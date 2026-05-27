#!/bin/bash
# Test the session-start.sh shared-tree block (#904). Three cases:
#
#   1. Peers present + main tree (no worktree) + no override
#        → exit 2, stderr contains "git worktree add"
#   2. Peers present + main tree + HF_FORCE_SHARED_TREE=1
#        → exit 0 (opt-out honoured, banner annotates the override)
#   3. PEER_COUNT == 1 (solo session, anywhere)
#        → exit 0 (no peer = no block)
#
# Strategy: spawn session-start.sh in a fully sandboxed PATH where
# `git`, `pgrep`, `cd`, and `shasum` are wrapped by tiny shims. The
# shims report whatever the test case needs (main tree vs worktree,
# 1 vs N peers). The cd shim swallows the script's `cd
# /Users/paulwander/projects/HF` line so the test does not actually
# leave its sandbox dir.
#
# Pure bash, no external deps. macOS bash 3.2 compatible.

set -u

# Always run against the file in this checkout, regardless of cwd.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
HOOK="$SCRIPT_DIR/../session-start.sh"
if [ ! -f "$HOOK" ]; then
  echo "FAIL: session-start.sh not found at $HOOK" >&2
  exit 1
fi

PASS=0
FAIL=0
fail() { echo "FAIL: $1" >&2; FAIL=$((FAIL + 1)); }
pass() { echo "pass: $1"; PASS=$((PASS + 1)); }

# Build a sandbox PATH with shim binaries that match the case we want
# to exercise. Returns the sandbox dir on stdout.
#
#   build_sandbox <mode> <peer_count>
#     mode = main | worktree
#     peer_count = integer (lines pgrep emits)
build_sandbox() {
  local mode="$1"
  local peers="$2"
  local sandbox
  sandbox=$(mktemp -d 2>/dev/null || mktemp -d -t hf-904)
  mkdir -p "$sandbox/bin"

  # Build fake on-disk git layout inside the sandbox so the hook's
  # `cd "$GIT_DIR" && pwd -P` normalisation succeeds. Without these,
  # GIT_DIR_ABS comes back empty and IS_WORKTREE stays "false"
  # regardless of the configured mode.
  local fake_common="$sandbox/repo/.git"
  local fake_main_top="$sandbox/repo"
  local fake_worktree_top="$sandbox/worktree"
  local fake_worktree_gitdir="$fake_common/worktrees/fake"
  mkdir -p "$fake_common" "$fake_main_top" "$fake_worktree_top" "$fake_worktree_gitdir"

  # `git` shim — covers every subcommand session-start.sh calls.
  # Other subcommands fall through to /dev/null (return ""), which the
  # hook tolerates because every git call is wrapped in 2>/dev/null
  # and || fallback.
  cat > "$sandbox/bin/git" <<GIT_SHIM
#!/bin/bash
case "\$1 \$2" in
  "rev-parse --show-toplevel")
    if [ "$mode" = "worktree" ]; then
      echo "$fake_worktree_top"
    else
      echo "$fake_main_top"
    fi
    ;;
  "rev-parse --git-dir")
    if [ "$mode" = "worktree" ]; then
      echo "$fake_worktree_gitdir"
    else
      echo "$fake_common"
    fi
    ;;
  "rev-parse --git-common-dir")
    echo "$fake_common"
    ;;
  "rev-parse HEAD")
    echo "deadbeefcafe1234567890"
    ;;
  "symbolic-ref --short")
    echo "main"
    ;;
  "status --porcelain")
    ;;
  "log -1")
    ;;
  *)
    ;;
esac
GIT_SHIM
  chmod +x "$sandbox/bin/git"

  # `pgrep` shim — emit <peers> lines of fake PIDs. The hook pipes to
  # `wc -l` so the actual content doesn't matter.
  cat > "$sandbox/bin/pgrep" <<PGREP_SHIM
#!/bin/bash
i=0
while [ \$i -lt $peers ]; do
  echo \$((10000 + i))
  i=\$((i + 1))
done
PGREP_SHIM
  chmod +x "$sandbox/bin/pgrep"

  # The script also calls `shasum`, `hostname`, `date`, `ps`, `cut`,
  # `kill`, `tr`, `wc`, `cd`, `sed` — leave those resolved via the
  # caller's PATH after our PATH override.
  printf '%s' "$sandbox"
}

run_hook() {
  # run_hook <sandbox> [env-pairs...]
  # Prepends sandbox bin to PATH, runs hook, captures exit + stderr.
  # bash 3.2 won't expand an empty `"${arr[@]}"` under `set -u`, so we
  # forward extra args directly via "$@" after the shift.
  local sandbox="$1"; shift
  local stderr_file
  stderr_file=$(mktemp 2>/dev/null || mktemp -t hf-904-err)
  env -i \
    PATH="$sandbox/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HOME" \
    "$@" \
    bash "$HOOK" >/dev/null 2>"$stderr_file"
  local code=$?
  LAST_STDERR=$(cat "$stderr_file")
  rm -f "$stderr_file"
  return $code
}

# --- Test 1: main tree + peers + no override → BLOCK ---
SBX=$(build_sandbox main 2)
run_hook "$SBX"
code=$?
rm -rf "$SBX"
if [ "$code" -ne 2 ]; then
  fail "test 1: expected exit 2, got $code"
elif ! printf '%s' "$LAST_STDERR" | grep -q "git worktree add"; then
  fail "test 1: stderr missing 'git worktree add'; got: $LAST_STDERR"
else
  pass "main-tree + 2 peers + no override → exit 2 with git worktree instruction"
fi

# --- Test 2: main tree + peers + HF_FORCE_SHARED_TREE=1 → ALLOW ---
SBX=$(build_sandbox main 2)
run_hook "$SBX" HF_FORCE_SHARED_TREE=1
code=$?
rm -rf "$SBX"
if [ "$code" -ne 0 ]; then
  fail "test 2: HF_FORCE_SHARED_TREE=1 should bypass; got exit $code, stderr=$LAST_STDERR"
else
  pass "main-tree + 2 peers + HF_FORCE_SHARED_TREE=1 → exit 0 (opt-out honoured)"
fi

# --- Test 3: solo session (PEER_COUNT=1) → ALLOW ---
SBX=$(build_sandbox main 1)
run_hook "$SBX"
code=$?
rm -rf "$SBX"
if [ "$code" -ne 0 ]; then
  fail "test 3: solo session should not block; got exit $code, stderr=$LAST_STDERR"
else
  pass "main-tree + 1 peer (solo) → exit 0 (no peer, no block)"
fi

# --- Test 4: worktree + many peers → ALLOW ---
# Belt-and-braces: ensures worktree detection works even when peers exist.
SBX=$(build_sandbox worktree 5)
run_hook "$SBX"
code=$?
rm -rf "$SBX"
if [ "$code" -ne 0 ]; then
  fail "test 4: worktree + peers should not block; got exit $code, stderr=$LAST_STDERR"
else
  pass "worktree + 5 peers → exit 0 (isolated, safe)"
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

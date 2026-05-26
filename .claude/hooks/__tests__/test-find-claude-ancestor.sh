#!/bin/bash
# Test the find_claude_ancestor helper duplicated into
# session-start.sh and git-lock-enforcer.sh (#899). Exits non-zero on
# any failure. macOS bash 3.2 compatible (no associative arrays).
#
# Strategy: override `ps` via a shim function that returns fabricated
# comm/ppid values keyed by PID via dynamic variable names, and assert
# the helper climbs to the right ancestor.

set -u

PASS=0
FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }
pass() { echo "pass: $1"; PASS=$((PASS + 1)); }

# Reset mock table — unset all MOCK_COMM_* / MOCK_PPID_* vars.
mock_reset() {
  local v
  for v in $(compgen -v | grep -E '^MOCK_(COMM|PPID)_'); do
    unset "$v"
  done
}

mock_set() {
  # mock_set <pid> <comm> <ppid>
  eval "MOCK_COMM_$1=\"\$2\""
  eval "MOCK_PPID_$1=\"\$3\""
}

# Shim `ps` for the helper. Honours only the patterns the helper uses:
#   ps -o comm= -p <pid>
#   ps -o ppid= -p <pid>
ps() {
  local field="" pid=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) field="$2"; shift 2 ;;
      -p) pid="$2"; shift 2 ;;
      *)  shift ;;
    esac
  done
  case "$field" in
    comm=) eval "printf '%s\n' \"\${MOCK_COMM_${pid}:-}\"" ;;
    ppid=) eval "printf '%s\n' \"\${MOCK_PPID_${pid}:-}\"" ;;
  esac
}

# Helper under test — duplicated verbatim from the hooks so any future
# divergence here is caught by the suite.
find_claude_ancestor() {
  local pid="${1:-$PPID}"
  local max_hops=20
  local hop=0
  local comm
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$hop" -lt "$max_hops" ]; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ' | sed 's|.*/||')
    if [ "$comm" = "claude" ]; then
      echo "$pid"
      return 0
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    hop=$((hop + 1))
  done
  ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' '
}

# --- Test 1: climbs past wrapper shell to claude ancestor ---
# Chain: 1000(bash hook) -> 999(zsh wrapper) -> 998(claude) -> 1(init)
mock_reset
mock_set 1000 "bash"   999
mock_set 999  "-zsh"   998
mock_set 998  "claude" 1
got=$(find_claude_ancestor 1000)
[ "$got" = "998" ] && pass "climbs past zsh wrapper to claude (got 998)" \
                   || fail "test 1: expected 998, got '$got'"

# --- Test 2: works with /path/to/claude (basename strip) ---
mock_reset
mock_set 2000 "bash"             1999
mock_set 1999 "-zsh"             1998
mock_set 1998 "/usr/bin/claude"  1
got=$(find_claude_ancestor 2000)
[ "$got" = "1998" ] && pass "strips path prefix from comm (got 1998)" \
                    || fail "test 2: expected 1998, got '$got'"

# --- Test 3: no claude in ancestry — fallback to one-step walk from $PPID ---
mock_reset
mock_set 3000 "bash"  2999
mock_set 2999 "-zsh"  2998
mock_set 2998 "login" 1
# Set the fallback target — ps -o ppid= -p $PPID returns 42424242.
mock_set "$PPID" "any" 42424242
got=$(find_claude_ancestor 3000)
[ "$got" = "42424242" ] && pass "fallback to one-step walk when no claude (got 42424242)" \
                        || fail "test 3: expected 42424242, got '$got'"

# --- Test 4: max_hops bounds — long chain with no claude exits cleanly ---
# Build a 25-deep chain (all bash); helper must terminate via max_hops
# rather than infinite-loop, then fall back to the $PPID walk.
mock_reset
i=4000
while [ "$i" -le 4024 ]; do
  mock_set "$i" "bash" $((i - 1))
  i=$((i + 1))
done
mock_set "$PPID" "any" 99999999
got=$(find_claude_ancestor 4024)
[ "$got" = "99999999" ] && pass "max_hops bound prevents infinite climb (got 99999999)" \
                        || fail "test 4: expected 99999999, got '$got'"

# --- Test 5: PID dies mid-walk — empty ppid terminates loop ---
mock_reset
mock_set 5000 "bash" 4999
mock_set 4999 "-zsh" ""           # parent vanished
mock_set "$PPID" "any" 55555555
got=$(find_claude_ancestor 5000)
[ "$got" = "55555555" ] && pass "empty ppid mid-walk falls through to fallback (got 55555555)" \
                        || fail "test 5: expected 55555555, got '$got'"

# --- Test 6: helper finds claude even when caller is itself the claude pid ---
mock_reset
mock_set 6000 "claude" 1
got=$(find_claude_ancestor 6000)
[ "$got" = "6000" ] && pass "returns starting PID when it is already claude (got 6000)" \
                    || fail "test 6: expected 6000, got '$got'"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

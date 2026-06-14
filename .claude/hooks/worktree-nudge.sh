#!/bin/bash
# PreToolUse:Edit|Write hook — warn-only worktree nudge for SECONDARY
# sessions still living in the shared main tree.
#
# Closes a gap in the #904 hard-block: that block fires at SessionStart
# and refuses NEW shared-tree sessions when peers exist. But a session
# that opened solo and then had peers come online mid-flight is allowed
# to keep going. When that session does a non-trivial Write/Edit it
# becomes exposed to the same HEAD-drift class — committed work can
# land on a peer's branch (incident 2026-06-13: ADR commit ended up
# on `feat/sp4d-goal-evidence-polish`, escaped via PR #1587 merge).
#
# This hook fires once per session on the first Edit/Write that lands
# in the main HF tree while peers are live. Warn-only, exit 0.

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$REPO_ROOT" ] && exit 0
cd "$REPO_ROOT" 2>/dev/null || exit 0

# Worktree detection (mirrors session-start.sh #904 logic).
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$GIT_DIR" ] && [ -n "$GIT_COMMON_DIR" ]; then
  GIT_DIR_ABS=$(cd "$GIT_DIR" 2>/dev/null && pwd -P)
  GIT_COMMON_DIR_ABS=$(cd "$GIT_COMMON_DIR" 2>/dev/null && pwd -P)
  if [ -n "$GIT_DIR_ABS" ] && [ "$GIT_DIR_ABS" != "$GIT_COMMON_DIR_ABS" ]; then
    # Already in a worktree — no nudge needed.
    exit 0
  fi
fi

# Solo session — no drift risk.
PEER_COUNT=$(pgrep -x claude 2>/dev/null | wc -l | tr -d ' ')
[ "$PEER_COUNT" -le 1 ] && exit 0

# Walk the process tree to find the ancestor claude PID. Identifies
# THIS session uniquely even though the hook spawns a fresh shell each
# call. Same pattern session-start.sh uses for orphan-reclaim — see
# the comment block there for the rationale.
walk_up_to_claude() {
  local pid=$$
  local hops=0
  while [ "$hops" -lt 12 ]; do
    local comm
    comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ')
    case "$comm" in
      claude|*/claude) printf '%s' "$pid"; return 0 ;;
    esac
    local ppid
    ppid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')
    [ -z "$ppid" ] || [ "$ppid" -eq 0 ] || [ "$ppid" -eq "$pid" ] && break
    pid="$ppid"
    hops=$((hops + 1))
  done
  printf '%s' "$$"  # fallback — at worst we re-nudge per shell, harmless
}

SESSION_PID=$(walk_up_to_claude)
MARKER="/tmp/claude-worktree-nudge-$SESSION_PID"
[ -f "$MARKER" ] && exit 0

# Fire the nudge to stderr — Claude sees it as hook output.
echo "🪴 SECONDARY session + first Edit/Write in the shared main tree ($PEER_COUNT peer claude processes live)." >&2
cat >&2 <<'EOF'

Edits and commits from this session can silently land on a peer's branch
when their git checkout swaps HEAD between your tool calls. This is the
HEAD-drift class (incident 2026-06-13: an ADR commit landed on
feat/sp4d-goal-evidence-polish because Session A checked out the branch
between Write and the git commit call).

Cheap fix — migrate this session to a worktree before committing:

    cd ..
    git worktree add HF-myrole HEAD       # if you have uncommitted work
    cd HF-myrole
    # restart claude here — HEAD swaps in the main tree no longer affect you

Or accept the risk for read-only / quick-edit work. This is warn-only,
not a block.
EOF

touch "$MARKER"
exit 0

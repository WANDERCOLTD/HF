#!/bin/bash
# PreToolUse:Bash hook — block destructive git ops from secondary
# claude sessions sharing the same working tree.
#
# Companion to session-start.sh (claims primary) and stop-release-lock.sh
# (releases on session end). Design: feedback_concurrent_claude_pidlock_design.md.
#
# Lock semantics:
#   - One lock per cwd hash → worktrees get independent locks, both primary
#   - Lock content: "<claude-pid>:<hostname>:<claim-epoch>"
#   - Primary: lock PID matches this session's claude PID → all git ops allowed
#   - Secondary: lock PID belongs to a peer (alive, same host) → destructive
#     git ops blocked with exit 2 + actionable message
#   - Stale lock: PID dead or different host → take over silently
#
# Escape hatch: set HF_FORCE_GIT=1 to bypass the block (operator override).
#
# Exit codes:
#   0 — allow the tool call
#   2 — block the tool call (claude renders stdout to the user)
#
# Input: JSON on stdin describing the tool call. We read only `tool_input.command`.

set -u

# Lock key = sha256 of the working-tree top. `git rev-parse --show-toplevel`
# returns a different path for each worktree (per `git worktree add ...`),
# so concurrent claude sessions in distinct worktrees get distinct locks
# and both run as primary in their own tree. Fall back to $PWD if not in
# a git tree (lock is harmlessly orphaned in that case).
TREE_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")
LOCK_KEY=$(printf '%s' "$TREE_TOPLEVEL" | shasum -a 256 | head -c8)
LOCK="/tmp/claude-lock-$LOCK_KEY"

# Read the incoming tool call payload (Claude Code passes JSON on stdin).
PAYLOAD=$(cat 2>/dev/null || true)

# Extract the bash command being attempted. Tolerant of missing jq.
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"command":[[:space:]]*"\([^"]*\)".*/\1/p')
fi

# Only inspect git commands. Anything non-git → allow.
case "$CMD" in
  *git*) ;;
  *) exit 0 ;;
esac

# Operator override.
if [ "${HF_FORCE_GIT:-0}" = "1" ]; then
  exit 0
fi

# No lock file → we're the only known session (session-start may not yet
# have claimed). Allow — letting through is safer than over-blocking.
if [ ! -f "$LOCK" ]; then
  exit 0
fi

LOCK_CONTENT=$(cat "$LOCK" 2>/dev/null || true)
LOCK_PID=$(printf '%s' "$LOCK_CONTENT" | cut -d: -f1)
LOCK_HOST=$(printf '%s' "$LOCK_CONTENT" | cut -d: -f2)

# Malformed lock → treat as no lock.
if [ -z "$LOCK_PID" ] || [ -z "$LOCK_HOST" ]; then
  exit 0
fi

# Lock owned by a different host (shared NFS scenario) → ignore.
if [ "$LOCK_HOST" != "$(hostname)" ]; then
  exit 0
fi

# Walk up the process tree to find a claude PID (hook bash → claude).
# $PPID is this script's parent (bash), $PPID's parent is the invoking
# process. On Claude Code that's the claude session.
MY_PPID="$PPID"
MY_CLAUDE_PID=$(ps -o ppid= -p "$MY_PPID" 2>/dev/null | tr -d ' ')

# Primary mode → lock PID matches our claude session.
if [ "$LOCK_PID" = "$MY_CLAUDE_PID" ] || [ "$LOCK_PID" = "$MY_PPID" ]; then
  exit 0
fi

# Check if the lock PID is alive.
if ! kill -0 "$LOCK_PID" 2>/dev/null; then
  # Stale lock → reclaim silently for this session.
  echo "$MY_CLAUDE_PID:$(hostname):$(date -u +%s)" > "$LOCK" 2>/dev/null || true
  exit 0
fi

# Secondary mode. Block destructive git ops only — allow read-only git
# commands (status, log, diff, show, branch, rev-parse, fetch).
# Match the command at word boundaries.
case "$CMD" in
  *"git checkout"*|*"git switch"*|*"git reset --hard"*|*"git pull"*|*"git merge"*|*"git rebase"*|*"git stash pop"*|*"git stash apply"*|*"git stash drop"*|*"git clean"*|*"git branch -f"*|*"git branch -D"*|*"git push --force"*|*"git push -f"*)
    cat <<EOF
🚫 Another claude session (PID $LOCK_PID) owns this working tree.
   This session is in SECONDARY mode — destructive git ops are blocked
   to prevent the peer's HEAD from being swapped under them.

   Attempted: $CMD

   To work concurrently, spawn an isolated worktree:
     git worktree add ../HF-myrole feat/your-branch
     cd ../HF-myrole
   Then start claude there. Lock is keyed on cwd hash → each worktree
   gets its own primary slot.

   Operator override (one-shot): set HF_FORCE_GIT=1 in the environment
   before the tool call. Use only if you've confirmed the peer session
   is finished or you accept the HEAD-swap risk.
EOF
    exit 2
    ;;
esac

# Read-only git command → allow.
exit 0

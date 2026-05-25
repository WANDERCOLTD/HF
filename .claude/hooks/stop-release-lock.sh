#!/bin/bash
# Stop hook — release the working-tree lock if this session owns it.
#
# Companion to git-lock-enforcer.sh and session-start.sh. Design:
# feedback_concurrent_claude_pidlock_design.md.
#
# If the lock file's recorded PID is our claude session, delete it so
# the next session in this cwd can claim primary cleanly. If it's a
# different (alive) PID, leave it alone — that's a peer we don't own.
#
# Never errors — stop hooks should be silent on the happy path.

set -u

TREE_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")
LOCK_KEY=$(printf '%s' "$TREE_TOPLEVEL" | shasum -a 256 | head -c8)
LOCK="/tmp/claude-lock-$LOCK_KEY"

[ -f "$LOCK" ] || exit 0

LOCK_PID=$(cut -d: -f1 < "$LOCK" 2>/dev/null)
[ -n "$LOCK_PID" ] || exit 0

MY_PPID="$PPID"
MY_CLAUDE_PID=$(ps -o ppid= -p "$MY_PPID" 2>/dev/null | tr -d ' ')

if [ "$LOCK_PID" = "$MY_CLAUDE_PID" ] || [ "$LOCK_PID" = "$MY_PPID" ]; then
  rm -f "$LOCK"
fi

exit 0

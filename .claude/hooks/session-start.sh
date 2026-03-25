#!/bin/bash
# SessionStart hook — show quick context on session open
# Outputs JSON with "message" field that Claude sees

cd /Users/paulwander/projects/HF || exit 0

# Check memory-sync staleness
MEMORY_SYNC_LOG="$HOME/.claude/projects/-Users-paulwander-projects-HF/memory/MEMORY.md"
LAST_SYNC=$(git log -1 --format="%ar" -- "$MEMORY_SYNC_LOG" 2>/dev/null || echo "unknown")

# Check for uncommitted changes
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# Build message
MSG=""
if [ "$DIRTY" -gt 0 ]; then
  MSG="$MSG⚠️  $DIRTY uncommitted changes from last session. "
fi

echo "$MSG"

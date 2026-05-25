#!/bin/bash
# SessionStart hook — show quick context on session open
# Outputs JSON with "message" field that Claude sees

cd /Users/paulwander/projects/HF || exit 0

# Check memory-sync staleness
MEMORY_SYNC_LOG="$HOME/.claude/projects/-Users-paulwander-projects-HF/memory/MEMORY.md"
LAST_SYNC=$(git log -1 --format="%ar" -- "$MEMORY_SYNC_LOG" 2>/dev/null || echo "unknown")

# Check for uncommitted changes
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# Concurrent claude processes — peer checkouts can swap HEAD silently.
# See memory/feedback_concurrent_claude_processes.md (2026-05-25 incident).
PEER_COUNT=$(pgrep -x claude 2>/dev/null | wc -l | tr -d ' ')

# Seed the shared HEAD snapshot the drift detector reads.
SNAPSHOT="/tmp/claude-head-snapshot-HF"
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
echo "$CURRENT_BRANCH @ $CURRENT_HEAD" > "$SNAPSHOT"

# Build message
MSG=""
if [ "$DIRTY" -gt 0 ]; then
  MSG="$MSG⚠️  $DIRTY uncommitted changes from last session. "
fi
if [ "$PEER_COUNT" -gt 1 ]; then
  MSG="${MSG}🚨 $PEER_COUNT concurrent claude processes detected. They share this working tree — peer 'git checkout' calls will swap HEAD under you. Treat any unexplained branch change as confirmation. See memory/feedback_concurrent_claude_processes.md for recovery. "
fi

echo "$MSG"

#!/bin/bash
# SessionStart hook — show quick context on session open + claim the
# working-tree lock so peer claude sessions sharing this tree see the
# block. Per memory/feedback_concurrent_claude_pidlock_design.md.
# Outputs JSON with "message" field that Claude sees.

# Derive the working-tree lock key BEFORE cd, so worktree sessions
# (which start in their own tree, not /Users/paulwander/projects/HF)
# get a per-worktree key. Companion hooks (git-lock-enforcer.sh,
# stop-release-lock.sh) compute the same way.
TREE_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")
LOCK_KEY=$(printf '%s' "$TREE_TOPLEVEL" | shasum -a 256 | head -c8)
LOCK="/tmp/claude-lock-$LOCK_KEY"

# Walk one level up from this script's bash → the claude PID (our PPID
# is the bash, PPID's parent is claude).
MY_CLAUDE_PID=$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')
LOCK_CONTENT="${MY_CLAUDE_PID:-$PPID}:$(hostname):$(date -u +%s)"

# Try atomic claim. noclobber refuses to overwrite existing locks.
if (set -o noclobber; echo "$LOCK_CONTENT" > "$LOCK") 2>/dev/null; then
  LOCK_ROLE="primary"
else
  # Existing lock — read it and decide.
  EXISTING_PID=$(cut -d: -f1 < "$LOCK" 2>/dev/null)
  EXISTING_HOST=$(cut -d: -f2 < "$LOCK" 2>/dev/null)
  if [ "$EXISTING_HOST" = "$(hostname)" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    LOCK_ROLE="secondary"
  else
    # Stale (dead PID or different host) → take over.
    echo "$LOCK_CONTENT" > "$LOCK"
    LOCK_ROLE="primary (reclaimed stale)"
  fi
fi

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
# Tell claude which lock role it claimed so it surfaces the right
# expectations to the user.
if [ "$LOCK_ROLE" = "secondary" ]; then
  MSG="${MSG}🔒 SECONDARY claude session — destructive git ops (checkout/switch/reset/pull/merge/rebase/stash pop/clean/branch -f/push -f) are blocked in this tree. Spawn an isolated worktree to work concurrently: \`git worktree add ../HF-myrole feat/your-branch && cd ../HF-myrole\` then start claude there. Operator override per command: HF_FORCE_GIT=1. "
elif [ "$LOCK_ROLE" = "primary (reclaimed stale)" ]; then
  MSG="${MSG}🔒 Reclaimed a stale lock (previous owner gone). This session is now PRIMARY. "
fi

echo "$MSG"

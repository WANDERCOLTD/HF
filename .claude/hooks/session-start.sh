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

# Worktree detection (#904) — also run BEFORE we cd into the main repo
# below, so we see the session's actual starting tree. The canonical
# git rule: in a linked worktree, git-dir lives under
# `.git/worktrees/<name>` while git-common-dir is the shared `.git` —
# they diverge. In the main repo checkout they are the same path.
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
IS_WORKTREE="false"
if [ -n "$GIT_DIR" ] && [ -n "$GIT_COMMON_DIR" ]; then
  # Normalise — both can return relative paths from the worktree cwd.
  GIT_DIR_ABS=$(cd "$GIT_DIR" 2>/dev/null && pwd -P)
  GIT_COMMON_DIR_ABS=$(cd "$GIT_COMMON_DIR" 2>/dev/null && pwd -P)
  if [ -n "$GIT_DIR_ABS" ] && [ "$GIT_DIR_ABS" != "$GIT_COMMON_DIR_ABS" ]; then
    IS_WORKTREE="true"
  fi
fi

# Hard block (#904): worktree isolation is now the structural default.
# Background: between 2026-05-25 and 2026-05-26 we shipped a five-commit
# fix chain (#841 → #849 → #861 → #870 → #899) bolting a PreToolUse
# enforcer onto the shared-.git problem. Every retrofit had a subtle
# semantic bug that ran live for hours before being noticed. The
# systemic fix is to refuse the dangerous state at startup so the
# enforcer becomes a defence-in-depth fallback, not the primary gate.
#
# We only block when a peer is already live (PEER_COUNT > 1). A solo
# session in the main tree is safe — nobody else can swap HEAD under it.
PEER_COUNT=$(pgrep -x claude 2>/dev/null | wc -l | tr -d ' ')
if [ "$PEER_COUNT" -gt 1 ] && [ "$IS_WORKTREE" != "true" ] && [ -z "$HF_FORCE_SHARED_TREE" ]; then
  cat >&2 <<EOF
🛑 BLOCKED: shared-tree claude session refused (#904).

$PEER_COUNT concurrent claude processes are live and this session is
opening in the main repo working tree (\`$TREE_TOPLEVEL\`). All concurrent
sessions MUST run in isolated git worktrees — peer \`git checkout\` calls
on a shared .git silently swap HEAD under live sessions (incident
2026-05-25, fix chain #841 → #849 → #861 → #870 → #899).

Start safely:

  git worktree add ../HF-myrole feat/your-branch && cd ../HF-myrole
  claude

Operator override (per-session, conscious risk):

  HF_FORCE_SHARED_TREE=1 claude

The override parallels the per-command \`HF_FORCE_GIT=1\` escape. Use
only when you have confirmed the peer is finished or accept the
HEAD-swap risk.
EOF
  exit 2
fi

# Climb the process tree until we find an ancestor whose comm is
# `claude`. Claude Code's hook execution layers a wrapper shell between
# this script and the claude session, so a one-step `ps -o ppid=` walk
# lands on the shell (comm `-zsh`) — not on claude. That used to
# silently break the orphan-reclaim path in git-lock-enforcer.sh, which
# would then rewrite the lock with another shell PID and exit 0,
# disabling all protection. See #899 for the live evidence.
#
# Fallback: if no claude ancestor is found within max_hops (e.g. when
# the hook is invoked manually for testing), preserve original
# behaviour by returning the one-step PPID-walk result.
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
  # Fallback to original one-step walk.
  ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' '
}

MY_CLAUDE_PID=$(find_claude_ancestor "$PPID")
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

# Portable repo root: Claude Code sets $CLAUDE_PROJECT_DIR to the project
# root on any machine; fall back to the git toplevel for manual runs.
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$REPO_ROOT" || exit 0

# Per-machine Claude memory dir: derive the dashed project key from the
# repo root (e.g. /Users/x/HF -> -Users-x-HF) so this resolves on any host.
PROJ_DASH=$(printf '%s' "$REPO_ROOT" | sed 's#/#-#g')

# Check memory-sync staleness
MEMORY_SYNC_LOG="$HOME/.claude/projects/$PROJ_DASH/memory/MEMORY.md"
LAST_SYNC=$(git log -1 --format="%ar" -- "$MEMORY_SYNC_LOG" 2>/dev/null || echo "unknown")

# Check for uncommitted changes
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# Seed the shared HEAD snapshot the drift detector reads.
SNAPSHOT="/tmp/claude-head-snapshot-HF"
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
echo "$CURRENT_BRANCH @ $CURRENT_HEAD" > "$SNAPSHOT"

# Build message
MSG=""
if [ -n "$HF_FORCE_SHARED_TREE" ] && [ "$PEER_COUNT" -gt 1 ] && [ "$IS_WORKTREE" != "true" ]; then
  # Document the opt-out in the session banner so it's auditable.
  MSG="${MSG}⚠️  HF_FORCE_SHARED_TREE=1 active — shared-tree opt-out, peer HEAD-swap risk acknowledged. "
fi
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

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

# Hard block (#904, hardened 2026-06-15): worktree isolation is the
# structural default for EVERY session in the main repo tree, regardless
# of peer count.
#
# Pre-2026-06-15 the block only fired when `PEER_COUNT > 1` on the theory
# that "a solo session in the main tree is safe — nobody else can swap
# HEAD under it." That assumption held only until a SECOND session
# started. Real-world race: peers spawned via IDE integrations
# (Cursor / VS Code Claude / web-app) bypass the `claude()` zsh wrapper
# that auto-worktrees interactive shells. Those peers landed solo in the
# main tree (block passed), then a subsequent session opened, raced, and
# destroyed work on `git pull --rebase` / `git checkout`. Twice in one
# session 2026-06-15 — the same workflow lost 5 commits via reset, was
# manually recovered via cherry-pick from reflog, lost 2 more on the
# next push attempt, recovered again. Untenable.
#
# New invariant: the main tree is a hands-off branch-management workspace,
# never a session workspace. Every session — first, solo, or 17th —
# starts in a worktree. The wrapper handles the friendly path
# (interactive zsh); this hook handles the IDE-spawn-bypass path.
echo "/standup"
PEER_COUNT=$(pgrep -x claude 2>/dev/null | wc -l | tr -d ' ')
if [ "$IS_WORKTREE" != "true" ] && [ -z "$HF_FORCE_SHARED_TREE" ]; then
  # Suggest a safe branch slug from the current HEAD so the instruction
  # is copy-paste runnable. Fallback to "main" if not on a branch.
  SUGGEST_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
  SUGGEST_SLUG=$(printf '%s' "$SUGGEST_BRANCH" | tr '/' '-' | tr -c 'A-Za-z0-9-' '-')
  SUGGEST_PATH="$TREE_TOPLEVEL-wt-$SUGGEST_SLUG"
  cat >&2 <<EOF
🛑 BLOCKED: shared-tree claude session refused (#904, hardened 2026-06-15).

This session is opening in the main repo working tree (\`$TREE_TOPLEVEL\`).
The main tree is reserved for branch management — every claude session
must run in an isolated git worktree so peer sessions can't swap HEAD
under each other via the shared \`.git\` directory. ($PEER_COUNT claude
process(es) currently live.)

Start safely (copy-paste):

  git worktree add "$SUGGEST_PATH" $SUGGEST_BRANCH
  cd "$SUGGEST_PATH"
  claude

Or for a fresh feature branch:

  git worktree add -b feat/your-task "$TREE_TOPLEVEL-wt-feat-your-task" main
  cd "$TREE_TOPLEVEL-wt-feat-your-task"
  claude

Operator override (per-session, conscious risk — destructive git ops
from peers can still destroy work in this tree):

  HF_FORCE_SHARED_TREE=1 claude

The override parallels the per-command \`HF_FORCE_GIT=1\` escape. Use
only for hands-off branch management (status / log / diff) or when you
have confirmed every other claude process is finished. For real work,
ALWAYS use a worktree.

Why this is mandatory: peer sessions spawned via IDE integrations
(Cursor / VS Code Claude / web-app) bypass the \`claude()\` zsh wrapper
that normally handles auto-worktree. The wrapper + this hook are the
two-layer defence; bypassing one means the other catches you.
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
REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/paulwander/projects/HF}"
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

# Agent-worktree zombie nudge — surfaces when accumulation gets noisy
# without making an gh API call on every session start. Threshold of 6
# allows for typical in-flight work + main; above that, the cleanup
# script almost always has zombies to garbage-collect.
ZOMBIE_COUNT=$(find "$REPO_ROOT/.claude/worktrees" -maxdepth 1 -type d -name 'agent-*' 2>/dev/null | wc -l | tr -d ' ')
if [ "$ZOMBIE_COUNT" -gt 6 ]; then
  MSG="${MSG}🧟 $ZOMBIE_COUNT agent worktrees in .claude/worktrees/ — likely zombies from merged-PR agents. Run \`bash scripts/cleanup-agent-worktrees.sh --dry-run\` to see what's removable; drop \`--dry-run\` to GC. "
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


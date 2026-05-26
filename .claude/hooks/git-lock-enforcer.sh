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

# Climb the process tree until we find an ancestor whose comm is
# `claude`. Claude Code's hook execution layers a wrapper shell between
# this script and the claude session, so a one-step `ps -o ppid=` walk
# lands on the shell (comm `-zsh`) — not on claude. That used to
# silently mask all protection: the lock owner would be a shell PID,
# the orphan-reclaim path below would fire, the lock would be rewritten
# with another shell PID, and we'd exit 0 on every git command. See
# #899 for the live evidence.
#
# Fallback: if no claude ancestor is found within max_hops (e.g. when
# the hook is invoked manually for testing), preserve original
# behaviour by returning the one-step PPID-walk result. Duplicated from
# session-start.sh — these are bash hooks with no module system.
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

MY_PPID="$PPID"
MY_CLAUDE_PID=$(find_claude_ancestor "$MY_PPID")

# Primary mode → lock PID matches our claude session.
if [ "$LOCK_PID" = "$MY_CLAUDE_PID" ] || [ "$LOCK_PID" = "$MY_PPID" ]; then
  exit 0
fi

# Check if the lock PID is alive AND a claude process. An alive PID that
# isn't a claude (e.g. an orphan zsh, Finder) is a stale lock — the previous
# claude crashed before its Stop hook released the lock, and the OS later
# reassigned the PID to something unrelated. Without the comm check the
# hook would forever treat that lock as a live peer and block this session.
# (Bug fix on top of #849, reported during the cleanup pass that followed
#  the merge.)
LOCK_PROC=$(ps -o comm= -p "$LOCK_PID" 2>/dev/null | tr -d ' ')
if ! kill -0 "$LOCK_PID" 2>/dev/null; then
  # Stale lock (dead PID) → reclaim silently for this session.
  echo "$MY_CLAUDE_PID:$(hostname):$(date -u +%s)" > "$LOCK" 2>/dev/null || true
  exit 0
fi
case "$LOCK_PROC" in
  claude|*/claude)
    : # Live claude — fall through to secondary-mode check below.
    ;;
  *)
    # Live PID but not a claude — orphan lock. Reclaim silently.
    echo "$MY_CLAUDE_PID:$(hostname):$(date -u +%s)" > "$LOCK" 2>/dev/null || true
    exit 0
    ;;
esac

# Secondary mode. Block destructive git ops only — allow read-only git
# commands (status, log, diff, show, branch -list, rev-parse, fetch).
#
# Match keywords at word boundaries via a regex with bash's =~ operator
# (shell glob patterns in `case` substring-match and would over-block —
# e.g. `*"git merge"*` matches `git merge-base`, which is a read).
# Each alternative is anchored on the trailing side by space or
# end-of-string so the keyword can't be part of a longer command name.
GIT_BLOCK_RE='git[[:space:]]+(checkout|switch|reset[[:space:]]+--hard|pull|merge|rebase|stash[[:space:]]+(pop|apply|drop)|clean|branch[[:space:]]+-[fD]|push[[:space:]]+(--force|-f))([[:space:]]|$)'
if [[ "$CMD" =~ $GIT_BLOCK_RE ]]; then
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
fi

# Read-only git command → allow.
exit 0

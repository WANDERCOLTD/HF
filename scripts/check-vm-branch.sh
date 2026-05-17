#!/bin/bash
# check-vm-branch.sh — verify local branch state matches origin before VM operations.
#
# Catches the silent drift class of bug (#423): when local HEAD has commits not
# on origin/{branch} (e.g. accidental cherry-pick, lost rebase, manual reset
# pointing at a foreign commit), VM operations push/run that drift without
# warning. Multiple incidents on 2026-05-17 traced to this.
#
# Exit codes:
#   0 — local HEAD matches origin/{branch} exactly (or only legitimately ahead with pushable commits — caller can decide)
#   1 — local has diverged (commits not on origin) — abort the caller
#   2 — local is behind origin (uncommon — usually means caller should pull) — abort the caller
#   3 — detached HEAD or other unrecoverable git state — abort the caller
#
# Usage:
#   scripts/check-vm-branch.sh              # check current branch
#   scripts/check-vm-branch.sh allow-ahead  # tolerate local-ahead-of-origin (e.g. before a push)

set -u

ALLOW_AHEAD="${1:-strict}"

# Resolve current branch
BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || {
  echo "❌ check-vm-branch: detached HEAD or no current branch."
  echo "   Run 'git checkout <branch>' before any VM operation."
  exit 3
}

# Fetch quietly so the comparison is against latest remote tip.
# Tolerate offline / no-network — fall back to last known state.
git fetch origin "$BRANCH" --quiet 2>/dev/null || {
  echo "⚠️  check-vm-branch: could not fetch origin/$BRANCH (network?). Using last known remote state."
}

UPSTREAM="origin/$BRANCH"

# Confirm the upstream ref exists (the branch may be local-only).
if ! git rev-parse --verify --quiet "$UPSTREAM" >/dev/null; then
  echo "❌ check-vm-branch: no remote branch '$UPSTREAM' exists."
  echo "   Push the branch first ('git push -u origin $BRANCH') or switch to a tracked branch."
  exit 1
fi

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "$UPSTREAM")
BASE=$(git merge-base HEAD "$UPSTREAM")

if [ "$LOCAL" = "$REMOTE" ]; then
  # In sync.
  exit 0
fi

if [ "$LOCAL" = "$BASE" ]; then
  # Local is strictly behind remote — fast-forward needed.
  echo "❌ check-vm-branch: $BRANCH is BEHIND $UPSTREAM."
  echo "   Local HEAD:  $(git log --oneline -1 HEAD)"
  echo "   Remote HEAD: $(git log --oneline -1 "$UPSTREAM")"
  echo "   Run: git pull --ff-only"
  exit 2
fi

if [ "$REMOTE" = "$BASE" ]; then
  # Local is strictly ahead of remote (has unpushed commits).
  COUNT=$(git rev-list --count "$UPSTREAM..HEAD")
  if [ "$ALLOW_AHEAD" = "allow-ahead" ]; then
    # Caller (e.g. /vm-cp which is about to push) is fine with this.
    exit 0
  fi
  echo "❌ check-vm-branch: $BRANCH has $COUNT unpushed commit(s) not on $UPSTREAM."
  echo "   Unpushed:"
  git log --oneline "$UPSTREAM..HEAD" | sed 's/^/     /'
  echo "   This may be legitimate work-in-progress, OR a stray cherry-pick/rebase that"
  echo "   silently pulled in commits from elsewhere (the #423 class of incident)."
  echo "   If intended: re-run with 'allow-ahead', or 'git push' first."
  echo "   If not:     'git reset --hard $UPSTREAM' to discard the local-only commits."
  exit 1
fi

# Both diverged: local AND remote have commits the other lacks.
LOCAL_AHEAD=$(git rev-list --count "$UPSTREAM..HEAD")
REMOTE_AHEAD=$(git rev-list --count "HEAD..$UPSTREAM")
echo "❌ check-vm-branch: $BRANCH has DIVERGED from $UPSTREAM."
echo "   Local ahead by $LOCAL_AHEAD commit(s), remote ahead by $REMOTE_AHEAD commit(s)."
echo "   Run 'git log --oneline --graph HEAD $UPSTREAM' to inspect."
echo "   To accept remote and discard local: 'git reset --hard $UPSTREAM'."
echo "   To rebase local on top of remote:   'git pull --rebase'."
exit 1

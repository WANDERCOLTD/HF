#!/usr/bin/env bash
# scripts/check-vm-migration-lock.sh
#
# Reads .vm-migration-lock at repo root and warns if another operator has
# a pending Prisma migration. Used by:
#   - .claude/hooks/session-start.sh (warn-only at session open)
#   - scripts/vm-migrate.sh (block before starting a new migration)
#
# Lock-file format (single line, pipe-separated):
#   <owner>|<iso8601-timestamp>|<branch>|<migration-intent>
#
# Lock is considered STALE after 30 min (operator forgot to /vm-cpp).
# Stale locks warn but don't block — operator can rerun the wrapper to reclaim.
#
# Exit codes:
#   0 — no lock, OR lock held by current operator, OR lock is stale (warn)
#   1 — lock held by another operator, fresh (< 30 min)
#
# Used by scripts/vm-migrate.sh with --strict to convert exit 1 → block.

set -euo pipefail

MODE="${1:-warn}"  # warn (default) | strict | summary
# summary: emit ONE line to stdout (for session-start.sh embedding), exit 0
# warn:    multi-line stderr, exit 0 (default; pre-action visibility)
# strict:  multi-line stderr + exit 1 if lock held by another operator (block)

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$REPO_ROOT" ] && exit 0
LOCK_FILE="$REPO_ROOT/.vm-migration-lock"

# No lock — clean state.
[ ! -f "$LOCK_FILE" ] && exit 0

LOCK_LINE="$(head -1 "$LOCK_FILE" 2>/dev/null || true)"
[ -z "$LOCK_LINE" ] && exit 0

IFS='|' read -r LOCK_OWNER LOCK_TS LOCK_BRANCH LOCK_INTENT <<< "$LOCK_LINE"

# Current operator: prefer GIT_AUTHOR_NAME, fall back to git config, then $USER.
ME="${GIT_AUTHOR_NAME:-$(git config --get user.name 2>/dev/null || echo "$USER")}"

# Stale check (30 min). Lock file mtime is the source of truth (more reliable
# than the embedded timestamp which may not match TZ).
LOCK_MTIME=$(stat -f '%m' "$LOCK_FILE" 2>/dev/null || stat -c '%Y' "$LOCK_FILE" 2>/dev/null || echo 0)
NOW=$(date +%s)
AGE_SECS=$(( NOW - LOCK_MTIME ))

AGE_MIN=$((AGE_SECS / 60))

if [ "$AGE_SECS" -gt 1800 ]; then
  if [ "$MODE" = "summary" ]; then
    echo "🟡 VM-migration-lock stale (${AGE_MIN}m): $LOCK_OWNER on $LOCK_BRANCH — safe to reclaim."
  else
    echo "" >&2
    echo "[vm-migration-lock] ⚠ Stale lock detected (>30 min old):" >&2
    echo "  owner:    $LOCK_OWNER" >&2
    echo "  branch:   $LOCK_BRANCH" >&2
    echo "  age:      ${AGE_MIN} min" >&2
    echo "  intent:   $LOCK_INTENT" >&2
    echo "  Path:     $LOCK_FILE" >&2
    echo "  Stale — safe to reclaim. Run scripts/vm-migrate.sh to take over." >&2
  fi
  exit 0
fi

# Lock held by current operator — no warn.
[ "$LOCK_OWNER" = "$ME" ] && exit 0

# Fresh lock held by someone else — warn (or block in strict mode).
if [ "$MODE" = "summary" ]; then
  echo "🛑 VM-migration-lock held by $LOCK_OWNER on $LOCK_BRANCH (${AGE_MIN}m ago) — don't run prisma migrate dev."
  exit 0
fi

echo "" >&2
echo "[vm-migration-lock] 🛑 Another operator has a pending Prisma migration:" >&2
echo "  owner:    $LOCK_OWNER" >&2
echo "  branch:   $LOCK_BRANCH" >&2
echo "  age:      ${AGE_MIN} min" >&2
echo "  intent:   $LOCK_INTENT" >&2
echo "" >&2
echo "  DO NOT run 'npx prisma migrate dev' until lock clears." >&2
echo "  Coordinate with $LOCK_OWNER or wait for their /vm-cpp push." >&2
echo "" >&2

if [ "$MODE" = "strict" ]; then
  exit 1
fi
exit 0

#!/usr/bin/env bash
# scripts/vm-migrate.sh
#
# Wrapper for `npx prisma migrate dev` that adds the multi-operator lock
# discipline (S8 / #1763). Use this on the VM instead of bare `npx prisma
# migrate dev` to prevent concurrent-migration races between Paul + Boaz
# on shared hf_sandbox.
#
# Usage:
#   scripts/vm-migrate.sh --name <migration-slug>
#   scripts/vm-migrate.sh --name add_xyz_table --create-only
#   scripts/vm-migrate.sh --help
#
# All args after the wrapper's own are passed through to `prisma migrate dev`.
#
# Lifecycle:
#   1. Pre-flight check via scripts/check-vm-migration-lock.sh --strict.
#      If another operator holds a fresh lock, exit 1.
#   2. Write .vm-migration-lock with this operator's identity.
#   3. Run npx prisma migrate dev "$@" inside apps/admin/.
#   4. On success: delete the lock.
#   5. On failure: keep the lock (operator may retry).
#   6. .vm-migration-lock is in .gitignore — never committed.
#
# Bypass (not recommended): set HF_VM_MIGRATE_BYPASS=1 to skip the lock check.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "[vm-migrate] ✗ not in a git repo — aborting" >&2
  exit 1
fi

cd "$REPO_ROOT"

# ── Pre-flight ────────────────────────────────────────────────────────────
if [ "${HF_VM_MIGRATE_BYPASS:-0}" != "1" ]; then
  if ! ./scripts/check-vm-migration-lock.sh strict; then
    echo "[vm-migrate] Blocked by fresh lock from another operator." >&2
    echo "[vm-migrate] If you must proceed: HF_VM_MIGRATE_BYPASS=1 scripts/vm-migrate.sh ..." >&2
    exit 1
  fi
fi

# ── Acquire lock ─────────────────────────────────────────────────────────
LOCK_FILE="$REPO_ROOT/.vm-migration-lock"
OWNER="${GIT_AUTHOR_NAME:-$(git config --get user.name 2>/dev/null || echo "$USER")}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "<detached>")"
INTENT="$*"
[ -z "$INTENT" ] && INTENT="(bare prisma migrate dev)"

printf '%s|%s|%s|%s\n' "$OWNER" "$TIMESTAMP" "$BRANCH" "$INTENT" > "$LOCK_FILE"
echo "[vm-migrate] 🔒 Acquired lock: $OWNER on $BRANCH at $TIMESTAMP" >&2

# ── Run migration ────────────────────────────────────────────────────────
cd apps/admin
if npx prisma migrate dev "$@"; then
  rm -f "$LOCK_FILE"
  echo "[vm-migrate] 🔓 Lock released — migration succeeded" >&2
  echo "[vm-migrate] Don't forget to commit + push (/vm-cpp) so the migration reaches other envs." >&2
  exit 0
else
  RC=$?
  echo "[vm-migrate] ✗ Migration failed (exit $RC); LOCK RETAINED." >&2
  echo "[vm-migrate] Investigate, retry, or manually delete $LOCK_FILE if abandoning." >&2
  exit "$RC"
fi

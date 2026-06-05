#!/bin/bash
#
# generate-migration.sh — create a Prisma migration without going through
# the broken shadow-DB rebuild. Runs `prisma migrate diff --from-url`
# against the live DB pointed at by $DATABASE_URL, lets you eyeball the
# SQL before applying, then registers the migration as applied.
#
# WHY THIS EXISTS: see docs/MIGRATIONS.md. The repo's pre-formal-migrations
# tables (Caller, Domain, etc.) were never CREATE TABLE'd in any migration,
# so `prisma migrate dev` always fails at the shadow-DB replay step.
#
# USAGE (run on hf-dev VM, where Postgres is reachable):
#   cd ~/HF/apps/admin
#   ./scripts/generate-migration.sh <migration_name>
#
# Example:
#   ./scripts/generate-migration.sh caller_identity_challenge
#
# Always read the generated SQL before confirming — the diff includes any
# drift between the live DB and schema.prisma (DROP TABLE tallyseal_*,
# unrelated ALTER COLUMN, etc.), not just your intended change.

set -e

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Usage: $0 <migration_name>" >&2
  echo "Example: $0 caller_identity_challenge" >&2
  exit 1
fi

# Validate name: lowercase, digits, underscores only — matches Prisma's convention.
if ! printf '%s' "$NAME" | grep -Eq '^[a-z0-9_]+$'; then
  echo "Migration name must be lowercase letters / digits / underscores only." >&2
  echo "Got: $NAME" >&2
  exit 1
fi

# Must run from apps/admin (where prisma/ lives).
if [ ! -f prisma/schema.prisma ]; then
  echo "Run this from apps/admin/ (no prisma/schema.prisma found in cwd)." >&2
  exit 1
fi

# Source .env so DATABASE_URL is available.
if [ ! -f .env ]; then
  echo "No .env in cwd — DATABASE_URL needed for --from-url." >&2
  exit 1
fi
set -a
. .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set after sourcing .env." >&2
  exit 1
fi

TS=$(date -u +%Y%m%d%H%M%S)
FULL_NAME="${TS}_${NAME}"
DIR="prisma/migrations/${FULL_NAME}"

mkdir -p "$DIR"

echo "==> Generating SQL diff (live DB → schema.prisma)..."
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$DIR/migration.sql"

if [ ! -s "$DIR/migration.sql" ]; then
  echo ""
  echo "Generated SQL is empty — schema is already in sync with the DB." >&2
  echo "Removing empty migration directory: $DIR" >&2
  rm -rf "$DIR"
  exit 1
fi

echo ""
echo "================================================================"
echo "Generated migration SQL — review before applying:"
echo "================================================================"
cat "$DIR/migration.sql"
echo "================================================================"
echo ""
echo "Path: $DIR/migration.sql"
echo ""
echo "★ Check for unrelated drift (DROP TABLE tallyseal_*, unwanted ALTERs)."
echo "  If the diff is wrong, edit $DIR/migration.sql before continuing."
echo ""
read -p "Apply this SQL to the DB now? [y/N] " -n 1 -r ANSWER
echo ""
if [[ ! "$ANSWER" =~ ^[Yy]$ ]]; then
  echo "Aborted. Migration file kept at $DIR/migration.sql — edit + re-run apply manually:"
  echo "  npx prisma db execute --file $DIR/migration.sql --schema prisma/schema.prisma"
  echo "  npx prisma migrate resolve --applied $FULL_NAME"
  exit 0
fi

echo ""
echo "==> Applying SQL via prisma db execute..."
npx prisma db execute \
  --file "$DIR/migration.sql" \
  --schema prisma/schema.prisma

echo ""
echo "==> Registering migration as applied in _prisma_migrations..."
npx prisma migrate resolve --applied "$FULL_NAME"

echo ""
echo "==> Regenerating Prisma client..."
npx prisma generate

echo ""
echo "================================================================"
echo "Done. Next steps:"
echo "  git add apps/admin/prisma/migrations/$FULL_NAME"
echo "  git commit -m 'feat(<area>): <description> (#NNNN)'"
echo "  git push"
echo "================================================================"

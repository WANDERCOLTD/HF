#!/usr/bin/env bash
# #944 — Block schema.prisma changes without a paired migration file.
#
# Substantive changes to apps/admin/prisma/schema.prisma MUST be accompanied
# by at least one new apps/admin/prisma/migrations/*/migration.sql file in
# the same diff. Without one, `prisma migrate deploy` is a no-op and every
# environment that pulls main breaks with `P2022 column does not exist`.
#
# This script is run from:
#   - .github/workflows/test.yml (hard gate at PR time)
#   - .claude/agents/migration-checker.md (advisory at author time)
#   - .claude/agents/guard-checker.md (advisory pre-commit)
#
# Usage:
#   scripts/check-schema-has-migration.sh [BASE_REF]
#
#   BASE_REF defaults to `origin/main` (local use) or the CI base ref when
#   running under GitHub Actions.
#
# Exit codes:
#   0 — clean (no schema change, comment-only change, or schema + migration)
#   1 — substantive schema change without a paired migration file
#   2 — script error (couldn't find git, no base ref, etc.)
#
# False-positive prevention: comment-only edits to schema.prisma (lines that
# are entirely blank, `//`, or `///` JSDoc comments after stripping leading
# `+`/`-`) are ignored. The check looks for at least one substantive token
# change before requiring a migration.

set -u

SCHEMA_FILE="apps/admin/prisma/schema.prisma"
MIGRATIONS_GLOB='^apps/admin/prisma/migrations/[^/]+/migration\.sql$'

if ! command -v git >/dev/null 2>&1; then
  echo "[check-schema-has-migration] git not available — skipping" >&2
  exit 2
fi

# Resolve base ref.
BASE="${1:-}"
if [ -z "$BASE" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    BASE="origin/${GITHUB_BASE_REF}"
  else
    BASE="origin/main"
  fi
fi

# Make sure the base ref is reachable. In CI the checkout action sometimes
# only fetches the head; fall back to fetching the base if needed.
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  git fetch origin "${BASE#origin/}" --depth=50 >/dev/null 2>&1 || true
fi

if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "[check-schema-has-migration] cannot resolve base ref '$BASE' — skipping" >&2
  exit 0
fi

MERGE_BASE=$(git merge-base "$BASE" HEAD 2>/dev/null || echo "$BASE")

# Did schema.prisma change at all in this range?
if ! git diff --quiet "$MERGE_BASE...HEAD" -- "$SCHEMA_FILE"; then
  SCHEMA_CHANGED=1
else
  SCHEMA_CHANGED=0
fi

if [ "$SCHEMA_CHANGED" -eq 0 ]; then
  exit 0
fi

# Strip:
#   - diff hunk headers (`@@`, `+++`, `---`)
#   - blank lines on either side
#   - comment lines (`//` or `///`, possibly indented)
# Keep only substantive added/removed lines.
SUBSTANTIVE=$(
  git diff "$MERGE_BASE...HEAD" -- "$SCHEMA_FILE" \
    | grep -E '^[+-]' \
    | grep -Ev '^(\+\+\+|---)' \
    | grep -Ev '^[+-]\s*$' \
    | grep -Ev '^[+-]\s*//' \
    || true
)

if [ -z "$SUBSTANTIVE" ]; then
  echo "[check-schema-has-migration] schema.prisma has comment-only changes — OK"
  exit 0
fi

# Substantive change present. Look for a NEW migration file added in the
# same range. We only care about Added (status A) files — modifying an
# existing migration file is suspicious (history rewrite) and should be
# justified case-by-case, not relied on as the migration for a new change.
NEW_MIGRATIONS=$(
  git diff --name-only --diff-filter=A "$MERGE_BASE...HEAD" \
    | grep -E "$MIGRATIONS_GLOB" \
    || true
)

if [ -n "$NEW_MIGRATIONS" ]; then
  echo "[check-schema-has-migration] schema.prisma changed + new migration found:"
  echo "$NEW_MIGRATIONS" | sed 's/^/  - /'
  exit 0
fi

cat >&2 <<EOF
❌ [check-schema-has-migration] #944 guard failed.

apps/admin/prisma/schema.prisma was modified (substantively) in this branch,
but no new apps/admin/prisma/migrations/*/migration.sql file was added.

\`prisma migrate deploy\` is a no-op for schema-only changes — every
environment that pulls main will start 500ing with \`P2022 column does
not exist\` until someone notices.

Fix locally:
  cd apps/admin
  npx prisma migrate dev --name <descriptive_slug>
  git add prisma/migrations/<the-new-dir>
  git commit --amend --no-edit  # or a new commit

Then push again. If the schema change is genuinely safe without a
migration (e.g. you regenerated the file but it produced no SQL),
re-run \`prisma migrate dev\` to confirm — Prisma will create an
empty .sql file you can commit, which satisfies this guard.

Substantive changes detected:
EOF

echo "$SUBSTANTIVE" | head -20 | sed 's/^/  /' >&2

exit 1

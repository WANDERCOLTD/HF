#!/usr/bin/env bash
# scripts/check-ci-docs-parity.sh
#
# Enforces CI ⇔ docs parity per .claude/rules/ci-docs-parity.md.
#
# Layers (per S14 #1802):
#   L2 (current) — invoked by .githooks/pre-push, warn-only.
#   L3 (pending) — invoked by gh-pr-create.sh with --strict, blocks PR.
#
# Usage:
#   check-ci-docs-parity.sh                 # warn-only (default; pre-push mode)
#   check-ci-docs-parity.sh --strict        # block on parity miss (PR-time mode)
#   check-ci-docs-parity.sh --base <ref>    # compare against ref (default: origin/main)
#
# Bypass (one-shot): SKIP_CI_DOCS_PARITY=1 git push ...
# Override (PR body): include a "## CI Docs Skip" section with one-line justification.

set -euo pipefail

MODE="warn"
BASE_REF="origin/main"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --strict) MODE="strict"; shift ;;
    --base)   BASE_REF="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "[ci-docs-parity] unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Bypass via env var (one-shot operator override)
if [ "${SKIP_CI_DOCS_PARITY:-0}" = "1" ]; then
  echo "[ci-docs-parity] SKIP_CI_DOCS_PARITY=1 — skipping check"
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$REPO_ROOT" ] && { echo "[ci-docs-parity] not a git repo — skipping"; exit 0; }
cd "$REPO_ROOT"

# Compute the changed file set.
# Prefer merge-base with BASE_REF; fall back to HEAD^ for a single-commit context.
if git rev-parse "$BASE_REF" >/dev/null 2>&1; then
  BASE_SHA="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git rev-parse HEAD^ 2>/dev/null || true)"
else
  BASE_SHA="$(git rev-parse HEAD^ 2>/dev/null || true)"
fi
[ -z "$BASE_SHA" ] && { echo "[ci-docs-parity] no base ref — skipping"; exit 0; }

CHANGED="$(git diff --name-only "$BASE_SHA"...HEAD 2>/dev/null || true)"
if [ -z "$CHANGED" ]; then
  # Fall back to staged + unstaged (covers pre-commit-like invocations)
  CHANGED="$(git diff --name-only HEAD 2>/dev/null || true)"
fi
[ -z "$CHANGED" ] && exit 0

# ─── Watched-paths map ────────────────────────────────────────────────────
# Keep in sync with .claude/rules/ci-docs-parity.md. Each entry is TAB-separated:
#   "<regex>\t<paired-doc-1>\t<paired-doc-2>..."
# Tab is the separator (not |) because regex alternation also uses |.
# A "paired-doc" match is an EXACT path equality (not regex).
WATCHED_MAP=(
  $'^\\.github/workflows/deploy-.*\\.yml$\tdocs/CLOUD-DEPLOYMENT.md\tdocs/RELEASE-PROCESS.md'
  $'^apps/admin/Dockerfile$\tdocs/CLOUD-DEPLOYMENT.md'
  $'^apps/admin/cloudbuild-.*\\.yaml$\tdocs/CLOUD-DEPLOYMENT.md'
  $'^apps/admin/scripts/deploy-gate\\.sh$\tdocs/CLOUD-DEPLOYMENT.md\tdocs/RELEASE-PROCESS.md'
  $'^\\.claude/commands/(deploy|db-route|db-switch)\\.md$\tdocs/CLOUD-DEPLOYMENT.md\tdocs/RELEASE-PROCESS.md'
  $'^apps/admin/scripts/cloud-sql-restore-drill\\.sh$\tdocs/DR-POSTURE.md\tdocs/runbooks/RB-1394-CLOUD-SQL-RESTORE.md\tdocs/runbooks/RB-1394-RESTORE-DRILL-DEPLOY.md'
  $'^apps/admin/prisma/fixtures/.*\\.ts$\tdocs/RELEASE-PROCESS.md'
  $'^scripts/(backup|restore)-.*\\.(sh|ts)$\tdocs/DR-POSTURE.md'
)

# ─── Run the check ────────────────────────────────────────────────────────
declare -a FAILURES=()
declare -a WATCHED_HITS=()

for entry in "${WATCHED_MAP[@]}"; do
  # Split on TAB
  IFS=$'\t' read -ra parts <<< "$entry"
  pattern="${parts[0]}"
  paired_docs=("${parts[@]:1}")

  # Did any changed file match this pattern?
  matched_files=()
  while IFS= read -r f; do
    if echo "$f" | grep -qE "$pattern"; then
      matched_files+=("$f")
    fi
  done <<< "$CHANGED"

  [ "${#matched_files[@]}" -eq 0 ] && continue

  # A watched path was touched. Check if any paired doc was also touched.
  paired_hit=0
  for doc in "${paired_docs[@]}"; do
    if echo "$CHANGED" | grep -qFx "$doc"; then
      paired_hit=1
      break
    fi
  done

  WATCHED_HITS+=("$(printf '%s\n' "${matched_files[@]}")")
  if [ "$paired_hit" -eq 0 ]; then
    FAILURES+=("$(printf '  • Touched: %s\n    No paired doc updated. Need one of: %s' \
                          "$(printf '%s ' "${matched_files[@]}")" \
                          "$(printf '%s, ' "${paired_docs[@]}" | sed 's/, $//')")")
  fi
done

# ─── Report ───────────────────────────────────────────────────────────────
if [ "${#FAILURES[@]}" -eq 0 ]; then
  if [ "${#WATCHED_HITS[@]}" -gt 0 ]; then
    echo "[ci-docs-parity] ✓ watched paths touched + paired docs updated — parity OK"
  fi
  exit 0
fi

echo ""
echo "[ci-docs-parity] ⚠️  CI/infra changes detected without paired doc update:"
echo ""
printf '%s\n' "${FAILURES[@]}"
echo ""
echo "  → Update at least one paired doc, OR include in the PR body:"
echo ""
echo "    ## CI Docs Skip"
echo "    "
echo "    <one-line justification>"
echo ""
echo "  Reference: .claude/rules/ci-docs-parity.md"
echo "  Bypass (one-shot): SKIP_CI_DOCS_PARITY=1 git push ..."
echo ""

if [ "$MODE" = "strict" ]; then
  exit 1
fi

# Warn mode — exit 0 so push proceeds
exit 0

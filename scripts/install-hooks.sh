#!/bin/bash
# Install git hooks for the HF project
#
# Run this once after cloning, or any time the hook bodies change here:
#   ./scripts/install-hooks.sh
#
# Four hooks land in .git/hooks/:
#   pre-commit   — blocks direct commits on main, regenerates API docs,
#                  fast qmd index update. Slow qmd embed moved out (post-commit).
#   pre-push     — runs tsc (whole project) + eslint (changed files only).
#                  Compares tsc error count against .ratchet.json baseline —
#                  passes if count <= baseline so pre-existing errors in
#                  touched files don't block routine pushes. Lint errors in
#                  changed files are always a hard fail (baseline is 0).
#                  Escape hatch: HF_SKIP_PREPUSH=1 git push ...
#   post-commit  — runs qmd embed synchronously so the index is consistent
#                  before the next command starts. ~30s blocking.
#   post-merge   — refreshes qmd index + runs embed synchronously after pull.
#                  ~30s blocking is the right trade-off vs silent search misses.
#
# Why the embed step is in post-commit, not pre-commit:
#   Long-running pre-commit work (qmd embed ~30s) races with concurrent git
#   operations from parallel terminals / scheduled tasks and has caused
#   commits to land on the wrong branch or fail with HEAD-lock errors.
#   Moving the embed AFTER the ref is written makes the race harmless.
#
# Why embed is now synchronous (G12, audit 2026-06-06):
#   The previous `( ... ) &` background subshell was orphaned when the
#   terminal closed before the ~30s embed completed, leaving vector
#   embeddings stale despite the keyword index being fresh. Synchronous
#   embed costs ~30s on `git pull` / `git commit` but guarantees the index
#   is consistent. Note: `gh pr merge --squash` bypasses post-merge entirely
#   — run `qmd embed` manually after large remote merges.

set -e

# --git-common-dir returns the canonical .git directory (the main repo's
# .git/), so the installer works from any worktree. show-toplevel + /.git
# breaks inside a worktree because .git there is a file pointer, not a dir.
HOOK_DIR="$(git rev-parse --git-common-dir)/hooks"

# ── pre-commit ──────────────────────────────────────────────────────────────
cat > "$HOOK_DIR/pre-commit" << 'HOOK'
#!/bin/bash
# HF pre-commit hook (installed by scripts/install-hooks.sh)

# Skip merge / cherry-pick / revert commits — they legitimately land on the
# current branch (including main).
GIT_DIR=$(git rev-parse --git-dir)
[ -f "$GIT_DIR/MERGE_HEAD" ] && exit 0
[ -f "$GIT_DIR/CHERRY_PICK_HEAD" ] && exit 0
[ -f "$GIT_DIR/REVERT_HEAD" ] && exit 0

# Block direct commits on main (CLAUDE.md branch hygiene).
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$BRANCH" = "main" ] && [ "${HF_ALLOW_MAIN_COMMIT:-0}" != "1" ]; then
  echo ""
  echo "  pre-commit hook: refusing to commit directly on 'main'"
  echo ""
  echo "  CLAUDE.md branch hygiene — work belongs on a branch:"
  echo "    git switch -c fix/<issue#>-<slug>     # bug fix"
  echo "    git switch -c feat/<issue#>-<slug>    # feature"
  echo "    git switch -c chore/<slug>            # tooling/docs"
  echo ""
  echo "  git switch -c carries your in-flight changes onto the new branch."
  echo ""
  echo "  Override (rare — typo fix / README only):"
  echo "    HF_ALLOW_MAIN_COMMIT=1 git commit ..."
  echo ""
  exit 1
fi

# Regenerate API docs when route files change.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
ROUTE_CHANGES=$(echo "$STAGED_FILES" | grep -c 'apps/admin/app/api/.*route\.ts$' || true)
if [ "$ROUTE_CHANGES" -gt 0 ]; then
  echo "[pre-commit] Route files changed — regenerating API docs..."
  cd apps/admin
  npx tsx scripts/api-docs/generator.ts 2>/dev/null
  RESULT=$?
  cd ../..
  if [ $RESULT -ne 0 ]; then
    echo "[pre-commit] ⚠ API docs generator failed (exit $RESULT). Commit continues."
    exit 0
  fi
  git add docs/API-INTERNAL.md docs/API-PUBLIC.md 2>/dev/null
  echo "[pre-commit] API docs regenerated and staged."
fi

# Fast qmd index update only (skip on VM, skip the slow embed step).
# qmd embed (~30s) runs in post-commit so it can't race with the commit ref.
if [ "$HOSTNAME" != "hf-dev" ] && command -v qmd &> /dev/null; then
  echo "[pre-commit] Updating QMD index..."
  qmd update --quiet 2>/dev/null || echo "[pre-commit] ⚠ QMD update failed (non-blocking)"
fi

exit 0
HOOK
chmod +x "$HOOK_DIR/pre-commit"

# ── pre-push ────────────────────────────────────────────────────────────────
cat > "$HOOK_DIR/pre-push" << 'HOOK'
#!/bin/bash
# HF pre-push hook (installed by scripts/install-hooks.sh)
#
# Why: catch tsc + lint errors YOU introduced before they hit the 5-10 min
# CI loop. We filter changed .ts/.tsx files to decide whether to run at all
# (fast path — no TS changes = skip). When TS changes are present we run
# tsc on the whole project and compare the TOTAL error count against the
# .ratchet.json baseline rather than doing a binary pass/fail on changed
# files. This mirrors what CI's Ratchet check does and avoids false positives
# when pre-existing errors live in files you legitimately touched.
#
# Gate logic:
#   total tsc errors  >  .ratchet.json baseline  →  FAIL  (you added errors)
#   total tsc errors  <=  .ratchet.json baseline  →  PASS  (no regression)
#   .ratchet.json missing                         →  WARN + binary fallback
#
# Lint: errors gate on changed files only (lint_errors baseline is 0 so any
# new error is a regression). Warnings are not gated (too noisy).
#
# Pre-push (not pre-commit) so small commits stay fast.
#
# Escape hatch: HF_SKIP_PREPUSH=1 git push ...   (emergencies only)
#
# Drain stdin so git doesn't SIGPIPE us — we don't inspect the ref list.
cat >/dev/null

# Skip on hf-dev VM (resource-constrained).
[ "$HOSTNAME" = "hf-dev" ] && exit 0

# Escape hatch.
if [ "${HF_SKIP_PREPUSH:-0}" = "1" ]; then
  echo "[pre-push] HF_SKIP_PREPUSH=1 — skipping checks. Don't make this a habit."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 0

# Resolve upstream — `git rev-parse @{u}` fails before the first push, fall
# back to origin/main.
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "origin/main")
git fetch origin main --quiet 2>/dev/null || true

# .ts/.tsx files modified in the commits about to be pushed.
CHANGED=$(git diff --name-only --diff-filter=ACMR "$UPSTREAM"...HEAD -- 'apps/admin/**/*.ts' 'apps/admin/**/*.tsx' 2>/dev/null)

if [ -z "$CHANGED" ]; then
  echo "[pre-push] No .ts/.tsx changes in apps/admin — skipping checks."
  exit 0
fi

cd apps/admin || exit 0
REL=$(echo "$CHANGED" | sed 's|^apps/admin/||')
CHANGED_COUNT=$(echo "$REL" | wc -l | tr -d ' ')

# ── 1) tsc — ratchet-aware ──────────────────────────────────────────────────
echo "[pre-push] Running tsc ($CHANGED_COUNT changed file(s) in push)..."
TSC_OUT=$(mktemp)
trap 'rm -f "$TSC_OUT"' EXIT
npx tsc --noEmit >"$TSC_OUT" 2>&1 || true

TSC_ERRORS=$(grep -cE "error TS[0-9]+:" "$TSC_OUT" || true)

# Read baseline from .ratchet.json (two levels up from apps/admin).
RATCHET_FILE="$REPO_ROOT/.ratchet.json"
if [ -f "$RATCHET_FILE" ] && command -v node >/dev/null 2>&1; then
  BASELINE_TSC=$(node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (typeof j.tsc_errors === "number") { process.stdout.write(String(j.tsc_errors)); }
    } catch {}
  ' "$RATCHET_FILE")
else
  BASELINE_TSC=""
fi

if [ -z "$BASELINE_TSC" ]; then
  # No baseline — fall back to old behaviour: any tsc error in changed files blocks.
  echo "[pre-push] Warning: .ratchet.json not found or unreadable — using file-filtered fallback."
  PATTERN=$(echo "$REL" | sed 's|\.|\\.|g' | paste -sd'|' -)
  NEW_TSC=$(grep -E "^($PATTERN)\(" "$TSC_OUT" || true)
  if [ -n "$NEW_TSC" ]; then
    echo ""
    echo "  [pre-push] tsc errors in files you're pushing:"
    echo ""
    echo "$NEW_TSC" | head -30 | sed 's/^/    /'
    echo ""
    echo "  Fix these or set up .ratchet.json (npm run ratchet:init) for ratchet-aware checks."
    echo "  Override (emergencies only): HF_SKIP_PREPUSH=1 git push ..."
    echo ""
    exit 1
  fi
  echo "[pre-push] tsc: no errors in changed files (fallback mode)."
elif [ "$TSC_ERRORS" -gt "$BASELINE_TSC" ]; then
  DELTA=$((TSC_ERRORS - BASELINE_TSC))
  echo ""
  echo "  [pre-push] tsc errors increased: $TSC_ERRORS (baseline $BASELINE_TSC, +$DELTA new)"
  echo ""
  echo "  Your push introduced $DELTA new tsc error(s). Fix them before pushing."
  echo "  Run:  cd apps/admin && npx tsc --noEmit 2>&1 | grep 'error TS'"
  echo "  Override (emergencies only): HF_SKIP_PREPUSH=1 git push ..."
  echo ""
  exit 1
else
  if [ "$TSC_ERRORS" -lt "$BASELINE_TSC" ]; then
    DELTA=$((BASELINE_TSC - TSC_ERRORS))
    echo "[pre-push] tsc: $TSC_ERRORS errors (baseline $BASELINE_TSC, -$DELTA). Run 'npm run ratchet:lock' to lock the improvement."
  else
    echo "[pre-push] tsc: $TSC_ERRORS errors (== baseline $BASELINE_TSC)."
  fi
fi

# ── 2) lint — errors gate on changed files (warnings not gated) ─────────────
echo "[pre-push] Running eslint on changed files..."
LINT_OUT=$(mktemp)
trap 'rm -f "$TSC_OUT" "$LINT_OUT"' EXIT
# shellcheck disable=SC2086
npx eslint --format json $REL >"$LINT_OUT" 2>/dev/null || true

LINT_ERRORS=0
if [ -s "$LINT_OUT" ] && command -v node >/dev/null 2>&1; then
  LINT_ERRORS=$(node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(j.reduce((s, f) => s + (f.errorCount || 0), 0)));
    } catch { process.stdout.write("0"); }
  ' "$LINT_OUT")
fi

if [ "${LINT_ERRORS:-0}" -gt 0 ]; then
  echo ""
  echo "  [pre-push] $LINT_ERRORS lint error(s) in files you're pushing."
  # Re-run in human-readable format for the developer.
  # shellcheck disable=SC2086
  npx eslint $REL 2>/dev/null || true
  echo ""
  echo "  Fix these before pushing."
  echo "  Override (emergencies only): HF_SKIP_PREPUSH=1 git push ..."
  echo ""
  exit 1
fi

echo "[pre-push] lint: no errors in changed files."
echo "[pre-push] Push checks passed."
exit 0
HOOK
chmod +x "$HOOK_DIR/pre-push"

# ── post-commit ─────────────────────────────────────────────────────────────
cat > "$HOOK_DIR/post-commit" << 'HOOK'
#!/bin/bash
# HF post-commit hook — backgrounded qmd embed so the commit isn't held open.

[ "$HOSTNAME" = "hf-dev" ] && exit 0
command -v qmd &> /dev/null || exit 0

echo "[post-commit] Embedding QMD documents (synchronous, ~30s)..."
qmd embed --quiet 2>/dev/null \
  && echo "[post-commit] ✓ QMD embeddings updated" \
  || echo "[post-commit] ⚠ QMD embed failed (non-blocking)"

exit 0
HOOK
chmod +x "$HOOK_DIR/post-commit"

# ── post-merge ──────────────────────────────────────────────────────────────
cat > "$HOOK_DIR/post-merge" << 'HOOK'
#!/bin/bash
# HF post-merge hook — refresh qmd after `git pull` / merge.

[ "$HOSTNAME" = "hf-dev" ] && exit 0
command -v qmd &> /dev/null || exit 0

echo "[post-merge] Updating QMD index..."
qmd update --quiet 2>/dev/null || echo "[post-merge] ⚠ QMD update failed (non-blocking)"

echo "[post-merge] Embedding QMD documents (synchronous, ~30s)..."
qmd embed --quiet 2>/dev/null \
  && echo "[post-merge] ✓ QMD index refreshed" \
  || echo "[post-merge] ⚠ QMD embed failed (non-blocking)"

exit 0
HOOK
chmod +x "$HOOK_DIR/post-merge"

echo "✓ Git hooks installed in $HOOK_DIR"
echo "  - pre-commit  (blocks main, regenerates API docs, fast qmd update)"
echo "  - pre-push    (tsc + eslint, filtered to changed files; skip on hf-dev)"
echo "  - post-commit (qmd embed in background)"
echo "  - post-merge  (qmd refresh after pull)"

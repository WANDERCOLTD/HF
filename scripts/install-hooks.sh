#!/bin/bash
# Install git hooks for the HF project
#
# Run this once after cloning, or any time the hook bodies change here:
#   ./scripts/install-hooks.sh
#
# Four hooks land in .git/hooks/:
#   pre-commit   — blocks direct commits on main, regenerates API docs,
#                  fast qmd index update. Slow qmd embed moved out (post-commit).
#   pre-push     — runs tsc --noEmit + eslint on apps/admin before push.
#                  Catches type/lint errors locally instead of in CI (5-10 min loop).
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

HOOK_DIR="$(git rev-parse --show-toplevel)/.git/hooks"

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
# Why: CI catches tsc/lint errors but at a 5–10 min round-trip. Running them
# locally before push catches the same errors in ~60s and keeps the loop tight.
# Pre-push (not pre-commit) so small commits stay fast.
#
# Escape hatch: HF_SKIP_PREPUSH=1 git push ...   (emergencies only)
#
# Drain stdin so git doesn't SIGPIPE us — we don't inspect the ref list.
cat >/dev/null

# Skip on hf-dev VM (resource-constrained; tsc on the box is too slow).
[ "$HOSTNAME" = "hf-dev" ] && exit 0

# Escape hatch.
if [ "${HF_SKIP_PREPUSH:-0}" = "1" ]; then
  echo "[pre-push] ⚠ HF_SKIP_PREPUSH=1 — skipping tsc + lint. Don't make this a habit."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/apps/admin" || exit 0

echo "[pre-push] Running tsc --noEmit (1/2)..."
if ! npx tsc --noEmit; then
  echo ""
  echo "  [pre-push] ✗ tsc failed — fix type errors before pushing."
  echo "  Override (emergencies only): HF_SKIP_PREPUSH=1 git push ..."
  echo ""
  exit 1
fi

echo "[pre-push] Running eslint (2/2)..."
if ! npm run lint --silent; then
  echo ""
  echo "  [pre-push] ✗ lint failed — fix lint errors before pushing."
  echo "  Override (emergencies only): HF_SKIP_PREPUSH=1 git push ..."
  echo ""
  exit 1
fi

echo "[pre-push] ✓ tsc + lint passed."
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
echo "  - pre-push    (tsc --noEmit + eslint on apps/admin; skip on hf-dev)"
echo "  - post-commit (qmd embed in background)"
echo "  - post-merge  (qmd refresh after pull)"

#!/usr/bin/env bash
# scripts/cleanup-agent-worktrees.sh
#
# Garbage-collect agent-spawned git worktrees whose PR is finished. The
# Claude Code Agent tool spawns worktrees at .claude/worktrees/agent-<id>
# (when invoked with `isolation: "worktree"`). Per its contract a worktree
# is auto-deleted only if the agent made NO changes; otherwise it survives
# and accumulates across sessions. This script collects the zombies.
#
# Logic per worktree:
#   - branch = main      → keep (canonical)
#   - branch has PR MERGED or CLOSED → remove worktree + delete branch
#   - branch has PR OPEN → keep (in-flight)
#   - branch has no PR   → warn but keep (manual decision)
#
# Run modes:
#   --dry-run   Print what would be removed, do nothing.
#   --quiet     Suppress per-worktree output; print only summary line.
#   (default)   Verbose; prints each decision and final summary.
#
# Requires: gh CLI authenticated. No-op + warn if not available.
#
# Born from a 2026-06-10 broken-windows pass where 14 of 17 agent
# worktrees were zombies, consuming 21 GB of disk. See guard-registry.md.
set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$REPO_ROOT" ] && { echo "[cleanup] not inside a git repo" >&2; exit 1; }
cd "$REPO_ROOT"

DRY_RUN=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --quiet)   QUIET=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "[cleanup] ⚠ gh CLI not on PATH — cannot resolve PR state, exiting."
  exit 0
fi

log() { [ "$QUIET" = "1" ] || echo "$@"; }

REMOVED=0
KEPT_INFLIGHT=0
KEPT_NOPR=0
KEPT_MAIN=0
SKIPPED_NO_BRANCH=0

# Parse `git worktree list --porcelain` for agent-* paths + their branch refs.
while IFS=$'\t' read -r wt_path branch_ref; do
  [ -z "$wt_path" ] && continue
  short_wt=$(basename "$wt_path")
  branch=$(printf '%s' "$branch_ref" | sed 's|refs/heads/||')

  if [ -z "$branch" ]; then
    SKIPPED_NO_BRANCH=$((SKIPPED_NO_BRANCH + 1))
    log "  skip   $short_wt (no branch — detached HEAD?)"
    continue
  fi

  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    KEPT_MAIN=$((KEPT_MAIN + 1))
    log "  keep   $short_wt ($branch — canonical)"
    continue
  fi

  state=$(gh pr list --head "$branch" --state all --limit 1 --json state --jq '.[0].state' 2>/dev/null || true)
  case "$state" in
    MERGED|CLOSED)
      if [ "$DRY_RUN" = "1" ]; then
        log "  [dry] WOULD remove $short_wt ($branch — PR $state)"
        REMOVED=$((REMOVED + 1))
      else
        log "  rm     $short_wt ($branch — PR $state)"
        # `git worktree remove --force` does NOT bypass the `locked` flag;
        # unlock first (no-op on unlocked worktrees) then remove. Observed
        # 2026-06-10: without the unlock, `--force` silently leaves locked
        # worktrees in place even though the script logs "rm".
        git worktree unlock "$wt_path" 2>/dev/null || true
        git worktree remove --force "$wt_path" 2>/dev/null || true
        git branch -D "$branch" 2>/dev/null || true
        REMOVED=$((REMOVED + 1))
      fi ;;
    OPEN)
      KEPT_INFLIGHT=$((KEPT_INFLIGHT + 1))
      log "  keep   $short_wt ($branch — PR OPEN, in-flight)" ;;
    ""|null)
      KEPT_NOPR=$((KEPT_NOPR + 1))
      log "  keep   $short_wt ($branch — no PR found, manual decision)" ;;
    *)
      KEPT_NOPR=$((KEPT_NOPR + 1))
      log "  keep   $short_wt ($branch — PR state '$state', leaving alone)" ;;
  esac
done < <(
  git worktree list --porcelain | awk '
    /^worktree / { wt = $2 }
    /^branch /   { br = $2 }
    /^$/         {
      if (wt ~ /\/\.claude\/worktrees\/agent-/) { print wt "\t" br }
      wt=""; br=""
    }'
)

if [ "$DRY_RUN" = "1" ]; then
  echo "[cleanup] DRY-RUN summary: would remove $REMOVED · in-flight $KEPT_INFLIGHT · no-PR $KEPT_NOPR · main $KEPT_MAIN"
else
  git worktree prune 2>/dev/null || true
  echo "[cleanup] removed $REMOVED zombie worktree(s) · kept $KEPT_INFLIGHT in-flight · kept $KEPT_NOPR no-PR (manual) · kept $KEPT_MAIN main"
fi

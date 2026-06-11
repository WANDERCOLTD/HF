#!/usr/bin/env bash
# check-reciprocal-edit.sh — detects the AP-1 anti-pattern (Loop 1):
# commit N+1 partially undoes commit N within minutes.
#
# Classic example: PR #1365 ec9fc28d removed conversation-update parsing
# from transcript handling; PR #1366 031551f2 restored it. Two commits, one
# net-zero behavioural change, and a deeply confusing history.
#
# Strategy: for each file in HEAD's diff against HEAD~1, compare the lines
# HEAD removed against the lines HEAD~1 added (and vice versa). If >50%
# overlap, this is a reciprocal edit — the diff is undoing what the previous
# commit did.
#
# Usage:
#   ./check-reciprocal-edit.sh                # check HEAD vs HEAD~1 (pre-push default)
#   ./check-reciprocal-edit.sh A B            # check commit B's reverse of commit A
#   ./check-reciprocal-edit.sh --range A..B   # walk pairs in a branch
#
# Exit codes:
#   0 — no reciprocal edit detected
#   1 — reciprocal edit detected (used by pre-push hook to block)
#   2 — invocation error
#
# Override: set ALLOW_RECIPROCAL_EDIT=1 in the env when the reverse is
# intentional (e.g. a deliberate revert documented in the commit body).
#
# Anchor: docs/kb/guard-registry.md#guard-reciprocal-edit

set -u

NEWER="HEAD"
OLDER="HEAD~1"
RANGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --range)
      shift
      RANGE="${1:?--range A..B expected}"
      ;;
    -h|--help)
      cat <<EOF
usage: check-reciprocal-edit.sh [OLDER NEWER]
       check-reciprocal-edit.sh --range A..B
       ALLOW_RECIPROCAL_EDIT=1 to bypass for an intentional revert
EOF
      exit 0
      ;;
    *)
      if [ -z "${ARG1:-}" ]; then
        ARG1="$1"
      elif [ -z "${ARG2:-}" ]; then
        ARG2="$1"
      else
        echo "too many args" >&2
        exit 2
      fi
      ;;
  esac
  shift
done

if [ -n "${ARG1:-}" ] && [ -n "${ARG2:-}" ]; then
  OLDER="$ARG1"
  NEWER="$ARG2"
fi

if [ "${ALLOW_RECIPROCAL_EDIT:-0}" = "1" ]; then
  echo "[reciprocal-edit] ALLOW_RECIPROCAL_EDIT=1 — skipping check."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "not in a git repo" >&2
  exit 2
fi
cd "$REPO_ROOT"

# If a range is given, walk consecutive pairs and recurse. This is the
# verification path; the default single-pair mode is the runtime path.
if [ -n "$RANGE" ]; then
  COMMITS=$(git log --reverse --pretty=format:'%H' "$RANGE" 2>/dev/null)
  PREV=""
  FAIL=0
  for sha in $COMMITS; do
    if [ -n "$PREV" ]; then
      OUT=$("$0" "$PREV" "$sha" 2>&1)
      RC=$?
      if [ "$RC" -eq 1 ]; then
        FAIL=1
        echo "$OUT"
      fi
    fi
    PREV="$sha"
  done
  exit "$FAIL"
fi

# Resolve refs to actual SHAs so the python analyser sees stable IDs.
OLDER_SHA=$(git rev-parse --short "$OLDER" 2>/dev/null || echo "")
NEWER_SHA=$(git rev-parse --short "$NEWER" 2>/dev/null || echo "")

if [ -z "$OLDER_SHA" ] || [ -z "$NEWER_SHA" ]; then
  echo "[reciprocal-edit] could not resolve commits ($OLDER, $NEWER)" >&2
  exit 0
fi

# Build the analyser as a temp file (apostrophe-safe).
PY_SCRIPT=$(mktemp -t reciprocal.XXXXXX.py)
trap 'rm -f "$PY_SCRIPT"' EXIT

cat > "$PY_SCRIPT" <<'PY'
"""
Read two unified diffs (older then newer, separated by NUL) and report
files where the newer diff is largely undoing the older diff.

A "reciprocal" file matches when:
  - newer-added lines ≥50% identical to older-removed lines, OR
  - newer-removed lines ≥50% identical to older-added lines.

Threshold + line-trim are intentionally generous so cosmetic whitespace
or comment tweaks aren't flagged; we want this fired on real reverts.
"""
import sys
import re

# Split the two diffs.
parts = sys.stdin.read().split('\x00', 1)
if len(parts) != 2:
    # No older diff (e.g. first commit on branch). Nothing to compare.
    sys.exit(0)
older_diff, newer_diff = parts

def parse(diff):
    """Return {path: {"added": [str,...], "removed": [str,...]}}."""
    files = {}
    cur = None
    for line in diff.splitlines():
        m = re.match(r'^\+\+\+ b/(.+)$', line)
        if m:
            cur = m.group(1)
            files.setdefault(cur, {"added": [], "removed": []})
            continue
        if cur is None:
            continue
        if line.startswith('+++') or line.startswith('---') or line.startswith('@@'):
            continue
        if line.startswith('+'):
            content = line[1:].strip()
            if content:
                files[cur]["added"].append(content)
        elif line.startswith('-'):
            content = line[1:].strip()
            if content:
                files[cur]["removed"].append(content)
    return files

older = parse(older_diff)
newer = parse(newer_diff)

THRESH = 0.5
MIN_LINES = 3  # under this, signal-to-noise too low

flagged = []
for path, n in newer.items():
    if path not in older:
        continue
    o = older[path]
    # Case 1: newer adds what older removed.
    if n["added"] and o["removed"]:
        added_set = set(n["added"])
        removed_set = set(o["removed"])
        overlap = added_set & removed_set
        denom = max(len(added_set), len(removed_set))
        if denom >= MIN_LINES and len(overlap) / denom >= THRESH:
            flagged.append((path, "newer-added re-introduces older-removed",
                            len(overlap), denom))
            continue
    # Case 2: newer removes what older added.
    if n["removed"] and o["added"]:
        removed_set = set(n["removed"])
        added_set = set(o["added"])
        overlap = removed_set & added_set
        denom = max(len(removed_set), len(added_set))
        if denom >= MIN_LINES and len(overlap) / denom >= THRESH:
            flagged.append((path, "newer-removed deletes older-added",
                            len(overlap), denom))

if not flagged:
    sys.exit(0)

print("RECIPROCAL_EDIT_DETECTED")
for path, why, overlap, denom in flagged:
    pct = int(100 * overlap / denom)
    print(f"  {path}")
    print(f"    {why} ({overlap}/{denom} lines, {pct}%)")
sys.exit(1)
PY

# Gather the two diffs separated by NUL.
OLDER_DIFF=$(git show -m --no-color "$OLDER_SHA" 2>/dev/null || true)
NEWER_DIFF=$(git show -m --no-color "$NEWER_SHA" 2>/dev/null || true)

if [ -z "$OLDER_DIFF" ] || [ -z "$NEWER_DIFF" ]; then
  echo "[reciprocal-edit] one of the commits is empty — skipping."
  exit 0
fi

OUT=$(printf '%s\x00%s' "$OLDER_DIFF" "$NEWER_DIFF" | python3 "$PY_SCRIPT")
RC=$?

if [ "$RC" -eq 0 ]; then
  exit 0
fi

cat <<EOF >&2
🔁 Reciprocal edit detected ($OLDER_SHA → $NEWER_SHA).

$OUT

This commit is partially undoing the previous one. Options:
  1. Squash both commits — the history doesn't need the round-trip
  2. Document the root cause in the body (why the first try was wrong)
     and re-run with: ALLOW_RECIPROCAL_EDIT=1 git push
  3. Revert the first commit explicitly (git revert) so intent is clear

Anchor: docs/kb/guard-registry.md#guard-reciprocal-edit
EOF
exit 1

#!/usr/bin/env bash
# check-fix-chain.sh — fix-chain detector (#1444-class methodology guard).
#
# CLAUDE.md says: "Fix chain detected (3+ fix: commits on same topic) →
# Flag it, run `root-cause` agent, create a story." Currently manual.
# This script makes the detection structural: post-commit hook fires it,
# the ratchet metric `same_issue_fix_chain_max` keeps the maximum chain
# length on the branch from rising.
#
# Algorithm:
#   1. Read the commits we're scanning (default: last 30 days on HEAD).
#   2. For each commit whose subject begins with `fix(...)` or `fix:`,
#      extract the GitHub issue number — either from a `#NNNN` token in
#      the subject or body.
#   3. Group by issue number, count.
#   4. Print warnings for any issue with ≥3 commits.
#   5. Echo the maximum chain length on stdout (used by check-ratchet).
#
# Usage:
#   ./check-fix-chain.sh                  — last 30 days, warning output + max stdout
#   ./check-fix-chain.sh --since "<date>" — explicit window
#   ./check-fix-chain.sh --max-only       — only echo the max int (for ratchet)
#   ./check-fix-chain.sh --range A..B     — explicit commit range
#
# Exit codes:
#   0 — chain detector ran (regardless of finding); the ratchet decides if
#       the count is a regression.
#   1 — invocation error.
#
# Anchor: KB-linked at docs/kb/guard-registry.md#guard-fix-chain.

set -u

SINCE='30 days ago'
RANGE=""
MAX_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --since)
      shift
      SINCE="${1:?--since requires a value}"
      ;;
    --max-only)
      MAX_ONLY=1
      ;;
    --range)
      shift
      RANGE="${1:?--range requires a value}"
      ;;
    -h|--help)
      cat <<EOF
usage: check-fix-chain.sh [--since "<date>" | --range A..B] [--max-only]
EOF
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
  shift
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "not in a git repo" >&2
  exit 1
fi

cd "$REPO_ROOT"

# Git log args are constructed inline below (after the python analyser
# is set up) so we can pass them safely without word-splitting issues.

# Write the python analyser to a temp file so the script body's apostrophes
# don't collide with shell heredoc quoting.
PY_SCRIPT=$(mktemp -t fixchain.XXXXXX.py)
trap 'rm -f "$PY_SCRIPT"' EXIT

cat > "$PY_SCRIPT" <<'PY'
import sys, re

raw = sys.stdin.read()
# Split into commit records by our explicit separator.
records = [r for r in raw.split('@@END@@') if r.strip()]

# issue number → list of (sha, subject)
chains = {}

for rec in records:
    m = re.search(r'([0-9a-f]+)@@SUBJ@@(.*?)@@BODY@@(.*)', rec, re.DOTALL)
    if not m:
        continue
    sha, subj, body = m.group(1), m.group(2), m.group(3)
    # Only fix: commits count. Matches "fix:" or "fix(scope):" at the start
    # of the (possibly leading-whitespace) subject.
    if not re.match(r'^\s*fix[\(:]', subj):
        continue
    # Find all #NNNN tokens in subject + body. Range 2-6 digits avoids
    # picking up large hashes or addresses.
    issues = set(re.findall(r'#(\d{2,6})', subj + ' ' + body))
    for issue in issues:
        chains.setdefault(issue, []).append((sha[:8], subj.strip()))

# Find max length and emit warnings.
max_len = 0
warnings = []
for issue, commits in sorted(chains.items(), key=lambda kv: -len(kv[1])):
    n = len(commits)
    if n > max_len:
        max_len = n
    if n >= 3:
        lines = [f"  #{issue}: {n} fix: commits"]
        for sha, subj in commits:
            lines.append(f"    {sha}  {subj[:90]}")
        warnings.append('\n'.join(lines))

print(f"MAX={max_len}")
if warnings:
    print("WARNINGS_START")
    print('\n\n'.join(warnings))
    print("WARNINGS_END")
PY

# Group commits by issue number (only fix: commits count).
# Pipe git output through the analyser. The unusual separators avoid
# collisions with conventional-commit content.
if [ -n "$RANGE" ]; then
  RESULT=$(git log "$RANGE" --pretty=format:'%H@@SUBJ@@%s@@BODY@@%b@@END@@' 2>/dev/null | python3 "$PY_SCRIPT")
else
  RESULT=$(git log "--since=$SINCE" --pretty=format:'%H@@SUBJ@@%s@@BODY@@%b@@END@@' 2>/dev/null | python3 "$PY_SCRIPT")
fi

MAX_LEN=$(printf '%s' "$RESULT" | grep '^MAX=' | head -1 | sed 's/^MAX=//')
MAX_LEN="${MAX_LEN:-0}"

if [ "$MAX_ONLY" -eq 1 ]; then
  echo "$MAX_LEN"
  exit 0
fi

if printf '%s' "$RESULT" | grep -q WARNINGS_START; then
  echo "🔁 Fix chain(s) detected (≥3 fix: commits on same #issue):"
  echo ""
  printf '%s' "$RESULT" | sed -n '/WARNINGS_START/,/WARNINGS_END/p' | sed '1d;$d'
  echo ""
  echo "Next step: run the root-cause agent before shipping the next fix on these issues."
  echo "  Agent({subagent_type:\"root-cause\", prompt:\"investigate fix-chain on #<issue>\"})"
  echo ""
  echo "Anchor: docs/kb/guard-registry.md#guard-fix-chain"
fi

echo ""
echo "max-chain-length: $MAX_LEN"
exit 0

#!/usr/bin/env bash
# gh-pr-create.sh — wraps `gh pr create` with a verify-before-fix gate.
#
# Why: PR #1406 shipped a fabricated fix-story built on a misread screenshot.
# One DB query would have disproved the premise. The lesson is recorded in
# memory/feedback_verify_before_fix_misread_2026_06_09.md. This script makes
# the lesson structural: a PR body without an evidence section is rejected
# at the gate.
#
# Required: a `## Verified by` (or `## Verification`) section containing at
# least one of these evidence forms:
#   - SQL: a line starting with `SELECT ` (case-insensitive) OR ending with `;`
#   - Test: a line citing a test file by path or by name, e.g. `tests/.../foo.test.ts`
#   - Playwright: a path like `e2e/...` or a `.zip` trace path
#   - Log: a line containing `[<subject>]` or `subject=` or `voice.<...>`
#   - HTTP: a `curl` or `gh api` invocation (the evidence command)
#
# Bypass: `--no-verify-section` (warns and proceeds — for trivial / docs-only PRs).
#
# Usage: identical to `gh pr create`; pass `--body-file <path>` or `--body "<text>"`.
# Examples:
#   gh-pr-create.sh --title "..." --body-file PR-BODY.md
#   gh-pr-create.sh --title "..." --body "$(cat <<EOF ... EOF)"
#
# Anchor: docs/kb/guard-registry.md#guard-verify-before-fix
#         memory/feedback_verify_before_fix_misread_2026_06_09.md

set -u

NO_VERIFY=0
NO_AGENT_CLAIM_CHECK=0
ARGS=()
BODY_TEXT=""
BODY_FILE=""

# Walk argv, extract --body / --body-file for inspection, pass everything
# else through to `gh pr create`. We don't consume --title etc.
while [ $# -gt 0 ]; do
  case "$1" in
    --no-verify-section)
      NO_VERIFY=1
      ;;
    --no-agent-claim-check)
      NO_AGENT_CLAIM_CHECK=1
      ;;
    --body)
      shift
      BODY_TEXT="${1:-}"
      ARGS+=("--body" "$BODY_TEXT")
      ;;
    --body-file)
      shift
      BODY_FILE="${1:-}"
      ARGS+=("--body-file" "$BODY_FILE")
      ;;
    *)
      ARGS+=("$1")
      ;;
  esac
  shift
done

# Resolve the body text to inspect.
BODY=""
if [ -n "$BODY_FILE" ]; then
  if [ -f "$BODY_FILE" ]; then
    BODY=$(cat "$BODY_FILE")
  fi
elif [ -n "$BODY_TEXT" ]; then
  BODY="$BODY_TEXT"
fi

verify_body() {
  local body="$1"
  # Must have the heading.
  if ! printf '%s' "$body" | grep -qiE '^##[[:space:]]+verif(ied by|ication)'; then
    return 1
  fi
  # Extract the section content from the heading to the next "##" (or EOF).
  local section
  section=$(printf '%s' "$body" | awk '
    BEGIN { in_section = 0 }
    /^##[[:space:]]+[Vv]erif(ied by|ication)/ { in_section = 1; next }
    /^##[[:space:]]/ { if (in_section) exit }
    { if (in_section) print }
  ')
  if [ -z "$section" ]; then
    return 1
  fi
  # At least one evidence form must appear in the section.
  # SQL
  if printf '%s' "$section" | grep -qiE '(^|[^a-z])select[[:space:]]'; then
    return 0
  fi
  # vitest / test file path / test() name (use literal grep on the parens)
  if printf '%s' "$section" | grep -qE '(\.test\.tsx?|tests?/[A-Za-z0-9_/.-]+\.(ts|tsx|sh|spec)|test\([^)]*should|describe\([^)]*should)'; then
    return 0
  fi
  # Playwright trace / e2e
  if printf '%s' "$section" | grep -qE '(e2e/[A-Za-z0-9_/.-]+|trace\.zip|playwright-report)'; then
    return 0
  fi
  # Log subject
  if printf '%s' "$section" | grep -qE '(\[[a-z][a-z0-9._/-]*\]|subject=|voice\.[a-z_.]+)'; then
    return 0
  fi
  # HTTP probe
  if printf '%s' "$section" | grep -qE '(^|[[:space:]])(curl|gh api|httpie|http )'; then
    return 0
  fi
  return 2
}

# Agent-report verification — scan the body for negative-shaped claims
# without an inverse-probe citation within a 3-line window.
#
# Why: 2026-06-15 session — 8 of 9 confidently-asserted agent negatives
# were wrong (name-form misses, schema-column confusion, missed provenance
# chains). The pattern recurs whenever a negative ("X doesn't exist",
# "no callers", "dead code") ships without a probe citation. This gate
# turns `.claude/rules/agent-report-verification.md` from convention into
# a commit-time block.
#
# A negative-claim line passes when it has, within ±3 lines:
#   - a file:line citation: `path/file.ext` or `path/file.ext:NNN`
#     for ext in ts/tsx/sh/mjs/md/json/prisma/sql
#   - an explicit marker: [verified] / [probed] / [inverse-probe:...]
#     / [unverified] / [skip-claim-check]
#   - a `## Verified by` or `## Verification` heading
verify_no_unverified_negatives() {
  local body="$1"
  local NEG='(does(n.t)? *not *exist|doesn.t *exist|has *no *callers?|no *callers?|dead *code|not *wired|not *implemented|isn.t *there|not *in *the *(codebase|tree|repo)|missing *from)'
  # Marker satisfies a single negative claim. Does NOT include
  # `## Verified by` — that heading satisfies the SIBLING verify-before-fix
  # gate (overall fix evidence) but is too coarse for per-claim probes.
  # Each negative needs its OWN citation (file:line) or an explicit marker.
  # Avoid `\b` — unreliable across BSD/GNU grep variants.
  local MARK='(\[(verified|probed|inverse-probe|unverified|skip-claim-check)|[a-zA-Z0-9_./-]+\.(ts|tsx|sh|mjs|md|json|prisma|sql)(:[0-9]+)?)'

  local neg_lines
  neg_lines=$(printf '%s\n' "$body" | grep -niE "$NEG" 2>/dev/null | cut -d: -f1 || true)
  [ -z "$neg_lines" ] && return 0

  local total
  total=$(printf '%s\n' "$body" | wc -l | tr -d ' ')

  # Window = ±1 line (same line, line immediately above, line immediately
  # below). ±1 is the natural co-location boundary for an author who has
  # actually probed the claim: the citation lands on the same line or
  # the next. Wider windows let a marker for ONE claim accidentally
  # satisfy an unrelated claim a few lines away.
  local offenders=""
  local ln start stop window line
  for ln in $neg_lines; do
    start=$((ln - 1))
    [ "$start" -lt 1 ] && start=1
    stop=$((ln + 1))
    [ "$stop" -gt "$total" ] && stop="$total"
    window=$(printf '%s\n' "$body" | sed -n "${start},${stop}p")
    if ! printf '%s' "$window" | grep -qE "$MARK"; then
      line=$(printf '%s\n' "$body" | sed -n "${ln}p")
      offenders="${offenders}  Line ${ln}: ${line}"$'\n'
    fi
  done
  if [ -n "$offenders" ]; then
    cat >&2 <<EOF
[gh-pr-create] ✖ PR body contains negative claim(s) without inverse-probe evidence.

Why: 2026-06-15 session found 8 of 9 confidently-asserted agent
negatives were wrong — name-form misses, schema-column confusion,
missed provenance chains. The pattern recurs whenever a negative
('X doesn't exist', 'no callers', 'dead code') ships without a probe
citation.

Rule: .claude/rules/agent-report-verification.md
ADR:  docs/decisions/2026-06-15-agent-report-verification.md

Offending line(s):
${offenders}
For each, do ONE of:
  (a) Add a file:line citation showing the inverse probe (e.g.
      lib/foo.ts:42 or eslint-rules/no-bare-strategy-key.mjs)
  (b) Add an explicit marker on the same line: [verified] / [probed] /
      [inverse-probe: <command-or-finding>]
  (c) Demote to [unverified] to admit you didn't probe — the reader is
      then explicitly warned not to act on the claim
  (d) Reword to remove the negative claim entirely

Bypass for trivial / docs-only PRs: --no-agent-claim-check
Anchor: docs/kb/guard-registry.md#guard-agent-report-verification
EOF
    return 3
  fi
  return 0
}

# Run the agent-claim check FIRST (it scans the whole body, not just the
# Verified-by section). If the verify-section gate also fires below, the
# operator sees both errors in one pass.
if [ "$NO_AGENT_CLAIM_CHECK" -eq 1 ]; then
  echo "[gh-pr-create] --no-agent-claim-check: skipping agent-claim verification gate." >&2
elif [ -n "$BODY" ]; then
  verify_no_unverified_negatives "$BODY"
  agent_rc=$?
  if [ "$agent_rc" -eq 3 ]; then
    exit 1
  fi
  echo "[gh-pr-create] ✔ agent-report verification gate passed." >&2
fi

if [ "$NO_VERIFY" -eq 1 ]; then
  echo "[gh-pr-create] --no-verify-section: skipping verification gate." >&2
elif [ -z "$BODY" ]; then
  cat >&2 <<EOF
[gh-pr-create] ✖ no --body or --body-file supplied. PR body is required.
[gh-pr-create]   To bypass for a docs-only / trivial PR, use --no-verify-section.
EOF
  exit 1
else
  verify_body "$BODY"
  rc=$?
  if [ "$rc" -eq 1 ]; then
    cat >&2 <<EOF
[gh-pr-create] ✖ PR body missing "## Verified by" (or "## Verification") section.

Why: PR #1406 shipped a fabricated fix-story built on a misread screenshot.
The lesson is recorded in
  memory/feedback_verify_before_fix_misread_2026_06_09.md

Add a section to the body that cites at least one of:
  - a SQL query + its result (e.g. SELECT recapSynthesisCache FROM ...)
  - a vitest name + file path (e.g. tests/api/foo.test.ts → "should bar")
  - a Playwright trace path (e.g. e2e/...trace.zip)
  - a log subject line (e.g. voice.outbound_dial.assistant_payload)
  - a curl/gh api invocation showing the request/response

Bypass for trivial PRs: --no-verify-section
Anchor: docs/kb/guard-registry.md#guard-verify-before-fix
EOF
    exit 1
  fi
  if [ "$rc" -eq 2 ]; then
    cat >&2 <<EOF
[gh-pr-create] ✖ "## Verified by" section is present but contains no concrete
                evidence (SQL, test name, Playwright trace, log subject, or
                curl/gh api invocation). See:
  docs/kb/guard-registry.md#guard-verify-before-fix
EOF
    exit 1
  fi
  echo "[gh-pr-create] ✔ verify-before-fix gate passed." >&2
fi

# Pass through to the real gh CLI.
exec gh pr create "${ARGS[@]}"

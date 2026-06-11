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

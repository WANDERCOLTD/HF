#!/bin/bash
# UserPromptSubmit hook — detect infrastructure-proposal intent in the user's
# prompt and inject a mandatory KB-reuse preamble before Claude responds.
#
# Why: over the last 6 weeks the assistant has repeatedly proposed parallel
# infrastructure that already existed in docs/kb/, .claude/rules/, scripts/check-*,
# or .ratchet.json — then iteratively chased symptoms in fix-loops instead of
# stopping for root-cause. Catalogued as anti-pattern AP-2/AP-3 in
# memory/feedback_chase_loop_anti_patterns.md. This hook is the structural
# enforcement: if the user prompt smells like a proposal, the model gets an
# explicit reminder to query the KB first.
#
# Reads: the user prompt is piped to stdin as JSON via the hook protocol.
# Writes: any text on stdout is injected as a system reminder visible to Claude.
# Exit: 0 always — this hook never blocks.
#
# Match conditions (case-insensitive substring on the user message text):
#   - "we should add"        → broad proposal
#   - "i propose"            → explicit proposal
#   - "new guard"            → guard-class proposal (most acute)
#   - "new rule"             → ESLint / process-rule proposal
#   - "new hook"             → hook addition
#   - "discipline change"    → process change
#   - "let's build a"        → infrastructure building
#   - "let's add a"          → infrastructure addition
#   - "let's create a"       → infrastructure creation
#   - "build a system"       → new system proposal
#   - "introduce a"          → introducing new abstraction
#
# When triggered, prints a preamble that names the matched pattern and
# instructs the model to consult docs/kb/README.md + grep the registries +
# spawn the reuse-finder agent before proposing structure.

set -u

# Read the JSON payload from stdin (the harness pipes the user message here).
# Schema: {"prompt": "...the user's text...", ...}. We extract `prompt`
# defensively — if the shape isn't what we expect, we silently exit 0 so
# legitimate prompts are never blocked.
PAYLOAD=$(cat)

# Extract the prompt text via python3 (already used by sprint-context.sh).
PROMPT_TEXT=$(printf '%s' "$PAYLOAD" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('prompt', ''))
except Exception:
    pass
" 2>/dev/null)

if [ -z "$PROMPT_TEXT" ]; then
  exit 0
fi

# Lower-case for matching.
LOWER=$(printf '%s' "$PROMPT_TEXT" | tr '[:upper:]' '[:lower:]')

# Patterns to detect. Each entry is "pattern|human-readable label" — the label
# is what appears in the preamble so the model knows which signal fired.
MATCHED=""
check_pattern() {
  local pat="$1" label="$2"
  if printf '%s' "$LOWER" | grep -qF -- "$pat"; then
    MATCHED="$label"
    return 0
  fi
  return 1
}

# Order matters — most-specific first so the label is informative.
check_pattern "new guard" "new guard" \
  || check_pattern "new rule" "new rule" \
  || check_pattern "new hook" "new hook" \
  || check_pattern "discipline change" "discipline change" \
  || check_pattern "i propose" "i propose" \
  || check_pattern "we should add" "we should add" \
  || check_pattern "let's build a" "let's build a" \
  || check_pattern "lets build a" "lets build a" \
  || check_pattern "let's add a" "let's add a" \
  || check_pattern "lets add a" "lets add a" \
  || check_pattern "let's create a" "let's create a" \
  || check_pattern "lets create a" "lets create a" \
  || check_pattern "build a system" "build a system" \
  || check_pattern "introduce a" "introduce a" \
  || true

if [ -z "$MATCHED" ]; then
  exit 0
fi

# Emit the preamble. The harness injects stdout as a system reminder; using
# a leading marker line plus a numbered checklist keeps it visible in the
# model's context.
cat <<EOF
🛑 Infrastructure-proposal intent detected ("$MATCHED").

Before proposing new structure, REQUIRED:
  1. cat docs/kb/README.md (or echo the 9-part table) — confirm where this lives
  2. grep -r "<topic>" docs/kb/guard-registry.md docs/kb/invariants.md .claude/rules/
  3. Run: Agent({subagent_type:"reuse-finder", prompt:"investigate whether HF already has infrastructure for: <topic>"})

Cite what you found (or "nothing relevant") in your first response.
Failure to cite = process violation (anti-pattern AP-2 / AP-3, see
memory/feedback_chase_loop_anti_patterns.md).

Reuse over reinvention. The system already knows a lot about itself.
EOF

exit 0

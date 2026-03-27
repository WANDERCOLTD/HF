#!/usr/bin/env bash
# PostToolUse hook: remind about flow map updates when relevant files change
# Non-blocking — outputs a systemMessage reminder, never stops the tool

set -eo pipefail

# Read the file path from stdin (Edit or Write tool input)
FILE_PATH=$(jq -r '(.tool_input.file_path // .tool_response.filePath // "") ' 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0

REMINDERS=""

case "$FILE_PATH" in
  *lib/prompt/composition/*) REMINDERS="$REMINDERS flow-prompt-composition.md" ;;
esac

case "$FILE_PATH" in
  *lib/pipeline/*) REMINDERS="$REMINDERS flow-pipeline.md" ;;
esac

case "$FILE_PATH" in
  *lib/goals/*) REMINDERS="$REMINDERS flow-pipeline.md flow-goal-tracking.md" ;;
esac

case "$FILE_PATH" in
  *app/api/vapi/*|*lib/test-harness/*) REMINDERS="$REMINDERS flow-call-lifecycle.md" ;;
esac

# Trim + deduplicate
UNIQUE=$(echo "$REMINDERS" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' | xargs)

[[ -z "$UNIQUE" ]] && exit 0

echo "{\"systemMessage\": \"Flow map reminder: check if $UNIQUE needs updating.\"}"

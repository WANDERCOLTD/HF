#!/bin/bash
# UserPromptSubmit hook — injects sprint context into every Claude session
# Runs before Claude responds to each message
# Output is injected as a system reminder visible to Claude

REPO_ROOT="/Users/paulwander/projects/HF"
REPO="paw2paw/HF"

# Get current sprint issues (top 3 open)
SPRINT_ISSUES=$(gh issue list \
  --repo "$REPO" \
  --milestone "Sprint 1" \
  --state open \
  --json number,title,labels \
  --limit 3 2>/dev/null | python3 -c "
import sys, json
issues = json.load(sys.stdin)
if not issues:
    print('No open sprint issues')
else:
    for i in issues:
        labels = [l['name'] for l in i.get('labels', [])]
        print(f'  #{i[\"number\"]} {i[\"title\"]} [{\" \".join(labels)}]')
" 2>/dev/null)

# Get latest fix chain warning from retro (if any)
RETRO_WARNING=$(cat "$HOME/.claude/projects/-Users-paulwander-projects-HF/memory/retro-latest.md" 2>/dev/null | \
  grep "REPEAT\|Fix chain" | head -3 | sed 's/^/  /')

# Get recent commit pattern (last 3 commits)
RECENT=$(cd "$REPO_ROOT" && git log --oneline -3 --format="%s" 2>/dev/null | sed 's/^/  /')

# Only output if we have something useful
if [ -n "$SPRINT_ISSUES" ] || [ -n "$RECENT" ]; then
  echo "## Sprint Context"
  echo ""
  if [ -n "$SPRINT_ISSUES" ]; then
    echo "**Open Sprint 1 stories:**"
    echo "$SPRINT_ISSUES"
    echo ""
  fi
  if [ -n "$RECENT" ]; then
    echo "**Recent commits:**"
    echo "$RECENT"
    echo ""
  fi
  if [ -n "$RETRO_WARNING" ]; then
    echo "**Retro flags:**"
    echo "$RETRO_WARNING"
    echo ""
  fi
  echo "*(If the user describes building intent, run BA + Tech Lead agents before coding)*"
fi

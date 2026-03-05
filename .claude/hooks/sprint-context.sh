#!/bin/bash
# UserPromptSubmit hook — injects sprint context into every Claude session
# Runs before Claude responds to each message
# Output is injected as a system reminder visible to Claude

REPO_ROOT="/Users/paulwander/projects/HF"
REPO="paw2paw/HF"
AGENT_STATE="$HOME/.claude/projects/-Users-paulwander-projects-HF/memory/agent-state.json"

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

# Get recent commit pattern (last 3 commits)
RECENT=$(cd "$REPO_ROOT" && git log --oneline -3 --format="%s" 2>/dev/null | sed 's/^/  /')

# --- Agent cadence enforcement ---
OVERDUE_AGENTS=""

# Helper: check if an agent is overdue
check_overdue() {
  local agent="$1" max_days="$2" label="$3"
  local last_run days

  last_run=$(python3 -c "
import json, sys
try:
    d = json.load(open('$AGENT_STATE'))
    val = d.get('$agent', '')
    print(val if val else '')
except:
    print('')
" 2>/dev/null)

  if [ -z "$last_run" ]; then
    OVERDUE_AGENTS="${OVERDUE_AGENTS}  ⚠️  ${label} — never run\n"
  else
    days=$(python3 -c "
from datetime import datetime
try:
    d = datetime.fromisoformat('$last_run')
    print((datetime.now() - d).days)
except:
    print(999)
" 2>/dev/null)
    if [ "${days:-0}" -gt "$max_days" ] 2>/dev/null; then
      OVERDUE_AGENTS="${OVERDUE_AGENTS}  ⚠️  ${label} — ${days}d ago (run every ${max_days}d)\n"
    fi
  fi
}

if [ -f "$AGENT_STATE" ]; then
  check_overdue "memory-sync" 7 "memory-sync (weekly)"
  check_overdue "broken-windows" 30 "broken-windows (monthly)"
fi

# --- Fix chain → root-cause check ---
FIX_CHAIN_COUNT=$(cd "$REPO_ROOT" && git log --oneline --since="7 days ago" --format="%s" 2>/dev/null | grep -c "^fix:" || echo 0)
FIX_CHAIN_BLOCKER=""

if [ "${FIX_CHAIN_COUNT:-0}" -ge 3 ]; then
  LAST_ROOT=$(python3 -c "
import json
try:
    d = json.load(open('$AGENT_STATE'))
    rc = d.get('root-cause', {})
    if isinstance(rc, dict):
        print(rc.get('last', ''))
    else:
        print(rc or '')
except:
    print('')
" 2>/dev/null)

  if [ -z "$LAST_ROOT" ]; then
    FIX_CHAIN_BLOCKER="  🔴 Fix chain (${FIX_CHAIN_COUNT} fix: commits in 7d) — run root-cause BEFORE next feat:"
  fi
fi

# Get latest fix chain warning from retro (if any)
RETRO_WARNING=$(cat "$HOME/.claude/projects/-Users-paulwander-projects-HF/memory/retro-latest.md" 2>/dev/null | \
  grep "REPEAT\|Fix chain" | head -3 | sed 's/^/  /')

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
  if [ -n "$FIX_CHAIN_BLOCKER" ]; then
    echo "**🔴 BLOCKER:**"
    echo "$FIX_CHAIN_BLOCKER"
    echo ""
  fi
  if [ -n "$OVERDUE_AGENTS" ]; then
    echo "**Agent hygiene:**"
    printf "$OVERDUE_AGENTS"
    echo ""
  fi
  echo "*(If the user describes building intent, run BA + Tech Lead agents before coding)*"
fi

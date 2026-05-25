#!/bin/bash
# PreToolUse:Bash hook — detect HEAD drift between tool calls.
#
# Single per-repo snapshot at /tmp/claude-head-snapshot-HF. Compares the
# current HEAD/branch against the snapshot. If they differ, surface a loud
# warning to the conversation — most likely a peer claude process running in
# the same working tree has swapped HEAD. False positive when the current
# session itself just ran `git checkout` / reset / pull / stash pop; the
# warning text says so.
#
# Exit 0 always — do not block tool execution. Over-blocking is worse than
# letting through a false positive.

cd /Users/paulwander/projects/HF 2>/dev/null || exit 0

SNAPSHOT="/tmp/claude-head-snapshot-HF"

CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")
CURRENT="$CURRENT_BRANCH @ $CURRENT_HEAD"

# Initialise on first run
if [ ! -f "$SNAPSHOT" ]; then
  echo "$CURRENT" > "$SNAPSHOT"
  exit 0
fi

LAST=$(cat "$SNAPSHOT" 2>/dev/null)

# No drift — fast path
if [ "$LAST" = "$CURRENT" ]; then
  exit 0
fi

# Drift detected. Refresh snapshot first so a duplicate warning doesn't fire
# on the very next call.
echo "$CURRENT" > "$SNAPSHOT"

echo "🚨 HEAD drift detected between Bash tool calls."
echo "   was:  $LAST"
echo "   now:  $CURRENT"
echo ""
echo "   Most likely cause: a peer 'claude' process running in the same"
echo "   working tree has swapped HEAD. Confirm with 'pgrep -x claude | wc -l'"
echo "   (> 1 means peers exist) and 'git reflog | head -10' — a 'checkout:"
echo "   moving from X to Y' line with no matching tool call in this"
echo "   conversation is the smoking gun."
echo ""
echo "   If the LAST tool call you ran in THIS session was an intentional"
echo "   git checkout / reset / pull --rebase / stash pop / branch -f, this"
echo "   warning is a false positive — ignore."
echo ""
echo "   Recovery playbook: ~/.claude/projects/-Users-paulwander-projects-HF"
echo "   /memory/feedback_concurrent_claude_processes.md"

exit 0

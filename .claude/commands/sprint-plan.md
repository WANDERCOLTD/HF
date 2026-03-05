---
description: Sprint planning — reads TODOs from MEMORY.md and market-test-top10.md, grooms top stories with BA + Tech Lead, creates GitHub milestone for the sprint.
---

Run sprint planning.

## Step 1 — Read the backlog

Read these files to find everything that needs doing:
```bash
cat ~/.claude/projects/-Users-paulwander-projects-HF/memory/MEMORY.md | head -200
cat ~/.claude/projects/-Users-paulwander-projects-HF/memory/market-test-top10.md
```

Also check open GitHub issues:
```bash
gh issue list --state open --json number,title,labels --limit 30
```

## Step 2 — Ask the user to set sprint capacity

Ask the user using AskUserQuestion:

**Question:** "How many focused hours do you have this sprint?"
**Header:** "Sprint capacity"
**multiSelect:** false

Options:
1. **~20h** — 4 days, normal sprint
2. **~30h** — 6 days, full sprint
3. **~10h** — 2 days, short sprint
4. **Custom** — I'll tell you

## Step 3 — Prioritise the backlog

Apply this priority order:
1. Items in `market-test-top10.md` that are still TODO (market test blockers)
2. Open GitHub issues labelled `blocked` (unblock first)
3. Items with `v4` label (V4 wizard is the current build priority)
4. Items from `MEMORY.md` TODO list
5. Tech debt / fix-chain root causes from recent retro

## Step 4 — Create the sprint milestone

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
# Check what sprint number we're on
gh api repos/$REPO/milestones 2>/dev/null | python3 -c "import sys,json; [print(f'#{m[\"number\"]} {m[\"title\"]}') for m in json.load(sys.stdin)]" 2>/dev/null

# Create next sprint milestone
SPRINT_NUM=[next number]
gh api repos/$REPO/milestones -X POST \
  -f title="Sprint $SPRINT_NUM" \
  -f description="Sprint starting $(date +%Y-%m-%d)" \
  -f due_on="$(date -v+7d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -d '+7 days' +%Y-%m-%dT00:00:00Z)" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Sprint {d[\"title\"]} created — {d[\"html_url\"]}')"
```

## Step 5 — For each top story (up to sprint capacity)

For rough ideas that don't have GitHub issues yet, use the Task tool to launch `business-analyst` agent to write them. Run up to 3 BA agents in parallel for independent stories.

For each groomed story, launch `tech-lead` agent to review.

## Step 6 — Report the sprint plan

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Sprint [N] Plan — [date]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAPACITY: ~[N]h

SPRINT BACKLOG
  #[N] [title]  ~[effort]h  [READY/SPIKE]
  #[N] [title]  ~[effort]h  [READY/SPIKE]
  #[N] [title]  ~[effort]h  [READY/SPIKE]
  ─────────────────────────
  Total: ~[N]h / [capacity]h

DEFERRED (over capacity)
  #[N] [title]  ~[effort]h
  #[N] [title]  ~[effort]h

MARKET TEST BLOCKERS STATUS
  ✅ [item] — done
  🔴 [item] — in this sprint (#N)
  ⬜ [item] — deferred

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show the user the plan and ask: "Does this look right, or do you want to swap any stories?"

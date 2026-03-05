---
description: Sprint retrospective — analyses git history for fix chains, wasted commits, and repeated patterns. Proposes one process change. Closes sprint, opens next.
---

Run the sprint retrospective.

## Step 1 — Ask for sprint dates

Ask the user using AskUserQuestion:

**Question:** "Which sprint are we closing?"
**Header:** "Retro"
**multiSelect:** false

Options:
1. **This week** — last 7 days
2. **Last 2 weeks** — standard sprint
3. **Custom dates** — I'll provide start/end dates

## Step 2 — Launch the retro bot

Use the Task tool to launch the `retro-bot` subagent with the sprint start date.

Wait for the retro output and display it directly to the user.

## Step 3 — Handle the process change

If the retro identifies a process change, ask the user using AskUserQuestion:

**Question:** "The retro recommends: [process change summary]. What should we do?"
**Header:** "Process change"
**multiSelect:** false

Options:
1. **Do it now** — implement the change immediately (add guard, extract utility, add hook)
2. **Add as a story** — create a GitHub issue for it, add to next sprint
3. **Add to CLAUDE.md** — document it as a new rule or guard
4. **Skip** — noted, moving on

If "Do it now" or "Add to CLAUDE.md": implement the change inline before closing.
If "Add as a story": run `/story` with the process change description.

## Step 4 — Close sprint and confirm

After retro-bot runs, confirm:
```
Retro saved to memory/retro-[date].md ✅
Sprint [N] closed ✅
Sprint [N+1] milestone created ✅
```

Remind the user to run `/sprint-plan` to fill the new sprint.

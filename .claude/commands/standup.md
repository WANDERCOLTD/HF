---
description: Daily standup — yesterday's commits, fix chains, today's priority, open blockers. Run at the start of every coding session.
---

Run the daily standup.

Use the Task tool to launch the `standup-bot` subagent. No input needed — it reads git log and GitHub issues automatically.

Display the standup output directly to the user without modification.

If a fix chain is detected, ask the user using AskUserQuestion:

**Question:** "A fix chain was detected on [topic]. How should we handle it?"
**Header:** "Fix chain"
**multiSelect:** false

Options:
1. **Add to retro** — note it, address in end-of-sprint retro
2. **Create a story now** — write a proper story to fix the root cause
3. **Ignore** — known issue, moving on

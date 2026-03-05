---
description: Command launcher — one entry point for all slash commands
---

Single entry point for all commands. One picker, then launch.

Ask the user using AskUserQuestion — **single call, one question, 4 options**:

**Question:** "What do you need?"
**Header:** "HF"
**multiSelect:** false

Options:
1. **Agile** — Standup, sprint planning, new story, or retrospective
2. **Check quality** — Pre-commit gate, branch review, deep audit, or project health
3. **Deploy** — Pre-flight, quick deploy, full deploy, rollback, or VM workflow
4. **Fix an error** — Paste an error message and get a diagnosis + fix

Then based on the user's choice, run a **second AskUserQuestion** to pick the specific action:

### If "Agile":
**Question:** "Which Agile action?"
**Header:** "Agile"
Options:
1. **/standup** — Daily standup: yesterday's commits, fix chains, today's priority
2. **/story** — Write a groomed story from a rough idea (BA + Tech Lead review)
3. **/sprint-plan** — Plan the sprint from backlog + market-test priorities
4. **/retro** — Sprint retrospective: fix chains, wasted commits, process change

Then execute the chosen command using the Skill tool.

### If "Check quality":
**Question:** "Which check?"
**Header:** "Quality"
Options:
1. **/check** — Pre-commit + branch review quality gate
2. **/audit** — Deep scan: hardcoding, auth, async, dead code, test gaps
3. **/status** — Health dashboard: git, tests, types, server, DB

Then execute the chosen command using the Skill tool (e.g. `skill: "check"`). Each command has its own sub-picker for details.

### If "Deploy":
**Question:** "Which workflow?"
**Header:** "Deploy"
Options:
1. **/deploy** — Production deploy menu (pre-flight, quick, full, rollback)
2. **/vm** — VM workflow (pull, start, commit, push, status)
3. **/zmb** — Kill zombie processes only | **/zmb+** — Kill + restart + tunnel
4. **/vm-seed** — Run full seed on hf-dev VM (all 9 seed scripts)

Then execute using the Skill tool. Each has its own sub-picker.

### If "Explore":
**Question:** "What do you want to see?"
**Header:** "Explore"
Options:
1. **/schema** — Prisma models, relations, migrations
2. **/spec** — Run BDD/Gherkin test suite
3. **/ss** — Read recent screenshots
4. **/xx** — List CLI commands

Then execute using the Skill tool.

### If "Fix an error":
Execute `/fix` directly using the Skill tool — it will ask for the error message.

### If "Other":
Show ALL commands as a flat list using Bash:
```bash
for f in .claude/commands/*.md; do name=$(basename "$f" .md); [ "$name" = "qq" ] && continue; desc=$(sed -n 's/^description: *//p' "$f"); echo "$name|$desc"; done | sort
```
Then ask which command to run.

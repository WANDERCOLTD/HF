---
description: Write a groomed GitHub story from a rough idea — validates against existing code, writes acceptance criteria, flags risks. BA agent + Tech Lead review.
---

Create a groomed GitHub story ready to build.

Ask the user using AskUserQuestion — **single call**:

**Question:** "Describe the feature or change you want to build. Be as rough as you like — just the idea."
**Header:** "Story"
**multiSelect:** false

Options:
1. **V4 wizard change** — prompt, UI, tools, or flow change for the V4 conversational wizard
2. **New feature** — something new that doesn't exist yet
3. **Fix or improvement** — making something existing better
4. **Infrastructure / chore** — seed, config, migration, docs

Then take the user's description and:

## Run the BA agent

Use the Task tool to launch the `business-analyst` subagent with the full requirement description. The BA agent will:
- Search the codebase for what already exists
- Write a GitHub issue with full acceptance criteria
- Return the issue URL

## Run the Tech Lead agent

Once the BA agent returns the issue number, use the Task tool to launch the `tech-lead` subagent with that issue number. The Tech Lead will:
- Validate schema claims
- Check for reuse opportunities
- Flag guard risks
- Comment READY TO BUILD or SPIKE FIRST on the issue

## Report back

Show the user:
```
Story created: [issue URL]
Status: READY TO BUILD / SPIKE FIRST / NEEDS CLARIFICATION
Effort: ~[N]h
Sprint: [milestone]

Key acceptance criteria:
- [ ] [top 3 criteria]
```

If READY TO BUILD, ask: "Add to current sprint?"
If yes: run `gh issue edit [number] --milestone "Sprint [N]"`

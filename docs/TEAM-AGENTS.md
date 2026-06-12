# Team Agents & Helpers

> Every helper described here is **checked into the repo under `.claude/`** — your collaborators get the entire team by cloning. Nothing critical lives in personal `~/.claude/` overrides.

## What's shared vs. what's personal

| Path | Shared with collaborators? | Notes |
|---|---|---|
| `.claude/agents/*.md` (25 agents) | ✅ git-tracked | The full team — BA, Tech Lead, QA, etc. |
| `.claude/commands/*.md` (34 slash commands) | ✅ git-tracked | `/story`, `/check`, `/deploy`, `/vm-*`, etc. |
| `.claude/skills/*/SKILL.md` (3 skills) | ✅ git-tracked | `dev-principles`, `hf-nextjs-patterns`, `deploy-preflight` |
| `.claude/rules/*.md` (10 path-scoped rules) | ✅ git-tracked | Auto-loaded for matching files (UI, API, AI-to-DB, etc.) |
| `.claude/hooks/*.sh` (7 hooks) | ✅ git-tracked | Branch drift detector, git lock enforcer, session-start, etc. |
| `.claude/agent-memory/business-analyst/*.md` | ✅ git-tracked | BA's project memory (epic briefs, parked stories) |
| `.claude/settings.json` | ✅ git-tracked | MCP servers, hooks, env defaults |
| `CLAUDE.md` + `.claude/rules/*` | ✅ git-tracked | Team contracts |
| `.claude/settings.local.json` | ❌ gitignored | Per-machine permission overrides |
| `.claude/worktrees/` | ❌ gitignored | Per-machine agent worktrees |
| `CLAUDE.local.md` | ❌ gitignored | Personal overrides |
| `~/.claude/` | ❌ user-global | Currently empty for this project — no private agents |

To verify on any machine: `git ls-files .claude/ | wc -l` (should report 89+).

---

## The Agile Team (25 agents)

These are spawned via the `Agent` tool with `subagent_type: "<name>"`. CLAUDE.md describes the auto-triggers; this table is the menu.

### Discovery & Grooming (run BEFORE coding)

| Agent | Purpose | Auto-trigger |
|---|---|---|
| `reuse-finder` | Read-only pre-BA research — maps every existing helper/hook/route relevant to a requirement. Caps itself at ~2 min on Haiku. Feeds BA. | Spawned in parallel by BA at Step 0 |
| `business-analyst` | Validates requirement against existing code, writes a groomed GitHub issue with happy path + edge cases + risks + out-of-scope. **6 HARD RULES** force reading of canonical docs first. | "Let's build…" / "Implement…" / "Add…" / "Start on…" |
| `course-architect` | Curriculum suitability + source-led module/LO skeleton for new HFF courses. Returns brief; feeds BA. | "Let's build a course on…" |
| `tech-lead` | Technical review of a groomed story — validates schema claims, flags FK/seed/auth/async risks, checks for reuse opportunities. | After BA writes a story, before work starts |
| `plan-reviewer` | Validates an implementation plan against 3-phase intent lifecycle (Setup / Maintenance / Runtime). Enforces ASCII mockups on UI plans. | After designing a plan |

### Execution helpers

| Agent | Purpose | Auto-trigger |
|---|---|---|
| `general-purpose` / `claude` | Catch-all when no specialist fits | Default |
| `Plan` | Architect agent for designing implementation plans | Manual |
| `Explore` | Fast codebase exploration (quick/medium/thorough) | Manual |

### Quality gates (run AFTER coding, BEFORE commit)

| Agent | Purpose | Auto-trigger |
|---|---|---|
| `qa-engineer` | Verifies acceptance criteria, writes vitest + promptfoo evals. Returns READY TO MERGE or BLOCKED. | "We're done" / story criteria met |
| `guard-checker` | Runs all 15 CLAUDE.md plan guards against changed files. | Post-implementation, pre-commit |
| `standards-checker` | Comprehensive scorecard — tests, UI gold, CSS, auth, code quality. | Before marking a story done |
| `arch-checker` | HF architectural contracts — SpecRole taxonomy, entity hierarchy, holographic sections, adaptive loop, AI-read grounding (#1444). | After implementation, before commit |
| `ui-reviewer` | HF design system — no inline styles, correct `hf-*` classes, `FieldHint` on wizard intent fields, spinner-vs-glow rules, no hex. | After UI changes |
| `ux-reviewer` | Best-in-class SaaS UX patterns — empty states, error recovery, microcopy, progressive disclosure. Advisory. | After UI changes |
| `api-doc-checker` | Validates `@api` JSDoc on every `route.ts`, public/internal boundaries, `docs/API-INTERNAL.md` freshness. | After adding/modifying API routes |
| `migration-checker` | Validates Prisma schema change before `migrate dev` — destructive ops, data migration needs, `/vm-cp` vs `/vm-cpp` verdict. | Before any `migrate dev` |
| `seed-checker` | Spec JSONs match schema, all `config.specs.*` slugs have seed entries, FK ordering safe, no dup slugs. | After schema migrations or spec JSON changes |
| `scope-enforcer` | Flags mixed concerns in a commit, suggests how to split — "one concern per commit". | Before commit |
| `pr-reviewer` | Reviews a PR or current branch diff against story acceptance criteria + guards + code quality. | Before pushing |
| `eval-engineer` | Writes/runs promptfoo evals for AI system prompts. | When prompt changes or new AI behaviour needs testing |
| `prompt-diff` | Diffs old vs new system prompt, extracts behavioural rule changes, flags high-risk changes, identifies evals to update. | Prompt file changed |

### Operations & retrospective

| Agent | Purpose | Auto-trigger |
|---|---|---|
| `standup-bot` | What shipped yesterday, fix chains to be aware of, today's priority, open blockers. | Start of session |
| `retro-bot` | Sprint retro — analyses git history for fix chains, wasted commits, repeated patterns. Proposes one process change. | End of sprint |
| `velocity-tracker` | Measures fix:feat ratio, story cycle time, hotspot files, commit cadence, fix-chain frequency. | Weekly / sprint boundaries |
| `post-mortem` | Blameless incident timeline — impact, 5 Whys root cause, immediate fix, systemic change. Creates `incident`-tagged issue. | Production incident |
| `root-cause` | Structured 5 Whys for recurring bugs / fix chains. Files process-change story. | Fix chain detected (3+ `fix:` commits on same topic) |
| `memory-sync` | Checks each memory file against actual codebase for drift. Reports stale claims, missing entries, outdated paths. | Weekly / after major refactor |
| `broken-windows` | Codebase hygiene — stale TODOs, commented-out code, unused exports, outdated JSDoc, dead test files. | Monthly / before sprint planning |

---

## How the BA agent goes deep on edge cases & non-happy paths

This is the team's biggest defence against "the demo works but the corner cases broke." The BA is not a doc-writer — it's a domain-aware investigator that **refuses to draft a story** until it has read the canonical docs and surfaced known landmines. Specifics:

### 1. Six HARD RULES — mandatory pre-read of canonical docs

The BA must read these before writing the story (`.claude/agents/business-analyst.md:28-98`). Each doc has an explicit **landmines section** the BA is required to surface in the story's `## Risks` block.

| If the requirement touches… | The BA MUST read… | Landmines forced into the story |
|---|---|---|
| Classification / extraction / audience / MCQ / wizard `create_course` | `docs/CONTENT-PIPELINE.md` | §5 conflict matrix, §6 veto precedence, §8 documented production incidents (Module picker break, visualAids leak, multi-playbook race) |
| Any pipeline stage / runner / guardrail / ADAPT sub-op / SUPERVISE clamp | `docs/PIPELINE.md` | §9 landmines (stage-name vs outputType, legacy `pipeline-run.ts` confusion, parallelStages hardcode) |
| Loaders / transforms / `getDefaultSections()` / `contentScope` / dry-run prompt | `docs/PROMPT-COMPOSITION.md` | §9 — `__teachingDepth` array hack, `PromptTemplateCompiler` isolated `PrismaClient`, `filterSpecsByToggles` silent drops, onboarding-flow override precedence |
| `SpecRole` enum / `scaffoldDomain` / toggle defaults / `extendsAgent` / any `config.specs.*` slug | `docs/SPEC-SYSTEM.md` | §9 L1 ADR-002 default-enabled, L3 SpecRole-without-consumer |
| Wizard chat flow / `update_setup` / `create_course` / `mark_complete` / `setupData` bag | `docs/WIZARD-DATA-BAG.md` | §10 W1–W4 (currently open), May 9–10 2026 silent field-drop incident |
| Models / FKs / content-scoping queries / Subject/Playbook/Source/Assertion | `docs/ENTITIES.md` | §9 Leak A / B / C / E7 / E8 (the 2026-04-16 triple-leak debugging session) |

**The phrase "this is non-negotiable" appears 6 times** in the BA prompt. Each rule cites a real past incident as the why.

### 2. Reuse-finder runs in parallel BEFORE the BA drafts

Step 0 of BA spawns `reuse-finder` (Haiku, ~2 min cap) which does a 4-tool parallel search (`qmd search` + `qmd vector_search` + `hf_graph_search` + `hf_graph_api_routes`), spot-verifies hits by reading files, and returns a structured brief with **Existing helpers / Similar patterns / Gaps**. HIGH-confidence entries are pre-loaded into the issue's "Already exists — do not rebuild" section. This is the team's primary defence against "BA wrote a story to build something we already have."

### 3. Acceptance criteria template forces edge-case enumeration

The BA's issue template requires **checkbox-form acceptance criteria** (not bullets — so QA can tick them off), and the template itself lists edge-case examples:

```markdown
## Acceptance criteria
- [ ] [happy path]
- [ ] [edge case: what happens when X is missing]
- [ ] [edge case: what happens when user navigates back]
- [ ] [V3 path unaffected] (if this is V4 work)
- [ ] [no migration needed confirmed] (or: migration created)
- [ ] [promptfoo eval passes] (if AI behaviour changes)
```

Plus an explicit `## Out of scope` section, `## Risks` (FK ordering, state propagation, auth, migration, async), and a binary `## Spike needed?` decision.

### 4. Recurring-bug-shape flags baked into the BA's rules

- **NEVER suggest building something that already exists.**
- **ALWAYS check schema before claiming "no migration needed."**
- **ALWAYS flag stories involving FK relationships in seed/cleanup code** (known fix-chain risk).
- **ALWAYS flag stories where wizard state threads through async creation steps** (the `domainId` pattern — known fix-chain risk).
- If the requirement is vague: comment 2–3 clarifying questions BEFORE writing the story.

### 5. Tech Lead is a second-pass adversarial reviewer

`tech-lead` enforces the same 6 HARD RULES from the verification side. Notable additional gates:

- **Rejects `route.ts` line-number citations** (file is 2700+ lines, actively edited — citations must be symbol form like `route.ts::stageExecutors.<STAGE>`).
- **Catches parallel-batch hazards** in the pipeline (the `parallelStages` hardcode).
- **Blocks any story that modifies a classification dimension without updating `CONTENT-PIPELINE.md` in the same PR.**

### 6. BA project memory — shared, not personal

`.claude/agent-memory/business-analyst/` (git-tracked) carries the BA's institutional knowledge across sessions and across collaborators:

- `epic-setup-readiness-chain-contracts.md`
- `epic-tuning-assistant.md`
- `project_playbook_source_migration.md`
- `project_scheduler_ui_stories.md`

When a collaborator runs the BA, it reads the same memory you see.

---

# How collaborators should work with this repo

## Terminal or claude.ai web app? → **Terminal (Claude Code CLI). Not negotiable for this repo.**

| Feature | Claude Code CLI (terminal) | claude.ai web app |
|---|---|---|
| The 25 team agents (BA, Tech Lead, QA…) | ✅ Auto-loaded | ❌ Doesn't see them |
| 34 slash commands (`/story`, `/check`, `/vm-cp`…) | ✅ Yes | ❌ No |
| 10 path-scoped rules auto-loaded for matching files | ✅ Yes | ❌ No |
| Hooks (branch-drift, git-lock, kb-reuse preamble) | ✅ Yes | ❌ No |
| MCP servers (`qmd`, `hf-graph`) | ✅ Yes | ❌ No |
| Sees `CLAUDE.md` + project memory | ✅ Yes | ⚠️ Only if pasted in by hand |
| Can edit files, run tests, push to git | ✅ Yes | ❌ No |

**Verdict:** the web app cannot run this team. Use Claude Code CLI in the terminal for ALL repo work. The web app is fine for "explain this snippet" chats, but never for delivering work into the repo.

---

## End-to-end walkthrough — "Sarah from UX delivers a fresh design"

**Scenario:** UX has a Figma for a new Preview-lens header on `/x/courses/[courseId]?tab=design`. Sarah will deliver the change as a PR. Paul (CTO) will review and merge.

### One-time setup (Sarah's first time, ~10 min)

```
TERMINAL                                           WHAT SHE SEES
─────────────────────────────────────────────────  ───────────────────────────────────────────
$ git clone git@github.com:<org>/HF.git            Cloning into 'HF'...
$ cd HF                                             Receiving objects: 100%
$ npm install                                       added 1247 packages
$ brew install claude-code                          (or: see claude.com/docs install guide)
$ brew install qmd                                  qmd MCP server — used for code search
$ claude                                            ┌────────────────────────────────────┐
                                                    │  Claude Code v1.x                  │
                                                    │  Project: HF                       │
                                                    │  Branch: main                      │
                                                    │  > _                               │
                                                    └────────────────────────────────────┘
                                                    (settings.json auto-loads MCP servers,
                                                     hooks, env. Nothing for her to config.)
```

Verify the team loaded:

```
> /qq                              ← lists all slash commands
> Spawn the standup-bot agent      ← proves agents are wired
```

If `/qq` lists 30+ commands and standup-bot responds, she's good.

---

### Daily flow — Sarah delivers the Preview-lens header

#### Step 1 — Start a fresh session, get oriented

```
TERMINAL                                           CLAUDE'S RESPONSE
─────────────────────────────────────────────────  ───────────────────────────────────────────
$ cd ~/projects/HF                                 (shell wrapper auto-creates a worktree
$ claude                                            at ~/projects/HF-wt-main and cd's there —
                                                    avoids the "two claude processes on same
                                                    working tree" hazard)

> /standup                                          ┌─ Yesterday ─┐  ┌─ Today's priority ─┐
                                                    │ 3 PRs merged │  │ #1530 Preview header│
                                                    │ no fix chain │  │ (UX delivery)       │
                                                    └──────────────┘  └─────────────────────┘
```

#### Step 2 — Always start on a branch. Always.

```
> I need to ship the new Preview-lens header from Figma. Start a feature branch.

Claude:  Working from main. Creating branch.

  $ git checkout -b feat/1530-preview-lens-header
  Switched to a new branch 'feat/1530-preview-lens-header'
```

**Why a branch:** CLAUDE.md mandates it. `/vm-cp`, hooks, and Paul's merge flow all assume feature branches. Working on `main` corrupts the deploy pipeline.

Naming: `feat/<issue#>-<slug>` (feature) · `fix/<issue#>-<slug>` (bug) · `chore/<slug>` (tooling/docs).

#### Step 3 — If no GitHub issue exists, the agents will groom one

```
> Here's the Figma: <link>. Implement the new Preview header.

Claude:  Before we start coding — let me run a quick check.

         [Spawning reuse-finder + business-analyst in parallel]
         [Spawning tech-lead]

         ┌────────────────────────────────────────────────────────┐
         │ business-analyst: filed issue #1530                    │
         │   Title: Preview lens header redesign                  │
         │   Already exists: PreviewLens.tsx:42, hf-preview-* CSS │
         │   Needs building: new <PreviewHeader/> component +     │
         │      sticky-on-scroll behaviour                        │
         │   Acceptance: 6 checkboxes including                   │
         │      • header collapses on scroll                      │
         │      • keyboard tab order preserved                    │
         │      • V3 PreviewLens path unaffected                  │
         │   Risks: shared CSS namespace `.hf-preview-*` —        │
         │      ui-reviewer must run                              │
         │ tech-lead: validated. No migration. No FK risk.        │
         │   1 reuse opportunity flagged: existing useSticky hook │
         └────────────────────────────────────────────────────────┘

         Ready to build?
```

She types `yes`. **Only now does Claude start editing files.**

If a GitHub issue already exists (Paul pre-groomed it), she skips this step: `> Work on #1530` and Claude reads the issue directly.

#### Step 4 — Edit files (Claude does this; she steers)

```
> implement it

Claude:  [Edit] apps/admin/app/x/courses/[courseId]/_components/PreviewLens.tsx
         [Write] apps/admin/app/x/courses/[courseId]/_components/PreviewHeader.tsx
         [Edit] apps/admin/styles/preview.css

         ✅ ui-reviewer fired (PostToolUse hook): no inline styles, hf-* classes ok.
```

She reviews the diff in the terminal (Claude prints it inline). If something is wrong, she pushes back in plain English: `> The collapse animation is using a hardcoded duration — pull it from the design token.`

#### Step 5 — Verify in the browser (UI must be tested live)

CLAUDE.md is explicit: type-checks don't verify UI; pixels do. The dev server runs on the VM (not locally) — Sarah opens the tunnel:

```
> /vm-tunnel               (opens SSH tunnel: localhost:3000 → hf-dev VM)
> /vm-dev                  (starts next dev on the VM if it's down)
```

Then in her browser:

```
┌─ http://localhost:3000/x/courses/abc123?tab=design ─────────┐
│                                                              │
│  [Preview]  Journey  Behaviour  Settings  Voice              │
│  ━━━━━━━━━                                                   │
│                                                              │
│  ▼ NEW HEADER (sticky on scroll)                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Preview · Call 1 · IELTS Speaking Prep            │   │
│  │  ⟳ Refresh   ⚙ Settings   ▷ Play                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  💬 (Pre-call survey) Welcome — quick check before…         │
│  💬 AI Intro Call begins                                     │
│  ─── Call 1 begins ───                                       │
│  💬 Hi Bertie! Today we're working on…                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

She walks the golden path AND the edge cases the BA listed (scroll collapse, keyboard tab, V3 path unaffected). If anything is off, back to Step 4.

#### Step 6 — Quality gate

```
> /check                                         Runs: tsc + lint + tests
                                                  Output:
                                                  ✅ tsc       0 errors
                                                  ✅ eslint    0 warnings
                                                  ✅ vitest    1247 pass

> Run qa-engineer on #1530                       qa-engineer agent walks every
                                                  acceptance checkbox + writes
                                                  any missing tests.
                                                  Verdict: READY TO MERGE.

> Run guard-checker                              All 15 plan guards: pass.
> Run ui-reviewer                                Design system: pass.
> Run scope-enforcer on current changes          One concern per commit: pass.
```

If any gate fails, she fixes and re-runs. Do not push past a red gate.

#### Step 7 — Commit and push the branch (does NOT touch main)

```
> /vm-cp                          Pure UI/component change — no schema, no deps.
                                  This runs: commit locally → push → pull on VM.

Claude:  Drafting commit message…
         feat(preview): #1530 sticky Preview-lens header redesign
         …
         Pushing to origin/feat/1530-preview-lens-header
         ✅ pushed
```

Decision rule for which command:

| Change | Command |
|---|---|
| Components, pages, CSS, lib code, tests | `/vm-cp` |
| Prisma schema, `next.config.ts`, `middleware.ts`, new deps, env vars | `/vm-cpp` (migration + restart) |

#### Step 8 — Open the PR for Paul (CTO) to merge

```
> Open a PR for #1530 against main.

Claude:  $ gh pr create --title "feat(preview): #1530 sticky header" \
                       --body "<auto-generated from acceptance criteria>"

         ✅ https://github.com/<org>/HF/pull/1532

         Body includes:
           - Summary (1-3 bullets)
           - Verified by (concrete evidence: vitest names, screenshot)
           - Test plan (checkboxes)
           - Closes #1530
```

She pastes the PR URL in Slack to Paul. **She is done.** She does NOT merge. She does NOT push to `main`. Paul handles the merge.

---

### What Paul does (CTO merge flow)

```
> Review PR #1532
                                                 pr-reviewer agent walks acceptance
                                                 criteria + guards + diff. Returns
                                                 verdict + comment thread.

(in browser at github.com/<org>/HF/pull/1532)
  ✅ CI green
  ✅ pr-reviewer agent approved
  Click [Squash and merge]

> /mmm                                           Merge → pull main on VM → clean
                                                 worktrees → write closeout.
```

After merge, Paul decides when to `/deploy` (deploys to Cloud Run for the live envs).

---

## Coordination rules (everyone follows these)

These keep multiple humans + agents from stepping on each other:

1. **One branch per concern, named with the issue number.** Never work on `main`.
2. **Start every session with `/standup`** — fix chains + today's priority surface in 5 seconds.
3. **If you say "let's build X", the BA + Tech Lead fire automatically.** Don't skip the "Ready to build?" prompt — that's the gate that catches duplicate work and missing edge cases.
4. **Run quality gates before pushing**, in order: `/check` → `qa-engineer` → `guard-checker` → `ui-reviewer` (UI only) → `scope-enforcer`.
5. **`/vm-cp` for code, `/vm-cpp` for schema/deps.** Mismatched command = silent breakage on the VM.
6. **Open PRs against `main`. Do not merge your own PR.** Paul merges. This keeps the deploy decision in one head.
7. **Only one `claude` per working tree.** The shell wrapper auto-creates a worktree (`~/projects/HF-wt-<branch>`) for you. If you spot a `🚨 N concurrent claude processes detected` banner at session-start, peer sessions exist — stay in your worktree.
8. **If branch drift hits (HEAD moves without you asking),** the `branch-drift-detector.sh` hook warns; recover with `git stash` → `git reflog` → `git branch -f <correct> <commit>` (full recipe in CLAUDE.md).
9. **PR body must include `## Verified by` with concrete evidence** (SQL result, vitest name, screenshot). The `gh-pr-create.sh` wrapper rejects PRs without it — this catches "screenshot-OCR fixes" that don't actually exist (the verify-before-fix rule).
10. **Personal preferences go in `CLAUDE.local.md`** (gitignored). Team contracts go in `CLAUDE.md` (committed).

---

## Cheat sheet (print this)

```
SESSION START          /standup
NEW WORK               > "Let's build X"        (BA + Tech Lead auto-fire)
BRANCH                 feat/<issue>-<slug>   |   fix/<issue>-<slug>   |   chore/<slug>
DURING WORK            > "implement it"  |  /vm-tunnel + /vm-dev to test live
GATES                  /check  →  qa-engineer  →  guard-checker  →  ui-reviewer
PUSH                   /vm-cp     (code)
                       /vm-cpp    (schema / deps)
PR                     > "Open a PR for #N against main"   →   Slack Paul the URL
MERGE                  Paul only.  /mmm  closes the loop.
DEPLOY                 Paul only.  /deploy
```

---

## Onboarding checklist for a new collaborator

- [ ] `git clone` the repo
- [ ] `npm install`
- [ ] Install Claude Code CLI (`brew install claude-code` or claude.com/docs)
- [ ] Install `qmd` MCP server (`brew install qmd`)
- [ ] First `claude` invocation auto-creates a worktree — verify no error
- [ ] `/qq` lists 30+ commands
- [ ] `/standup` runs without error
- [ ] Skim `CLAUDE.md` (top of repo) and this doc
- [ ] Create a throwaway branch and run the walkthrough above end-to-end on a typo fix to prove the pipeline works on their machine

# HANDOFF — Refactor the 3 over-large hotspots

Paste this whole file into a fresh Claude Code session. It is self-contained:
file paths, line ranges, function maps, proposed split, risk notes, discipline
gates. Estimated time: 2 sprints if the test bed is solid; 4 if you have to
build it as you go.

## TL;DR

Three files exceed 2900 lines and showed up in the production-strength audit
(see `docs/audit/PRODUCTION-READINESS-SCORECARD.md` row 4 of the deferred
list). They are review-hostile, change-hostile, AND mask bugs — the audit's
biggest single fix (HF-A, commit `602e3ad`) was *inside* a file like this and
sat for months because `ContractRegistry.get` was unreachable to a reviewer
scrolling through 200+ functions.

| File                                                      | Lines | Top-level fns | Risk class             |
| --------------------------------------------------------- | ----- | ------------- | ---------------------- |
| `apps/admin/app/api/calls/[callId]/pipeline/route.ts`     | 4258  | 22            | **Hot path** (every call hits POST) |
| `apps/admin/lib/chat/admin-tool-handlers.ts`              | 3092  | 45            | **Hot path** (every Cmd+K admin tool) |
| `apps/admin/lib/chat/wizard-tool-executor.ts`             | 2900  | 8 (one fn = 2400 lines) | Less hot — wizard only fires on course-setup flows |

All three are on the `claude/model-kqgcaq` audit branch base. The audit
session left them untouched on purpose — refactoring needs its own scoped
session with proper test coverage in place.

## Pre-flight (DO FIRST)

1. **Open the relevant CLAUDE.md context.** This is an HF monorepo (Next.js
   16 + Prisma + spec-driven pipeline). Mantras: **Configuration over Code.
   Database over Filesystem. Evidence over Assumption. Reuse over Reinvention.**
   Branch-hygiene rule is mandatory — make a new branch off whatever is on
   `main` at refactor time (`chore/refactor-pipeline-route`,
   `chore/refactor-admin-tool-handlers`, `chore/refactor-wizard-executor`).

2. **Pick the worktree pattern.** Multiple `claude` sessions on the same tree
   share `.git/`; HF has a `git-lock-enforcer.sh` hook for this. Either:
   - typing `claude` inside `~/projects/HF` auto-worktrees you (`~/.zshrc`
     wrapper), or
   - launch the agent with `isolation: "worktree"` on the Agent tool.

3. **Read these memory files** (~/.claude/projects/-Users-paulwander-projects-HF/memory/):
   - `flow-pipeline.md` — the 7-stage pipeline; pipeline/route.ts is the
     orchestrator end of that flow.
   - `flow-prompt-composition.md` — COMPOSE-stage detail; what `runSpecDrivenPipeline`
     calls into.
   - `entities.md` + `holographic.md` — entity hierarchy + 8-section state shape.
   - `ai-to-db-fk-writes.md` — the guards the pipeline writes through.

4. **Run the test bed once before touching anything.**
   ```bash
   cd apps/admin
   npm run kb:check          # all 7 guards green is the baseline
   npm run ratchet:check     # tsc_errors 190 == baseline (post-audit)
   npx vitest run tests/api/pipeline tests/lib/pipeline tests/lib/chat
   ```
   Lock the ratchets to your starting numbers and **only let them drop**.

5. **Run `qmd embed`** if you haven't (per CLAUDE.md auto-sync). The refactor
   will move files; the KB needs to catch the rename for downstream agent
   searches.

## File 1 — `app/api/calls/[callId]/pipeline/route.ts` (4258 lines, 22 fns)

### Current shape

```
L1-L80    Top-of-file imports + JSDoc API contract
L81       async function loadCurrentModuleContext()             ──┐
L495      function buildBatchedCallerPrompt()                     │ "scoring" cluster
L546      function buildBatchedAgentPrompt()                      │ (~1700 lines)
L589      async function runPerSegmentScoring()                   │
L805      async function runBatchedCallerAnalysis()                │
L1450     async function runBatchedAgentAnalysis()                ┘
L1646     async function computeReward()                          ┐ "reward" cluster (~440)
L2065     export async function writeDiagnosticFromMock()         ┘
L1763     export async function incrementModuleEvidence()         ┐ "module-mastery" cluster
L1857     export async function writeModuleMastery()              │ (~230)
L1991     export async function resolveModuleEvidenceTargets()    ┘
L2158     async function aggregatePersonality()                   ── "personality" (~193)
L2351     async function computeAdapt()                           ┐ "adapt" cluster
L2426     function buildAdaptPrompt()                              │ (~310)
L2460     async function runAdaptSpecs()                          ┘
L2657     async function validateTargets()                        ┐ "targets" (~166)
L2719     async function aggregateCallerTargets()                 ┘
L2821     async function trackCurriculumAfterCall()                ┐ "post-call tracking" cluster
L3044     async function trackOnboardingAfterCall()                │ (~1100, BIGGEST)
L3087     async function updateTpMasteryAfterCall()                ┘
L3932     async function runSpecDrivenPipeline()                  ── "orchestrator" (~160)
L4093     export async function POST()                            ── HTTP handler (~165)
```

### Proposed split — extract into `lib/pipeline/<cluster>/`

```
lib/pipeline/
├── module-context.ts            ← loadCurrentModuleContext
├── scoring/
│   ├── build-batched-prompts.ts ← buildBatched{Caller,Agent}Prompt
│   ├── per-segment.ts           ← runPerSegmentScoring
│   ├── caller-analysis.ts       ← runBatchedCallerAnalysis
│   └── agent-analysis.ts        ← runBatchedAgentAnalysis
├── reward.ts                    ← computeReward + writeDiagnosticFromMock
├── module-mastery.ts            ← increment/write/resolve trio (already partially exported)
├── personality.ts               ← aggregatePersonality
├── adapt/
│   ├── compute.ts               ← computeAdapt
│   ├── prompt.ts                ← buildAdaptPrompt
│   └── runner.ts                ← runAdaptSpecs
├── targets.ts                   ← validateTargets + aggregateCallerTargets
├── post-call/
│   ├── curriculum.ts            ← trackCurriculumAfterCall  (~220)
│   ├── onboarding.ts            ← trackOnboardingAfterCall   (~45)
│   └── tp-mastery.ts            ← updateTpMasteryAfterCall   (~845, the elephant — may need its own sub-split)
└── orchestrator.ts              ← runSpecDrivenPipeline

app/api/calls/[callId]/pipeline/route.ts  (target: ~200 lines)
└── POST handler + request validation + error envelope
```

### Discipline

- **`updateTpMasteryAfterCall` is 845 lines on its own.** Treat it as a
  second-tier refactor: extract once into `post-call/tp-mastery.ts` in the
  first PR, then re-split internally in a follow-up PR. Don't try both at once.
- 3 functions are already `export` (incrementModuleEvidence,
  writeModuleMastery, resolveModuleEvidenceTargets, writeDiagnosticFromMock).
  Their callers need their import lines updated — search before you move:
  ```bash
  grep -rn "from.*\\[callId\\]/pipeline/route" apps/admin/
  ```
- Behaviour MUST be byte-identical. Pin with a golden test BEFORE the move:
  the existing `tests/api/sim-pipeline.test.ts` is quarantined but a
  snapshot of POST → response over a fixed transcript is the goal-stamp.
- The `runSpecDrivenPipeline` orchestrator is the right cut-point. Everything
  *below* it can move; the orchestrator just calls into `lib/pipeline/*`.

### Risks

- **Hot path.** Every Call hits this on completion. A subtle refactor break
  fails ALL pipeline runs. Stage the work behind a `HF_FLAG_PIPELINE_REFACTOR_V2`
  if you want a safer rollout (the codebase has the `HF_FLAG_*` pattern,
  see `HF_FLAG_SESSION_MODEL_V2` in MEMORY.md).
- **AI-to-DB guards on the move.** `incrementModuleEvidence` /
  `writeModuleMastery` write CallerAttribute + CallerModuleProgress under the
  #407 / #611 / #614 slug-canonical chain. Verify those guards still fire
  after the move (`tests/lib/curriculum/resolve-module.test.ts` is the pin).
- **Chain-contract docs reference `pipeline/route.ts` by line.**
  `docs/CHAIN-CONTRACTS.md` Link 3 cites this file. Update line refs as you
  move.

### Test coverage stamp before merge

```bash
npm run test -- tests/api/pipeline tests/lib/pipeline tests/lib/goals/track-progress
npm run kb:check
npm run ratchet:check     # tsc_errors must DROP or hold; never rise
```

## File 2 — `lib/chat/admin-tool-handlers.ts` (3092 lines, 45 fns)

### Current shape

One dispatcher (`executeAdminTool` at L155) + 44 `handleXxx` handlers, each
~30-200 lines, plus three shared helpers (`truncateResult`, `hashAssertion`,
`validatePriorCallRecapUpdates`).

Handlers cluster by entity. Visible from `grep -nE "^async function handle" lib/chat/admin-tool-handlers.ts`:

| Entity            | Handlers                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| Specs             | handleQuerySpecs, handleGetSpecConfig, handleUpdateSpecConfig            |
| Callers           | handleQueryCallers, handleGetCallerDetail, handleUpdateCaller, handleListGoalsForCaller |
| Subjects/content  | handleCreateSubjectWithSource, handleAddContentAssertions, handleLinkSubjectToDomain, handleUpdateAssertionLoLink |
| Curriculum        | handleGenerateCurriculum, handleUpdateCurriculumModule, handleListCurriculumModules |
| BehaviorTargets   | handleUpdateBehaviorTarget, handleListBehaviorTargets, handleUpdatePlaybookConfig |
| Goals             | handleConfirmGoal, handleDismissGoal                                     |
| Domain            | handleGetDomainInfo, handleUpdateDomain                                  |
| Playbook          | handleGetPlaybookConfig, handleUpdatePlaybookMeta, handleRepromptPlaybook |
| Recompose         | handleRecomposeCallerPrompt, handleRepromptDemoSet                       |
| (More past L2050 — enumerate as you scan) |                                              |

### Proposed split

```
lib/chat/admin-tool-handlers/
├── index.ts                     ← executeAdminTool dispatcher + shared helpers
│                                  (truncateResult, hashAssertion,
│                                  validatePriorCallRecapUpdates)
├── _types.ts                    ← shared input shapes / response types
├── specs.ts                     ← 3 handlers
├── callers.ts                   ← 4 handlers
├── subjects-and-content.ts      ← 4 handlers
├── curriculum.ts                ← 3 handlers
├── behavior-targets.ts          ← 3 handlers
├── goals.ts                     ← 2 handlers
├── domain.ts                    ← 2 handlers
├── playbook.ts                  ← 3 handlers
├── recompose.ts                 ← 2 handlers
└── ... (rest of L2050+ in their own files)
```

Index target: ~300 lines (dispatcher + helpers + barrel re-exports).
Each entity file: 200-500 lines (well within review-friendly bounds).

### Discipline

- The dispatcher is the only export the chat route consumes — `app/api/chat/route.ts`
  imports `executeAdminTool`. Don't break that contract.
- **Pending-changes-tray collector path** (per ai-to-db-guard.md row 13) —
  several handlers (e.g. `handleUpdateBehaviorTarget`, `handleUpdatePlaybookConfig`)
  push into the tray with `aiSuggested: true`. The 5-layer guard MUST keep
  firing after the move. ESLint rule `hf-config/no-ai-fanout-all` is the
  build-time arm.
- The `factual-grounding-intercept.ts` rule applies to handler RESPONSES too
  if they end up narrated back to the user. Don't break the grounding contract.

### Test coverage stamp before merge

```bash
npm run test -- tests/lib/chat tests/api/chat
npx eslint lib/chat/admin-tool-handlers --max-warnings 0   # the 11 warnings the file currently carries are CRITICAL to clear
```

The 11 lint warnings in this file (`Unexpected any` mostly) are the
single biggest pre-existing lint_warnings contributor. **The refactor is the
right time to type them** — but only if you have golden-test coverage on
EVERY handler. If coverage is sparse, leave the `any` casts alone and file
a follow-on issue. Don't conflate "refactor" with "type-tighten".

## File 3 — `lib/chat/wizard-tool-executor.ts` (2900 lines, 1 giant fn)

### Current shape

```
L1-L52    Imports + WELCOME_PHASE_DEFINITIONS constant
L53       export function applyStudentExperienceConfig()
L135      function validUuid()
L145      async function ensureInstitutionAndDomain()       ← resolver
L222      export async function executeWizardTool()         ← THE BIG ONE: ~2400 lines (L222 → L2607)
L2608     async function resolveInstitutionByName()         ┐
L2720     function inferTypeFromName()                       │ resolvers cluster
L2746     async function resolveCourseByName()              │
L2831     async function resolveSubjectByName()              ┘
```

`executeWizardTool` is a giant switch on `toolName`. Each case is 50-300
lines. Estimated 20-30 cases.

### Proposed split

```
lib/chat/wizard-tool-executor/
├── index.ts                     ← executeWizardTool dispatcher (small switch
│                                  with per-tool handler calls)
├── resolvers.ts                 ← ensureInstitutionAndDomain,
│                                  resolveInstitutionByName, resolveCourseByName,
│                                  resolveSubjectByName, inferTypeFromName, validUuid
├── apply-student-experience.ts  ← applyStudentExperienceConfig
├── welcome-phases.ts            ← WELCOME_PHASE_DEFINITIONS + helpers
└── tools/
    ├── create_institution.ts
    ├── create_course.ts
    ├── update_course.ts
    ├── add_module.ts
    ├── ... (one file per tool case)
```

Index target: ~200 lines (dispatcher only).

### Discipline

- `executeWizardTool` returns a tagged-union result type the chat route
  consumes. Keep the return type stable — extract the type into `index.ts` /
  `_types.ts` before extracting any case.
- Recent commits touched this file:
  - `40e2a690` (fix(chat): broaden DEMO tools with reads + fix 'Save & apply' mislabel)
  - `d3d6704f` (fix(chat): expose DEMO mode as a tab)
  - `0881b3ed` (login bundle strip, indirect)

  Be careful with merge conflicts — make a fresh branch off main and
  refactor in small bites. Each tool extraction can be its own commit.
- **`create_course` is one of the touchy ones** — per ai-to-db-guard.md row 8,
  it unlinks non-primary playbook Subjects via `unlinkNonPrimaryPlaybookSubjects`
  after the create. That guard MUST keep firing.

### Test coverage stamp before merge

```bash
npm run test -- tests/lib/chat/wizard tests/api/chat
npm run kb:check
```

If `tests/lib/chat/wizard/` doesn't exist, **build it before refactoring**.
There is no path forward on this file without per-tool golden tests.

## What NOT to do

- **Don't combine the refactor with feature work.** Pure file-shape changes
  only. The whole point is that `git blame` stays useful after.
- **Don't tighten types in the same PR.** The 11 `any` warnings in admin-tool-handlers
  can be typed AFTER the file is split (one entity file at a time, with golden
  tests behind each).
- **Don't fix bugs you find in-flight.** File them, finish the move, then fix
  on a separate branch. Otherwise nobody can review the refactor diff.
- **Don't refactor all three files in one branch.** Each is its own branch,
  its own PR, its own deploy slot. One at a time, lowest risk first
  (`wizard-tool-executor` is the coldest — start there).

## Recommended ordering

1. **`wizard-tool-executor.ts`** first (lowest risk; coldest path; easiest
   golden coverage).
2. **`admin-tool-handlers.ts`** second (medium risk; admin chat is offline-safe).
3. **`pipeline/route.ts`** last (highest risk; every Call hits it; needs
   `HF_FLAG_PIPELINE_REFACTOR_V2` gate for a staged rollout).

## Acceptance criteria per PR

- [ ] `npm run kb:check` ✓ all 7 guards green
- [ ] `npm run ratchet:check` ✓ no ratchet rose (tsc_errors, lint_errors,
      lint_warnings, quarantined_tests, knip_unused)
- [ ] `npm run test` ✓ no regressions; new golden-tests added with the
      refactor
- [ ] No file in the new directory >1000 lines
- [ ] Imports use the canonical `@/lib/...` alias (not relative)
- [ ] `git log --follow <new-path>` shows the rename history (use `git mv`, not
      delete + add)
- [ ] PR description carries a `## Verified by` section (gh-pr-create.sh
      enforces this — per `.claude/rules/verify-before-fix.md`)
- [ ] `docs/CHAIN-CONTRACTS.md` line references updated where they cite this
      file
- [ ] The refactor PR carries ZERO behaviour change (no feature, no bug fix,
      no type tightening). If the diff doesn't look like "move + adjust
      imports + add re-exports", redo it.

## Discoverability stamps for the next-next session

When each refactor lands, add a row to `docs/audit/PRODUCTION-READINESS-SCORECARD.md`
"Findings summary" table:

- HF-N: pipeline/route.ts refactor (~4258 → ~200, 9-cluster split)
- HF-O: admin-tool-handlers.ts refactor (~3092 → ~300, per-entity split)
- HF-P: wizard-tool-executor.ts refactor (~2900 → ~200, per-tool split)

Mark each ✅ Ship when complete, with the PR number + commit.

## When you're done

The 3 hotspots are gone. Re-run the audit's complexity probe:

```bash
find apps/admin/lib apps/admin/app -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -path "*/node_modules/*" -exec awk 'END{if(NR>1000)print NR"\t"FILENAME}' {} \; \
  | sort -rn | head -10
```

After all 3 PRs land, no file should exceed 2000 lines. If one does, it's the
next refactor candidate. Add it to a fourth HF row and a follow-on handoff.

## Open question for the next operator

These files grew organically over multiple sprints. The split above is my
best read AFTER the audit, not after the refactor. Be prepared for one of
the splits to feel wrong once you're inside it — re-cut along whatever
seam the code reveals, don't force my taxonomy.

If you change the split shape, update this handoff for the session after
you.

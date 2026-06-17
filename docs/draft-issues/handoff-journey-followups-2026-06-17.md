---
📋 HANDOFF — Paste into new Claude Code session

# Journey-tab follow-ups round 2 (from 2026-06-16 EOD session)

The first round shipped 7 PRs (#1813 → #1822) on 2026-06-16. Main is at
`94243985`. All 3 dead contracts removed, JourneyStop + JourneyPhases
typed editors landed, save round-trip smoke test live, tolerance bucket
fixed, ratchet bumped 43→57 (pre-push hook is usable again without
`HF_SKIP_PREPUSH=1`).

Detail of what shipped: `~/.claude/projects/-Users-paulwander-projects-HF/memory/project_journey_followups_2026_06_16_eod.md`.

User wants the ENTIRE journey surface closed before declaring done.
Per their standing rule: ship them, don't punt.

## The 6 follow-ons still to ship

### 1. Manual hf-dev browser verification of Stop + Phases editors (HIGHEST PRIORITY)

Vitest is clean (7 + 7 = 14 tests). Browser verification = pending.

After `/vm-cp` syncs main `94243985` to hf-dev:

```
/x/courses/<id>?tab=journey
```

Test each of the 6 affected contracts:
- preTestStop, midJourneyStop, npsStop, postTestStop (stop editor)
- onboardingFlowPhases, offboardingFlowPhases (phases editor)

**Per contract verification:**
1. Open from Cmd+K → Inspector renders
2. Enabled toggle: click → "• Unsaved" → wait 600ms → "✓ Saved"
3. Change a trigger type → conditional sub-field appears
4. Reload page → state preserved
5. **Critical: extras preservation.** If the value had `id`, `kind`,
   `delivery`, `payload` (Stop) or `successMetrics` (Onboarding wrapper)
   or `triggerAfterCalls` / `bannerMessage` (Offboarding wrapper) or
   `content` / `surveySteps` (per phase) — verify they SURVIVE a save +
   reload. Query DB via:
   ```
   psql ... -c "SELECT config->'sessionFlow'->'stops' FROM \"Playbook\" WHERE id='<id>'"
   ```
   then save + re-query. The non-exposed fields must be byte-identical.

If any extras get dropped → the editor's `serializeStop` / `serializePhases`
spread logic is wrong; both editors live at
`apps/admin/components/journey-controls/JourneyStop.tsx` and `.../JourneyPhases.tsx`.

### 2. Stop-vs-array contract path inconsistency

`SessionFlowConfig.stops` is typed as `JourneyStop[]` (array) in
`apps/admin/lib/types/json-fields.ts:267` but the 4 stop contracts have
`storagePath: "sessionFlow.stops.preTest"` / `.midJourney` / `.nps` /
`.postTest` (keyed access).

The current applier creates an OBJECT at `sessionFlow.stops` (not array)
when writing those paths. So the runtime stored shape diverges from the
declared type.

**Investigation needed before fixing:**
- Run `qmd search "sessionFlow.stops"` — find every reader. Are they
  reading by key or by iterating array?
- If readers expect array: the contracts are wrong. Convert to struct
  paths with `arrayKey: "kind"` + `selectorValue: "pre_test"` etc.
  Update applier integration tests.
- If readers expect keyed object: the TYPE is wrong. Convert to
  `stops?: Record<"preTest" | "midJourney" | "nps" | "postTest", JourneyStop>`.

This is a Lattice survey job — read `.claude/rules/lattice-survey.md`
first. 90-second discipline before any contract or type change.

### 3. Remaining 57 tsc errors — incremental cleanup

Clusters surfaced in PR7 commit message:

| Cluster | Files | Approx count |
|---|---|---|
| Prisma `segmentCues` include drift | `pipeline/route.ts`, `seed-ielts-course.ts` | ~5 |
| null/undefined union drift | `attainment/route.ts`, `pipeline/route.ts` | ~5 |
| Request vs NextRequest test fixtures | `tests/api/student/results/results-route.test.ts` | 7 |
| Missing module import | `app/x/test/[playbookSlug]/[moduleSlug]/page.tsx` → `@/lib/test-harness/clone-demo-caller` | 1 |
| Mock covariance | `tests/api/student-qualification-progress.test.ts` | 1 |
| Wizard sync + AuthoredModulesPanel + LearnerModulePicker drift | various | ~10 |
| Page-help registry / parameterised pathname | `tests/lib/page-help.test.ts` | 1 |
| Rest — diverse | various | ~28 |

Each cluster wants its own focused PR. After each clean-up PR, bump
`.ratchet.json::tsc_errors` to the new count so the pre-push hook keeps
the floor.

Suggested order: `segmentCues` drift first (referenced in CI failure
logs of every recent PR — fixing it cleans up half the noise).

### 4. tolRetrievalCadence control type — number → slider?

TL agent flagged during PR3 review:

> "Control is `number` (free-entry). If this is a bounded multiplier,
> a `slider` is more appropriate. Check whether `resolve-tolerance.ts`
> has a defined range for `retrievalCadenceOverride` — if so, add
> `min`/`max` hints or swap to `slider`."

Action:
1. Read `apps/admin/lib/tolerance/resolve-tolerance.ts` — does it clamp
   `retrievalCadenceOverride` to a range?
2. If bounded → change contract `control: "number"` → `"slider"` in
   `setting-contracts.entries.ts` (around line 1405). Verify slider
   renders correctly in Inspector.
3. If unbounded → leave as number. Document why in helpText.

### 5. Issue-number suffixes in helpText — 28 instances

TL agent flagged:

> "Issue numbers in user-visible help text are noise. Strip `(#598)`,
> `(#918)`, etc. from helpText."

`grep -c "(#[0-9]" apps/admin/lib/journey/setting-contracts.entries.ts`
returns 28. Site-wide convention violation — all-or-none change.

If shipping: one PR that strips all 28. Risk is zero (helpText is
cosmetic). Reviewer will notice the size of the diff.

If leaving: convert the convention. Issue numbers go in `// comment`
above the contract entry where engineers see them; helpText stays
educator-focused.

### 6. Renderers v2 epic — parked since 2026-06-13

Doc on main: `docs/draft-issues/followon-designer-renderers-v2.md`.
Filed at the close of CourseReDesign #1555. Activates when an operator
wants the Preview lens to render the new sections.

Approximate scope (read the doc for current numbers):
- **Group A:** 10 missing renderers to fill `PREVIEW_RENDERERS` registry
- **Group A.5:** 4 stories for new `conversationArtifacts` + `memoryDeltas`
  composer sections
- **Group B:** 2 registry-migration stories
- **Group C:** 4+ stories for the Snapshot tab

Per memory, this epic was "ready for BA grooming + child issues" as of
EOD 2026-06-13. Today (2026-06-16) it's still parked. Decide:
- (a) Activate now — file the GitHub epic, BA + TL grooming on each
  Group, then ship.
- (b) Keep parked — Renderers v2 has no operator pull right now; let it
  wait.

Talk to the user before activating — this is multi-day work.

## Context the new session needs

- **5 Lattice pillars** as of 2026-06-16: Chain Contracts / Guards /
  Cascade / Rules / **Coverage** (new). Coverage tests are at
  `apps/admin/tests/lib/journey/registry-options-coverage.test.ts`
  (the schema-coverage test at `registry-schema-coverage.test.ts`
  was referenced in a rule but doesn't exist yet — confirm if you need
  it). Rule: `.claude/rules/registry-schema-coverage.md`.
- **Bucket model:** 14 buckets (A_intake → M_end_of_course + N_voice).
  All 85 journey + 11 voice settings have `menuGroupKey` (enforced by
  `hf-journey/no-bucketless-journey-setting` ESLint rule).
- **3 dead-contract pattern:** if you find a contract with no
  PlaybookConfig type definition + no runtime reader, REMOVE it. The
  "robust" answer is removal, not papering over with helpText or
  placeholder options.
- **Compound editor pattern (Stop / Phases / future):**
  1. Parse value into `{<exposed-fields>, extra: Record<string, unknown>}`.
  2. Edit exposed fields.
  3. On save, merge `{...extra, <exposed-fields>}` so non-exposed
     fields survive. Two-level if the wrapper also has extras.
  4. For structural changes (add/remove/reorder), call `void saveDraft(next)`
     directly — NOT `f.commit()`. The hook's `commit()` reads
     `draftRef.current` synchronously and sees the stale pre-setDraftValue
     snapshot. `JourneyArrayEditor` + `JourneyPhases` use this pattern.
- **Pre-push hook ratchet:** `.ratchet.json::tsc_errors` is now **57**.
  If you reduce errors further, bump it down. If you can't reduce
  (real bug surface, takes time), DON'T raise it — fix the errors first.

## Worktree hygiene

All 7 worktrees from the 2026-06-16 session were cleaned. Start fresh:

```bash
git fetch origin main
git worktree list  # check for stale entries
# remove with `git worktree remove <path> --force` if not in use
git worktree add /Users/paulwander/projects/HF-r2 -b feat/journey-r2 origin/main
cd /Users/paulwander/projects/HF-r2/apps/admin
ln -s /Users/paulwander/projects/HF/apps/admin/node_modules node_modules
```

(Symlinking node_modules avoids the 30-min npm install. Works because
both worktrees track the same package.json.)

If you need `HF_FORCE_GIT=1` to push (i.e. you're a secondary claude
session sharing the main tree's lock), it's already in the project
permissions allow-list — `Bash(HF_FORCE_GIT=1 git:*)`. Use it
sparingly. Do NOT add it to env globally — was denied last session
for good reason.

## Verification before claiming done

User has explicit memory: "Never claim done/clean/complete without an
audit." When you finish, audit each of the 6 above, list what shipped
vs what didn't, and propose follow-ons rather than declaring victory.

For each PR opened:
- Include a `## Verified by` section in the PR body (per
  `.claude/rules/verify-before-fix.md`).
- Pre-push hook should pass naturally now (ratchet at 57). If it
  fails, you've introduced new tsc errors — fix them, don't bypass.

## Recommended sequence (small first, build momentum)

1. **#1 browser verification** (1-2 hr; might surface bugs to file)
2. **#3 tsc cleanup, one cluster at a time** — start with `segmentCues`
   drift (cleans up half the noise)
3. **#4 tolRetrievalCadence control investigation** (30 min)
4. **#5 helpText issue-number strip** (30 min — only if user approves
   the convention change)
5. **#2 Stop-vs-array reconciliation** (half day — needs Lattice
   survey + reader audit)
6. **#6 Renderers v2 epic** (only after talking to user about whether
   to activate)

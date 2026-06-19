# Design Brief — #2051: Wire 3 Call 1 Shape JourneySettingContracts

Sub-epic B of epic #2049. This brief defines the semantics, runtime behaviour, and
acceptance criteria for the three producer-only Call 1 shape contracts so an
implementation agent can wire them without making design judgement calls.

---

## Verified by (sibling-writer survey)

Searched for `baselineAssessmentDepth`, `firstCallCurriculumFocus`, `moduleSequencePolicy`
across all of `apps/admin/lib/` and `apps/admin/app/` — confirmed zero references
outside `lib/journey/setting-contracts.entries.ts`. All three are unambiguously
producer-only today. Existing sibling writers surveyed:

- `lib/prompt/composition/transforms/pedagogy.ts` — owns the `firstCallMode /
  baseline_assessment` branch (§A below).
- `lib/prompt/composition/transforms/modules.ts` — owns module-pool selection and
  sequencing; is the target consumer for §B and §C below.
- `lib/prompt/composition/defaults/critical-rules.ts` — emits `BASELINE_ASSESSMENT_RULE`;
  candidate location for depth-variant rules.
- `lib/types/json-fields.ts::PlaybookConfig` — does NOT yet declare
  `baselineAssessmentDepth`, `firstCallCurriculumFocus`, or `moduleSequencePolicy`.
  All three fields MUST be added in the implementation PR.

No sibling-writer conflict risk exists: none of the three fields is currently read
by any transform, so there is no clobber or ordering hazard.

---

## Contract 1 — `baselineAssessmentDepth`

`config.baselineAssessmentDepth: "light" | "standard" | "deep"` (select)

### A. Runtime intent

**Who edits this:** An educator who has set `firstCallMode = "baseline_assessment"` and
wants to control how much of the learner's first call is spent on diagnostic probing.

**Mental model:** "I'm running a placement-test call. Light is a quick spot-check (3
questions, 3 min); Standard is a practical gate (5 questions, 5 min); Deep is a full
diagnostic with follow-up probes (8 questions up to 8 min)."

**What changes in the learner's experience:**

| Depth | Question count | Distribution | Target duration | Follow-up probes |
|---|---|---|---|---|
| `light` | 3 | 1 question per LO from the first 3 LOs in `sortOrder` | ~3 min | None |
| `standard` | 5 | 1 question per LO from first 5 LOs in `sortOrder` | ~5 min | None |
| `deep` | 8 | 1 question per LO from all LOs, then 2 confidence follow-up probes on whichever LOs scored lowest | ~8 min | 2 probes targeting the LOs that received the lowest diagnostic evidence |

LOs are taken from the _current module_ (the module the scheduler selects on call 1 —
normally the first structured module by `sortOrder`). When the module has fewer LOs
than the question count, the AI covers all available LOs and stops.

**Where the value lands in the composed prompt:**

The directive lands in the `instructions` section, produced by
`lib/prompt/composition/transforms/instructions.ts`. The implementation should
check `isBaselineFirstCall` (already set by `pedagogy.ts`) and, when true, read
`pbConfig.baselineAssessmentDepth` to append a depth-specific sub-directive after the
existing `BASELINE_ASSESSMENT_RULE` critical rule.

Section reference: `composeImpact.sections = ["firstCallMode", "instructions"]` — the
contract already declares this correctly.

### B. Precise semantics per option

**`light` (3 questions):**
```
Directive injected into [INSTRUCTIONS] under the BASELINE section:
"Assessment depth: LIGHT. Ask 3 diagnostic questions only — one per learning
objective starting from the first objective in the sequence. Do not exceed 3 questions
total. Manage time so the session closes within 3 minutes of the assessment opening."
```

**`standard` (5 questions, DEFAULT when field absent):**
```
Directive injected:
"Assessment depth: STANDARD. Ask 5 diagnostic questions — one per learning objective
working through the sequence. Do not exceed 5 questions total. Target 5 minutes for
the assessment."
```
The default BASELINE flow (no `baselineAssessmentDepth` set) MUST produce
byte-identical output to `standard`. This preserves existing behaviour for any
playbook already using `firstCallMode = "baseline_assessment"` without the new field.

**`deep` (8 questions + 2 probes):**
```
Directive injected:
"Assessment depth: DEEP. Ask 8 diagnostic questions — work through all learning
objectives in sequence, then select the 2 LOs where the learner showed the least
confidence and ask one follow-up probe each. Target 8 minutes. Do not correct or
teach during the follow-ups — they are additional diagnostic evidence."
```

### C. Sibling-writer survey

- `pedagogy.ts::isBaselineFirstCall` — already set correctly; the new transform
  code MUST guard on `isBaselineFirstCall` to avoid emitting depth directives when
  `firstCallMode != "baseline_assessment"`.
- `defaults/critical-rules.ts::BASELINE_ASSESSMENT_RULE` — the existing rule stays
  unchanged. The depth directive is APPENDED after it in the prompt, not merged into
  it. Do not edit `BASELINE_ASSESSMENT_RULE`.
- `composeImpact.sections: ["firstCallMode", "instructions"]` — the contract's
  existing declaration is correct. The implementation PR MUST NOT change it.

No `gatedBy` is currently declared on this contract. The implementation PR should
add `gatedBy: { parentId: "firstCallMode", inactiveValues: ["onboarding", "teach_immediately"] }`
to the contract so the Inspector grays the depth selector out when `firstCallMode` is
not `"baseline_assessment"`. This is a UI correctness fix, not a compose concern —
the compose-time guard (§C above) is the structural safety net.

### D. Failure modes + edge cases

- **Field absent when `firstCallMode = "baseline_assessment"`:** default to `standard`
  (5 questions). The composed directive reads as if `standard` were set.
- **`firstCallMode != "baseline_assessment"`:** the transform MUST NOT emit any
  depth directive. Guard on `isBaselineFirstCall` before reading the config field.
- **Module has fewer LOs than the question count:** the AI covers all available LOs
  and the directive reads "up to N questions" — use "up to" phrasing so the AI
  doesn't hang waiting for a 5th LO that doesn't exist.
- **No LOs loaded at compose time:** emit no depth directive; `BASELINE_ASSESSMENT_RULE`
  alone is sufficient.

### E. Test plan

File: `tests/lib/composition/baseline-assessment-depth.test.ts`

```
1. Default preserves current behaviour:
   - Input: firstCallMode="baseline_assessment", baselineAssessmentDepth absent
   - Assert: assembled instructions section contains "5 diagnostic questions" directive
     (standard default applies)
   - Assert: existing BASELINE_ASSESSMENT_RULE text present unchanged

2. light option:
   - Input: firstCallMode="baseline_assessment", baselineAssessmentDepth="light"
   - Assert: assembled instructions contains "3 diagnostic questions"
   - Assert: NO mention of "follow-up probe"

3. deep option:
   - Input: firstCallMode="baseline_assessment", baselineAssessmentDepth="deep"
   - Assert: assembled instructions contains "8 diagnostic questions"
   - Assert: assembled instructions contains "follow-up probe"

4. No-op when firstCallMode != baseline_assessment:
   - Input: firstCallMode="onboarding", baselineAssessmentDepth="deep"
   - Assert: assembled instructions do NOT contain any "Assessment depth:" directive

5. No LOs loaded:
   - Input: firstCallMode="baseline_assessment", baselineAssessmentDepth="deep", modules=[]
   - Assert: no depth directive emitted; BASELINE_ASSESSMENT_RULE still present
```

---

## Contract 2 — `firstCallCurriculumFocus`

`config.firstCallCurriculumFocus: string[]` (multi-select of module slugs/ids)

### A. Runtime intent

**Who edits this:** An educator designing a structured course where not all modules
should be available on the learner's first call. Typical use case: "I want Call 1 to
only ever address Module 1 and Module 2 — no other modules should be surfaced to a
brand-new learner regardless of what the scheduler recommends."

**Mental model:** "This is a Call 1 allow-list. Only these modules are in play for
the first session."

**What changes in the learner's experience:** On Call 1 only (`isFirstCall === true`),
the module candidate pool fed to `selectNextExchange` (the scheduler) is filtered to
only modules whose `slug` (or `id`) appears in `firstCallCurriculumFocus`. The
scheduler still operates normally within the filtered pool.

This is **EXCLUSIVE**, not PRIORITIZED. If a module is not in the array, it is
ineligible for Call 1 regardless of mastery or scheduler preference.

### B. Precise semantics

**Filter point:** `modules.ts`, immediately before the `selectNextExchange` call (~line
885 of the current file), when `isFirstCall` is true and `firstCallCurriculumFocus`
is a non-empty array. The filtered pool replaces the full `modules` array for the
duration of the scheduler call only — it MUST NOT mutate the broader `modules` array
that `completedModules`, `tpProgress`, or `loMasteryMap` depend on.

**Filter identity:** match on `module.slug` first, then `module.id` as fallback (same
pattern used throughout `modules.ts`).

**When `firstCallCurriculumFocus` is absent or empty:** no filtering — fall through
to the existing behaviour unchanged (the full module pool is used).

**Cascade behaviour:** the field is NOT cascadable (no `cascadeSources` in the
contract). It lives on `Playbook.config` only. Do not add a cascade family.

**When all listed modules are already mastered (completed by the learner):**
Do NOT error. Fall back to the full module pool (unfiltered) and log:
```
[modules] firstCallCurriculumFocus: all listed modules already mastered — falling back to full pool
```
Rationale: the learner somehow completed these modules out-of-band (e.g. placement
test passed them), and blocking the call would be a worse outcome than serving the
next natural module.

**When `isFirstCall` is false (Call 2+):** the filter does NOT apply. This is a
Call 1 constraint only.

**Section impact:** the contract declares `composeImpact.sections = ["firstCallMode",
"modulesGate"]`. The `modulesGate` section is shaped by the module pool — filtering
the pool is sufficient; no additional directive needs to be injected into the prompt.
The scheduler already emits its decision into the composed prompt via the existing
`lessonPlanEntry` / `nextModule` output path.

### C. Sibling-writer survey

- `modules.ts::selectNextExchange` — the filter applies to the input `modules` array
  fed to this call. The call site is at ~line 885; the `workingSetInput.modules` array
  is assembled just above it. Apply the filter there.
- `modules.ts::completedModules` (lines 478-495) — built from `CallerModuleProgress`
  keyed on `module.slug`. The filter MUST NOT affect this set — it must reflect ALL
  modules the caller has ever completed, not just the Call 1 allow-list.
- `modules.ts::lockedModule` (picker-locked module, ~line 684) — if `lockedModule`
  is set (learner explicitly picked a module), the scheduler block is bypassed
  entirely. The `firstCallCurriculumFocus` filter MUST also be bypassed when
  `lockedModule` is set — the learner's explicit choice wins.
- `modules.ts::tpProgress` and `loMasteryMap` — both must remain full-scope; only
  the scheduler input is narrowed.

### D. Failure modes + edge cases

- **Empty array `[]`:** treated as absent — no filtering.
- **Array with invalid slugs (not matching any module):** filter returns empty pool.
  Fall back to full pool and log a warning. Do not throw.
- **`lockedModule` set:** skip filter. Learner pick overrides educator allow-list.
- **`isFirstCall = false`:** no filter applied.
- **Single module in the array:** that module is the only candidate; scheduler runs
  with pool of 1. If it is already mastered, fall back per the "all mastered" rule above.

### E. Test plan

File: `tests/lib/composition/first-call-curriculum-focus.test.ts`

```
1. Default preserves current behaviour:
   - Input: firstCallCurriculumFocus absent, isFirstCall=true
   - Assert: full module pool passed to selectNextExchange (no filtering)

2. Filter applied on Call 1:
   - Input: modules=[A,B,C], firstCallCurriculumFocus=["module-a","module-b"], isFirstCall=true
   - Assert: selectNextExchange receives only modules A and B

3. Filter not applied on Call 2+:
   - Input: modules=[A,B,C], firstCallCurriculumFocus=["module-a"], isFirstCall=false
   - Assert: selectNextExchange receives A, B, and C (full pool)

4. Fallback when all listed modules mastered:
   - Input: modules=[A(mastered),B(mastered),C], firstCallCurriculumFocus=["module-a","module-b"], isFirstCall=true
   - Assert: selectNextExchange receives A, B, and C (full pool — fallback)
   - Assert: console.log contains "all listed modules already mastered"

5. lockedModule bypasses filter:
   - Input: modules=[A,B,C], firstCallCurriculumFocus=["module-a"], isFirstCall=true, lockedModule=C
   - Assert: scheduler block bypassed as normal (no filter applied)

6. Invalid slug:
   - Input: modules=[A,B,C], firstCallCurriculumFocus=["not-a-real-slug"], isFirstCall=true
   - Assert: selectNextExchange receives A, B, and C (falls back to full pool on empty filter result)
```

---

## Contract 3 — `moduleSequencePolicy`

`config.moduleSequencePolicy: "strict" | "interleaved" | "learner_led"` (select)

Note: the contract uses `"learner_led"` (underscore) not `"learner-led"` (hyphen) —
confirmed from the `options` array in the contract definition.

### A. Runtime intent

**Who edits this:** An educator configuring how the AI tutor decides which module to
teach next. The knob controls sequencing policy within the scheduler.

**Mental model:** "Should the AI enforce prerequisite order, mix in spaced-review of
older material, or just follow wherever the learner leads?"

**What changes in the learner's experience:**

| Policy | Effect |
|---|---|
| `strict` | Prerequisites enforced; linear sequence; a module with unmet prerequisites is never placed in the scheduler's candidate pool, even if mastery is low. |
| `interleaved` | Spaced-review mixing: after every 3 consecutive new-module sessions, 1 review session is inserted for the most-eligible mastered module. New-material still drives the primary flow. |
| `learner_led` | No sequencing constraint; the scheduler runs unrestricted. First call behaviour is identical to the current default (no `moduleSequencePolicy` set). |

**Where the value lands:** `modules.ts` at the `selectNextExchange` call site,
via the `policy` object passed in `workingSetInput`. The existing
`getPresetForPlaybook` function returns a `SchedulerPolicy`; the implementation
extends the policy resolution to read `moduleSequencePolicy` and merge policy
properties before passing to `selectNextExchange`.

### B. Precise semantics per option

**`strict`:**

The module candidate pool passed to `selectNextExchange` is filtered to exclude any
module whose `prerequisites` array contains a module slug that is NOT in
`completedModules`. This is a hard gate — the AI cannot decide to skip a prerequisite.

Additionally, the resolved `SchedulerPolicy.retrievalCadence` override is set to
`0` (no review mode) when the policy is `strict`, because interleaving review with
a prerequisite chain creates confusing session plans. The scheduler still runs
`mode: "assess"` per its own cadence when the educator separately configures
assessment.

Directive logged: `[modules] moduleSequencePolicy=strict: filtered ${excluded} module(s) with unmet prerequisites.`

**`interleaved`:**

Apply the standard module pool (no prerequisite filtering beyond what already
exists in the scheduler). Additionally, after the scheduler resolves, check:

```
callsSinceLastReview = (callNumber - 1) % 4
// 0 = new session, 3 = review session (every 4th call)
```

When `callsSinceLastReview === 3`, pass `mode: "review"` to the scheduler (override
the scheduler's mode decision for this call only). The `interleaveReview.ts` loader
already handles surfacing a review candidate; the policy here ensures the scheduler
agrees with the loader's suggestion by forcing `mode: "review"` at the right cadence.

Ratio: 3 new sessions : 1 review session. This matches the existing
`interleaveReviewMinDays` convention (every ~7 days at 2-3 calls/week).

The `interleaveReviewMinDays` config field is UNAFFECTED — it controls the staleness
threshold within the review selection, not the cadence at which reviews are inserted.

Directive logged: `[modules] moduleSequencePolicy=interleaved: cadence tick ${callsSinceLastReview}/4 — mode=${resolvedMode}.`

**`learner_led`:**

No change to the scheduler input. Behaviour is byte-identical to `moduleSequencePolicy`
absent (current default). This is the safe no-op value.

**Default (field absent):** behaviour is byte-identical to `learner_led`. The
implementation MUST produce identical composed prompt output when the field is absent
vs. when it is `"learner_led"`.

### C. Sibling-writer survey

- `modules.ts::getPresetForPlaybook` — the current entry point for scheduler policy
  resolution. The implementation should extend this function (or add a wrapper) to
  merge `moduleSequencePolicy` overrides into the returned `SchedulerPolicy`. Do NOT
  create a parallel policy resolution path.
- `modules.ts::completedModules` — used for strict-mode prerequisite checking. Already
  computed correctly before the scheduler call.
- `lib/prompt/composition/transforms/interleaveReview.ts` — existing transform for
  the interleave review nudge. The `interleaved` policy does not change this transform;
  it instead ensures the scheduler's mode decision aligns with it.
- `loaders/interleaveReview.ts` — reads `interleaveReviewMinDays` from `pbConfig`.
  Not affected by `moduleSequencePolicy`.
- `config.strictPrerequisites` (existing `PlaybookConfig` field, ~line 744 of
  `json-fields.ts`) — also controls prerequisite gating but at the picker layer
  (UI hard-lock), not the scheduler candidate pool. These are complementary, not
  competing: `moduleSequencePolicy: "strict"` gates the scheduler pool; `strictPrerequisites:
  true` gates the UI picker. An educator may set both; no conflict.
- `modules.ts::lockedModule` — when set, the scheduler block is bypassed. The
  `moduleSequencePolicy` filter MUST also be bypassed in this case.

**Default-deny check:** guard #1252 (`no-module-read-without-course-style-guard`)
applies. Both `strict` and `interleaved` filtering operate on the module pool which
is already inside the `courseStyle === "structured"` branch in `modules.ts`. The
implementation MUST NOT add a separate `courseStyle` check — the enclosing branch
already provides it. `learner_led` and absent are no-ops, so no guard issue.

### D. Failure modes + edge cases

- **`learner_led` when new learner (no `lastSelectedModuleId`):** no `lockedModule`
  is set; the scheduler runs normally and picks the first module by `sortOrder`. This
  is the existing default behaviour — no change.
- **`strict` when all modules have prerequisites met:** no modules are filtered out.
  The pool is unchanged. Log: `[modules] moduleSequencePolicy=strict: no modules filtered (all prerequisites met).`
- **`strict` when all modules have unmet prerequisites (misconfigured course):** the
  pool after filtering is empty. Fall back to the full pool and log a warning:
  `[modules] moduleSequencePolicy=strict: all modules filtered out (check prerequisite configuration) — using full pool.`
- **`interleaved` on Call 1 (`callNumber = 1`):** `(1 - 1) % 4 = 0` — first session
  is always a new-module session. No review override fires on the very first call.
- **`moduleSequencePolicy` set for a CONTINUOUS course:** the contract already
  declares `appliesTo: ["structured"]`. The transform should confirm `courseStyle
  === "structured"` and emit a console.warn + no-op if not. This is defensive
  programming; the inspector gate should prevent it in practice.

### E. Test plan

File: `tests/lib/composition/module-sequence-policy.test.ts`

```
1. Default (absent) preserves current behaviour:
   - Input: moduleSequencePolicy absent, modules=[A(prereq:[]),B(prereq:["module-a"]),C], isFirstCall=true
   - Assert: selectNextExchange receives all 3 modules (no filtering)

2. learner_led is byte-identical to absent:
   - Input: moduleSequencePolicy="learner_led", same modules as above
   - Assert: selectNextExchange input identical to test 1

3. strict filters unmet prerequisites:
   - Input: moduleSequencePolicy="strict", modules=[A,B(prereq:A),C], completedModules={}
   - Assert: selectNextExchange receives only A and C (B excluded — prereq A not met)

4. strict passes when prerequisites met:
   - Input: moduleSequencePolicy="strict", modules=[A,B(prereq:A)], completedModules={"module-a"}
   - Assert: selectNextExchange receives both A and B

5. strict falls back when all modules filtered:
   - Input: moduleSequencePolicy="strict", modules=[A(prereq:X)], completedModules={}
   - Assert: selectNextExchange receives A (full pool fallback)
   - Assert: console.warn contains "all modules filtered out"

6. interleaved: review mode fires on 4th call:
   - Input: moduleSequencePolicy="interleaved", callNumber=4, modules=[A(mastered),B,C]
   - Assert: scheduler receives mode="review" override
   - Assert: interleaveReview candidate is considered

7. interleaved: no review mode on non-4th call:
   - Input: moduleSequencePolicy="interleaved", callNumber=2
   - Assert: mode determined by scheduler normally (no override)

8. lockedModule bypasses all policy:
   - Input: moduleSequencePolicy="strict", lockedModule=B(prereq:A), completedModules={}
   - Assert: scheduler block bypassed as normal (B is served)
```

---

## Cross-cutting acceptance criteria (all 3 contracts)

- [ ] `PlaybookConfig` in `lib/types/json-fields.ts` declares all 3 fields with
  `@bucket 1` annotation and JSDoc per the existing pattern.
- [ ] `tests/lib/journey/registry-schema-coverage.test.ts` updated to add all 3
  paths to `EXPECTED_SCHEMA_PATHS` (prevents the Slice-C gap class).
- [ ] `tests/lib/journey/registry-consumer-coverage.test.ts` exempt entries removed
  for all 3 contracts once consumers are wired (currently they are in the exempt list
  or would be classified `gap` — after this PR they MUST be `covered`).
- [ ] No change to the `composeImpact` declarations on any of the 3 contracts.
- [ ] `gatedBy` added to `baselineAssessmentDepth` contract (UI-only, non-breaking).
- [ ] All existing baseline-assessment call paths produce byte-identical composed
  prompts to their pre-PR output (no regression for `firstCallMode="baseline_assessment"`
  courses already live).
- [ ] `moduleSequencePolicy: "learner_led"` and absent produce identical composed
  prompt output.
- [ ] `firstCallCurriculumFocus` filter does not affect `completedModules` or `tpProgress`.
- [ ] No new ESLint errors introduced.
- [ ] `npx vitest run` passes with no new failures.

---

## Out of scope

- MCQ generation or quiz-mode integration (that is epic #2009 / #2011).
- Per-LO depth variants (asking N questions per LO, not N total) — this is a future
  enhancement.
- Cascade families for any of the 3 fields — all are course-only knobs.
- `moduleSequencePolicy: "strict"` UI hard-lock at the picker (that is `strictPrerequisites`
  — a separate field).
- ADAPT-stage interaction with `moduleSequencePolicy` — the policy applies at compose
  time only; ADAPT reads mastery, not policy.

---

## Effort estimate

~6h total across the 3 wires:
- `baselineAssessmentDepth`: ~1.5h (instructions.ts directive + tests)
- `firstCallCurriculumFocus`: ~2h (modules.ts filter + edge cases + tests)
- `moduleSequencePolicy`: ~2.5h (policy merge + interleaved cadence + strict filtering + tests)

## Deploy command

`/vm-cp` — no schema migration. All 3 fields are `PlaybookConfig` JSON additions (no
new Prisma columns). The `PlaybookConfig` type update is TypeScript-only.

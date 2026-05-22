# Epic 100 — Chain-Walk Report

> **Required reading** for any work touching adaptive-loop boundaries (EXTRACT, SCORE_AGENT, AGGREGATE, REWARD, ADAPT, SUPERVISE, COMPOSE).
>
> Generated 2026-05-22 during Epic 100 grooming. Captures the full course → learner → measures → prompts → next-call walk with per-link risk + mitigation analysis.
>
> Epic: [#600](https://github.com/WANDERCOLTD/HF/issues/600) | Verification harness: [#631](https://github.com/WANDERCOLTD/HF/issues/631)

---

## Origin

A single bad transcript from caller Nico Grant (`f17d8616-3c31-4814-8de1-626fb42f16f6`) on 2026-05-22 in IELTS Prep Lab. ComposedPrompt `8acde2a1-b1b7-4767-aede-c6277f5cb68e`, Call `010312de-134e-4d0c-bcdd-c91924ea2d93`, Playbook `ec4127a1-2097-4ad4-8f11-af5da46c679e`.

What looked like one bad prompt turned out to be 6 distinct unenforced contracts between adaptive-loop modules. The walk below traces each link in the loop, names the contract, identifies which Epic 100 story touches it, and assesses chain-break risk after the bundle ships.

---

## Executive summary

The Epic 100 bundle (#604–#611, #614–#616, #631) addresses data-contract violations across the course-to-call pipeline. This walk identified **three high-impact gaps** that became follow-on stories (#614, #615, #616) and one foundational harness story (#631).

**Verdict:** bundle is **safe to ship** with the verification harness landing first, the three migrations queued, and the documented merge order respected. No blocking issues; all gaps have remediation paths.

**Highest-priority mitigation:** historical `CallerAttribute` lo_mastery key migration (#614) — without it, post-#611 loop closure is non-deterministic.

---

## The chain

```
COURSE (Playbook + Curriculum + LOs + Subjects)
   │ defines what's taught
   ▼
LEARNER (Caller + Memories + Profile + Personality)
   │ defines who's being taught
   ▼
MEASURES (CallScore + LO mastery + parameters + targets)
   │ defines how progress is tracked
   ▼
PROMPTS (ComposedPrompt + transforms)
   │ defines what the AI does next
   ↑                                    │
   └────────────────────────────────────┘
                next call
```

---

## Link 1 — COURSE → CONTENT (extraction)

**Contract:** `CONTENT_EXTRACTION_V1`

- **Input:** document uploaded with declared `documentType`, optional `teachMethod` override
- **Output:** `ContentAssertion` + `ContentQuestion` rows with `teachMethod`, `assessmentUse`, `learningObjectiveId`, `linkConfidence`

**Bundle issues touching this link:** #605 (teachMethod assignment), #606 (assessmentUse default), #607 (subject linkage)

**Risk pre-mitigation:** MEDIUM — new courses extract cleanly; existing assertions may have legacy null `teachMethod` or divergent `assessmentUse` inference on QUESTION_BANK rows.

**Mitigation:** Backfill scripts deployed pre-ship. `#606` AC: *"All `ContentQuestion` rows from QUESTION_BANK sources have `assessmentUse != null` post-migration."*

**Status:** ✅ closed (audit AC + backfill in #605 / #606)

---

## Link 2 — CONTENT → CURRICULUM (LO linkage)

**Contract:** `LO_LINKAGE_V1`

- **Input:** `ContentAssertion` rows with `learningObjectiveId` + `linkConfidence`
- **Output:** LO mastery tracking driven by correct curriculum scope

**Bundle issues touching this link:** #607 (subject linkage cleans up orphan LOs)

**Risk pre-mitigation:** MEDIUM-HIGH — `#607` may detach the only-host subject of some `LearningObjective` rows; existing `ContentAssertion.learningObjectiveId` becomes a dangling soft-FK (no DB-level enforcement); AGGREGATE then can't derive mastery → silent zero or runtime error.

**Mitigation:** Follow-on story **#615** — extend `scripts/check-fk-consistency.ts` (CI step 5) with orphan-LO detection. Initial cleanup migration audits DEV; AGGREGATE gracefully handles missing LO (log warning, skip write).

**Status:** 🟡 partial — covered by #615 (queued)

---

## Link 3 — CURRICULUM → CALL (compose)

**Contract:** `PROMPT_COMPOSITION_V1`

- **Input:** LO scope, active curriculum, playbook enrollment, content loaders scoped by `subjectSourceId`
- **Output:** `ComposedPrompt` with teaching content, course instructions, questions, behaviour targets

**Bundle issues touching this link:** #604 (criticalRules), #606 (question filter), #608 (identity), #610 (transform config)

**Risk pre-mitigation:** LOW — loaders are already scoped-safe (strict `subjectSourceId IN (…)` with no null fallback per `flow-prompt-composition.md` §3). Identity and transform changes are isolated.

**Mitigation:** None required — loaders already defend against scope bleed.

**Status:** ✅ closed (existing defences sufficient)

---

## Link 4 — CALL → TRANSCRIPT → SCORE (pipeline)

**Contract:** `CALL_SCORE_V1`

- **Input:** transcript + ComposedPrompt parameters
- **Output:** `CallScore` rows with canonical key form `(callId, parameterId, moduleId?)`

**Bundle issues touching this link:** #611 (moduleId resolution, evidence gate, priorCallFeedback filter)

**Risk pre-mitigation:** MEDIUM — #611 changes how CallScore keys are formed (some scores now carry slug-form `moduleId`, historical rows carry name-form or no moduleId). COMPOSE stage (order 100) reads CallScore rows from AGGREGATE output (order 30). If AGGREGATE produces a new key form and COMPOSE expects old form, they miss each other silently.

**Mitigation:** `#611` ACs (added):
- "After migration, all CallScore rows have a single canonical key form. Validator audit confirms zero rows with divergent forms."
- "COMPOSE reader at `modules.ts:688` handles BOTH pre- and post-migration forms during a 2-week grace window. Cutover criterion documented."
- "Fixes A + B + C ship in **one PR**. No partial merges."

**Status:** 🟡 partial — covered by #611 (monolithic merge enforced via AC)

---

## Link 5 — SCORE → AGGREGATE → ADAPT (mastery tracking)

**Contract:** `MASTERY_TRACKING_V1`

- **Input:** `CallScore` rows + `LearningObjective` definitions
- **Output:** mastery per LO + next-module selection

**Bundle issues touching this link:** #605 (clean assertions → cleaner mastery), #607 (clean subject → clean mastery scope), indirectly #611

**Risk pre-mitigation:** MEDIUM — #607 may delete LOs; AGGREGATE tries to derive mastery for a deleted LO → either drops the row silently or crashes. ADAPT's module-selection depends on mastery scope being correct; polluted scope → wrong next module.

**Mitigation:** Post-#607, audit AGGREGATE's LO-mastery derivation (`#615`). Add logic: *"if LO no longer exists, skip the mastery row with logging."*

**Status:** 🟡 partial — covered by #615 (queued)

---

## Link 6 — ADAPT → COMPOSE (loop closure)

**Contract:** `CALLER_STATE_V1`

- **Input:** mastery + `CallerAttribute` (memory keys) + `CallerMemory`
- **Output:** fresh `ComposedPrompt` for next call carrying forward adaptive state

**Bundle issues touching this link:** #605, #607 may introduce key-form divergence in legacy data

**Risk pre-mitigation:** **HIGH** — existing `CallerAttribute` rows use old naming convention (e.g. `lo_mastery:Part 1: Familiar Topics:OUT-01`). New code may expect slug-form (`lo_mastery:part1:OUT-01`). COMPOSE loaders may skip old-form keys silently → memory loss between calls (silent data loss).

**Mitigation:** **Follow-on story #614 — CRITICAL.**

```sql
SELECT COUNT(*),
       CASE
         WHEN "key" LIKE 'lo_mastery:%' AND "key" ~ '[A-Z ]' THEN 'old_name_form'
         WHEN "key" LIKE 'lo_mastery:%' AND "key" !~ '[A-Z ]' THEN 'slug_form'
         ELSE 'other'
       END AS key_pattern
FROM "CallerAttribute"
WHERE "expiresAt" IS NULL OR "expiresAt" > NOW()
GROUP BY key_pattern;
```

If `old_name_form` count > 0: migration script `scripts/migrate-caller-attribute-lo-mastery-keys.ts`:
- Read old-form rows
- Slugify key via `resolveModuleByLogicalId(curriculumId, name)` — same canonical resolver as #611
- Write new row with slug-form key + `migratedFromKey` provenance in `meta`
- Soft-delete old row (set `expiresAt = NOW()`)
- COMPOSE reader: during grace window, try new form first, fallback to old

**Estimated volume:** Query above determines. Assume 500–5,000 rows based on production call volume.

**Status:** 🟡 partial — covered by #614 (queued, CRITICAL priority)

---

## Summary table

| Link | Input → Output | Bundle issues | Risk (pre-mitigation) | Mitigation | Status |
|------|----------------|---------------|-----------------------|------------|--------|
| 1. COURSE → CONTENT | Doc → ContentAssertion/Question | #605, #606, #607 | M | Backfill script + AC audit | ✅ closed |
| 2. CONTENT → CURRICULUM | Assertion → LO linkage | #607 | M-H | Post-ship FK audit + cleanup (#615) | 🟡 partial |
| 3. CURRICULUM → CALL | LO scope → ComposedPrompt | #604, #606, #608, #610 | L | Loaders already scoped-safe | ✅ closed |
| 4. CALL → SCORE | Transcript → CallScore key form | #611 | M | Monolithic merge + grace window (#611 ACs) | 🟡 partial |
| 5. SCORE → ADAPT | CallScore → mastery → next module | #605, #607, #611 | M | Post-ship mastery-cleanup audit (#615) | 🟡 partial |
| 6. ADAPT → COMPOSE | Mastery + CallerAttribute → next prompt | #605, #607 | **H** | **Historical key migration (#614)** | 🟡 partial — CRITICAL |

---

## Recommended ACs (applied 2026-05-22)

Applied via `gh issue comment` on each child:

- **#605** — backfill script + memory docs (entities.md `tutor_instruction`, ai-to-db-fk-writes.md guard entry) + lesson-plan models review
- **#606** — `assessmentUse` in `select` not just `where` + defense-in-depth render-time filter + memory doc
- **#607** — FK cascade audit BEFORE unlink + orphan-LO audit AFTER + cross-course regression test + memory doc
- **#611** — MONOLITHIC merge (A+B+C in one PR) + wider scope (signature change OR move resolve to call sites + second write site) + universal evidence gate (not extension of #566 IELTS-only guard) + parameter-category filter primary (not strict moduleId) + reader stays tolerant for 2-week grace window
- **#604** — memory doc + test debt rewrite (preamble.test.ts:149 + renderPromptSummary.test.ts:97-118) in same PR + sequencing-after-#605/#606/#607
- **#608** — Option C / Option A scope split
- **#610** — in-flight migration strategy (config fallback to thin code defaults if spec field absent)

---

## Follow-on issues opened 2026-05-22

| # | Title | Severity | Effort |
|---|-------|----------|--------|
| **#614** | Historical CallerAttribute lo_mastery key migration | **HIGH (silent memory loss without it)** | M (~4h) |
| **#615** | Post-#607 orphan-LO + dangling-assertion audit | MEDIUM-HIGH | S-M (~3h) |
| **#616** | docs/CHAIN-CONTRACTS.md — single inventory of stage-to-stage contracts | MEDIUM | M (~4–6h) |
| **#631** | Epic 100 verification harness — audit + golden-caller + evals + sim proofs + CI | **FOUNDATIONAL (blocks all)** | M (~5–6h) |

---

## Execution order (final)

```
#631 (verification harness — BLOCKS ALL OTHERS, lands first)
  ↓
#606 → #607 → #605 → #608-C → #604 → #611 (monolithic) → #614 → #615 → #608-A → #610 → #616
```

---

## Reading this doc

**Required reading** when working on any file in:

- `apps/admin/lib/prompt/composition/` (touches links 3 + 6)
- `apps/admin/lib/curriculum/` (touches links 1, 2, 5)
- `apps/admin/lib/pipeline/` (touches links 4, 5)
- `apps/admin/lib/content-trust/` (touches link 1)
- `apps/admin/lib/chat/wizard-tool-executor.ts` (touches links 1, 2)
- `apps/admin/scripts/backfill-*.ts` (touches links 1, 6)

Before editing any of these, verify your change respects the documented contract for the affected link. If your change introduces a new contract or modifies an existing one, update this doc as part of the PR.

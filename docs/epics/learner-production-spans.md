# Epic — Learner Production Spans

**Status:** PARKED — groomed 2026-05-25, three sprint blockers to resolve before P1 starts
**Issues:** Epic [#804](https://github.com/WANDERCOLTD/HF/issues/804) · P1 [#805](https://github.com/WANDERCOLTD/HF/issues/805) · P2 stub [#806](https://github.com/WANDERCOLTD/HF/issues/806) · P3 stub [#807](https://github.com/WANDERCOLTD/HF/issues/807)
**Driver:** First-class learner experience. Current tutor has no concept of "learner error" beyond mastery scores on quiz answers — free-conversation errors (e.g. "I go school") pass through unrecorded.
**Source memory:** `~/.claude/projects/-Users-paulwander-projects-HF/memory/epic-learner-production-spans.md` (canonical originate; this file is the repo mirror)

**Why:** Language learners need recasting + persistent error tracking. AKMD (`docs/pedagogical-approach.md`) treats errors as 0–5 quality scores per TP, not as content. Course-author free-text workarounds exist (IELTS course-ref's "Directive correction-retry cycle") but no system primitive.

**How to apply:** Before starting any "tutor needs to remember/recast errors" or "error pattern tracking" work, read this. The primitive choice and the event-gate defence are the load-bearing decisions.

---

## Sprint blockers (resolve before P1)

Three sprint-blocking design gaps identified in Tech Lead review (2026-05-25). None can be resolved during implementation — they determine the shape of the code. See [#805](https://github.com/WANDERCOLTD/HF/issues/805) for the full blocker detail.

| # | Blocker | Who resolves | Required output |
|---|---|---|---|
| B1 | **Execution-path decision** — `SPAN-ANNOTATE-001` auto-discovery routes to `runBatchedCallerAnalysis` (wrong executor for a two-pass annotator). Choose: (a) routing branch via `scoringGate: "span-annotate"` marker, or (b) dedicated side-op in `route.ts::stageExecutors.EXTRACT` alongside `extractArtifacts`. | Tech Lead + implementor | ADR in `docs/decisions/` before any code |
| B2 | **Tag vocabulary v1** — `{type}` token in `error_pattern:{type}:{lemma}` must be a closed enum. Resolution (2026-05-26): **Lyster & Ranta 1997 SLA correction taxonomy** (`recast`, `explicit`, `metalinguistic`, `elicitation`, `clarification`, `repetition`). Language v1 only; non-language `teachingProfile` ships `enabled: false`. | PM (RESOLVED) | Enum in `lib/types/json-fields.ts` + `SPAN-ANNOTATE-001.config.annotationTagSet` seed |
| B3 | **Lemma canonicalisation** — Free-form AI `{lemma}` output will produce duplicate EMA rows without normalisation. `resolveSpanKey(type, lemma)` helper modelled on `resolveModuleSlug` must exist before annotator is wired. | Implementor (follows B2) | `lib/pipeline/resolve-span-key.ts` — validates `type` against closed enum, normalises `lemma` (lowercase, trim, strip punctuation) |

---

## Primitive choice (after rejecting alternatives)

**Use:** `LearnerProduction` rows — annotated transcript spans with controlled-vocabulary tags.

| Considered | Rejected because |
|---|---|
| `error_pattern` entity (language-only) | Doesn't generalise; forks the data model |
| Extend TP/LO mastery | EXTRACT only fires on quiz answers; misses free-conversation errors |
| `Misconception` (cog-sci concept) | Discrete-belief framing doesn't fit gradient language errors |
| `Skill` (existing SKILL_MEASURE_V1) | Too coarse — captures rollups, not per-utterance evidence |
| `CallScore` with new `kind` field | `parameterId` FK is central to model; span isn't a scored parameter (TL ruling, 2026-05-25) |

**Why spans:** subject-agnostic (maths slips, history argument gaps, language errors all fit), captures positive evidence not just absence-of-error, enables recasting (you have the span + target form), enables post-hoc pattern mining without pre-defining error types. Matches how skilled human tutors take notes.

**Row shape:** `{ callId, callerId, span, startOffset, endOffset, tags[], targetForm, confidence, polarity, isGap }`.

The `polarity: "gap" | "positive"` column (default `"gap"`) accommodates future positive-evidence rows without a migration; v1 writes only `"gap"`.

---

## Cost architecture — two-pass EXTRACT

- **Pass 1 (Haiku gate):** "does this utterance contain anything worth annotating?" — 1-token output, runs on every utterance that survives the event-gate. Cheap. Always-on when `enabled=true` and event-gate passes.
- **Pass 2 (Sonnet annotator):** structured tag + targetForm output, only on Pass 1 hits, sampled per `annotationSampleRate`.

Sliders attenuate Pass 2 spend, not Pass 1. Range ~$0.001/call (sample 0) to ~$0.05/call (sample 1.0).

**Critical:** The per-call `enabled=false` short-circuit MUST fire BEFORE Pass 1 — `annotationSampleRate` is a Pass-2 control only.

---

## Cascade defaults (modelled on #833 `resolveMasteryThreshold`, not `resolveExtractionConfig`)

| Layer | Source |
|---|---|
| 1. Per-call override (debug) | `Call.config.spanAnnotation` |
| 2. Per-playbook | `Playbook.config.spanAnnotation.*` (each field tagged `@bucket` per #822) |
| 3. Per-subject teaching profile | `Subject.teachingOverrides.spanAnnotation` (or new field — to decide in P1) |
| 4. Canonical spec | `SPAN-ANNOTATE-001.config.defaults` |
| 5. Hard fallback | log warning + return `{ enabled: false }` — **not** throw |

**Resolver:** `resolveSpanAnnotationConfig(playbookId)` — single typed function. Inline comment per layer. `console.log` on the winning layer. Reuse the convention established by `lib/tolerance/resolve-tolerance.ts` (#833), not the older `resolveExtractionConfig` shape.

**Knobs:** `enabled`, `annotationSampleRate` (0–1), `annotationModelTier` (haiku/sonnet), `annotationMinUtteranceWords`, `annotationMaxPerCall`, `annotationTagSet` (slug), `annotationFocusToActiveLOs`.

**Profile defaults (`Subject.teachingProfile` enum, not domain names):** to be defined per profile-key (`comprehension-led`, `recall-led`, `practice-led`, `syllabus-led`, `discussion-led`, `coaching-led`) — not per "Language / History / Maths". For v1, only courses with `teachingProfile = practice-led` AND domain Language get a non-false default.

---

## Flag strategy (4 levels)

1. **Global kill:** `config.featureFlags.spanAnnotation` short-circuits at EXTRACT entry.
2. **Per-env:** sandbox/staging on, pilot/prod off until proven.
3. **Per-course opt-in:** v1 default `false`, IELTS opts in alone.
4. **Per-call escape:** `Call.config.spanAnnotation.enabled=false`.

COMPOSE side self-gates on empty data — flag flip-off / flip-on causes no broken state. Persisted `CallerAttribute` rows just sit unread when disabled.

---

## Pipeline placement

- **PIPELINE-001 stage spec — no change.** The two passes are internal to one extractor.
- New `SPAN-ANNOTATE-001` AnalysisSpec, `outputType: MEASURE`, `scope: SYSTEM`.
- **B1 unresolved:** `specRole` is NOT a discovery filter — `getSystemSpecs` filters on `outputType` + `scope` only. A `MEASURE`-typed spec would be picked up but routed through `runBatchedCallerAnalysis` (wrong executor for a two-pass annotator). The ADR for B1 must decide between a `scoringGate: "span-annotate"` marker that routes inside the batch runner, or a dedicated side-op in `route.ts::stageExecutors.EXTRACT` alongside `extractArtifacts`.
- New AGGREGATE rollup → `CallerAttribute` keys `error_pattern:{type}:{lemma}` (EMA, same shape as `lo_mastery:*` #611). Reuses `lib/pipeline/aggregate-runner.ts` upsert path.
- New COMPOSE section `[LEARNER ERROR PATTERNS]` + per-call `[LISTEN FOR]` hints. Staleness via EMA + `validUntil` (reusing #614 drain pattern). Length cap required.
- Extend `Subject` teaching profile spec with annotation defaults.

---

## LANDMINE — Scheduler v1 event-gate

**Rule:** SpanAnnotator MUST respect the existing EXTRACT event-gate (`docs/pipeline.md` §2). When prior `SchedulerDecision.mode` ∉ assessment modes, skip annotation entirely.

**What goes wrong if ignored:**

1. **Cost:** Pass 1 fires on every utterance of every onboarding, offboarding summary, and recap-mode call — the bulk of low-value spend.
2. **Data poisoning:** Intro chitchat ("hi I'm good thanks") flagged with false-positive `error_pattern:*` rows in `CallerAttribute`.
3. **Prompt drift:** COMPOSE rolls up the noise, next call's prompt says "Listen for: informal register, dropped subjects" — derails a lesson the student never failed at.
4. **Silent:** no test fails, no error log. Surfaces only as cost spike or teacher complaint.

**Defence — both required:**

1. SpanAnnotator runner short-circuits on `skipMeasure === true` (the prop passed into `route.ts::runSpecDrivenPipeline` from `shouldRunCallerAnalysis` in `lib/pipeline/event-gate.ts`) BEFORE Pass 1 fires.
2. Vitest fixture: "intro-mode call → zero `LearnerProduction` rows written". This is the non-silent guardrail for the next person who touches this — without it, the landmine reappears.

---

## Post-grooming patterns to absorb in P1 (2026-05-26)

Three patterns landed after grooming that P1 must adopt:

1. **Tolerance Placement ADR (#822)** — `Playbook.config.spanAnnotation.*` fields each need `@bucket` JSDoc tag (1 = Course parameter / 2 = System default / 3 = Per-learner adaptation). arch-checker Check E enforces.

2. **PendingChangesTray + `aiSuggested` flag (#856/#871/#873/#878/#879/#880)** — 5-layer guard documented in `.claude/rules/ai-to-db-guard.md`. **P3 implication:** any AI tool executor / wizard / cmd+k surface that writes `spanAnnotation` config MUST push to the tray with `aiSuggested: true`. Do NOT call `updatePlaybookConfig` / `updateAnalysisSpecConfig` directly.

3. **CHAIN-CONTRACTS.md was rewritten in #835** — P1 must add a structural-row matching the new shape (CI guard #867 blocks PR on drift). Mirrors the `lo_mastery:*` row added in #616.

4. **Tolerances split precedent (#851)** — Course-only knobs went to Course Design tab; learner override stayed on Tune. P3 follows: course-level span annotation config → Course Design; per-learner override (if any) → Tune sidebar.

---

## Open question resolutions (2026-05-26)

All five settled.

| Q | Resolution |
|---|---|
| Q1 (tag vocabulary v1) | Lyster & Ranta SLA taxonomy; language v1 only; non-language ships `enabled: false`. **Closes B2.** |
| Q2 (`LearnerProduction` table vs `CallScore`) | **New table.** `CallScore.parameterId` FK is central; span isn't a scored parameter. |
| Q3 (positive-evidence spans) | **Polarity tag** column on the same table (`"gap" \| "positive"`, default `"gap"`). v1 writes only `"gap"`; schema accommodates from day one. |
| Q4 (COMPOSE staleness policy) | **EMA + `validUntil`** — reuse the `CallerAttribute` validity-window pattern from #614 drain. No separate decay calc. |
| Q5 (`annotationFocusToActiveLOs` scope) | **Call-planned LOs** (current call's planned LOs, not session-wide). |

---

## UI

- **Tab:** no new tab. Course-level config on Course Design (precedent #851); learner override (if introduced in v2) on Tune.
- **Component:** one collapsible "Error capture & recasting" section.
- **Visible:** sample-rate slider + on/off toggle. Rest behind "Advanced".
- **Inheritance display:** "(inheriting from Language profile)" hint — same UX as audience target inheritance post-#796.

---

## Effort (rough)

~30–40h across 3 phases:
- **P1 (~12–15h, +2–4h if B1 reveals coupling):** Schema + extractor + two-pass + event-gate + `resolveSpanKey` helper + telemetry bucket.
- **P2 (~10–12h):** AGGREGATE rollup into `CallerAttribute` + COMPOSE section + first vocab pack (language).
- **P3 (~8–10h):** Course-author UI + per-course tuning + subject-profile defaults.

---

## Related

- `docs/pedagogical-approach.md` (AKMD) — frames why this is a primitive miss
- `docs/pipeline.md` — pipeline canon + event-gate reference
- `docs/CHAIN-CONTRACTS.md` — add a row matching post-#835 shape
- `docs/decisions/2026-05-22-tolerance-placement.md` — `@bucket` ADR (#822)
- `.claude/rules/ai-to-db-guard.md` — PendingChangesTray 5-layer guard
- `lib/tolerance/resolve-tolerance.ts` — canonical resolver template (#833)
- `lib/pipeline/event-gate.ts` — `shouldRunCallerAnalysis` (the gate)
- `lib/curriculum/resolve-module.ts` — `resolveModuleSlug` (the canonicalisation model for `resolveSpanKey`)
- `lib/pipeline/aggregate-runner.ts` — `CallerAttribute` upsert (reuse for EMA rollup)
- `lib/prompt/composition/transforms/audience.ts` — existing `errorCorrection` tone
- `lib/prompt/composition/transforms/pedagogy-mode.ts` — practice-mode error handling
- IELTS course-ref `course-reference-ielts-v2-2.md` — current state-of-art (prose only)
- #611 — `lo_mastery:*` CallerAttribute key shape + `resolveModuleSlug`
- #796 — INIT-001 cascade defaults (reuse pattern)
- #797 — `firstCallMode` gate (analogous gating discipline)
- #822 — Tolerance Placement ADR
- #833 — `resolveMasteryThreshold` (cascade resolver template)
- #835 — CHAIN-CONTRACTS rewrite
- #851 — Tolerances split UI precedent
- #856 / #871 / #873 / #878 / #879 / #880 — PendingChangesTray + `aiSuggested` guard

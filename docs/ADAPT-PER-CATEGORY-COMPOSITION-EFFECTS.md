# ADAPT per-category — what each does for prompt composition

> Born of the 2026-06-19 "TransformerLattice" session, after wiring the
> 9-category parameter coverage epic (#2078). This doc answers the operator
> question: *"Whilst I wait — confirm what the adapts per category actually
> DO for prompt composition."*
>
> Sibling to [`CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) (the cross-stage
> invariants this table executes against) and
> [`PARAMETER-TAXONOMY.md`](./PARAMETER-TAXONOMY.md) (the 10 canonical
> `domainGroup` names). This doc is the **runtime mapping** — for each of
> the 9 active domainGroups, what's read, what's written, where it lands
> in the composed prompt, and the educator-visible effect.

## How to read the table

Each row covers one `Parameter.domainGroup`. Columns:

- **Reads** — the data source the ADAPT-runner / compose transform pulls
  from (typically `CallerAttribute` keyed by
  `behavior_profile:{group}:{dim}` — written by an AGGREGATE spec that
  consumes the per-call `CallScore` rows).
- **Writes** — the cascade-readable destination
  (`CallerTarget.targetValue` for parameter-targeted adaptations,
  `CallerAttribute` for profile-shape rolls).
- **Lands in prompt** — the section + transform that emits the
  directive into the composed prompt (referenced from
  [`renderPromptSummary.ts`](../apps/admin/lib/prompt/composition/renderPromptSummary.ts)).
- **Effect** — what changes in the LLM's behaviour on call N+1.

## The 9 active categories

| domainGroup | Reads | Writes | Lands in prompt | Effect |
|---|---|---|---|---|
| **personality-adaptation** (14 params) | `CallerPersonalityProfile.{openness,conscientiousness,extraversion,agreeableness,neuroticism}` (Big-5 OCEAN, rolled from per-call BEH-* scores via PERSONALITY-AGG-001) | Directive block only (no CallerTarget write — this is a read-only cohort signal) | `personality_adaptation_directives` section (priority 11.5, [`personality.ts`](../apps/admin/lib/prompt/composition/transforms/personality.ts)) | LLM tunes tone, pacing, and challenge framing to learner trait — e.g. high-N → more reassurance; low-A → less hedging; high-O → more "let me show you why" reasoning. |
| **curriculum-adaptation** (32 params) | `behavior_profile:curriculum:*` rolled mastery + LO completion + reading-level cohort | `CallerTarget` for 12 mastery-driven CURR-A params (advance-readiness, prerequisite-callback, spaced-retrieval, etc.) | `curriculum_adaptation_directives` section (priority 14.5, [`curriculum-adaptation.ts`](../apps/admin/lib/prompt/composition/transforms/curriculum-adaptation.ts)). `dependsOn: ["behavior_targets", "curriculum"]` so it lands AFTER curriculum is resolved | LLM sequences modules + LO depth based on learner's current band — e.g. waiver on incomplete-attempt 2 short-circuits to next-module advance prompt; spaced-retrieval triggers a callback to a 3-week-old LO mid-conversation. |
| **companion** (17 params) | `behavior_profile:companion:{depth_engagement,emotional_attunement,curiosity_invitation,...}` (rolled from per-call companion BEH-* scores) | Directive block (read-only cohort signal) | `companion_directives` section (priority 12.83, [`companion.ts`](../apps/admin/lib/prompt/composition/transforms/companion.ts)). Renders as `[COMPANION STYLE] …` block in renderPromptSummary | LLM adjusts conversational warmth, depth of probing, and curiosity-invitation pattern — e.g. high depth_engagement learner gets deeper questions ("what would you do if…"); low emotional_attunement triggers a more matter-of-fact register. |
| **engagement** (13 params) | `behavior_profile:engagement:{attention_signal,response_latency,enthusiasm,...}` + `behavior_profile:onboarding:*` (rolled from per-call engagement BEH-* scores via ADAPT-ENG-001) | `CallerTarget.targetValue` for the 13 engagement params (per [`engagement-targets-manifest.ts`](../apps/admin/lib/pipeline/engagement-targets-manifest.ts)) | Read by [`targets.ts`](../apps/admin/lib/prompt/composition/transforms/targets.ts) into `## Behavior Targets` section + `## Behavior Targets Semantics` block | LLM tunes session pacing, prompts for confirmation, and exit-cue sensitivity — e.g. low attention_signal learner gets shorter chunks + more "still with me?" probes; high enthusiasm gets less scaffolding. |
| **supervision** (12 params) | `behavior_profile:supervision:*` + per-call SCORE_AGENT outputs (`scoreboard.violations[]`) | `CallerTarget.targetValue` for the 12 supervision params (compliance directives, banned-phrase enforcement, identity-stickiness) | `supervision_directives` section (priority 15.0, [`supervision.ts`](../apps/admin/lib/prompt/composition/transforms/supervision.ts)). High-priority — lands near top of system prompt | LLM enforces operator-set compliance rules — e.g. medical-disclaimer required after every health claim; never use first-name unless learner offered; abort + escalate on PII disclosure trigger. |
| **learning-adaptation** (49 params — largest cohort) | `behavior_profile:learning:{vark_modality,interaction_pattern,...}` for 18 spec-driven (ADAPT-LEARN-001 branches) + 13 inert STYLE / MODALITY params (Phase A prompt-injection) — see PR #2110 | Mixed: 18 → `CallerTarget`; 13 → directive directly via [`parametersAsDirectives.ts`](../apps/admin/lib/prompt/composition/transforms/parametersAsDirectives.ts) dispatcher | `learning_style_directives` section (priority 13.0, [`learning-style.ts`](../apps/admin/lib/prompt/composition/transforms/learning-style.ts)) + scattered injections | LLM adapts modality, analogy frequency, and example richness — e.g. visual-modality learner gets more "imagine a diagram…" framing; kinesthetic gets more "try this…" prompts. Note: VARK params are folk-pedagogy (Pashler 2008 + Nancekivell 2024 meta-analyses show no matching effect); kept for operator-facing tuning but pedagogy review pending per `docs/PARAMETER-TAXONOMY.md` §2. |
| **reinforcement** (6 params) | `behavior_profile:reinforcement:*` (reward-cadence + praise-density rolls) | `CallerTarget.targetValue` for praise-density, error-correction-cadence, scaffolding-removal-rate | `reinforcement_directives` section (priority 12.0, currently routed via [`targets.ts`](../apps/admin/lib/prompt/composition/transforms/targets.ts)) | LLM adjusts how often it confirms learner progress + how fast it removes scaffolding — e.g. low-confidence learner gets more "great, exactly" affirmations; high-confidence gets faster scaffolding withdrawal. |
| **behavior-core** (6 params — BEH-WARMTH, BEH-FORMALITY, BEH-DIRECTNESS, BEH-TONE, BEH-RESPONSE-LEN, BEH-TURN-LENGTH) | `CallerTarget.targetValue` (the cascade resolves System → Domain → Course → Segment → Caller → Call per parameterId) | N/A — these are the bedrock axes; written upstream by operator UI or AGGREGATE | `## Behavior Targets` section (priority 10.0, [`targets.ts`](../apps/admin/lib/prompt/composition/transforms/targets.ts)) + `## Behavior Targets Semantics` block emitting `interpretationHigh`/`interpretationLow` per #1951 | LLM's foundational tone — sets warmth, formality, directness for the whole call. The semantics block (#1951) gives the LLM the **why** behind each numeric — "0.9 warmth means treat the learner like a friend, not a customer." |
| **onboarding** (5 params) | `behavior_profile:onboarding:{intro_pace,name_confirmation,context_calibration,...}` rolled from first-3-call BEH-* scores | `CallerTarget.targetValue` for the 5 onboarding params (intro-pace, etc.) | `onboarding_directives` section (priority 9.0, [`onboarding.ts`](../apps/admin/lib/prompt/composition/transforms/onboarding.ts)) — only active when `Caller.totalCalls < N` | LLM treats first-N-call learners differently — slower intros, more name confirmation, more "what brings you here?" probing. After call N, this section drops out and the learner enters steady-state. |

## What "lands in prompt" actually looks like

The `renderPromptSummary.ts` mirror walks the assembled-sections list in
priority order and emits each block as prose. A typical composed prompt
section sequence is:

```
## Identity (priority 1.0)
## Voice config (5.0)
## Context (7.0)
## Onboarding directives (9.0)              ← onboarding (if applicable)
## Behavior Targets (10.0)                  ← behavior-core + reinforcement
## Behavior Targets Semantics (10.1)        ← #1951 — interpretation text
## Personality adaptation directives (11.5) ← personality-adaptation
## Reinforcement directives (12.0)
## Companion directives (12.83)             ← companion
## Learning style directives (13.0)         ← learning-adaptation
## Curriculum adaptation directives (14.5)  ← curriculum-adaptation
## Supervision directives (15.0)            ← supervision (highest)
## Instructions (16.0)
```

Sections that resolve to "nothing to say" (e.g. a learner with no
companion profile yet) emit an empty block and are skipped at render.

## Producer-only vs wired — the audit

Pre-#2078 (epic launched 2026-06-19), **109 of 154 parameters were
producer-only** — operator could tune the cascade, nothing read the
result. Post-#2078 (5 implementation slices: S1 personality, S2 learning,
S3 curriculum, S4 engagement, S5 companion, S6 supervise+reward):

- Ratchet `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET` in
  [`tests/lib/measurement/parameter-coverage.test.ts`](../apps/admin/tests/lib/measurement/parameter-coverage.test.ts)
  drops from **109 → 0** (target) as each slice merges.
- The 6 deferred parameters (BEH-CHALLENGE-LEVEL, BEH-PREREQUISITE-*,
  BEH-SPACED-RETRIEVAL-PRIORITY, etc.) are catalogued in
  [`docs/M4-pedagogy-review.md`](./M4-pedagogy-review.md) for explicit
  pedagogy review before wiring.

## How to verify on hf_sandbox / hf_staging

For any caller `<id>`:

```sql
-- See what the cascade resolved for this caller's BEH-* params
SELECT
  bt."parameterId",
  ct."targetValue",
  ct."layerSetBy",
  ct."updatedAt"
FROM "CallerTarget" ct
JOIN "BehaviorTarget" bt ON bt.id = ct."behaviorTargetId"
WHERE ct."callerId" = '<id>'
ORDER BY bt."parameterId";

-- See what AGGREGATE rolled into the caller's profile shape
SELECT key, value, "updatedAt"
FROM "CallerAttribute"
WHERE "callerId" = '<id>'
  AND key LIKE 'behavior_profile:%'
ORDER BY key;
```

Then re-run COMPOSE for the caller's next call and inspect the
resulting `ComposedPrompt.prompt` for each `directives` section.

## Related

- [`docs/CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) — pipeline stage invariants
- [`docs/PARAMETER-TAXONOMY.md`](./PARAMETER-TAXONOMY.md) — the 10 canonical domainGroups
- [`docs/PARAMETER-INTERPRETATIONS.md`](./PARAMETER-INTERPRETATIONS.md) — pedagogy-led interpretation text (target of S4 backfill)
- [`docs/M4-pedagogy-review.md`](./M4-pedagogy-review.md) — pedagogy-deferred parameters
- [`apps/admin/lib/prompt/composition/renderPromptSummary.ts`](../apps/admin/lib/prompt/composition/renderPromptSummary.ts) — the prose mirror that emits all sections
- [`apps/admin/lib/prompt/composition/transforms/`](../apps/admin/lib/prompt/composition/transforms/) — per-category transform implementations
- Epic [#2078](https://github.com/WANDERCOLTD/HF/issues/2078) — parameter-coverage close-out
- Spec [`BEH-AGG-001-behavior-aggregation.spec.json`](../apps/admin/docs-archive/bdd-specs/BEH-AGG-001-behavior-aggregation.spec.json) — AGGREGATE producer for 9 of 9 domainGroups
- Spec [`ADAPT-BEH-001-behavior-adaptation.spec.json`](../apps/admin/docs-archive/bdd-specs/ADAPT-BEH-001-behavior-adaptation.spec.json) — ADAPT consumer for companion/supervision/engagement (Phase 1)

# Scoring editability — the IP-boundary audit

> Story [#2174](https://github.com/WANDERCOLTD/HF/issues/2174) S1.
> Foundational classification doc for the epic. No code edits in this
> slice — subsequent slices (S2/S3/S4/S5) use this matrix to decide
> what to wire.
>
> Sister docs:
> [`docs/PARAMETER-TAXONOMY.md`](./PARAMETER-TAXONOMY.md) (parameter
> kinds + customer-override boundary),
> [`.claude/rules/spec-readonly-boundary.md`](../.claude/rules/spec-readonly-boundary.md)
> (the **HF-canonical IP rule** this audit implements per-field).

## Why this exists

The operator surfaced the question on 2026-06-21:

> *"Are the scorings editable in a pane somewhere? Should be, with cascade."*

Today the answer is **partially**. The Rubric Calibration lens on the
Skills tab lets an operator pick a tier preset (`tierPresetId`) and edit
two mastery-policy knobs (`skillTierMapping`,
`skillScoringEmaHalfLifeDays`) — and both genuinely cascade
(Domain → Course). Everything else about the rubric — per-skill tier
**descriptors**, per-skill **target tier**, band **thresholds**, the
literal **MEASURE prompt** the LLM reads — is HF-authored seed data,
read-only at runtime.

`.claude/rules/spec-readonly-boundary.md` already draws the IP line for
3 fields (`definition`, `interpretationHigh`, `interpretationLow`). This
audit walks every scoring-related field and classifies it against the
same boundary, so the rest of the epic knows which fields can move into
the editable + cascade-aware surface and which must stay HF-canonical.

## Classification taxonomy

| Class | Definition |
|---|---|
| **TUNABLE** | Customer can edit; the value cascades (System → Domain → Course → Segment → Caller). |
| **EDITABLE-BUT-NOT-CASCADED** | Customer can edit but the field is per-resource — no parent layer owns it (e.g. a per-Course rubric override on a Course-only field). |
| **HF-CANONICAL** | HF authors only via seed / migration / `/api/x/*` admin route. Customer cannot edit. Spec-readonly boundary applies. |
| **DECISION-NEEDED** | Boundary is genuinely ambiguous; this slice surfaces it, doesn't decide it. Each row carries the question the next slice must answer. |

## Classification table

### A. `Parameter` row fields (the canonical spec — HF IP surface)

| Field | Lives in | Runtime consumer | Class | Rationale | UI today? |
|---|---|---|---|---|---|
| `Parameter.definition` | `prisma/schema.prisma::Parameter.definition` | Not directly read by composer today; carried into operator-facing UI + admin docs | **HF-CANONICAL** | `spec-readonly-boundary.md` declares it HF IP. Future composer reads (e.g. system-prompt training scaffolds) make it runtime-load-bearing. ESLint guard already blocks customer writes. | Read-only on `/x/parameters/[id]` (SUPERADMIN PUT can edit) |
| `Parameter.interpretationHigh` | `Parameter.interpretationHigh` | `lib/prompt/composition/renderPromptSummary.ts:155-161` — emitted into `behavior_targets_semantics` block on **every** call for **every** active param | **HF-CANONICAL** | Pre-#1951 only top-5 params; post-#1951 the full list. A customer write of `"make the AI act crazy"` poisons every other customer's composed prompt on next recompose. ESLint `hf-spec/no-customer-write-to-canonical-interpretation` blocks. | SUPERADMIN-only PUT at `app/api/parameters/[id]/route.ts:95-144` |
| `Parameter.interpretationLow` | same | same | **HF-CANONICAL** | same | same |
| `Parameter.config.tiers` (per-tier descriptor map) | `Parameter.config` Json — `tiers[tierName] = descriptor text` | Read by `app/x/courses/[courseId]/CourseSkillsTab.tsx:980-997` (Rubric Calibration lens, displays the LLM-facing per-tier descriptor); written into the MEASURE prompt via the skill resolver chain | **DECISION-NEEDED** — see Open Question Q1 below | The descriptor text IS the rubric the LLM judges against ("Band 7 requires lexical resource X"). If a customer can override this per-course, they tune the LLM's judging behaviour without touching the prompt template. If they can't, two cohorts with materially different pedagogies (IELTS academic vs IELTS general) share a single descriptor. **Sister-writer risk:** unlike `interpretation*`, `tiers` isn't shared across customers — it's seeded per-Parameter per-course. The customer-IP risk is asymmetrical: editing OWN tier descriptors doesn't leak. | Read-only display via Rubric Calibration lens; no write surface |
| `Parameter.config.tierScheme` (which tier names exist) | `Parameter.config.tierScheme: string[]` (e.g. `["emerging", "developing", "secure"]`) | `lib/curriculum/resolve-skill.ts:90-99` — drives renderer's per-skill tier columns | **HF-CANONICAL** | The set of tier names is a curriculum-framework choice (CEFR has 6 levels, IELTS Speaking 9 bands, generic 4 tiers). Customer pick happens at the `tierPresetId` layer (TUNABLE), not by re-naming the tier slots themselves. Adding/removing tier names would cascade-break every Goal + CallerTarget tied to a tier label. | None (read-only via lens) |
| `Parameter.defaultTarget` | `Parameter.defaultTarget Float @default(0.5)` | Read by `BehaviorTarget` cascade as the SYSTEM-base layer fallback when no Domain/Playbook override exists | **HF-CANONICAL** (the **default**) — but `BehaviorTarget.targetValue` is the **TUNABLE** layer that overrides it | The default is a curated baseline; the override knob is the per-skill target tier. Conflating "default" and "override" is the source of confusion. The default lives on `Parameter`; the override lives on `BehaviorTarget`. | None directly; `BehaviorTarget` editor exists at `/api/playbooks/[id]/targets` |
| `Parameter.aliases` | `Parameter.aliases String[]` | Read by `parameter-loop-closure.test.ts` cross-checks; resolves AnalysisSpec `sourceParameter` references | **HF-CANONICAL** | Aliases are taxonomy — they're how the canonical id reaches AGGREGATE/ADAPT specs that cite the param by an older name. Customer override would silently rewire which `CallScore` rows feed which downstream consumer. | None |
| `Parameter.config.bandThresholds` | `ParameterConfig.bandThresholds: Record<number, string>` | Read by MEASURE prompt assembly for IELTS-style courses; per-band descriptor passed to LLM | **DECISION-NEEDED** — see Open Question Q1 (same boundary as `tiers`) | Same shape as `tiers` — descriptor text the LLM consumes. Different keying (band number vs tier name). Same boundary question. | Read-only via Rubric Calibration lens |
| `Parameter.config.<other keys>` (scoring config bag) | `ParameterConfig.[key: string]: unknown` (open shape) | Varies by key; e.g. `Parameter.config.scoringMode`, future per-param scoring rules | **DECISION-NEEDED** per key | Open shape — each new key must be classified at land-time. | None |
| `Parameter.usage.compose` | `behavior-parameters.registry.json` | Read by `parameter-usage-coverage.test.ts` + `renderPromptSummary.ts` (drives which compose route renders the param) | **HF-CANONICAL** | Routes the param to its compose consumer (`semantics-block` / `prompt-injection` / `transform-direct`). Customer-tunable would let a customer reroute their own param to a different compose surface — chain-contract scope creep. | Edited by HF via the registry JSON + reseed |
| `Parameter.usage.measurement` | same registry | Cited by AnalysisSpec; verified by `parameter-measurement-coverage.test.ts` | **HF-CANONICAL** | Names the spec that scores the param. Customer-tunable would let a customer redirect measurement of `BEH-WARMTH` to a different spec — same scope-creep risk. | Edited by HF |

### B. `BehaviorTarget` row fields (the canonical TUNABLE surface)

| Field | Lives in | Runtime consumer | Class | Rationale | UI today? |
|---|---|---|---|---|---|
| `BehaviorTarget.targetValue` | `prisma/schema.prisma::BehaviorTarget.targetValue Float` | `lib/cascade/effective-value.ts` `behavior-target` family resolver; every `behavior_targets_semantics` line carries it; pipeline AGGREGATE / ADAPT specs read it | **TUNABLE** (canonical example — this is the intended customer-edit surface) | Cascade order: SYSTEM → PLAYBOOK → SEGMENT → CALLER. The whole adaptive loop is built around this being the cascade-aware tuning knob. | `/api/playbooks/[playbookId]/targets` PUT; `/api/callers/[callerId]/behavior-targets` PATCH; AgentTuner sliders |
| `BehaviorTarget.parameterId` (the binding) | `BehaviorTarget.parameterId String` (FK to `Parameter.parameterId`) | Cascade resolver pivots on it | **HF-CANONICAL** | The binding itself is structural — customer can SET the value on a parameter, not RE-BIND which parameter their cohort tunes. | Drop-down constrained to canonical Parameter set; no free-text |
| `BehaviorTarget.scope` (System / Playbook / Segment / Caller) | `BehaviorTargetScope` enum | Cascade resolver layer-pivot | **HF-CANONICAL** (the cascade layout) — though the operator implicitly chooses scope by which writer surface they invoke | Adding a 6th layer (e.g. "Tenant") would be a Lattice-level decision, not a per-customer edit. | Implicit via writer route choice |
| `BehaviorTarget.confidence` | `BehaviorTarget.confidence Float @default(0.5)` | Read by `lib/agent-tuner/write-target.ts` learning-rate scaling | **TUNABLE** | Per-row knob; customer can set how confident their target is. No cross-customer effect. | Set via AgentTuner write helper; not exposed in tuner UI today |
| `BehaviorTarget.effectiveFrom` / `effectiveUntil` | versioning | Cascade reads only `effectiveUntil: null` rows | **TUNABLE** (mechanically — the writer flips these) — but operator doesn't author dates directly | Time-windowing is a system invariant, set by the writer chokepoint. | Not directly UI-editable |
| `BehaviorTarget.skillRef` | `BehaviorTarget.skillRef String?` (#417 stable ref from course-ref doc) | `lib/curriculum/resolve-skill.ts` joins by skillRef | **HF-CANONICAL** (set by `apply-projection.ts` from course-ref upload) | Customer can re-upload a different course-ref doc to change the skill set; can't re-bind individual skillRefs without re-projection. | Drives the Framework Map; no direct edit |

### C. `Playbook.config` scoring-knob fields (the cascade-aware UI surface today)

| Field | Lives in | Runtime consumer | Class | Rationale | UI today? |
|---|---|---|---|---|---|
| `Playbook.config.tierPresetId` | `lib/types/json-fields.ts::PlaybookConfig.tierPresetId: "generic"\|"ielts-speaking"\|"cefr"\|"5-level"\|"custom"` | `lib/banding/presets.ts::TIER_PRESETS` lookup; drives banding labels and the IELTS prosody dispatch in `lib/voice/prosody/*` | **TUNABLE** ⚠️ but **NOT cascade-aware today** — see Open Question Q2 | The preset choice itself feels like a Domain-default-+-Course-override candidate (CEFR-shaped domains have many courses that want CEFR by default). Today it's per-Playbook only. | `BandingPicker` component renders 5 radio choices |
| `Playbook.config.skillTierMapping` | `PlaybookConfig.skillTierMapping: { thresholds, tierBands, tierLabels? }` | `lib/goals/track-progress.ts::scoreToTier()` reads via `getPreset` resolver | **TUNABLE** + cascade-aware | Registered in `lib/cascade/effective-value.ts` `mastery-policy` family (Domain → Playbook). Operator can pick canonical preset OR supply a fully custom shape. | Implicit via `BandingPicker` (writes via PUT `/api/courses/[courseId]/design`) |
| `Playbook.config.skillScoringEmaHalfLifeDays` | `PlaybookConfig.skillScoringEmaHalfLifeDays: number` | EMA half-life for `CallerTarget.currentScore` decay | **TUNABLE** + cascade-aware | Same `mastery-policy` family as `skillTierMapping`. | `CourseSkillsTab` Rubric Calibration lens chip (CascadeValue + LayerBadge) |
| `Playbook.config.skillMinCallsToFull` | `PlaybookConfig.skillMinCallsToFull: number` | First-call cap factor in `lib/goals/track-progress.ts` | **EDITABLE-BUT-NOT-CASCADED** today (Playbook-only) — see Open Question Q3 | Same shape as `skillScoringEmaHalfLifeDays` — could cascade. Not registered in `effective-value.ts` today. | None; only reachable via direct API write |
| `Playbook.config.useFreshMastery` | variant-intrinsic | Read by curriculum runtime for Exam Assessment isolation | **EDITABLE-BUT-NOT-CASCADED** (intentional) | The 3 variant-intrinsic mastery knobs are documented in `components/shared/VariantPresetPill.tsx` as Playbook-only by design — variant identity, not a customer override. | `VariantPresetPill` shows current value, no edit affordance |
| `Playbook.config.maxMasteryTier` | same | same | **EDITABLE-BUT-NOT-CASCADED** (intentional) | same | same |
| `Playbook.config.scoringMode` | same | `lib/ops/compute-reward.ts` reward-strategy router | **EDITABLE-BUT-NOT-CASCADED** (intentional) | same | same |
| `Playbook.config.loMasteryThreshold` | `PlaybookConfig.loMasteryThreshold: number` (#2052) | `lib/prompt/composition/scoring-config.ts::resolveScoringConfig` chokepoint, read by `transforms/modules.ts` | **TUNABLE** today (Playbook-scoped); cascade-candidate per Q3 | Recently landed (#2052 sub-epic C); operator-tunable per the field's `@bucket` tag. Currently no Domain layer. | Read-side wired; no editor UI yet |
| `Playbook.config.assessmentReadinessThreshold` | `PlaybookConfig.assessmentReadinessThreshold: number` (#2052) | `transforms/instructions.ts` `assessment_readiness_directive` | **TUNABLE** Playbook-scoped; cascade-candidate per Q3 | Same shape as `loMasteryThreshold`. | Read-side wired; no editor UI yet |
| `Playbook.config.progressSignals: {lowWater?, highWater?}` | `PlaybookConfig.progressSignals` (#2052) | `transforms/instructions.ts` `progress_signal_directive` | **TUNABLE** Playbook-scoped; cascade-candidate per Q3 | Watermarks on engagement-mastery rollup. | Read-side wired; no editor UI yet |

### D. `AnalysisSpec` (the LLM prompt + scoring config — HF IP)

| Field | Lives in | Runtime consumer | Class | Rationale | UI today? |
|---|---|---|---|---|---|
| `AnalysisSpec.promptTemplate` | `prisma/schema.prisma::AnalysisSpec.promptTemplate String? @db.Text` | Read by `lib/prompt/composition` template compiler → emitted to LLM verbatim | **HF-CANONICAL** | The literal prompt the LLM reads. Customer override = chain-contract scope creep (the customer is now authoring HF's scoring methodology). If a future epic ships an "advanced overlay" surface for SUPERADMIN-tier customers, that's a SUPERADMIN-only carve-out, not a normal-operator edit. | `/x/specs/*` (SUPERADMIN-only writers); not on the Skills tab |
| `AnalysisSpec.parameters[].id` (the parameter cite) | spec.json | `parameter-measurement-coverage.test.ts` verifies the cite | **HF-CANONICAL** | The cite IS the binding from MEASURE → Parameter; renaming/rewiring is a spec-author concern. | None for customers |
| `AnalysisSpec.config` (e.g. `requiresBehaviorTargetParams`, scoring rules) | spec.json | `lib/pipeline/specs-loader.ts` filter logic | **HF-CANONICAL** | Same scope-creep concern as `promptTemplate`. | None for customers |
| `AnalysisSpec.outputType` | spec.json | Pipeline runner dispatch | **HF-CANONICAL** | Chain-contract slot assignment. | None for customers |
| `AnalysisSpec.scope`, `specType`, `specRole` | spec.json | Pipeline + RBAC | **HF-CANONICAL** | Structural metadata. | None |

### E. `TIER_PRESETS` (the canonical preset catalogue — HF IP)

| Field | Lives in | Runtime consumer | Class | Rationale | UI today? |
|---|---|---|---|---|---|
| `TIER_PRESETS[*].thresholds` (% cutoffs per preset) | `apps/admin/lib/banding/presets.ts` TS constant | `scoreToTier()` + `BandingPicker` | **HF-CANONICAL** | These are the canonical preset DEFINITIONS. Customer-tunable would mean a customer redefines what "IELTS Band 7" means — that's not preset selection, that's preset authoring. If the operator needs different cutoffs, the `tierPresetId: "custom"` path + `skillTierMapping` override is the customer-tunable surface (TUNABLE row in §C). | Read-only (canonical preset set) |
| `TIER_PRESETS[*].tiers[*].label` | same | rendered in `BandingPicker` | **HF-CANONICAL** | Same shape; customer override happens via the `custom` preset + `tierLabels` payload, not by mutating the preset catalogue. | Read-only |
| `TIER_PRESETS[*].mapping.tierBands` | same | `scoreToTier()` returns | **HF-CANONICAL** | The band numbers the threshold maps to (e.g. IELTS 3 / 4 / 5.5 / 7). Customer authoring = `"custom"` preset path. | Read-only |

## What's editable today vs the gap

### Existing editors

| Editor | Lives at | Covers (classification-table rows) |
|---|---|---|
| `BandingPicker` | `apps/admin/components/shared/BandingPicker.tsx` | §C `Playbook.config.skillTierMapping` (full mapping override) + implicit `tierPresetId` selection |
| Rubric Calibration lens — mastery-policy chips | `apps/admin/app/x/courses/[courseId]/CourseSkillsTab.tsx:860-895` (CascadeValue + LayerBadge) | §C `Playbook.config.skillTierMapping`, `skillScoringEmaHalfLifeDays` (with cascade chips) |
| Rubric Calibration lens — variant-preset pills | `apps/admin/components/shared/VariantPresetPill.tsx` mounted in `CourseSkillsTab.tsx:882-895` | §C `useFreshMastery`, `maxMasteryTier`, `scoringMode` — DISPLAY ONLY (no edit affordance) |
| AgentTuner sliders (per-parameter targets) | `apps/admin/lib/agent-tuner/write-target.ts` + route | §B `BehaviorTarget.targetValue` (all scopes) |
| Per-playbook targets editor | `PUT /api/playbooks/[playbookId]/targets` | §B `BehaviorTarget.targetValue` (PLAYBOOK scope) |
| Per-caller targets editor | `PATCH /api/callers/[callerId]/behavior-targets` | §B `BehaviorTarget.targetValue` (CALLER scope) |
| Parameter PUT (SUPERADMIN) | `PUT /api/parameters/[id]` (auth raised in #1947) | §A `Parameter.definition` / `interpretationHigh` / `interpretationLow` / `name` / etc. — **HF-IP override surface**, not customer-tunable |

### TUNABLE classifications not yet reachable via UI (= the #2174 S2-S4 backlog)

| Row | Field | Why reach for it next |
|---|---|---|
| §C | `Playbook.config.skillMinCallsToFull` | Already TUNABLE shape; just no editor. Cheapest first reach. |
| §C | `Playbook.config.loMasteryThreshold` | Read-side wired (#2052); editor pending. |
| §C | `Playbook.config.assessmentReadinessThreshold` | Read-side wired (#2052); editor pending. |
| §C | `Playbook.config.progressSignals.{lowWater, highWater}` | Read-side wired (#2052); editor pending. |
| §B | `BehaviorTarget.targetValue` at **per-skill** granularity inside Rubric Calibration lens | The lens shows the target tier today (`tierLabelForTarget(skill)` at `CourseSkillsTab.tsx:963-965`) but no editor — the AgentTuner does the work elsewhere. Co-locating the editor with the rubric closes a UX loop. |

### Cascade-eligible but not yet cascade-aware (= candidate S3 promotions)

| Row | Field | Today | Why promote |
|---|---|---|---|
| §C | `tierPresetId` | Playbook-only | A Domain that hosts many CEFR courses should be able to set CEFR as the Domain default. (Q2 below.) |
| §C | `loMasteryThreshold` | Playbook-only | Same Domain-default reasoning. |
| §C | `assessmentReadinessThreshold` | Playbook-only | Same. |
| §C | `progressSignals` | Playbook-only | Same. |
| §C | `skillMinCallsToFull` | Playbook-only | Sibling of `skillScoringEmaHalfLifeDays` which IS cascade-aware; symmetry suggests promotion. |

## The HF-canonical-IP guard rail

Restating `.claude/rules/spec-readonly-boundary.md` for completeness:

> Customers TUNE values via the cascade (`BehaviorTarget.targetValue`).
> Customers DO NOT EDIT the semantics (`Parameter.definition`,
> `interpretationHigh`, `interpretationLow`).

This audit confirms the rule's coverage is **correct but narrow**. The
existing ESLint rule (`hf-spec/no-customer-write-to-canonical-interpretation`)
guards 3 fields. The audit surfaces 4 additional HF-CANONICAL fields
on `Parameter` (§A: `aliases`, `usage.compose`, `usage.measurement`,
`config.tierScheme`) that are not currently in
`PARAMETER_SPEC_READONLY_FIELDS`. These are not written from any
customer-driven path today, so the absence is not a live leak — but a
future PR could add a write surface and the ESLint guard wouldn't fire.

**Recommended follow-on (not in #2174 scope):** extend
`PARAMETER_SPEC_READONLY_FIELDS` to cover these 4 fields, OR explicitly
exempt them in the constant's docstring with rationale. Tracked as a
DECISION-NEEDED row below (Q5).

For the AnalysisSpec surface (§D) the equivalent guard rail does not
exist as an ESLint rule today — the spec-author surface is gated by
RBAC (SUPERADMIN on `/x/specs/*`) rather than by a structural rule. If
the epic ever ships a customer-facing AnalysisSpec edit surface, the
guard needs to extend to spec fields. Tracked as Q6.

## Recommended slice scope

### S2 — Make the 4 fastest-cascade-eligible Playbook knobs editable (3-6 fields)

The fastest, lowest-risk set: TUNABLE classifications whose read-side
is already wired, just no editor. Co-locate the editors in the existing
Rubric Calibration lens (insertion point: between the "Mastery policy"
section at `CourseSkillsTab.tsx:851-896` and the "Preset banding"
section at `:898-908`).

1. `Playbook.config.loMasteryThreshold` — slider [0,1], current value
   from cascade resolver
2. `Playbook.config.assessmentReadinessThreshold` — slider [0,1]
3. `Playbook.config.progressSignals.lowWater` — slider [0,1] (nullable)
4. `Playbook.config.progressSignals.highWater` — slider [0,1] (nullable)
5. `Playbook.config.skillMinCallsToFull` — number input ≥1

Optional 6th: per-skill `BehaviorTarget.targetValue` editor inside the
per-skill expansion in the rubric (already shown as label at
`CourseSkillsTab.tsx:963-965`).

### S3 — Promote cascade-eligible knobs to cascade-aware (2-3 fields)

Register the S2 set in `lib/cascade/effective-value.ts::FAMILIES` so
Domain-level defaults work. Best candidates (low blast radius, high
operator-value):

1. `tierPresetId` — Domain-level preset default
2. `loMasteryThreshold` + `assessmentReadinessThreshold` + `progressSignals`
   (as a single `mastery-policy` family extension — these already
   logically belong with `skillTierMapping` + `skillScoringEmaHalfLifeDays`)
3. `skillMinCallsToFull` — natural sibling of `skillScoringEmaHalfLifeDays`

### S4 — DECISION-NEEDED resolution + tier-descriptor editor (Q1 dependent)

Only proceed once Q1 is resolved. If Q1 → "tier descriptors are
customer-tunable": ship a per-Course tier-descriptor editor that writes
to a new `Playbook.config.tierDescriptorOverrides` shape (NOT to
`Parameter.config.tiers`, which stays HF-canonical). The cascade
resolver overlays per-skill overrides on top of the canonical tier
descriptor at compose time.

### S5 — Lattice hardening (extend ESLint + Coverage gates)

Per Q5 + Q6 resolution: extend
`PARAMETER_SPEC_READONLY_FIELDS` to include `aliases`, `usage.compose`,
`usage.measurement`, `config.tierScheme`; add the matching ESLint pin;
add an AnalysisSpec-write Lattice rule + coverage test if S4 opens an
operator-facing spec write surface.

### UI insertion point

The Rubric Calibration lens at
`apps/admin/app/x/courses/[courseId]/CourseSkillsTab.tsx` is the natural
home. S2 inserts a new `<section className="hf-rubric-thresholds">`
between "Mastery policy" (`:851`) and "Preset banding" (`:898`). S4's
per-skill descriptor editor sits inside the existing per-skill
expansion at `:980-997` (currently read-only `Tier descriptors`
sub-heading).

## Open questions / DECISION-NEEDED

### Q1. Tier descriptor text (`Parameter.config.tiers` + `config.bandThresholds`) — customer-tunable per Course?

The descriptor text IS the rubric the LLM judges transcripts against
("Band 7 requires lexical resource X"). Asymmetric from `interpretation*`
because it's seeded per-Parameter per-course (not shared across
customers), so a customer-edit doesn't poison sibling customers.

But editing this changes the LLM's judging behaviour as much as
editing the MEASURE prompt would. Two cohorts on the same course but
different audiences (IELTS academic vs general training) might
legitimately want different descriptors.

**Sub-questions:**
- If YES: does the override live on `Playbook.config.tierDescriptorOverrides` (new shape), or on the `Parameter.config.tiers` field directly (with a customer-FK)?
- If YES: cascade scope — Domain → Playbook, or Playbook-only?
- If NO: is the operator path "request a new Parameter row from HF" workable, or does it create a curation bottleneck?

### Q2. `tierPresetId` cascade promotion — worth it?

Today Playbook-only. A Domain that hosts many courses sharing one
preset (e.g. a CEFR-shaped Domain with 6 CEFR courses) currently sets
the preset 6 times. Domain-default would let the Domain set once, each
Playbook inherit, individual Playbooks override.

**Sub-question:** is the cross-course preset-uniformity assumption real?
Audit the existing Domains on hf_staging — if no Domain has >1 course
sharing a preset, the cascade is a write that nobody reads. (Trivially
verifiable on the live DB.)

### Q3. `loMasteryThreshold` / `assessmentReadinessThreshold` / `progressSignals` cascade promotion

Same shape as Q2 — these `#2052` fields landed Playbook-only because
no Domain-default consumer existed at the time. Same audit question:
does any Domain on staging set these consistently across its courses?
If yes, promote. If no, defer.

### Q4. Per-skill `BehaviorTarget.targetValue` editor location

The AgentTuner already edits per-parameter targets. The Rubric
Calibration lens shows the per-skill target but doesn't edit it.
Co-locating the editor in the rubric closes a UX loop, BUT duplicates
state-management with AgentTuner. Pick one (TL judgement).

### Q5. Extend `PARAMETER_SPEC_READONLY_FIELDS` to cover `aliases` / `usage.compose` / `usage.measurement` / `config.tierScheme`?

The audit surfaced 4 `Parameter` fields that are HF-CANONICAL but not
in the spec-readonly constant. No live leak today (no customer writer
exists), but a future PR could add one and the ESLint guard wouldn't
fire. Recommended: extend the constant defensively.

### Q6. `AnalysisSpec` IP boundary — codify in spec-readonly rule, or rely on RBAC?

Today the only structural guard on `AnalysisSpec.promptTemplate` is
the SUPERADMIN gate on `/x/specs/*` routes. If the epic ever ships a
customer-facing AnalysisSpec edit surface (even a SUPERADMIN-tier
customer overlay), the spec-readonly rule needs to extend to `promptTemplate`,
`config`, `parameters[]`, `outputType`. Tracked as a future-hardening
follow-on.

## Related

- [`.claude/rules/spec-readonly-boundary.md`](../.claude/rules/spec-readonly-boundary.md) — the parent rule this audit implements per-field
- [`apps/admin/lib/cascade/spec-readonly-fields.ts`](../apps/admin/lib/cascade/spec-readonly-fields.ts) — the constant (`PARAMETER_SPEC_READONLY_FIELDS`)
- [`apps/admin/eslint-rules/no-customer-write-to-canonical-interpretation.mjs`](../apps/admin/eslint-rules/no-customer-write-to-canonical-interpretation.mjs) — the edit-time chokepoint
- [`apps/admin/lib/banding/presets.ts`](../apps/admin/lib/banding/presets.ts) — `TIER_PRESETS` (HF-canonical)
- [`apps/admin/lib/prompt/composition/renderPromptSummary.ts`](../apps/admin/lib/prompt/composition/renderPromptSummary.ts) — the `behavior_targets_semantics` consumer that makes `interpretationHigh/Low` load-bearing on every call
- [`apps/admin/app/x/courses/[courseId]/CourseSkillsTab.tsx`](../apps/admin/app/x/courses/%5BcourseId%5D/CourseSkillsTab.tsx) — Rubric Calibration lens (where S2/S4 editors land)
- [`apps/admin/components/shared/BandingPicker.tsx`](../apps/admin/components/shared/BandingPicker.tsx) — the existing editable preset picker
- [`apps/admin/lib/cascade/effective-value.ts`](../apps/admin/lib/cascade/effective-value.ts) — `FAMILIES` table (where S3 cascade promotions land)
- [`docs/PARAMETER-TAXONOMY.md`](./PARAMETER-TAXONOMY.md) — broader IP-quality framing
- Epic [#2174](https://github.com/WANDERCOLTD/HF/issues/2174) — parent
- Sibling in-flight: epic #2176 (CourseAssessmentPlan) — edits `lib/types/json-fields.ts` enums; this audit reads from json-fields.ts only (no edit; collision-safe)

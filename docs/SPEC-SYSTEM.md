# Spec System — Canonical Map of AnalysisSpec, SpecRole, Scaffold, and Toggle Resolution

> **Read this before you change any of: `SpecRole` enum values, `scaffoldDomain` step order, `systemSpecToggles` defaults, identity resolution, the `extendsAgent` cascade, or any `config.specs.*` slug.**
>
> Fifth pillar of the architecture canon:
> - [`docs/ENTITIES.md`](./ENTITIES.md) — data model + content-boundary rules
> - [`docs/WIZARD-DATA-BAG.md`](./WIZARD-DATA-BAG.md) — wizard inputs → `Playbook.config`
> - [`docs/CONTENT-PIPELINE.md`](./CONTENT-PIPELINE.md) — classification, extraction, compose-time filters
> - `docs/PROMPT-COMPOSITION.md` (roadmap — `memory/flow-prompt-composition.md` today) — loader → transform → assembly
> - **This doc** — the spec layer: roles, toggles, identity resolution, env-overridable slugs.
>
> Update CONTENT-PIPELINE.md §7 and ENTITIES.md §5 in the same PR when changing spec materialisation. Update §6 of this doc whenever a new `config.specs.*` getter ships.

---

## 1. Why this doc exists

Three pain points motivated this canonical map:

| Pain point | Detail |
|------------|--------|
| **ADR-002 mistake (post-incident, 2026-03-25)** | `scaffoldDomain` originally toggled every system spec to `isEnabled: true`. Seven competing IDENTITY-role specs all passed through `resolveSpecs()` and the first row returned by Prisma won. Selective toggle landed (`lib/domain/scaffold.ts::scaffoldDomain` step 6). The bug only surfaced because operators noticed wrong tutor voice — there is no test that fails when two IDENTITY specs survive the toggle filter. |
| **Opaque `extendsAgent` chain** | What the prompt actually sees is the *fourth* layer: base archetype → `mergeIdentitySpec` overlay → `applyGroupToneOverride` → `extractIdentitySpec` transform. The group-tone layer was added after ADR-002 and is referenced by zero docs. Any change to identity shape risks bypassing one of the four layers silently. |
| **`config.specs.*` sprawl** | ~40 env-overridable spec slugs in `lib/config.ts::config.specs`. Three different code paths name the same archetype slug (`scaffoldDomain` default, archetype-picker getter, wizard tool executor). Renaming or retiring a slug needs a map. |

**Rule of thumb:** *if you touch SpecRole, `scaffoldDomain`, `systemSpecToggles`, or `extendsAgent` — walk §3-§5 first and update §11 in the same PR.*

---

## 2. SpecRole taxonomy

Authoritative source: `prisma/schema.prisma::enum SpecRole`.

### 2.1 Active roles (9)

| Role | What it does | Lifecycle phase | Surfaces in prompt as |
|------|--------------|-----------------|------------------------|
| `ORCHESTRATE` | Flow / sequence control — pipeline ordering, session phasing, onboarding flow | Setup + every call | Not in prompt directly; drives which other specs run and in what order (e.g. `pipeline-001-pipeline-configuration-spec` defines stage ordering for the post-call pipeline) |
| `EXTRACT` | Measurement and learning — pull traits, states, memories, supervisor signals from a transcript | Post-call (EXTRACT stage) | Not in prompt; writes to `Parameter` / `CallScore` / `CallerMemory` tables which subsequent loaders read |
| `SYNTHESISE` | Combine / transform data — composition, reward, adaptation formulas | Post-call (AGGREGATE / REWARD / ADAPT / COMPOSE) | Indirectly — drives `Parameter` aggregation; composition specs select sections |
| `OBSERVE` | System health and metrics — token meter, AI knowledge metric, error monitor | Background / per-call | Not in prompt; surfaces in dashboards |
| `CONSTRAIN` | Bounds and guards — voicemail guard, generic guardrails | Per-call (CONSTRAIN / SUPERVISE) | As a CONSTRAINTS block (stacked into identity via `mergeIdentitySpec`'s constraint accumulation) |
| `IDENTITY` | Agent personas — base archetype + domain overlay | Compose time | Identity section of the prompt (role statement, primary goal, style guidelines, do / does-not, session structure) via `registerTransform("extractIdentitySpec")` |
| `CONTENT` | Curriculum content — pre-ADR-002 path; deprecated for new content (Curriculum + CurriculumModule + ContentAssertion now own it) | Compose time | Legacy `content` section; new courses do not emit it (see ADR-002 Decision 2) |
| `VOICE` | Voice guidance — `domain: "voice"` IDENTITY specs and `VOICE`-role specs | Compose time | Voice block; resolved by `resolveSpecs` and the `resolveVoiceSpecFallback` helper |
| `PROMPT` | System prompts for AI calls — wizard prompts, chat prompts, lesson-plan generator, course-pack analyzer | Per-call (the matching AI call) | Replaces the call's system prompt entirely; loaded by slug via `config.specs.*` |

### 2.2 Deprecated roles (5)

| Role | Migrate to | Notes |
|------|-----------|-------|
| `MEASURE` | `EXTRACT` | Inline comment in `prisma/schema.prisma::enum SpecRole` |
| `ADAPT` | `SYNTHESISE` | Same |
| `REWARD` | `SYNTHESISE` | Same |
| `GUARDRAIL` | `CONSTRAIN` | Same |
| `BOOTSTRAP` | `ORCHESTRATE` | Same |

Deprecated values remain in the enum because seeded specs may still carry them. Do not write new specs with deprecated roles. A migration to scrub legacy values is out of scope (see ADR-002 §Out-of-scope discussion).

---

## 3. `scaffoldDomain()` — 8-step materialisation

`lib/domain/scaffold.ts::scaffoldDomain` runs at wizard `create_course` time (and seed). Idempotent. The numbered comments in source match these eight steps.

| Step | Input | Output | Notes |
|------|-------|--------|-------|
| **1. Resolve archetype** | `options.extendsAgent` ?? `Institution.type.defaultArchetypeSlug` ?? `config.specs.defaultArchetype` | `archetypeSlug` (e.g. `"TUT-001"`) | First non-null wins — explicit option beats institution preset beats global default. |
| **2. Early-return guard** | Existing PUBLISHED `Playbook` for the domain, AND `!options.forceNewPlaybook` | Returns scaffold result early after ensuring identity spec + onboarding exist | When `forceNewPlaybook` is true (new class in existing school) the guard is skipped. |
| **3. Find or create domain identity spec** | `archetypeSlug`, `domain.slug`, `options.identityConfig` | `AnalysisSpec { slug: "{domain.slug}-identity", specRole: IDENTITY, specType: DOMAIN, scope: DOMAIN, extendsAgent: archetypeSlug, config: overlayConfig }` | Overlay config: either AI-generated identity config from `options.identityConfig`, or a generic `agent_role` parameter pinning role + primary goal to the domain. |
| **4. Find or create Playbook** | `domain.id`, `options.playbookName`, `options.groupId`, `options.forceNewPlaybook` | `Playbook { name, domainId, status: DRAFT, groupId? }` | Reuses an existing DRAFT playbook unless `forceNewPlaybook`. |
| **5. Add identity spec to playbook** | `playbook.id`, `identitySpec.id` | `PlaybookItem { itemType: SPEC, specId: identitySpec.id, sortOrder: 0, isEnabled: true }` | Skipped if a `PlaybookItem` already links the same pair. |
| **6. Configure `systemSpecToggles`** | All active SYSTEM specs | `Playbook.config.systemSpecToggles = { [specId]: { isEnabled } }` for every system spec | **The ADR-002 fix.** IDENTITY-role system specs whose `slug !== archetypeSlug` are toggled `false`; all other roles stay `true`. Merged over existing `currentConfig.systemSpecToggles` (preserves prior overrides). |
| **7. Publish playbook** | `playbook.id` | `Playbook.status = PUBLISHED`, `publishedAt`, validation flags | Archives competing PUBLISHED playbooks unless `forceNewPlaybook`. |
| **8. Configure onboarding** | `identitySpec.id`, `options.flowPhases` | `Domain.onboardingIdentitySpecId`, `Domain.onboardingFlowPhases` | Flow phases fall back to `getFlowPhasesFallback()` (SystemSettings → hardcoded default). |

Return shape: `ScaffoldResult { identitySpec, playbook, published, onboardingConfigured, extendsAgent, skipped[] }`. The `skipped` array surfaces "Identity spec already exists" / "Reusing existing DRAFT playbook" so callers can show the operator what was idempotent.

---

## 4. `systemSpecToggles` resolution

Two ends of the chain:

### 4.1 Writer — `scaffoldDomain` step 6

```
For every SYSTEM spec where isActive = true:
  toggles[spec.id] = { isEnabled: !(specRole === IDENTITY && slug !== archetypeSlug) }
Merge over existing Playbook.config.systemSpecToggles (preserves manual overrides).
```

### 4.2 Reader — `lib/pipeline/specs-loader.ts::getSystemSpecs`

```
1. Query all active SYSTEM specs matching the outputTypes filter.
2. If no playbookId provided           → return all (no filter).
3. Load Playbook.config.systemSpecToggles.
4. If toggles object is empty          → return all (default-enabled — see L1).
5. For each spec:
     toggle = toggles[spec.id] || toggles[spec.slug]
     if toggle.isEnabled === false     → exclude
     otherwise                         → include
```

### 4.3 Resolution rules

| Condition | Result |
|-----------|--------|
| Toggle entry missing for a spec | Spec is **enabled** (default). |
| Toggle entry present with `isEnabled: false` | Spec is **disabled**. |
| Toggle entry present with `isEnabled: true` | Spec is **enabled**. |
| `systemSpecToggles` object empty | **All** system specs enabled (no filter applied). See L1. |
| Lookup key | `toggles[spec.id]` tried first, then `toggles[spec.slug]` — either form works. |

### 4.4 The ADR-002 failure mode (re-summarised)

If `systemSpecToggles` is missing entirely — old playbooks, manually inserted rows, certain seed paths — every system spec runs, including multiple competing IDENTITY-role specs. `resolveSpecs()` (see §5) returns whichever appears first in `systemSpecs` array order, so the prompt's identity can switch unpredictably between runs. This is L1.

---

## 5. The 4-layer `extendsAgent` chain

The final identity section in the prompt is built by four distinct layers. **The third layer is entirely undocumented today** (flag L2).

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 0 — Selection                                                 │
│   lib/prompt/composition/transforms/identity.ts::resolveSpecs       │
│   Picks one IDENTITY spec from PlaybookItems (first playbook wins)  │
│   or, if none, from System Specs.                                   │
│   Voice spec resolved separately on the same pass.                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1 — Base archetype (SYSTEM, specRole: IDENTITY)               │
│   The spec at slug = `spec-${extendsAgent}` (or raw extendsAgent).  │
│   Provides default parameters: roleStatement, primaryGoal, style,   │
│   techniques, boundaries, session structure.                        │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 2 — Domain overlay merge                                      │
│   lib/prompt/composition/transforms/identity.ts::mergeIdentitySpec  │
│   • Recurses up to depth 3 (overlay → base → base-of-base …).       │
│   • Parameter-level merge: overlay replaces by `param.id`.          │
│   • Top-level keys: overlay wins.                                   │
│   • Constraints stack (base + overlay, never removed).              │
│   • Warn-not-throw if `extendsAgent` resolves to nothing.           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 3 — Group tone override (UNDOCUMENTED before this doc)        │
│   lib/prompt/composition/transforms/identity.ts                     │
│     ::applyGroupToneOverride                                         │
│   • Reads PlaybookGroup.identityOverride JSON.                      │
│   • `toneSliders` (formality/warmth/pace/encourage/precision):      │
│     non-neutral values (>0.05 away from 0.5) → directive strings    │
│     appended to `styleGuidelines`. Intensity word ("strongly" /     │
│     "somewhat") set by distance from 0.5.                           │
│   • `styleNotes` (freeform string) → appended verbatim as           │
│     "Department teaching style: …".                                 │
│   • Returns the spec unchanged if neither slider nor notes present. │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 4 — Course identity flatten                                   │
│   lib/prompt/composition/transforms/identity.ts                     │
│     ::registerTransform("extractIdentitySpec")                       │
│   Reads `context.resolvedSpecs.identitySpec.config` and emits the   │
│   llmPrompt-friendly shape: specName, domain, description, role,    │
│   primaryGoal, secondaryGoals, techniques, styleDefaults,           │
│   styleGuidelines, responsePatterns, boundaries, sessionStructure,  │
│   assessmentApproach. This is what the template compiler renders.   │
└─────────────────────────────────────────────────────────────────────┘
```

Notes:

- `resolveSpecs` Voice branch: a spec with `specRole: VOICE` OR (`specRole: IDENTITY` AND `domain: "voice"`) is captured separately. If neither path finds one, `resolveVoiceSpecFallback` queries by `config.specs.voicePattern`.
- The `extractContentSpec` transform was removed when the Content Spec consolidated into Curriculum + ContentAssertion (ADR-002 Decision 2). The model-level enum value `CONTENT` remains for back-compat.

---

## 6. `config.specs.*` slug catalogue

All getters defined at `lib/config.ts::specs` via the `optional(ENV, default)` helper. Override any slug by setting the matching env var. Categories below match the source's section comments.

### 6.1 Pipeline + onboarding (4)

| Key | Default slug | Env var |
|-----|--------------|---------|
| `onboarding` | `INIT-001` | `ONBOARDING_SPEC_SLUG` |
| `pipeline` | `PIPELINE-001` | `PIPELINE_SPEC_SLUG` |
| `pipelineFallback` | `GUARD-001` | `PIPELINE_FALLBACK_SPEC_SLUG` |
| `compose` | `system-compose-next-prompt` | `COMPOSE_SPEC_SLUG` |

### 6.2 Voice + content extraction (3)

| Key | Default | Env var |
|-----|---------|---------|
| `voicePattern` | `voice` | `VOICE_SPEC_SLUG_PATTERN` |
| `onboardingSlugPrefix` | `init.` | `ONBOARDING_SLUG_PREFIX` |
| `contentExtract` | `CONTENT-EXTRACT-001` | `SPEC_CONTENT_EXTRACT` |

### 6.3 Archetypes (8)

| Key | Default slug | Env var |
|-----|--------------|---------|
| `defaultArchetype` | `TUT-001` | `DEFAULT_ARCHETYPE_SLUG` |
| `coachArchetype` | `COACH-001` | `COACH_ARCHETYPE_SLUG` |
| `companionArchetype` | `COMPANION-001` | `COMPANION_ARCHETYPE_SLUG` |
| `advisorArchetype` | `ADVISOR-001` | `ADVISOR_ARCHETYPE_SLUG` |
| `facilitatorArchetype` | `FACILITATOR-001` | `FACILITATOR_ARCHETYPE_SLUG` |
| `convguideArchetype` | `CONVGUIDE-001` | `CONVGUIDE_ARCHETYPE_SLUG` |
| `mentorArchetype` | `MENTOR-001` | `MENTOR_ARCHETYPE_SLUG` |
| (the default `defaultArchetype` is also referenced as the global fallback in `scaffoldDomain` step 1) | — | — |

### 6.4 Wizard setup + flow + readiness (9)

| Key | Default slug | Env var |
|-----|--------------|---------|
| `contentSourceSetup` | `CONTENT-SOURCE-SETUP-001` | `CONTENT_SOURCE_SETUP_SPEC_SLUG` |
| `courseSetup` | `COURSE-SETUP-001` | `COURSE_SETUP_SPEC_SLUG` |
| `communitySetup` | `COMMUNITY-SETUP-001` | `COMMUNITY_SETUP_SPEC_SLUG` |
| `institutionSetup` | `INSTITUTION-SETUP-001` | `INSTITUTION_SETUP_SPEC_SLUG` |
| `classroomSetup` | `CLASSROOM-SETUP-001` | `CLASSROOM_SETUP_SPEC_SLUG` |
| `courseReady` | `COURSE-READY-001` | `COURSE_READY_SPEC_SLUG` |
| `communityReady` | `COMMUNITY-READY-001` | `COMMUNITY_READY_SPEC_SLUG` |
| `demonstrateFlow` | `DEMONSTRATE-FLOW-001` | `DEMONSTRATE_FLOW_SPEC_SLUG` |
| `teachFlow` | `TEACH-FLOW-001` | `TEACH_FLOW_SPEC_SLUG` |

### 6.5 PROMPT-role specs — system prompts (19)

| Key | Default slug | Env var |
|-----|--------------|---------|
| `chatDataHelper` | `PROMPT-CHAT-DATA-001` | `CHAT_DATA_HELPER_SPEC_SLUG` |
| `chatBugDiagnosis` | `PROMPT-CHAT-BUG-001` | `CHAT_BUG_DIAGNOSIS_SPEC_SLUG` |
| `adminAssistant` | `PROMPT-ADMIN-001` | `ADMIN_ASSISTANT_SPEC_SLUG` |
| `tuningAssistant` | `PROMPT-TUNA-001` | `TUNING_ASSISTANT_SPEC_SLUG` |
| `workflowClassifier` | `PROMPT-WORKFLOW-001` | `WORKFLOW_CLASSIFIER_SPEC_SLUG` |
| `coursePackAnalyzer` | `PROMPT-PACK-001` | `COURSE_PACK_ANALYZER_SPEC_SLUG` |
| `lessonPlanGenerator` | `PROMPT-PLAN-001` | `LESSON_PLAN_GENERATOR_SPEC_SLUG` |
| `compositionPreamble` | `PROMPT-PREAMBLE-001` | `COMPOSITION_PREAMBLE_SPEC_SLUG` |
| `wizIdentity` | `PROMPT-WIZ-IDENTITY-001` | `WIZ_IDENTITY_SPEC_SLUG` |
| `wizComms` | `PROMPT-WIZ-COMMS-001` | `WIZ_COMMS_SPEC_SLUG` |
| `wizCommunity` | `PROMPT-WIZ-COMMUNITY-001` | `WIZ_COMMUNITY_SPEC_SLUG` |
| `wizOpening` | `PROMPT-WIZ-OPENING-001` | `WIZ_OPENING_SPEC_SLUG` |
| `wizPlayback` | `PROMPT-WIZ-PLAYBACK-001` | `WIZ_PLAYBACK_SPEC_SLUG` |
| `wizProposal` | `PROMPT-WIZ-PROPOSAL-001` | `WIZ_PROPOSAL_SPEC_SLUG` |
| `wizContent` | `PROMPT-WIZ-CONTENT-001` | `WIZ_CONTENT_SPEC_SLUG` |
| `wizPedagogy` | `PROMPT-WIZ-PEDAGOGY-001` | `WIZ_PEDAGOGY_SPEC_SLUG` |
| `wizValues` | `PROMPT-WIZ-VALUES-001` | `WIZ_VALUES_SPEC_SLUG` |
| `wizRules` | `PROMPT-WIZ-RULES-001` | `WIZ_RULES_SPEC_SLUG` |
| (V4 wizard slugs: `wiz4Identity`, `wiz4Intake`, `wiz4Playback`, `wiz4Proposal`, `wiz4Rules`, `wiz4ContentExtra` — same pattern) | `PROMPT-WIZ4-*-001` | `WIZ4_*_SPEC_SLUG` |

### 6.6 Course Reference wizard (3)

| Key | Default slug | Env var |
|-----|--------------|---------|
| `crefIdentity` | `PROMPT-CREF-IDENTITY-001` | `CREF_IDENTITY_SPEC_SLUG` |
| `crefTools` | `PROMPT-CREF-TOOLS-001` | `CREF_TOOLS_SPEC_SLUG` |
| `crefRules` | `PROMPT-CREF-RULES-001` | `CREF_RULES_SPEC_SLUG` |

### 6.7 Contracts (3, not specs but co-located)

| Key | Default slug | Env var |
|-----|--------------|---------|
| `onboardingAssessment` | `ONBOARDING_ASSESSMENT_V1` | `ONBOARDING_ASSESSMENT_CONTRACT_SLUG` |
| `surveyTemplates` | `SURVEY_TEMPLATES_V1` | `SURVEY_TEMPLATES_CONTRACT_SLUG` |
| `sessionTypes` | `SESSION_TYPES_V1` | `SESSION_TYPES_CONTRACT_SLUG` |

**Maintenance rule:** when a new `config.specs.*` getter is added in `lib/config.ts::specs`, add a row to the right sub-table above in the same PR.

---

## 7. Cross-references

| Looking for | Read |
|-------------|------|
| Where do `SpecRole`-tagged specs land in the prompt? | `memory/flow-prompt-composition.md` (loader + transform list) — promote to `docs/PROMPT-COMPOSITION.md` per roadmap |
| Where is the post-call pipeline ordering defined? | `docs/CONTENT-PIPELINE.md` §7 (pipeline-001 stage ordering) + `memory/flow-pipeline.md` |
| How does `Playbook.config.systemSpecToggles` interact with wizard inputs? | `docs/WIZARD-DATA-BAG.md` (master field table → `Playbook.config`) |
| Where is `scaffoldDomain` called from? | `lib/wizard/wizard-tool-executor.ts` (`create_course` handler), seed scripts in `prisma/` |
| Model-level field reference for `AnalysisSpec`? | `docs/ENTITIES.md` §3 + `prisma/schema.prisma::model AnalysisSpec` |

---

## 8. Pre-change checklist

### Adding a new `SpecRole` value

- [ ] Add to `prisma/schema.prisma::enum SpecRole` with an inline comment that names example slugs.
- [ ] Update §2.1 of this doc with the role, lifecycle phase, and where it surfaces in the prompt.
- [ ] Decide who consumes it. If `resolveSpecs` should pick it up, add a branch (currently only IDENTITY / VOICE are handled).
- [ ] Update `.claude/rules/pipeline-and-prompt.md::SpecRole Taxonomy` block.
- [ ] If the role is for AI prompts, add the slug to `config.specs.*` and document in §6.

### Changing `scaffoldDomain` step order or behaviour

- [ ] Re-walk §3 and update the table in the same PR.
- [ ] If a step writes a new field on `Playbook.config`, add it to `docs/WIZARD-DATA-BAG.md` §3 master table.
- [ ] Verify the `forceNewPlaybook` branch in the early-return guard (step 2) still satisfies all callers.
- [ ] Confirm idempotency: rerun the modified function on the same domain and assert no double-writes.

### Adding a new system spec

- [ ] Add the spec JSON to `docs-archive/bdd-specs/` and seed via `npm run db:seed`.
- [ ] Decide whether the toggle should default to enabled. If `specRole: IDENTITY`, `scaffoldDomain` step 6 will auto-disable it for any course whose archetype is a different slug — verify this matches your intent.
- [ ] If the spec is referenced by code (composition consumer, pipeline runner), add the slug to `config.specs.*` and to §6.
- [ ] Add an entry to the appropriate sub-table in §6.

### Adding a new layer in the `extendsAgent` chain

- [ ] Decide where the new layer fits in §5's box diagram. Update the diagram and the implementation order in the same PR.
- [ ] Verify the layer is pure (returns a new spec; does not mutate input) — `applyGroupToneOverride` is the reference shape.
- [ ] Add a test that confirms layer N+1 still observes the output of layer N.
- [ ] Update `memory/flow-prompt-composition.md`.

---

## 9. Known landmines

| # | Landmine | Where | Status |
|---|----------|-------|--------|
| L1 | **ADR-002 toggle default leak** — when `Playbook.config.systemSpecToggles` is missing entirely (legacy playbooks, manual rows), every system spec runs, including multiple competing IDENTITY specs. `resolveSpecs` picks the first one in result order, which is non-deterministic. | `lib/pipeline/specs-loader.ts::getSystemSpecs` (the `Object.keys(toggles).length === 0` early-return); `lib/prompt/composition/transforms/identity.ts::resolveSpecs` (first-wins). | ⚠ **PARTIAL.** New courses go through `scaffoldDomain` step 6 which writes toggles. Legacy / manual playbooks remain default-enabled. No migration sweep planned. |
| L2 | **`applyGroupToneOverride` is invisible** — the third layer of the `extendsAgent` chain is documented nowhere before this doc. Any change to `mergeIdentitySpec` output shape could silently bypass it (e.g. if `styleGuidelines` is renamed, slider directives evaporate). | `lib/prompt/composition/transforms/identity.ts::applyGroupToneOverride` | ⚠ **DOC-ONLY FIX.** This doc is the first reference. No test asserts the layer fires. Consider adding a snapshot test that confirms a non-neutral slider produces a guideline string. |
| L3 | **Adding a `SpecRole` without updating composition consumers** — a new role added to `enum SpecRole` and seeded into a spec will be loaded by `getSystemSpecs` (it passes the outputType filter) but ignored by `resolveSpecs` (it only branches on IDENTITY / VOICE). The spec runs in the pipeline but contributes nothing to the prompt — silent no-op. | `enum SpecRole` ↔ `resolveSpecs` branches | ⚠ OPEN. The `extractIdentitySpec` transform only knows about IDENTITY shape. No catch-all consumer exists. |
| L4 | **`resolveVoiceSpecFallback` is a third resolution path** — separate from `resolveSpecs` and `getSystemSpecs`. Queries DB directly for any active spec matching `config.specs.voicePattern`. Bypasses `systemSpecToggles`. | `lib/prompt/composition/transforms/identity.ts::resolveVoiceSpecFallback` | ⚠ OPEN. A "disabled" voice system spec can still surface via the fallback. Document or remove. |
| L5 | **Deprecated `SpecRole` values can still be seeded** — `MEASURE / ADAPT / REWARD / GUARDRAIL / BOOTSTRAP` remain in the enum. A new spec JSON using them will seed without error. | `enum SpecRole` | ⚠ OPEN. No code-level lint. Migration to scrub legacy values is out of scope for this doc. |
| L6 | **`config.specs.*` sprawl** — ~40 getters, several semantically overlap (e.g. `wizIdentity` vs `wiz4Identity` vs `crefIdentity` are three identity slugs across three wizards). Renaming or retiring requires grepping for both the getter name and the env-var literal. | `lib/config.ts::specs` | ⚠ DOC-ONLY MITIGATION. §6 catalogue is the single grep target. |

---

## 10. ADR-002 partial supersession

`docs/adr/ADR-002-spec-toggles-and-content-consolidation.md` is **partially superseded** by this doc:

- **Decision 1 (Selective Spec Toggles):** the *immediate fix* still stands. The expanded toggle resolution chain — including the default-enabled landmine, the `id`-or-`slug` lookup, and the empty-toggles early-return — is now §4 of this doc.
- **Decision 2 (Content Spec Consolidation):** Phase 1 shipped (no-op); Phase 2 is implemented in code (`extractContentSpec` transform removed; `CONTENT` role retained for back-compat). Phase 3 (deprecate the role entirely) is unscheduled.
- **What's new here:** §3 step-by-step scaffold map, §5 4-layer `extendsAgent` chain (with `applyGroupToneOverride`), §6 slug catalogue, §9 expanded landmines (L2–L6 are new).

The ADR header has been annotated to point here for the live picture.

---

## 11. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. Fifth pillar alongside ENTITIES.md, WIZARD-DATA-BAG.md, CONTENT-PIPELINE.md, and the PROMPT-COMPOSITION roadmap doc. §2 SpecRole table (9 active + 5 deprecated). §3 scaffoldDomain 8-step map. §4 systemSpecToggles resolution. §5 4-layer extendsAgent chain including the previously undocumented `applyGroupToneOverride`. §6 config.specs.* catalogue (~46 slugs across 7 categories). §9 six landmines (L1 = ADR-002 default-enabled; L2 = invisible group-tone layer; L3 = SpecRole without consumer; L4 = voice fallback bypass; L5 = deprecated roles still seedable; L6 = config.specs sprawl). §10 marks ADR-002 partially superseded. Closes #328. |

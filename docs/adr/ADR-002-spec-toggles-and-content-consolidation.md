# ADR-002 — Spec Toggles & Content Spec Consolidation

## Status
**Partially superseded by [`docs/SPEC-SYSTEM.md`](../SPEC-SYSTEM.md) §4 (toggle resolution chain) and §10 (supersession notes).**

- Decision 1 (selective spec toggles) — **Accepted**; the expanded canonical map (8-step scaffold, toggle reader, 4-layer `extendsAgent` chain) now lives in `docs/SPEC-SYSTEM.md` §3-§5. Read that doc for current behaviour.
- Decision 2 (Content Spec consolidation) — **Phase 1 + Phase 2 shipped** (`extractContentSpec` transform removed; `CONTENT` role retained for back-compat). Phase 3 unscheduled.

The original Context / Decision text below is preserved for historical reference.

## Context

During Slice 1 verification, two related problems were discovered:

1. **All 40 system specs enabled by default.** `scaffoldDomain()` queries all active SYSTEM specs and sets every one to `isEnabled: true` in `Playbook.config.systemSpecToggles`. This means `resolveSpecs()` may pick the wrong identity archetype (whichever appears first in the query), and 7 competing IDENTITY specs all pass through the filter. Both prompt composition and the post-call pipeline read `systemSpecToggles` to decide what runs.

2. **Content Spec duplicates the Curriculum model.** The Content Spec (`specRole: "CONTENT"`) is an AI-generated `AnalysisSpec` storing modules, learning outcomes, delivery rules, and assessment criteria. The same data already lives in `Curriculum` + `CurriculumModule` + `LearningObjective` DB tables. The actual teaching content reaches the prompt through a separate path: `ContentAssertion` records loaded by the `curriculumAssertions` data loader and rendered by the `teaching-content` transform. The Content Spec contributes a duplicate "curriculum metadata" section to the prompt that the assertions already cover at finer granularity.

## Decision 1: Selective Spec Toggles (Immediate)

**Only disable unused IDENTITY archetype specs. Keep everything else enabled.**

When scaffolding a new domain/playbook:
- Query all SYSTEM specs with `specRole` included
- Set `isEnabled: false` for IDENTITY-role specs whose slug does NOT match the chosen archetype
- Set `isEnabled: true` for all other specs (MEASURE, LEARN, ADAPT, GUARD, ORCHESTRATE, VOICE, CONTENT, OBSERVE)

This ensures:
- `resolveSpecs()` finds exactly one IDENTITY spec from system specs (the chosen archetype)
- All pipeline stages (EXTRACT, AGGREGATE, REWARD, ADAPT, SUPERVISE, COMPOSE) remain active
- All measurement specs (PERS-001, VARK-001, etc.) continue to run

The UI (ExplorerTab) hides disabled specs from the System Specs column — operators only see what's active for their course.

### Files changed
- `lib/domain/scaffold.ts` — selective toggle logic
- `prisma/seed-golden.ts` — same pattern for golden seed
- `prisma/seed-holographic-demo.ts` — same pattern for demo seed
- `components/playbook/playbook-builder/ExplorerTab.tsx` — filter disabled specs from render

### Impact on existing courses
Existing courses retain their all-enabled toggles. The fix only affects new courses. To fix existing courses: re-scaffold or manually update toggles via Prisma Studio.

## Decision 2: Content Spec Becomes Assertion Browser (Phased)

### Phase 1 — Slice 1 (now)
No change. Both paths work. Accept the token cost of duplicate curriculum metadata in the prompt.

### Phase 2 — Post-market-test
Content Spec stops contributing to the prompt. It becomes a UI-only surface:

- **Remove** `extractContentSpec` transform from composition
- **Remove** the `content` section (priority 12) from the prompt
- **Move** assessment criteria and delivery rules to the identity overlay config (they're teaching instructions, not content)
- **Redirect** `modules.ts` to read from `CurriculumModule` model directly
- **Redirect** `trust.ts` to read trust levels from `ContentSource` records
- **Keep** `generate-content-spec.ts` for Curriculum model population — stop creating a separate `AnalysisSpec`

The Content Spec tab in the course UI becomes:
- **Assertion browser** — ContentAssertions grouped by module/LO, with counts, categories, trust levels
- **Delivery rules editor** — pacing, assessment criteria (stored in identity overlay, displayed here for teacher convenience)
- Teachers can browse, reorder, exclude assertions per session

### Phase 3 — Optional
Deprecate Content Spec as `AnalysisSpec` entirely. Replace with a dedicated Curriculum detail page backed by `Curriculum` + `CurriculumModule` + `ContentAssertion` models.

### Files affected (Phase 2)

| File | Change |
|------|--------|
| `lib/prompt/composition/transforms/identity.ts` | Remove `extractContentSpec` transform |
| `lib/prompt/composition/transforms/modules.ts` | Read from `CurriculumModule`, not content spec config |
| `lib/prompt/composition/transforms/trust.ts` | Read trust from `ContentSource` |
| `lib/prompt/composition/CompositionExecutor.ts` | Remove "content" section definition |
| `lib/domain/generate-content-spec.ts` | Keep curriculum generation, stop creating `AnalysisSpec` |
| `app/x/courses/[courseId]/` | Content tab becomes assertion browser + delivery rules |

## Consequences

- New courses get a clean, lean spec configuration (~34 enabled, ~6 disabled)
- Operators see only relevant specs in the UI
- Pipeline stages are never accidentally disabled
- (Phase 2) Teaching content in the prompt comes from one source of truth: `ContentAssertion` records
- (Phase 2) Curriculum structure comes from one source of truth: `Curriculum` + `CurriculumModule` tables
- (Phase 2) Token savings from removing duplicate curriculum metadata section

## Alternatives Considered

1. **Disable everything except 3 specs (archetype + voice + identity overlay).** Rejected — this kills the pipeline. Both composition AND pipeline read `systemSpecToggles`.
2. **Keep all specs enabled, fix only `resolveSpecs()` ordering.** Rejected — doesn't address the UI clutter or the fundamental issue of competing identities.
3. **Remove Content Spec entirely now.** Rejected — too disruptive for Slice 1. Phased approach is safer.

## Date
2026-03-25

# DRAFT EPIC: Designer Renderers v2 + Snapshot Tab

> **Status:** parked until structural foundation epic ships Story S4 (Designer shell + empty `PREVIEW_RENDERERS` registry).
> **Activation:** file as GitHub epic the day S4 merges.
> **Draft author:** 2026-06-13 session "CourseReDesign"; corrections folded in after TL re-review.

## TL;DR

~18 small UI stories. Most read an existing transform output from `ComposedPrompt.inputs.composition` and render it via the `registerPreviewRenderer<S>()` API from S4. A 4-story subset (Group A.5) creates new composer sections first because the source composer doesn't emit them today.

## Why this exists

The structural foundation epic (S1–S5) ships:
- **S1**: the discriminated `ComposeSection` union (14 members) + `kind: "config" | "runtime"` discriminator + key→section + loader→section maps
- **S2**: section-grain staleness hashes
- **S3**: section-scoped incremental regen
- **S4**: tri-pane Designer shell + **empty** `PREVIEW_RENDERERS` registry
- **S5**: caller-detail `?v=3` beta route + `WILL_RETIRE` audit registry

…but ships zero new visible renderers. PreviewLens continues to hand-wire its 8 existing sections inline. The educator sees no improvement.

This epic flips the switch. It migrates the 8 hand-wired sections into the registry, adds the 10 renderers for sections the composer already emits, adds 2 stories per item for the 2 items where the composer doesn't yet emit the section, and adds the Snapshot tab content for caller-detail v3.

## Scope — ~18 stories at ~½–1 day each

### Group A — Missing renderers for sections the composer ALREADY emits (10)

Each reads `ComposedPrompt.inputs.composition` via the S4 registry. No new loaders, no pipeline changes.

| # | Section (registry key) | Renderer surfaces | Data source |
|---|---|---|---|
| 1 | `firstCallMode` (kind: config) | "This Call 1 runs as Baseline Assessment" chip | `Playbook.config.firstCallMode` |
| 2 | `modePolicy` (kind: config) | demo-policy / useFreshMastery / maxMasteryTier / evidence-first banner | `Playbook.config` |
| 3 | `loMastery` | per-LO mastery chips inside a module bubble | `lo_mastery:{moduleId}:{loRef}` CallerAttribute keys |
| 4 | `instructions` sub-render (goalAdaptation) | per-goal LOW/MID/HIGH guidance sticky | `instructions.session_guidance` (already merged by `goalAdaptationGuidance()`) |
| 5 | `instructions` sub-render (goal evidence) | "You grew on LO3 — your DR/BC framing is much sharper" | `Goal.progressMetrics.progress.{evidence, tier, band, callId, at}` |
| 6 | `behaviorTargets` sub-render (skillBands) | skill band + EMA delta + callsUsed card | `CallerTarget.currentScore` + banding presets |
| 7 | `personality` | personality snippet for Big-Five courses | `CallerPersonalityProfile` + `personalityDecayHalfLifeDays` |
| 8 | `contentTrust` | "Tax facts expire in 12 days" amber chip | `subjectSources` loader + `transforms/trust.ts::checkFreshness` `FreshnessWarning` |
| 9 | `carryOverActions` | "From last call: complete worksheet X" bubble | `CallAction` (HOMEWORK / SEND_MEDIA / TASK) |
| 10 | `priorCallFeedback` | recap-depth indicator + admin warning on dry-run trace (per Q8 ruling — NOT a Preview chip) | `recapSynthesisCache` + `PRIOR_CALL_RECAP_RICH_DEPTH_ENABLED` env |

### Group A.5 — New composer sections (loader + transform + seed-sync prerequisite) (4)

These items from the original Q1 audit have **no backing composer section today**. The Q1 audit gap is deeper than "missing renderer" — the composer doesn't emit them at all. A renderer slice cannot ship until each gets a loader + transform + COMP-001 seed-sync update first.

| # | New section | Prerequisite story | Renderer story |
|---|---|---|---|
| 11 | `conversationArtifacts` (loader + transform + seed-sync) | `SectionDataLoader.ts::registerLoader("conversationArtifacts", …)` + `transforms/artifacts.ts` + new `outputKey: "conversationArtifacts"` in `getDefaultSections()` + COMP-001 spec JSON update + add `"conversationArtifacts"` to `ComposeSection` union + section map entries + loader map entry | Quote-worthy lines rendered as a bubble in Preview |
| 12 | `memoryDeltas` (loader + transform + seed-sync) | New loader computing `{ added: CallerMemory[], updated: CallerMemory[] }` between most-recent call and prior call + transform + new section + COMP-001 spec update + same union/map updates | "New facts learned this call" sticky-note in Preview |

**Each item = 2 stories** (loader+transform = 1, renderer = 1). Total Group A.5 = 4 stories.

### Group B — Registry migration + infrastructure (2)

| # | Story |
|---|---|
| 13 | Migrate the 8 hand-wired PreviewLens sections into the registry — behaviour-preserving; deletes inline rendering code in `PreviewLens.tsx`; tests assert byte-identical output |
| 14 | Renderer testing harness + Storybook fixtures for the registry |

### Group C — Snapshot tab content for caller-detail v3 (4+)

| # | Story |
|---|---|
| 15 | Snapshot landing tab — composes existing data: trajectory sparklines + "who we think they are" with interpretations + adapt panel + LO heatmap + last-call decisions block. Drills into existing tabs (Modules, Profile, Adaptation, Calls). |
| 16 | Per-LO heatmap drill from Modules — reads `lo_mastery:*` directly |
| 17 | DISC/COACH/COMP per-learner sub-skill cards — new `/api/callers/[id]/sub-skills` route |
| 18 | "Why this call?" panel — reads `scheduler:last_decision` + workingSet from compose trace |
| 19+ | Render `Parameter.interpretationHigh/Low` everywhere personality + traits render — schema fields already exist; never rendered |

## Out of scope (explicit non-goals)

- The 9 sprinkles (D1–D9 from master plan) — they're separate small wins
- Dead-key cleanup (5 orphans) — separate 3-phase deprecate-observe-delete workstream
- Migration of the 14 existing CourseDesignConsole lenses into the Inspector slot — third epic, after Renderers v2 ships
- IELTS-specific UI — separate course-level concern
- New loaders / pipeline stages / schema changes are out of scope EXCEPT in Group A.5 where loader+transform+seed-sync is the explicit deliverable for `conversationArtifacts` and `memoryDeltas`

## Activation checklist

- [ ] Structural foundation epic Story S4 merged (`PREVIEW_RENDERERS` registry exported)
- [ ] BA agent run to groom this draft into a real epic with sized child issues
- [ ] Tech Lead review for any data-source assumptions that drifted between draft and ship date
- [ ] File epic; reference this draft as the source-of-truth

## References

- Source session: 2026-06-13 "CourseReDesign"
- Master plan: 4 workstreams (A Designer, B dead keys, C caller-detail v3, D sprinkles)
- Structural foundation BA epic: 5 stories, 5 remaining TL questions (Q1, Q2, Q3, Q5 pending; Q4/Q6/Q7/Q8 RULED), current as of 2026-06-13
- Q1 audit baseline: PreviewLens covered 8 of 30 controls; TL re-review reshaped 19→14 sections + flagged 2 items needing new composer sections

# Caller Insights — Refocus All Three Tabs (Overview, Uplift, Progress)

> Synthesised plan. Absorbs the original draft + the code-verified refinement.
> Status: **PR 1a shipped locally** on branch `feat/insights-tabs-pr1a-plumbing-primitives`.
> Next: **PR 1b** (HeroSection + ModulesSection).

## Context

The Caller detail page (`apps/admin/components/callers/CallerDetailPage.tsx`) has three insight tabs — **Overview** (`?tab=overview` → `GuideLens`), **Uplift** (`?tab=uplift` → `UpliftTab`), and **Progress** (`?tab=what` → the `ProgressTab` exports). Their responsibilities overlap by accident: Module Mastery / Goals / Learning Trajectory render on both Uplift and Progress; goals/modules/personality/memories also spill into Overview's cards. The dividing line ("editable vs read-only") is a lazy axis.

**Re-focus all three tabs by intent and audience:**

| Tab | Audience | Intent | Layout |
|---|---|---|---|
| **Overview** | Educator landing | "30-second read: engaged? what now? how confident are the measurements?" | Scrolling dashboard |
| **Uplift** | Learner (or educator → learner) | "Proof of growth — share this" | Scrolling celebratory report, 12-col grid |
| **Progress** | Educator operating the course | "What's working / what to tune next?" | LH menu + RHS context panel |

Same data appears on more than one tab **only when more than one audience needs it**, visualised differently each time. Otherwise tabs **link** rather than duplicate.

**Build strategy:** Uplift v2 (`?tab=uplift-v2`) and Progress v2 (`?tab=progress-v2`) ship at new tab ids alongside v1; v1 deleted at cutover. Overview evolves in place (it's already coherent). All data calls reuse v1 routes — no new API routes in PR 1.

---

## What's actually in the code (verified against live tree)

| Claim | Reality | Action |
|---|---|---|
| UpliftTab path | `apps/admin/components/callers/caller-detail/UpliftTab.tsx`. `RingChart` 34-64, `MiniRing` 66-83, `trendDirection` 87-98, `Section` 104-133, `DeltaBadge` 137-144. | Extract these into primitives. |
| Tab plumbing | `SectionId` union in `caller-detail/types.ts:253`; `validTabs` in `CallerDetailPage.tsx:77`; tab buttons in `sections[]` ~line 630; render switch at `activeSection === …` (1083 uplift, 1249 what). | Register new ids in **both** `types.ts:253` and `CallerDetailPage.tsx`. |
| Glossary source | `/api/parameters/display-config` filters `isCanonical:true` → returns **only personality params** (Big Five / VARK), NOT behaviour/adaptation. | PR 1 glossary = hardcoded non-param terms + canonical defs from display-config. Adaptation/behaviour param defs arrive **per-track** from the PR-2 `/uplift` change (select `parameter.definition`). |
| Adaptation data | `/api/callers/[callerId]/uplift` (`route.ts:195-205`) returns `parameterName/defaultValue/currentValue/delta/callsUsed/confidence`; `parameter` select (`route.ts:70-76`) pulls `name` only. `Parameter` model (`schema.prisma:228`) has `parameterType`, `sectionId`, `definition`. | EQ mixer category bands → **PR 2** behind a one-line route change. Module Heatmap ships PR 1b (data already in payload). |
| Radar | `components/shared/PersonalityRadar.tsx` accepts `traits: RadarTrait[]` + optional `targetTraits`, hero/compact, returns null if `n<3`. | `Radar.tsx` = thin adapter mapping `{label,value}` → `RadarTrait`. |
| EQMixer source | `VerticalSlider` is drag-editable + ~21 inline-styled. Wrapping it imports the inline-style debt. | Build `EQMixer` as a **fresh, lean, read-only, CSS-class** vertical-bar component. Editing flows through the **pending-changes tray** (`ai-to-db-guard.md`), not slider drag. |
| Tooltip | Canonical `components/shared/Tooltip.tsx` (#689) — CSS-var styled, hover+focus, 500ms. | Reuse. Mobile (touch) won't fire hover — desktop-only caveat is real. |
| Sparkline | `components/shared/Sparkline.tsx` (+ `HistoryChartModal`); returns null if `<2` points unless `showIfEmpty`. | `SparklineCard` wraps it. |
| Overview card count | `GuideLens.tsx` renders **9 cards** (AtAGlance, SkillBandStrip, MockResult, ProgressStack, Focus, WhoTheyAre, RecentCalls, Achievements, TrustFooter) + Quick Actions. | PR 4.5 keep/drop table counts 9 + Quick Actions. |
| Cutover blockers | `CallerDetailPage.tsx:30` imports exactly 8 named exports from `ProgressTab.tsx` (`ScoresSection`, `LearningSection`, `AssessmentTargetsCard`, `TopicsCoveredSection`, `ExamReadinessSection`, `TopLevelAgentBehaviorSection`, `PlanProgressSection`, `ModuleProgressView`). | PR 9 = M, not S. Migrate these first. |
| Module drilldown | `ModuleDetailPanel(callerId, moduleSlug, moduleTitle, moduleMastery, onClose)` — `ProgressTab.tsx:909`. `/uplift` returns `moduleId`, `slug`, `title`, `mastery`, `callCount`. | Heatmap cells reuse `ModuleDetailPanel` with `moduleSlug={mod.slug}`. |

Test infra: `@testing-library/react` + `jsdom` (`vitest.config.ts`). Component tests in `tests/components/` and `__tests__/`.

---

## Display Primitives Catalogue

A finite, reusable set. Every data point on either tab uses one of these — no one-off vizzes.

| # | Primitive | Source | Use when |
|---|-----------|--------|----------|
| 1 | **Donut** | generalise `RingChart` (`UpliftTab.tsx:34-64`) | Single fraction 0–1, headline |
| 2 | **StatTile** | new | Single count, headline |
| 3 | **DeltaPill** | replaces `DeltaBadge` (`UpliftTab.tsx:137-144`) | Pre→post indicator (always a child) |
| 4 | **SparklineCard** | wraps `shared/Sparkline.tsx` | Time series, optional target overlay |
| 5 | **Radar** | adapter over `PersonalityRadar` | ≤8 same-scale params, shape |
| 6 | **EQMixer** | new, lean, read-only, CSS-class | >8 same-scale params, banded |
| 7 | **SliceDonut** | new | Categorical breakdown of a total |
| 8 | **HeatmapStrip** | new | Ordered items 0–1, course-sequence |
| 9 | **CalendarStrip** | new (needs `callDates[]` — PR 4) | Daily booleans |
| 10 | **TopicCloud** | new (sources `MemorySummary.topTopics` — PR 4) | Frequency-weighted text |
| 11 | **TimelineRibbon** | new | Sequenced status items |
| 12 | **CardGrid** | new (thin `minmax` auto-fill wrapper) | Many same-shaped detail cards |

Cross-cutting (not primitives): **Tooltip** (reuse `shared/Tooltip.tsx`), **Icon** (Lucide), **Direction colour** (green/red/neutral).

Each primitive is **pure presentational**: data + display props, no fetching, no state beyond hover/expand. Every primitive renders a defined empty state on null/undefined/NaN — never `NaN%`. Verified by unit tests.

---

## Build order

```
PR 1a  Plumbing                     ── SHIPPED LOCALLY (this branch)
PR 1b  HeroSection + ModulesSection  ── NEXT
PR 2   Adaptation EQ + Score-trend cards + /uplift route change
PR 3   Goals + Engagement + Print/Export PDF
PR 4   Topics cloud + Skill radar + CalendarStrip + /uplift callDates
PR 4.5 Overview in-place tighten (9 cards + Quick Actions)
PR 5   Progress v2 shell — LH menu + ?view= router
PR 6   Parameters + Adaptation + Modules lenses
PR 7   Goals (action chips via tray) + Topics + Exam lenses
PR 8   Plan timeline + Trajectory lenses
PR 9   Cutover — migrate 8 ProgressTab exports, then rm v1
```

**Data-reuse flow (all v2 tabs):**

```
useCallerInsights(data)
  ↓
GET /api/callers/[id]/uplift
GET /api/callers/[id]/learning-trajectory
data.scores / data.callerTargets (props from CallerDetailPage)
  ↓
v2 sections (read-only) → display-primitives
```

No writes back into the pipeline. All three tabs are downstream read-only consumers.

---

## PR 1a — SHIPPED LOCALLY (this branch)

| Deliverable | File | Status |
|---|---|---|
| `SectionId` += `"uplift-v2"`, `"progress-v2"` | `components/callers/caller-detail/types.ts:253` | ✅ |
| `validTabs[]` += both new ids | `components/callers/CallerDetailPage.tsx:77` | ✅ |
| `sections[]` += two BETA tab buttons | `CallerDetailPage.tsx` ~630 | ✅ |
| Render branches for both v2 tabs | `CallerDetailPage.tsx` ~1083/1249 | ✅ |
| `V1BetaBanner` (dismissible per surface) injected above v1 Uplift + Progress | `caller-detail/caller-detail-v2/V1BetaBanner.tsx` + `v1-beta-banner.css` (extras over `hf-banner hf-banner-info`) | ✅ |
| 12 display primitives + `primitives.css` + `index.ts` | `components/shared/display-primitives/` | ✅ |
| `caller-insights/` utilities (formatNum, direction, telemetry) | `lib/caller-insights/` | ✅ |
| `glossary.ts` — hardcoded fallback + `useGlossary()` hook fetching display-config canonical defs | `lib/caller-insights/glossary.ts` | ✅ |
| Section registry typing + empty `UPLIFT_SECTIONS` + placeholder catalogue | `components/callers/caller-detail/caller-detail-v2/sections/registry.ts` | ✅ |
| `UpliftV2Tab` shell renders placeholder grid via registry; emits `trackTabLoad("uplift-v2")` | `caller-detail/caller-detail-v2/UpliftV2Tab.tsx` + `uplift-v2.css` | ✅ |
| `ProgressV2Tab` shell renders LH menu placeholder + RHS empty panel; emits `trackTabLoad("progress-v2")` | `caller-detail/caller-detail-v2/ProgressV2Tab.tsx` + `progress-v2.css` | ✅ |

Tests: **61 passing** (12 primitives × snapshot+edge, 12 formatNum, 9 direction, 7 glossary, 3 telemetry). 0 new tsc errors. 0 new lint errors.

---

## PR 1b — NEXT

5. **`caller-detail/caller-detail-v2/sections/registry.ts`** — `UPLIFT_SECTIONS` += `hero` and `modules` entries; both with `Component` and `span`.

6. **HeroSection** — Mastery / Confidence / Knowledge donuts + DeltaPills + Calls/Days StatTiles. **Decision:** Confidence & Knowledge show **pre→post markers inside the donut centre** (`3.4 → 4.2`, via `formatNum.fraction`) — no sparkline, since `/uplift` has no per-call series for them. Mastery keeps its sparkline (real `CallScore` series). Empty hero (no calls): `"—"` in donut, no pill, "Awaiting first call" subtitle.

7. **ModulesSection** — `HeatmapStrip` (one cell per module in `sortOrder`, intensity = mastery), Tooltip (title + mastery% + callCount), cells clickable → `ModuleDetailPanel` (reusing `moduleSlug` from `/uplift` `moduleProgress[]`). All data already in `/uplift`.

8. **Data hook** — `useUpliftData(callerId)` in `caller-detail-v2/` consolidates the `/api/callers/[id]/uplift` fetch so sections don't each re-fetch. Returns `{ data, loading, error }`.

9. **e2e smoke test** — Playwright: load seed caller `?tab=uplift-v2`, assert Hero + Heatmap render non-empty.

---

## Subsequent PRs (slot in via registry)

| PR | Adds | Route change |
|---|---|---|
| 2 | Adaptation EQ + Score-trend sparkline cards | `/uplift`: `adaptationEvidence` `select parameter.parameterType + sectionId + definition`; extend `AdaptationItem` type (`types.ts:265`) |
| 3 | Goals badges + Engagement (slice + momentum) + **Print/Export PDF** (hard-pinned, not deferred) | — |
| 4 | Topics cloud + Skill radar + CalendarStrip | `/uplift`: add `callDates: string[]`; TopicCloud sources `MemorySummary.topTopics` from `/api/callers/[id]` |
| 4.5 | **Overview in-place tighten** — touches `GuideLens.tsx` + 9 card files + `lens.css`, no tab-id change | — |
| 5 | **Progress v2 shell** — LH menu + RHS router via `?view=` (additive to `?tab=`) | — |
| 6 | Parameters + Adaptation + Modules lenses | — |
| 7 | Goals (action chips via tray) + Topics + Exam readiness lenses | — |
| 8 | Plan timeline + Trajectory lenses | — |
| 9 | **Cutover** — migrate the 8 `ProgressTab` exports (used by `CallerDetailPage.tsx:30`) to v2/shared, then `rm` v1 `UpliftTab.tsx` + `ProgressTab.tsx` + `uplift-tab.css`. M, not S. | — |

**Cutover gate:** v1 sections re-implemented at parity · visual diff signed off · 1 sprint dual-availability · telemetry ≥95% v2 (else "4 weeks dual-available + no complaints").

---

## Three-tab duplication matrix (target state)

| Data | Overview | Uplift v2 | Progress v2 |
|---|---|---|---|
| Mastery % | At a Glance (small donut) | Hero (large donut + sparkline) | Overview lens (small donut) |
| Momentum / Streak | At a Glance (tile + mini calendar) | Engagement (calendar strip) | — |
| Skill bands | Link → Uplift | Skill chart + Radar | Parameters lens (EQ mixer) |
| Mock results | Mock Results card | — | Exam readiness lens (+ radar) |
| Goals | 2-stat summary + link → Progress | Goals achieved (badge grid, read-only) | Goals lens (action chips, via tray) |
| Module mastery | — (link to Progress) | Module heatmap | Modules lens (heatmap + drilldown) |
| Adaptation | — | "How we adapted" (EQ, celebratory) | Adaptation lens (EQ + reasons + chips) |
| Memories | Compact preview + link | Memories slice donut | — |
| Personality | 3 tiles + link → Profile | — | (Profile tab — out of scope) |
| Recent calls | Mini timeline (last 5) | — | Plan lens (session ribbon) |
| Achievements | Badge grid | (echo only if PR-3 print needs) | — |
| Trust / evidence | Trust footer | — | — |
| Learning trajectory | — | — | Trajectory lens (single home) |

---

## Overview in-place tighten (PR 4.5)

| Existing card | Decision | New primitives |
|---|---|---|
| At a Glance | KEEP | StatTile×4, small Donut, DeltaPill, mini CalendarStrip |
| Skill Bands | **→ link card** (trend lives on Uplift) | 3 mini-donuts + "View skill growth →" |
| Mock Results | KEEP | Donut + band chips + DeltaPill |
| Progress Stack | **→ summary + link** | StatTile×2 + mini TimelineRibbon + link |
| Focus (What to Focus On) | KEEP | CardGrid×2 |
| Who They Are | TIGHTEN | 3 personality tiles + 2 memory quotes + "View full profile" |
| Recent Calls | KEEP | mini TimelineRibbon (last 5) |
| Achievements | KEEP | CardGrid (badges) |
| Trust Footer | KEEP | StatTiles + Sparkline |
| Quick Actions | KEEP unchanged | — |

---

## Layout

**Uplift v2** — 12-col CSS grid, per-section `--span`, collapses to 1-col <900px:
```
[ Hero ──────────────────────────────── span 12 ]
[ Skill timeseries (8)        | Skill radar (4)  ]
[ Module heatmap ────────────────────── span 12 ]
[ Goals (6)                   | Score trends (6) ]
[ How we adapted (EQ) ────────────────── span 12 ]
[ Topics (6)                  | Engagement (6)   ]
```

**Progress v2** — LH menu + RHS panel; active lens in URL (`?tab=progress-v2&view=adaptation`, back-button works); <900px sidebar → top scroll-strip:
```
┌────────────────┬──────────────────────────────┐
│ ▸ Overview     │  [active lens — primitives]   │
│ ● Adaptation   │                               │
│ ▸ Parameters   │                               │
│ ▸ Modules ...  │                               │
└────────────────┴──────────────────────────────┘
```

---

## Tests

- **Primitive unit tests** — each of the 12 gets a snapshot + edge-data test (empty, null, NaN, single point, max value). ✅ PR 1a.
- **Glossary completeness** — fail build if a section references a glossary key that doesn't resolve. PR 1b+.
- **Section registry** — fail build if an `UPLIFT_SECTIONS` entry has no component or unknown span. PR 1b+.
- **Data-reuse smoke** — UpliftV2Tab + v1 UpliftTab render against the same fixture without error (parity guard). PR 1b.
- **No v1 regression** — existing UpliftTab tests stay green; `?tab=uplift` byte-identical (screenshot).
- **e2e (Playwright)** — load seed caller `?tab=uplift-v2`; assert Hero + Heatmap render non-empty. PR 1b.

---

## Architectural validation

- **Adaptive loop** — all three tabs are read-only consumers of pipeline outputs (`CallScore`, `CallerTarget`, `CallerAttribute`, `CallerModuleProgress`, `Goal`, `CallerMemorySummary`). No writes into EXTRACT…COMPOSE. CHAIN-CONTRACTS Links 3/4/5 untouched (UI never writes ComposedPrompt; heatmap reads aggregated `CallerModuleProgress.mastery`, not raw per-LO).
- **#928/#939 LO mastery** — no parallel per-LO read path; if a later PR needs per-LO display it MUST use `buildLoMasteryMap` (`lib/prompt/composition/lo-mastery-map.ts`).
- **EQ semantics** — "default vs current" respects `CallerTarget.targetValue` vs `SYSTEM_DEFAULT = 0.5`; delta computed client-side from authentic data. "How we adapted" is read-only celebratory framing — no narrative invention of *why*.
- **Taxonomy** — EQ category bands use `Parameter.parameterType` + `Parameter.sectionId`, NOT `domainGroup` and NOT SpecRole.
- **Memory docs** — no Prisma model changes, no new holographic sections / async hooks / DocumentTypes. `entities.md` / `holographic.md` / `async-patterns.md` / `extraction.md` / `flow-*.md` stay current.
- **ai-to-db-guard** — Progress v2 edit affordances (PR 6/7) push into the **pending-changes tray** (`aiSuggested` where applicable), never call config helpers directly.

---

## Risks

| Risk | Mitigation |
|---|---|
| Primitive library grows past the catalogue | Code-review gate: new viz must extend a primitive or be added to the catalogue with justification |
| Dual-tab confusion | BETA badge + in-app banner (PR 1a, not optional) |
| v1↔v2 data drift | Data-reuse smoke test fails CI on divergence |
| 9-PR sprawl | Each PR independently shippable; unbuilt sections show "Coming soon" |
| Cutover slips | Pre-written cutover PR pinned in MEMORY.md; >2 sprints post-parity ⇒ treat as fix chain, root-cause |
| Hidden v1 imports block PR 9 | PR 9 migrates the 8 `ProgressTab` exports first (M, not S) |
| EQ shipped flat (no bands) | Moved to PR 2 behind `/uplift` route change; PR 1 ships Module Heatmap (data complete) |
| Print/Share never ships | Hard-pinned to PR 3 |
| Mobile tooltips don't fire | `shared/Tooltip` is hover/focus → desktop-only; document in primitive, defer touch fix |
| Glossary defs drift / incomplete for behaviour params | Adaptation defs carried per-track from PR-2 `/uplift` change, not hardcoded |

---

## Open questions (deferred to later PRs)

1. **Multi-course** — `/uplift` aggregates across all active enrollments (not playbook-scoped). PR 1 hero shows aggregate (= v1 behaviour). Course-switcher chip is a later UI enhancement.
2. **Curriculum mid-flight** — heatmap renders current-curriculum modules; phantoms (mastery exists, module gone) → "Retired modules (N)" sub-cluster. (PR with Modules lens.)
3. **Stale goal types** — fall back to generic "Goal" label + console warn; never crash. (PR 3.)
4. **EQ default expand state** at 45 params — collapse all bands except the one with largest |delta|. (PR 2.)
5. **Glossary authoring ownership** — who writes the ~10–15 non-param plain-English defs (dev placeholder + educator review vs block PR 3)? (PR 3.)
6. **SUPPORT / non-educator role** — `requireAuth` doesn't differentiate read-only roles; decide before PR 6 edit affordances. Default: hide action chips for non-educator, not whole panels.

**Out of scope (whole epic):** cohort side-by-side view; AI-suggested next-action tiles (separate epic); new schema/permission rules in PR 1; mobile design beyond 1-col collapse.

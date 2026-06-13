# Handoff — Skills Framework UI build (2026-06-13)

> **From:** the session that scoped + built the first two lenses of the
> Skills Framework Inspector beta tab on Course Detail
> **To:** the next session continuing this build
> **Date:** 2026-06-13 (end of day)
> **Status:** 9 PRs merged today; tab live on dev with 2 of 6 planned lenses

## What's live right now (`localhost:3000`)

The VM is pulled to main + dev server running + tunnel open. Test URLs:

| URL | What you should see |
|---|---|
| `/x/courses/5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0?tab=skills` | **CTO Revision Aid** — 4-tier rubric (Foundation→Distinction), all 10 cross-cutting skills with descriptors populated |
| `/x/courses/405b210f-9a2b-4aca-b906-edcc758534a2?tab=skills` | CTO Pop Quiz (same skills, same scheme) |
| `/x/courses/2d04ded7-19dc-46d3-afa5-b85d073778b4?tab=skills` | CTO Exam Assessment |
| `/x/courses/eb6bc79e-3168-49e5-90a0-d732a37fe294?tab=skills` | IELTS Speaking — 4 skills × 3-tier (heading form — cross-course consistency check) |

Login: `admin@test.com` / `admin123` (the seeded SUPERADMIN).

## Today's 9 merged PRs

| PR | What | Why it matters |
|---|---|---|
| #1568 | `docs/glossary-skills-mastery.md` + `/x/help/glossary` | Canonical vocabulary — every entity mapped to UI label + DB shape. Indexed by Cmd+K/help overlay. Maintain as the system evolves. |
| #1569 | Stream A invariants — `resolveSkillByLogicalId` + handoff doc rulings | Skills-side mirror of `resolveModuleByLogicalId`. Refuses unscoped lookup. Used by every Sprint 2+ surface. |
| #1570 | `lib/banding/tier-colors.ts` + `<TierCell>` + `<CascadeValue>` | Shared primitives. Cold→hot direction, glyph + label, 3/4/CEFR-tier supported. `AWAITING_EVIDENCE` + `ABOVE_TARGET` first-class states. |
| #1571 | `mastery-policy` cascade family | `skillTierMapping` + `skillScoringEmaHalfLifeDays` now cascade Domain→Playbook. Other 3 mastery knobs documented as variant-intrinsic (no chip). |
| #1572 | Skills Framework tab scaffold + Framework Map lens | `/x/courses/[id]?tab=skills` route, `<CourseSkillsTab>`, Framework Map default lens. Reads `/api/courses/[id]/skills-framework`. |
| #1573 | `applyProjection` persists per-skill `tierScheme` + tier descriptors | Closed gap where the parser emitted per-skill tier data but applier dropped it. `Parameter.config.{tierScheme, tiers, bandThresholds}` merged. |
| #1574 | Cohort Heatmap lens + lens switcher | Second lens. Single `groupBy` query (no N+1 — Tech-Lead's Task #10 mandate). Lens switcher pattern for all future lenses. |
| (pre-today) #1556 | CourseReDesign S1 — `ComposeSection` taxonomy | Foundation. S2/S3/S4/S5 not yet shipped. |

## Architecture decisions locked today

### 4 invariants (per `docs/draft-issues/handoff-skills-framework-heatmap.md`)

1. **Stable skill IDs** — `ParsedSkill.ref` is the `SKILL-NN` stable ID. Resolver: `lib/curriculum/resolve-skill.ts::resolveSkillByLogicalId`.
2. **Tier ordering** — PER-SKILL `tierScheme`, NOT per-playbook. Different skills in one course MAY use different schemes (CEFR + cto can coexist). Tech-Lead corrected the original "single per playbook" mis-statement; the resolver now flows it correctly via `Parameter.config.tierScheme`.
3. **LO → Tier 1:1** — enforced at runtime by `scoreToTier()` (single tier per score). No parser warning needed.
4. **Mastery storage** — `CallerAttribute lo_mastery:{moduleSlug}:{loRef}`, ratchet semantics. `useFreshMastery` fork persists per-call to `Call.scratchMastery` (Exam Assessment mode).

### 3 handoff doc rulings recorded

- N-tier ordering: operator-defined PER SKILL
- Empty tier rows: render with `"(no descriptors yet)"` placeholder
- launchBlockers + heatmap: render with `DRAFT` watermark badge

### Cascade-knob split (Tech-Lead fix #1)

| Knob | Cascade family | Why |
|---|---|---|
| `skillTierMapping` | ✅ `mastery-policy` | Institution-level rubric standardization (IELTS school sets Domain default) |
| `skillScoringEmaHalfLifeDays` | ✅ `mastery-policy` | Short-demo institutions want 4d Domain default; long-courses want 30d |
| `useFreshMastery` | ❌ Playbook-only | Variant-intrinsic (Exam Assessment identity) |
| `maxMasteryTier` | ❌ Playbook-only | Variant-intrinsic (Pop Quiz cap) |
| `scoringMode` | ⏳ Playbook-only for now | Deferred — revisit if institution-wide evidence-first policy emerges |

The Rubric Calibration lens (SP3-A) will render the 2 cascade knobs with `<CascadeValue>` chips and the 3 playbook-only knobs with a variant-preset pill.

### Two parallel scoring systems coexist

Documented in `docs/glossary-skills-mastery.md` and the Mastery vs Skill explainer lens (SP3-C, NOT shipped):

- **Skill EMA** — `CallerTarget.currentScore`, time-weighted, banded via `scoreToTier()`, can fall
- **LO Mastery** — `CallerAttribute lo_mastery:*`, monotonic `Math.max` ratchet, only rises

They diverge by design and BOTH surface on the Caller Detail Attainment tab (SP4, NOT shipped).

## How learner assessment works (FAQ from this session)

See the conversation transcript and the glossary doc — but in one line: **the LLM reads the transcript against the rubric you authored** via the per-playbook `skill-measure-<id>` AnalysisSpec, which emits one trigger per skill. Score lands as `BehaviorMeasurement` → EMA into `CallerTarget.currentScore` → banded by `scoreToTier()` for the chips. The rubric text the LLM sees IS the tier descriptor text shown on the Framework Map lens. Rubric Calibration lens (SP3-A) will let the educator preview the exact MEASURE prompt.

## What's NEXT (sprint plan recap)

### Sprint 2 remaining

| Story | Effort | Notes |
|---|---|---|
| **SP2-G** Single Learner Drill lens | S 3h | Deep-link to Caller Detail Attainment tab. Need Sprint 4's tab to exist first, OR cross-link to existing ProgressV2Tab as a transitional shim. |

### Sprint 3 — Inspector lenses (~20h)

| Story | Effort | Notes |
|---|---|---|
| **SP3-A** Rubric Calibration lens | M 8h | **Highest value next.** Absorbs `BandingPicker`. Renders per-band `bandThresholds`. Shows the actual MEASURE-spec prompt the AI tutor scores against ("what the model sees"). Cascade chips via `<CascadeValue>` on the 2 mastery-policy knobs. Variant-preset pill on the other 3. |
| **SP3-B** Source Lineage lens | M 6h | `sourceContentId` chain from upload to projected entities. Re-project button (existing route). Drift indicator. |
| **SP3-C** Mastery vs Skill explainer lens | S 6h | Static educational view. Math.max ratchet vs EMA side-by-side. Cross-links to glossary. Closes the "why do they diverge?" question. |
| Group A renderer migrations (3 of 10) | M 8h | Once S4 `PREVIEW_RENDERERS` lands |

### Sprint 4 — Caller Detail v3 Attainment tab (~29h)

| Story | Effort | Notes |
|---|---|---|
| **SP4-A** tab shell `?tab=attainment&v=3` | S 4h | STUDENT-readable for OWN data (per Task #8 decision below). Uses `studentAllowedToReadCaller` (path-param), NOT `resolveCallerScopeForReading` (query-param). |
| **SP4-B** Skill Bands section | M 8h | Per-skill EMA tier + cascade chip showing tier-mapping source. Branches on `useFreshMastery`. |
| **SP4-C** LO Mastery section | M 6h | `lo_mastery:*` via canonical helpers. Per-module rollup. |
| **SP4-D** Goal Progress section | M 6h | With strategy label + evidence trail. |
| **SP4-E** `WILL_RETIRE` tag on `ProgressTab` / `SkillBandStripCard` / `MockResultCard` | S 3h | 2-sprint observation window starts. |
| **SP4-F** Cohort Heatmap → Attainment deep-link wiring | S 2h | Completes the Single Learner Drill bridge (SP2-G). |

### Sprint 5 — Adaptations tab (~28h)

| Story | Effort | Notes |
|---|---|---|
| **SP5-A** tab shell | S 4h | OPERATOR+ only (exposes tuning signals). |
| **SP5-B** "What was adapted" | M 7h | `CallerTarget` overrides vs `BehaviorTarget` PLAYBOOK default. `<CascadeValue>` on every knob. |
| **SP5-C** "Why" | M 7h | `RewardScore` + `Goal.progressMetrics.progress.{evidence, tier, band, callId}` (structured read, not just `Goal.progress` float). |
| **SP5-D** "Next call's adaptation" | M 5h | `goalAdaptationGuidance` LOW/MID/HIGH preview. |
| **SP5-E** `WILL_RETIRE` tag on `AdaptationLens` + Tune-tab adaptation sections | S 3h | |

## Outstanding ship-readiness fixes (Task list)

Per the in-session task tracker:

| # | Task | Status |
|---|---|---|
| 7 | Lock cascade-knob decision (mastery-policy family) | ✅ Done in PR #1571 |
| 8 | STUDENT-visibility decision for Attainment + Adaptations | **OUTSTANDING.** Recommend Attainment = STUDENT for own data; Adaptations = OPERATOR+ only. Lock as AC on each route story. |
| 9 | Correct tier-scheme invariant (per-skill not per-playbook) | ✅ Done in PR #1569 |
| 10 | Cohort heatmap GROUP BY strategy | ✅ Done in PR #1574 (single `findMany` not `findFirst` per cell) |
| 11 | File master epic on GitHub | **OUTSTANDING.** BA's draft body is in this session's transcript. Fold in TL's 4 critical + 5 secondary fixes and `gh issue create`. |

## Files you'll touch next

### For SP3-A Rubric Calibration:

| Action | File |
|---|---|
| New API route | `apps/admin/app/api/courses/[courseId]/skills-rubric-calibration/route.ts` — read MEASURE spec text + per-skill bandThresholds + cascade-resolved knobs |
| Extend tab | `apps/admin/app/x/courses/[courseId]/CourseSkillsTab.tsx` add `"rubric-calibration"` to `LensId` union + LENSES array + lens body |
| Absorb component | `apps/admin/components/shared/BandingPicker.tsx` — wrap in the lens, KEEP the existing file in place during the 2-sprint observation window |
| Cascade chips | Import from `apps/admin/components/shared/CascadeValue.tsx` (already shipped). Hook to `/api/cascade/resolve?knobKey=skillTierMapping&playbookId=...` |
| Variant-preset pill | Tiny new component for the 3 playbook-only knobs (Pop Quiz cap, Exam Assessment isolation, evidence-first mode) |

### For SP3-B Source Lineage:

| Action | File |
|---|---|
| New API route | `/api/courses/[courseId]/skills-source-lineage/route.ts` — walks `Parameter → BehaviorTarget → Source` via `sourceContentId` |
| Tab extension | same as SP3-A |
| Re-project trigger | existing `runProjectionForPlaybook()` is the action |

### For SP4 Attainment tab:

| Action | File |
|---|---|
| Route | `apps/admin/app/x/callers/[callerId]/page.tsx` — find existing tabs, add `attainment` to VALID_TABS + tab array |
| Tab component | `apps/admin/app/x/callers/[callerId]/CallerAttainmentTab.tsx` (new) |
| API route | `apps/admin/app/api/callers/[callerId]/attainment/route.ts` — uses `studentAllowedToReadCaller` for path-param scope |
| Reuse | Existing `ProgressV2Tab` data fetches as reference; KEEP it during 2-sprint observation |

## Open data-state observations

- **CTO 4-tier rubric** populated post #1573 + backfill — Framework Map shows descriptors correctly.
- **Cohort Heatmap** today shows mostly `AWAITING_EVIDENCE` because hf_sandbox has minimal real call data on CTO. Cyrus Horváth has 7 calls but only on Unit-04; other 9 skills have no score. Smoke-test by running sim calls.
- **IELTS course** still shows 3-tier (heading form) — that's correct, parser emitted 3-tier for that course-ref. NOT a bug.
- **Existing Cohort surface** at `CohortLearningAggregate.tsx:22-28` still uses inline `BAND_COLORS` — migration to the shared `tierColor()` util is queued for Sprint 4 SP4-F.

## Key files for orientation

```
apps/admin/lib/wizard/project-course-reference.ts   # ParsedSkill + parser + 3/4/CEFR scheme detection
apps/admin/lib/wizard/apply-projection.ts           # writes Parameter.config.{tierScheme,tiers,bandThresholds}
apps/admin/lib/curriculum/resolve-skill.ts          # canonical skill resolver (Stream A invariant A1)
apps/admin/lib/banding/tier-colors.ts               # shared tier→colour/glyph/label
apps/admin/lib/cascade/resolvers/mastery-policy.ts  # cascade family for the 2 cascade-eligible mastery knobs
apps/admin/components/shared/TierCell.tsx           # one heatmap cell primitive
apps/admin/components/shared/CascadeValue.tsx       # inline value + LayerBadge composer
apps/admin/components/cascade/LayerBadge.tsx        # the chip itself (existing, reused)
apps/admin/components/cascade/CascadeInspectorTray.tsx  # heavy tray (consumer mounts, not CascadeValue)
apps/admin/app/x/courses/[courseId]/CourseSkillsTab.tsx  # 2 lenses, lens switcher, LENSES registry
apps/admin/app/x/courses/[courseId]/course-skills-tab.css  # styling, all CSS-token-only
apps/admin/app/api/courses/[courseId]/skills-framework/route.ts        # Framework Map data
apps/admin/app/api/courses/[courseId]/skills-cohort-heatmap/route.ts   # Cohort Heatmap data (single GROUP BY)
docs/glossary-skills-mastery.md                     # canonical vocabulary
docs/draft-issues/handoff-skills-framework-heatmap.md  # earlier handoff doc with rulings
```

## Test infrastructure

| Test file | Coverage |
|---|---|
| `tests/lib/resolve-skill.test.ts` | 11 — Stream A invariant A1 |
| `tests/lib/tier-colors.test.ts` | 28 — every tier scheme, no hex tokens, accessibility |
| `tests/components/TierCell.test.tsx` | 12 — glyph + colour + label + ★ marker + interactive vs static |
| `tests/lib/cascade/mastery-policy-resolver.test.ts` | 9 — PLAYBOOK-over-DOMAIN precedence + provenance gaps |
| `lib/wizard/__tests__/project-course-reference.test.ts` | 36 — parser (unchanged by today's PRs) |

All 96 tests pass. Run with: `cd apps/admin && npx vitest run tests/lib tests/components lib/wizard/__tests__`.

## Quick win for next session start

1. **Smoke** the live tab in browser at the URLs above. Confirm the 4-tier rubric renders on CTO courses + Cohort Heatmap loads.
2. **Pick** between SP3-A Rubric Calibration (highest value — closes the "what's the AI scoring against" trust gap and consumes the cascade chips) OR SP4-A Attainment tab shell (sets up the deep-link from Cohort Heatmap).
3. **File** the master epic ticket (Task #11) with TL's 4 critical fixes folded in — see the BA's draft body in this session's transcript.

## Risks to flag

- **Master epic not filed yet.** The 28-story plan + cross-cutting NFRs (cascade-honesty, learner-scope, slug-scope, AI-to-DB tray, AI-read grounding, compose bump, WILL_RETIRE tagging) all need to land as acceptance criteria before grooming. Task #11.
- **S2/S3/S4/S5 of the foundation epic aren't shipped.** Sprint 3+ stories can build their own lens registry; Sprint 2's lenses already do. When the foundation lands, migrate.
- **Cyrus on hf_sandbox is the only real test learner with cross-skill call data.** Need more sim calls to validate the Cohort Heatmap distribution at scale (or a synthetic seed for testing).
- **`page.tsx` is large** (~1800 lines). Adding lenses inside it doesn't grow it much, but the tab switch logic is ripe for an extraction. NOT urgent — flag for after Sprint 5.

## Evidence trail — captured today, surfaced unevenly

The DB carries per-call evidence on THREE fields:

- `BehaviorMeasurement.evidence` — LLM transcript excerpt + rationale per skill score (SCORE_AGENT stage)
- `CallScore.evidence` — same shape for EXTRACT-stage params (Big5, VARK, engagement)
- `Goal.progressMetrics.progress.{evidence, tier, band, score, target, callId, at}` — strategy-level provenance

UI surfaces today:
  - ✅ `CallsPromptsTab` (per-call scores with evidence)
  - ✅ `GoalsLens` (Goal.progress evidence string)
  - ⚠️ `AdaptationLens` (partial)
  - ❌ Skills Framework tab (no evidence rendered anywhere yet — intentional for Framework Map, gap for Cohort Heatmap)
  - ❌ `ProgressTab`, `SkillBandStripCard`, `MockResultCard`, `SkillTrendChartCard`

**ACs to add to in-flight stories (no new stories needed):**

  - **SP2-D-followon** — Cohort Heatmap cell drill: click "12 at Practitioner" → side panel lists those 12 learners with last `BehaviorMeasurement.evidence` excerpt each. Effort S, 4h.
  - **SP4-B extend** — Attainment Skill Bands section: each skill row expands inline to show 3 most-recent `BehaviorMeasurement.evidence` lines + confidence + callId deep-link. No size change.
  - **SP3-A extend** — Rubric Calibration "What the AI tutor cited" panel: pulls 3 most-recent evidence excerpts per skill across the cohort. Closes the trust gap (educator sees both the rubric prompt AND what the model quoted from real transcripts). No size change.

## References

- Today's commits: #1568–#1574 on `main`
- Glossary: `docs/glossary-skills-mastery.md` (lives at `/x/help/glossary`)
- Earlier handoff (heatmap renderer brief): `docs/draft-issues/handoff-skills-framework-heatmap.md`
- Foundation epic context: `docs/draft-issues/s1-compose-section-contract.md`, `docs/draft-issues/followon-designer-renderers-v2.md`
- Banding presets reference: `apps/admin/lib/banding/presets.ts`

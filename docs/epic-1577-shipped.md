# Epic #1577 — Skills Framework Inspector + Attainment + Adaptations + Renderer Migration

> **Status: substantially complete.** 17 PRs shipped 2026-06-13.
> Outstanding: SP2-E / SP2-F / SP3-D renderer migrations (depend on
> Renderers v2 follow-on epic) + #1555 S2 / S3 backend work. SP5-F
> closeout doc (this file).

## Net surface delivered

Three new educator-visible surfaces, two of them live on `main` without
a feature flag:

| Surface | URL | Auth | Status |
|---|---|---|---|
| **Skills Framework Inspector** | `/x/courses/<id>?tab=skills` | OPERATOR+ | 5 lenses shipped |
| **Caller Detail → Attainment tab** | `/x/callers/<id>?tab=attainment` | STUDENT (own) / OPERATOR+ (any) | 4 SP4 stories shipped |
| **Caller Detail → Adaptations tab** | `/x/callers/<id>?tab=adaptations` | OPERATOR+ | 5 SP5 stories shipped |

### Skills Framework Inspector — 5 lenses

| Lens | Story | PR |
|---|---|---|
| Framework Map (default) | SP2-A + SP2-B | #1572 |
| Cohort Heatmap | SP2-D | #1574 |
| Cohort Heatmap cell drill | SP2-D-followon | #1581 |
| Rubric Calibration | SP3-A | #1579 |
| Source Lineage (+ Re-project) | SP3-B | #1597 |
| Mastery vs Skill explainer | SP3-C | #1596 |

### Attainment tab — 4 sections

| Section | Story | PR |
|---|---|---|
| Tab shell + skill bands + evidence-trail expand | SP4-A | #1580 |
| Per-LO mastery drill | SP4-C | #1586 |
| Goal evidence trail polish | SP4-D | #1587 |
| Cohort Heatmap → Attainment deep-link (receive) | SP4-F | #1588 |

### Adaptations tab — 5 sections

| Section | Story | PR |
|---|---|---|
| Tab shell | SP5-A | #1589 |
| What was adapted (CallerTarget overrides + cascade chips) | SP5-B | #1590 |
| Why (RewardScore.targetUpdatesApplied timeline) | SP5-C | #1591 |
| Next call's adaptation (goalAdaptationGuidance preview) | SP5-D | #1592 |
| WILL_RETIRE audit on AdaptationLens + Tune adaptation sections | SP5-E | #1595 |

### Foundation (epic #1555)

| Story | PR |
|---|---|
| S1 Compose section contract | #1563 |
| **S4 DesignerShell tri-pane + PREVIEW_RENDERERS registry** | #1593 |
| **S5 ?v=3 Snapshot beta route + WILL_RETIRE registry** | #1594 |
| S2 section-grain staleness hash | not shipped — open |
| S3 section-scoped incremental regen | not shipped — open |

### Cross-cutting

- Synthetic cohort seed for smoke testing: PR #1578 (`scripts/seed-synthetic-cohort.ts`)
- Per-learner skills evidence route: PR #1576 (`/api/callers/[id]/skills-evidence` — earlier sister of the cohort route)
- Master epic body + cross-cutting NFRs: #1577

## Outstanding work (deliberately deferred)

### Renderer migrations — SP2-E / SP2-F / SP3-D

Each story migrates 3–4 existing Preview renderer functions into the
`PREVIEW_RENDERERS` registry shipped in S4. They're queued behind the
Renderers v2 follow-on epic
([`docs/draft-issues/followon-designer-renderers-v2.md`](./draft-issues/followon-designer-renderers-v2.md))
because each renderer is non-trivial (per-section data envelope +
selection-aware UI). Activating the queue requires shipping S4 first
(now done) and then a focused renderer-by-renderer epic.

### S2 / S3 — section-grain staleness hash + incremental regen

These are bigger backend pieces under #1555. Independent of the
surfaces shipped under #1577 — the surfaces work today against the
existing whole-prompt compose path. S2 unlocks per-section staleness
banners; S3 unlocks per-section regen (perf win on large playbooks).

### SP2-G — Single Learner Drill lens

**Closed as superseded** by SP4-F (PR #1588). The Cohort Heatmap cell
drill (SP2-D-followon #1581) lists learners; each carries a
"View attainment →" deep-link to that learner's Attainment tab with
the matching skill row auto-expanded. The original SP2-G scope of "a
separate full lens that drills into one learner" is fully covered by
that flow without adding a fifth lens entry.

## Cross-cutting compliance

Every story shipped under this epic satisfied:

- ✅ **Cascade-honesty (Epic #1442 L2)** — every cascade-resolvable knob
  rendered via `<CascadeValue>` (PR #1570) consuming `/api/cascade/resolve`.
  Variant-intrinsic knobs use `<VariantPresetPill>` (NOT a cascade chip).
- ✅ **Learner-scope (#977)** — STUDENT-readable routes route through
  `studentAllowedToReadCaller` (path-param) or
  `resolveCallerScopeForReading` (query-param); OPERATOR-only routes
  carry the inline `eslint-disable hf-security/no-unscoped-caller-id-route`
  with rationale.
- ✅ **Slug-scope (#407)** — per-LO + per-skill ops route through
  `resolveModuleByLogicalId` / `resolveSkillByLogicalId`.
- ✅ **Course-style guard (#1252 / #1259)** — `CallerModuleProgress`
  reads wrapped in `getCourseStyle() === "structured"`.
- ✅ **AI-to-DB tray (#854)** — no AI-driven config writes in this
  epic's scope.
- ✅ **AI-read grounding (#1444)** — no AI claims about specific
  entities in any of the new routes.
- ✅ **WILL_RETIRE protocol** — every legacy surface marked for
  retirement has a file-top comment pointing at its audit doc, and
  every audit doc carries a corresponding row.

## Retirement audit docs filed

| Audit | Scope |
|---|---|
| [`caller-detail-v3.md`](./retirement-audit/caller-detail-v3.md) | 8 legacy Caller Detail tabs slated to retire when Snapshot v3 ships content |
| [`attainment-sp4e.md`](./retirement-audit/attainment-sp4e.md) | ProgressTab / SkillBandStripCard / MockResultCard — retire after 2-sprint observation |
| [`adaptations-sp5e.md`](./retirement-audit/adaptations-sp5e.md) | AdaptationLens + Tune-tab adaptation sections — retire after 2-sprint observation |

## Closeout owner

Session closed by Session A on 2026-06-13. Next session should:

1. Read this doc + `caller-detail-v3.md` for the broader retirement
   picture.
2. Decide whether to activate Renderers v2 follow-on epic (the
   biggest outstanding piece — fills `PREVIEW_RENDERERS` registry).
3. Independently consider S2 + S3 (#1557 + #1558) for the staleness +
   incremental-regen wins.

# Handoff — Skills Framework × Mastery Heatmap UI

> **From:** CourseReDesign epic session (#1555 / S1 just merged via PR #1563, commit `fe841b6d`)
> **To:** the parallel session that landed #1564 (N-tier Skills Framework) / #1565 (launchBlockers consume) / #1566 (eval looseners)
> **Date:** 2026-06-13
> **Purpose:** Lock in the visual-and-data contract between your structural Skills Framework work and the upcoming mastery-heatmap renderer in the CourseReDesign follow-on epic. Read once, no action needed today — picks up when you've finished the framework round.

## What I'm flagging

Your N-tier Skills Framework (#1564) is the structural backbone we want to render in the educator-facing **mastery heatmap** UI that's queued for the CourseReDesign follow-on epic ("Designer Renderers v2 + Snapshot Tab"). The educator's mental model — and the request we got from the operator — is:

> *"Show me a Skill, let me drill into Tier, drill into LO, drill into per-learner trajectory — same visual idiom at every level."*

That maps 1:1 onto your hierarchy:

```
Course (#1555 epic context)
  └─ Skill            (your SKILL-NN headings, N-tier)
       └─ Tier         (Emerging / Developing / Secure today; N-tier-table-form per #1564)
            └─ LO       (descriptor / behaviour per tier)
                 └─ Per-learner mastery state  (CallerAttribute `lo_mastery:{moduleId}:{loRef}`)
```

The renderer wants four data invariants from your work; if any change as you keep iterating, please ping me and I'll re-scope. Detail below.

## Three views, one component — Course Details / Cohort / Single Learner

Same heatmap primitive (9-cell sparkline strip + tooltip + drill) renders in **three lenses**, each with different cell semantics:

| Lens | Where | What a cell means | Hierarchy expansion |
|---|---|---|---|
| **Course Details** | `/x/courses/[id]` (educator's structural view) | "Does this LO exist in the curriculum / what's its tier band / how taught" — structural, no learner data yet | Skill ▸ Tier ▸ LO. Used to *design* the framework. |
| **Cohort View** | `/x/courses/[id]/learners` (or follow-on Snapshot tab equivalent) | "% of cohort that have mastered this LO" or "mean mastery score" across the cohort over time | Skill row aggregates all tiers; tier row aggregates all LOs; LO row shows cohort distribution sparkline |
| **Single Learner** | `/x/callers/[id]?v=3` (Snapshot tab, follow-on epic) | "This learner's mastery score, call-by-call" — time × call number | Same hierarchy, but cells are per-call mastery readings for one learner |

The component is the **same**; the three lenses differ in (a) data source, (b) cell color/value scale, (c) tooltip copy. We keep the visual idiom identical so educators recognise the pattern immediately when they move from "designing my course" → "watching my cohort" → "auditing one learner".

## The visual idiom (so you can sanity-check it against #1564's shape)

Same 9-cell sparkline-style heatmap strip at every layer, lazy-unfolded:

```
SKILL-03 · Lexical Resource                                ⌃ collapse
   cohort:  ▂▃▃▄▄▅▅▅▅   48% mastered
   ┌─ Tiers ─────────────────────────────────────────────────────────┐
   │  Emerging      ▇▇▇▇▇▇▇▇▇  94% (16 of 17 learners ≥ Emerging)    │
   │  Developing    ▃▄▄▅▅▆▆▆▇  68% (11 of 17)        ⌄ expand        │
   │  Secure        ▁▁▂▂▂▃▃▃▃  31% (5 of 17)         ⌄ expand        │
   │     ┌─ Developing LOs (drill open) ────────────────────────┐   │
   │     │  LO-03A "use synonyms for common topics"  ▇▆▆▆▆▅▅▅▅ │   │
   │     │  LO-03B "paraphrase when stuck"           ▃▃▄▄▄▅▅▅▆ │   │
   │     │  LO-03C "less reliance on common words"   ▁▁▂▂▂▃▃▃▃ │   │
   │     │  → click LO row → per-learner heatmap                │   │
   │     └──────────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────────────┘
```

The 9-cell strip displays whatever axis is most useful at that lens × layer:

| Lens | Skill row | Tier row | LO row | Cell semantics |
|---|---|---|---|---|
| **Course Details** | static colour (designed) | static colour | static colour | tier-band colour from the framework spec — no learner data; the strip is symbolic |
| **Cohort** | time × % of cohort at-or-above tier | time × % of cohort that have mastered any LO in this tier | time × % of cohort that have mastered this LO | mastery diffusion across the cohort |
| **Single Learner** | aggregate trajectory across skill | aggregate across tier | call-by-call mastery on this LO | personal progression |

Tooltip copy adapts per lens. Click affordances stay identical (expand / collapse / drill into next level).

## 4 invariants we'll consume — please don't break these silently

1. **Skill identifier is stable + addressable.** The renderer needs `SKILL-01`-style stable IDs that survive course edits. Today these come out of `parseSkillsFramework` in `apps/admin/lib/wizard/project-course-reference.ts`. If you ever switch to UUIDs / DB-rowids, give us a logical-id resolver helper (mirror of `lib/curriculum/resolve-module.ts`).
2. **Tier ordering is preserved.** Emerging → Developing → Secure is the canonical bottom-to-top order. The N-tier-table-form change in #1564 widens this past 3 — fine — but please publish the canonical order somewhere we can import (an `as const` array would be enough). The heatmap renders rows in that order.
3. **LOs roll up to a single tier per skill.** An LO belongs to one Tier of one Skill — not multiple. If that ever loosens (e.g. an LO crosses tiers), we need a roll-up rule before the renderer can compute "% of learners ≥ this tier". A short JSDoc on whichever function emits the LO→Tier link is enough.
4. **Mastery state stays on `CallerAttribute lo_mastery:{moduleId}:{loRef}`.** The recent canonical-key migration is on the goals-progress side; the renderer reads from `lo_mastery:*` directly. If projection ever proposes moving mastery state elsewhere, please loop me in — it's load-bearing for the heatmap drill and would also affect S1's `PIPELINE_STATE_SECTION_LOADERS` (`loMastery → ["callerAttributes"]`).

## What we'll contribute back (so you know the shape)

The renderer + its three lenses sit in the **follow-on epic** — `docs/draft-issues/followon-designer-renderers-v2.md`, **Group A → `loMastery` renderer**, plus the Snapshot tab "LO mastery (heatmap)" block, plus a new Cohort view block. The roll-up arithmetic is ours; we'll consume your hierarchy. Slice estimates (revised for three lenses):

| Slice | Effort | Lens | Status |
|---|---|---|---|
| Heatmap component primitive (the 9-cell strip + tooltip + drill) — Storybook-first, lens-agnostic | S (3h) | (all) | queued in follow-on epic |
| **Course Details lens** — Skills + Tiers + LOs structural view; no learner data | S (3h) | Course Details | queued |
| **Cohort lens** — Skill row aggregating cohort %; tier + LO drills | M (5h) | Cohort | queued |
| **Single Learner lens** — Snapshot block, per-call trajectory | S (3h) | Single Learner | queued; also part of Snapshot tab work |
| Tier unfold (shared across lenses) | S (3h) | (all) | queued |
| LO unfold + drill (shared) | M (6h) | (all) | queued |

Not blocked on you — but if your Skills Framework iteration changes any of the 4 invariants above, please ping so I can re-scope before grooming.

## Where it interlocks with the CourseReDesign foundation (just-shipped #1556)

S1 (#1556 / merged commit `fe841b6d`) introduced a `ComposeSection` taxonomy. The `loMastery` section (`PIPELINE_STATE_SECTION_LOADERS["loMastery"] = ["callerAttributes"]`) is the slot the renderer will plug into. Three downstream stories from the foundation queue gate the renderer:

| Story | Why it gates the heatmap |
|---|---|
| **#1557 S2** field staleness | Lets the educator see when their LO list is stale vs the latest learner mastery state — banner-level signal in the heatmap header |
| **#1558 S3** section-scoped regen | "Regenerate just this skill's LO mastery section" — actionable from the heatmap |
| **#1559 S4** Designer shell + `PREVIEW_RENDERERS` registry | The renderer registers under `loMastery` here once S4 ships |

You don't need to touch any of these — they're queued for me. Just FYI so you know the path.

## Quick consistency check you can run on your side

If you want a 30-second test that #1564's parser still aligns with the renderer's expectations: run `parseSkillsFramework` against `a-sample-docs/course-reference-template.md`'s `## Skills Framework` block and confirm the result shape carries (a) stable skill IDs, (b) tier-ordered descriptors, (c) clear LO → Tier attribution. If any of those three are degraded or planned to change, drop a note in this file under "Drift detected" and I'll re-shape the renderer brief.

## Open questions — RULINGS (2026-06-13, post-merge of #1564/#1565/#1566)

1. **N-tier ordering — operator-defined PER SKILL, not per playbook.**
   **Ruling:** the canonical tier-order list lives on each `ParsedSkill.tierScheme` array
   (see `apps/admin/lib/wizard/project-course-reference.ts::parseSkillsFramework`).
   It is **per-skill, not per-playbook** — different skills inside the same playbook
   MAY declare different schemes (e.g. a course can mix CEFR for SKILL-01 with the
   `cto` 4-tier for SKILL-02). The previous draft of this doc implied
   "single scheme per playbook" — that was wrong; tech-lead caught it before grooming.
   The renderer reads `tierScheme` from each skill, not a course-level summary.

   `KNOWN_TIER_SCHEMES` (in `project-course-reference.ts`) registers `three`, `cto`,
   and `cefr`. Unrecognised schemes are accepted with a
   `SKILL_UNRECOGNISED_TIER_SCHEME` warning. Heatmap rows render in each skill's
   `tierScheme` order.

2. **Empty tier rows — render with placeholder, never hide.**
   **Ruling:** when a tier has 0 descriptors, render with
   `"(no descriptors yet — add to course-ref)"`. Hiding leaves the educator unable
   to see what the projection's drift indicator could surface ("you declared 4 tiers
   but only filled 3"). The placeholder is also necessary for the Source Lineage
   lens which compares declared-vs-projected counts.

3. **Launch blockers + heatmap — render with DRAFT watermark.**
   **Ruling:** when `Playbook.status === "DRAFT"` (typically because PR #1565's
   launchBlockers fired), the heatmap renders WITH a `DRAFT` watermark badge.
   Matches the Course Design Console Preview lens's existing DRAFT-mode treatment.
   Hiding would leave the educator with no visual to confirm what fixing the
   course-ref will produce — they need to SEE the heatmap shell to know whether
   their fix worked.

## Drift detected

(none — invariants below were verified against the as-merged shape of #1564.)

## Invariants — confirmed shape (post-merge of #1564)

The 4 invariants the renderer depends on, restated against the actual code shape:

1. **Stable skill IDs.** `ParsedSkill.ref` is the `SKILL-NN` stable ID — emitted by
   `parseSkillsFramework` in both heading-form and table-form parsing paths.
   The new `resolveSkillByLogicalId(playbookId, skillRef)` helper landing in
   Stream A-B mirrors `lib/curriculum/resolve-module.ts::resolveModuleByLogicalId`
   — refuses unscoped lookup, throws on empty `playbookId`.

2. **Tier ordering preserved.** Per-skill `tierScheme` array IS the canonical order.
   The renderer iterates rows in `tierScheme` order (bottom = first entry, top = last).
   Rule 1 above corrects the earlier "single scheme per playbook" mis-statement.

3. **LO → Tier 1:1.** Stream A-B adds a parse-time `SKILL_LO_MULTI_TIER` validation
   warning to `parseSkillsFramework` when the same `outcomeRef` appears under
   multiple tiers within one Skill. First-wins resolution; warning surfaces in
   the projection result's `validationWarnings` array so the Skills Framework
   inspector can render an inline warning chip.

4. **Mastery storage on `CallerAttribute lo_mastery:{moduleSlug}:{loRef}`.**
   Canonical post-#611 + #1561 work. PR #1561 hardened the read side; this is
   load-bearing for the heatmap drill.

   **Important `useFreshMastery` fork:** when `Playbook.config.useFreshMastery === true`
   (Exam Assessment courses), mastery lives on `Call.scratchMastery` per-call,
   NOT on `CallerAttribute lo_mastery:*`. The heatmap's data-fetch layer MUST
   branch on this — naive read = empty mastery on Exam Assessment courses.
   See `apps/admin/lib/curriculum/scratch-mastery.ts`.

## TL;DR for the next session that opens this file

- Your Skills Framework hierarchy from #1564 is the data scaffold; the educator-facing **mastery heatmap** consumes it across **three lenses** — Course Details, Cohort, Single Learner — using one shared primitive.
- 4 invariants we depend on — don't break silently (stable skill IDs, tier order, LO→Tier 1:1, mastery on `CallerAttribute lo_mastery:*`).
- Renderer lives in the CourseReDesign follow-on epic; not blocked on you; ping me if any of the 4 invariants shift.
- 3 open questions worth your ruling: N-tier ordering source, empty-tier handling, DRAFT-mode rendering.

## References

- This handoff: `docs/draft-issues/handoff-skills-framework-heatmap.md`
- Follow-on epic scope: `docs/draft-issues/followon-designer-renderers-v2.md` (Group A `loMastery` renderer + Snapshot tab heatmap block)
- Foundation epic just shipped: #1555 epic, #1556 S1 (commit `fe841b6d`)
- Your work: #1564 N-tier Skills Framework, #1565 launchBlockers consume, #1566 eval looseners
- Course-ref Skills Framework spec lives in `a-sample-docs/course-reference-template.md` lines 252+ ("## Skills Framework")
- Parser implementation: `apps/admin/lib/wizard/project-course-reference.ts::parseSkillsFramework`

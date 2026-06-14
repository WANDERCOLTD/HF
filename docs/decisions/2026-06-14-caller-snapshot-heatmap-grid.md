# ADR: Per-LO mastery heatmap — fixed 4-cell grid on the Snapshot tab

**Date:** 2026-06-14
**Status:** Accepted
**Deciders:** Paul W
**Story:** Epic #1606 Group C #16 — Per-LO heatmap drill from Modules on caller Snapshot v3
**Prerequisites:** S5 `?v=3` Snapshot beta route (#1594) merged · SP4-C per-LO drill (#1586) merged · `/api/callers/[callerId]/lo-mastery` route shipped · `lib/banding/tier-colors` shipped

## Context

Group C of Epic #1606 ships the Snapshot tab content at `/x/callers/[id]?v=3`.
The biggest visual surface is the per-LO mastery heatmap — every Learning
Objective for every module in the learner's enrolled curriculum, rendered
as a tier-banded grid so an educator can scan the whole course at a glance
and click into any single LO to see the evidence trail behind its score.

The parked design from the 2026-06-14 Renderers v2 closeout
(`memory/project_renderers_v2_session_2026_06_14.md`) sketched a fixed-grid
pattern. This ADR locks it down: visual contract, data wiring, empty
states, click-into behaviour, performance budget, and how it slots into
the Snapshot tab's compose hierarchy.

The alternative we rejected upfront: an "expanders" pattern where each LO
row can grow to show its mastery + evidence inline. That breaks the
horizontal scan property — the educator's eye has to re-find the column
alignment after every expansion. The fixed grid keeps every row at the
same width and uses a side panel for evidence, paying for the consistency
with one extra slot allocation per page.

## The grid (locked visual contract)

```
LO mastery — Beckett — Calculus 1
                    FOUND   DEVEL   PRACT   DIST    Score
─── Module 1 ─── (avg 0.61)
  LO-01 chain rule  ░░░░░   █████   ░░░░░   ░░░░░   0.42 ↗ Call 7
  LO-02 limits      ░░░░░   ░░░░░   █████   ░░░░░   0.71 ↗ Call 5
  LO-03 derivatives ░░░░░   ░░░░░   ░░░░░   █████   0.92 → Call 8
─── Module 2 ─── (avg —)
  LO-01 integrals   ╌╌╌╌╌   ╌╌╌╌╌   ╌╌╌╌╌   ╌╌╌╌╌   Awaiting evidence
  LO-02 substitution█████   ░░░░░   ░░░░░   ░░░░░   0.18 ↘ Call 6
```

### Decisions baked into the visual

- **4 fixed cells per row, same width across every row in the page.** The
  column count matches the canonical tier set
  (`FOUNDATION / DEVELOPING / PRACTITIONER / DISTINCTION`). This matches
  the default tier scheme; courses with `scoringTierScheme = "5-level"`
  render 5 columns. Tier count is determined per page from
  `Playbook.config.scoringTierScheme` and applies to every row uniformly
  (we do NOT vary column count per LO — that would re-break horizontal
  scan).
- **Active cell = solid tier-mapped colour** from `lib/banding/tier-colors`.
  Cold→hot palette identical to the Skill Bands cards on Attainment
  (#1580 SP4-A). Visual continuity is intentional: an educator should
  recognise "this is the same scoring model" without a legend.
- **Inactive cells = 1px outline only** using `--surface-border`. No
  fill, no hover state (only the active cell is hover-targetable). Keeps
  the grid quiet so the lit cells dominate.
- **Awaiting-evidence rows = dashed border across all 4 cells** plus
  "Awaiting evidence" in the Score column. The dashed grid is uniform
  (still 4 cells wide) so column alignment never breaks. Maps to the
  loader's `status: "not_started"` from `/api/callers/[callerId]/lo-mastery`.
- **Module header = sticky subhead row** with the module-level average
  mastery score (computed as `mean(LO.mastery)` across non-not-started
  LOs in that module; `—` when all LOs are not_started). Sticky so the
  educator scrolling a long curriculum keeps context. Sticky offset
  matches the existing AttainmentTab pattern.
- **Click cell → side panel** opens on the right, reusing SP4-D's
  `progressMetrics.evidence[]` shape verbatim — same component, same
  formatting, same EXPLICIT/INFERRED pill. No new API route; the panel
  fetches `/api/callers/[callerId]/skills-evidence?loRef=...&moduleId=...`
  (same shape sister #1576 shipped for skill-grain). Closes on Escape,
  on outside click, on second click of the same cell, or when the
  educator clicks a different cell (panel content swaps without
  re-opening). Selected cell carries an outline-ring state so the
  educator can see which row populates the panel.
- **Hover cell = tooltip** with three lines: score (0-1 to 2dp), trend
  arrow (↗ ↘ → → derived from `progressMetrics.delta` if present, else
  no arrow), and last-call reference ("Call 7" — `sourceCallId` short
  form). Tooltip stays out of the way of clicks; click goes to the side
  panel as the primary action.

## Data wiring (reuse over reinvention)

| Need | Existing surface | Reuse strategy |
|---|---|---|
| Per-LO `tier`, `mastery`, `status`, `bandLabel`, `updatedAt` | `GET /api/callers/[callerId]/lo-mastery?moduleId=…` (SP4-C #1586) | Call once per module on Snapshot mount; renderer pivots the response into the grid. **Cap is one round-trip per visible module** — same `Promise.all` pattern as Attainment tab's module fetch. |
| Tier labels + colour mapping | `lib/banding/tier-colors::tierLabel + getSkillTierMapping` | Already course-aware via `Playbook.config.scoringTierScheme`. Heatmap pulls the resolved mapping once and renders all rows with it. |
| `useFreshMastery` branching | `/lo-mastery` route already handles the branch; returns mastery from `Call.scratchMastery` when set | No new logic — the heatmap renders whatever the route returns, including the "all not_started after mock reset" empty state. |
| Cell-click evidence | `GET /api/callers/[callerId]/skills-evidence?loRef=…` (#1576 sister) | Lazy-fetched on cell click; component reuses the SP4-D GoalsSection evidence renderer (same `progressMetrics.evidence[]` shape). |
| Module list + order | `GET /api/callers/[callerId]/attainment` (SP4-A) — already returns `modules[]` with `id, slug, title` | The Snapshot landing tab (#15) calls this anyway for the Snapshot's Modules section; the heatmap reuses the same payload so we don't double-fetch. |

**No new API routes for #16.** The route inventory holds steady at the
SP4-A / SP4-C / #1576 set. Group C #17 will add `/api/callers/[id]/sub-skills`
but that's a separate story.

## STUDENT scope inheritance

The heatmap is STUDENT-readable for the learner's own caller because the
underlying routes already are (`studentAllowedToReadCaller` at
`/lo-mastery` and `/attainment` per SP4-A). No new auth wiring; the
Snapshot tab inherits the same gate.

The heatmap is OPERATOR+ for any other caller. Same matrix as Attainment.

## Performance budget

For a typical 8-module course with ~6 LOs per module on a fresh page load:
- 1 `/attainment` call → modules + skill bands + goals (single round-trip)
- 8 `/lo-mastery?moduleId=…` calls → one per module, fired in parallel
  (`Promise.all`)
- 0 evidence calls until the educator clicks a cell — then 1 per click

Total cold-load: **9 parallel requests** to render the full heatmap. The
existing Attainment tab fires the same shape (1 + per-module-on-expand);
this just fires the per-module ones eagerly because the Snapshot's primary
job is "everything visible at once". The lo-mastery route is indexed on
`callId + callerId + curriculumModuleId` so per-module reads are O(LO
count) — acceptable on the 6-LO median.

If a course grows past ~40 modules, we switch to viewport-based lazy fetch
(IntersectionObserver on the sticky module headers). Not in scope for
the first slice.

## Empty states locked

| Scenario | Render |
|---|---|
| No modules in curriculum yet | Module-grid omitted entirely; the Snapshot's other sections (skill bands, goals, "Why this call?") still render. Heatmap not rendered until at least one CurriculumModule exists. |
| Curriculum exists but no calls yet (Call 1 path) | Every LO row = dashed-border "Awaiting evidence". Module header shows `(avg —)`. Educator can still see the LO ladder to anticipate what's coming. |
| `useFreshMastery: true` mid-mock (Exam Assessment) | `/lo-mastery` returns scratch values; heatmap renders them with the same tier mapping. A small lozenge above the heatmap reads "Showing mock-exam scratch mastery — resets at end of session" so the educator doesn't conflate scratch with long-term ratchet. Lozenge text comes from the `/lo-mastery` route's existing `useFreshMastery: true` flag — no new copy. |
| Side panel opened but `skills-evidence` returns `evidence: []` | Panel renders "No evidence recorded for this LO yet" (muted), plus the LO's `description` + `masteryThreshold`. Click-through still feels intentional, not broken. |

## Where it lives in the Snapshot compose

The Snapshot landing tab (#15) composes from existing data:
1. Header: trajectory sparklines + adapt panel (reuses existing components)
2. **LO Heatmap** (this ADR — Group C #16)
3. Sub-skill cards (Group C #17 — DISC/COACH/COMP per-learner cards)
4. "Why this call?" panel (Group C #18)
5. Goals + evidence trail (reuses SP4-D)

The heatmap is the 2nd surface down because mastery state is the educator's
primary "where are they at" question. Sub-skill cards (3rd) add the
"why are they doing what they're doing" layer; "Why this call?" (4th) is
the system's reasoning. This ordering matches the educator's question
hierarchy.

## Out of scope (deferred to follow-on stories)

- **Vertical timeline of mastery changes per LO** — too dense for the
  heatmap surface; if it's needed, it belongs in the side panel or its
  own lens.
- **Cross-caller cohort heatmap on this surface** — the
  Course Skills tab's `Cohort Heatmap` lens (SP2 + #1581 cell drill)
  already covers cohort-grain. The Snapshot heatmap is single-caller.
- **Edit / override mastery from the heatmap** — read-only. Mastery
  overrides go through the Adaptations tab (SP5).
- **Sparkline per LO** — score history is shown in the side panel via
  `progressMetrics.evidence[]`, not inline. Adding sparklines to every
  row would reintroduce the horizontal-scan problem the fixed grid is
  designed to prevent.

## What changes after this ADR ships

Nothing in code. The ADR captures the design. Group C #16 implementation
PR builds against this spec.

## Open questions deferred to implementation

- **Sticky-header z-index** when stacked under the existing tab header.
  Trivial CSS choice; pick during implementation.
- **Tooltip portal vs in-tree render.** Existing AttainmentTab uses
  in-tree; if the heatmap's sticky module headers cause clipping, switch
  to a portal. Decide when we hit it.
- **Animation on cell selection.** Outline-ring + side-panel slide is
  the default; if motion-reduce preference is set, swap to instant. No
  new infrastructure — `prefers-reduced-motion` is already wired in
  `app/globals.css`.

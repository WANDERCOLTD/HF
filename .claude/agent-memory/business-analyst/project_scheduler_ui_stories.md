---
name: Scheduler v1 UI stories
description: Groomed UI surface stories for Scheduler v1 epic (#154) — dual-mode requirement, sequencing, reuse findings
type: project
---

Three UI stories written 2026-04-14; Track A retrieval story written 2026-04-15.

**Why:** Slice 1 (event-gate) and Slice 2 (selectNextExchange) land no educator-visible UI. The UI stories add the visibility layer. Track A wires the MCQ injection.

**Critical constraint:** Every surface must work for BOTH continuous-mode (scheduler-driven) and n-session/structured courses (session-spec-driven). Single component, two data adapters.

## Stories
- #154 — Slice 1 event-gate + placeholder decision (SHIPPED commit 3d12a028)
- #155 — Slice 2 selectNextExchange + policy framework (OPEN, Sprint 2)
- #156 — Slice 3 interleave + spacing integration (OPEN, Sprint 2)
- #157 — Caller page sparklines + call strip (no Slice 2 dependency, safe to land first)
- #158 — Caller page "Next exchange" panel (depends on #155 Slice 2 for real outcomeId/reason)
- #159 — Course page "Current Focus" strip + LO Coverage tree (partial n-session path before #155; full story after)
- #164 — Track A retrieval practice: mode:assess → MCQ injection, frequency keyed on teachingMode (depends on #155) — SPIKE
- #165 — Event-triggered surveys + Track B pre/post bookends (depends on #155) — NEW 2026-04-15
- #166 — Wizard soft-cap budget + preset picker (depends on #155) — NEW 2026-04-15

## Sprint 2 sequence (per 2026-04-15 re-groom)
#155 → #164 (spike) → #165 → #166 → #156 → #157 → #158 → #159

## Decisions that changed the arc (2026-04-15)
- CourseArchetype epic deferred — preset picker in #166 keys on existing `teachingMode`, not archetypes
- Phases 5–6 (DAG editor, Module→Outcome migration) deferred post market-test
- Transcript classifier deferred — `mode` flag gating is sufficient for market test

## Key reuse findings
- `Sparkline` component exists at `components/shared/Sparkline.tsx` — reuse for all sparklines
- `LearningTrajectoryCard` already renders per-parameter sparklines for non-knowledge profiles — do not duplicate
- `proof-points/route.ts` already batch-fetches `CallerModuleProgress` — use as aggregation template
- `ContinuousProgrammeView` already on Journey tab — Surface A strip slots above it, not replacing it
- `GenomeBrowser` exists — Surface B adds a toggle, does not replace it
- `isContinuousMode()` heuristic (entries.length === 1 && type === 'continuous') should be extracted to `lib/lesson-plan/session-ui.ts` — currently duplicated inline in page.tsx:1075

## Key gaps confirmed
- No per-call scheduler decision storage yet (Slice 1 only writes :last key) — mode column degrades gracefully
- No `GET /api/courses/:courseId/current-focus` route exists
- No `GET /api/courses/:courseId/lo-coverage` route exists
- No `GET /api/callers/:callerId/module-progress` route with per-LO history exists
- No LO-level state badges (mastered/frontier/in-rotation/locked) in GenomeBrowser

**How to apply:** When grooming further scheduler stories, check these gaps as completed before writing new stories.

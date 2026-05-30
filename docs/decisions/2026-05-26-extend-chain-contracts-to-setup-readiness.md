# ADR: Extend the chain-contract pattern to setup readiness

**Date:** 2026-05-26
**Status:** Proposed (deferred — revisit when HF supports 3+ course types beyond IELTS)
**Deciders:** Paul Wander, HF team

> **Deferral note (2026-05-26):** The chain-extension pattern is architecturally sound but overengineering for the current need (IELTS Speaking + one non-IELTS course type). The blast radius (new spec, audit-harness extension, panel restructure, ~39h epic) does not pay back when only two course shapes need support. The minimum-viable path — fix the "Ready to Teach" gating lie (#884), add a single `scoring_scheme_configured` check to the existing `COURSE-READY-001` spec (#887), gate band-stripping on an IELTS-shape detector (#889) — delivers the same teacher-facing outcome for ~10h. Promote this ADR back to **Accepted** when a third course type lands (CEFR, K12 mastery, NHS bands, etc.) and the elegant pattern earns its keep.

## Context

Epic 100 Phase 1 (closed 2026-05-25) established the **runtime adaptive loop** as a contract chain:

```
EXTRACT → AGGREGATE → MEASURE → REWARD → ADAPT → SUPERVISE → COMPOSE
```

Each stage has a spec contract, an evidence counter, and cross-stage invariants verified by `apps/admin/scripts/audit-epic-100.ts` (11 counters, CI step 6). Verdict on 2026-05-25: GREEN. The pattern caught the #607, #611/#614, and #615 classes of bug at audit time instead of in production. See `docs/CHAIN-CONTRACTS.md`.

**Setup readiness is architecturally orphaned from this pattern.** Today:

- `lib/domain/course-readiness.ts` loads `COURSE-READY-001-course-readiness.spec.json` with 4 static checks (`assertions_reviewed`, `lesson_plan_set`, `onboarding_configured`, `prompt_composed`)
- No evidence counters
- No cross-step invariants
- No audit harness coverage
- Checks can pass independently and contradict each other

**Two observed consequences:**

1. **The "Ready to Teach lying" bug** (visible in the Course Setup panel as of 2026-05-26): "Ready to Teach" shows green while "Content Uploaded" is still in progress. The panel banner contradicts the stage badge. No invariant enforces `ready_to_teach ⇒ all prior steps`.
2. **IELTS-shaped readiness** — the 4 checks were authored against IELTS Speaking's needs. A non-IELTS course (e.g. "The Black Death" English Comprehension worksheet) has no first-class gate for *scoring scheme / rubric / banding*, so the panel reports green even when a rubric is missing.

The deeper issue is that setup and runtime are two halves of the same teacher-facing progress story, but they sit on incompatible foundations.

## Decision

**Formalise a `SETUP` cluster in `docs/CHAIN-CONTRACTS.md` and apply the Epic 100 Phase 1 chain-contract pattern to setup readiness.**

Every setup gate becomes:

- A **contract** (one `.contract.json` per gate)
- An **evidence counter** fed into `audit-epic-100.ts` (e.g. `setupGap.scoringSchemeMissing`)
- A **cross-step invariant** (e.g. `ready_to_teach ⇒ ∀ prior step done`)
- A **course-type-aware check** (different gates fire for IELTS-shaped vs comprehension vs skill-tier courses)

Setup is a **one-time lifecycle** cluster; runtime is a **per-call lifecycle** cluster. Both clusters live in the same chain doc, use the same audit harness, and surface through a single unified Progress panel that shows setup readiness (one-time gates) above runtime cohort progress (continuous, learner data).

## Consequences

**Positive:**

- **Fail-loud setup gates** — the "Ready to Teach lying" bug becomes structurally impossible. Invariant violations fail the CI audit (per #819 fail-loud rule).
- **Single architectural model** — devs reason about setup and runtime through the same primitives (contract / counter / invariant / audit). New gates added in one place, surfaced consistently.
- **Course-type generality** — first-class support for non-IELTS courses without forking the panel. The `SCORING-SCHEME-V1` contract switches its check by course-type classifier (bands / mastery / tiers), so Black Death gets the right gate without touching IELTS Speaking's gate.
- **Teacher UX consolidation** — Tolerances panel + Skill Banding panel + Course Setup panel collapse into one Progress panel, each existing panel becoming an expand-on-click of its parent step.
- **AI-fill-in via existing tray** — "Suggest defaults" per step emits `pendingChange` entries with `aiSuggested: true`, reusing the entire #874 / #878 / #879 guard chain. No new human-gate plumbing.
- **Auditable across the lifecycle** — the same harness validates that setup-time invariants survive runtime; e.g. a course can't have `ready_to_teach=true` and runtime `lo_unmeasured_count > N` without raising a flag.

**Negative / Trade-offs:**

- **One-time refactor cost** — `COURSE-READY-001` is replaced by `COURSE-READY-002` (chain-shaped). ~39h epic; cannot ship piecemeal without first landing the spec.
- **Harness footprint grows** — `audit-epic-100.ts` was scoped to 11 runtime counters; setup adds ~6 more. Doc and CI hygiene needs to scale.
- **Mental load for contract authors** — every new setup gate now requires the full contract bundle (spec + counter + invariant + test), not just a check function. Higher floor for change.
- **Invariant scope creep risk** — tempting to wire cross-lifecycle invariants too aggressively ("learner stalled at module X ⇒ setup misconfigured"). Need explicit boundary: invariants stay within their cluster unless ADR'd otherwise.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Patch `COURSE-READY-001` in place — fix the lying bug, add a `scoring_scheme` check, leave architecture alone | Doesn't fix the underlying issue (no invariants), accumulates more drift between setup and runtime. The bug recurs whenever a new check is added. |
| Build a parallel "setup chain" with its own doc, counter, and audit script | Two-system overhead. Devs would need to remember which lifecycle has which guarantees. Defeats the unification motive. |
| Replace `COURSE-READY-001` with hardcoded TypeScript checks | Loses spec-driven shape. Course-type variations become a forest of `if` statements. Violates "Configuration over Code." |
| Treat the panel bug as a one-off UI fix; defer architectural work | Real risk: same class of bug recurs on every new course-type added. The chain-contract pattern earned its keep on runtime; the same payoff applies here. |
| Use `Goal.progress` (runtime construct) for setup gates | Conceptually wrong. `Goal.progress` is 0–1 continuous per-learner; setup is per-course boolean. Forcing one shape on the other muddies both. |

## Related

- `docs/CHAIN-CONTRACTS.md` — the existing runtime chain doc; `SETUP` cluster lands here
- `apps/admin/scripts/audit-epic-100.ts` — the audit harness to extend
- `docs/decisions/2026-05-22-tolerance-placement.md` (#822) — `@bucket` tags on PlaybookConfig fields; aligns with course-type classification
- `apps/admin/lib/domain/course-readiness.ts` — current readiness loader to be migrated
- `docs-archive/bdd-specs/COURSE-READY-001-course-readiness.spec.json` — current spec; superseded by `COURSE-READY-002`
- Epic 100 Phase 1 close-out (2026-05-25): MEMORY.md and chain audit verdict GREEN
- Pending-changes tray architecture: #854 / #874 / #878 / #879 / `.claude/rules/ai-to-db-guard.md`
- The Course Setup panel bug ("Ready to Teach" lying) as observed 2026-05-26 — S0 stopgap (#884) shipped before this ADR's landing

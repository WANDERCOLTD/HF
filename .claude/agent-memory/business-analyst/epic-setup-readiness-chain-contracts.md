---
name: Epic 883 — Extend chain-contracts to setup readiness
description: 7-story epic applying Epic 100 chain-contract pattern to setup readiness + unified Progress panel. Issues #883–#890.
type: project
---

# Epic #883: Extend chain-contracts to setup readiness (unified Progress panel)

**ADR:** `docs/decisions/2026-05-26-extend-chain-contracts-to-setup-readiness.md`

## Story map

| Issue | Title | Effort | Deps |
|-------|-------|--------|------|
| #884 | S0 — Fix "Ready to Teach" gating lie (stopgap) | ~2h | — |
| #885 | S1 — Define COURSE-READY-002 spec + CHAIN-CONTRACTS.md SETUP cluster | ~6h | S0 |
| #886 | S2 — Setup checks → contracts + evidence counters; extend audit-epic-100.ts | ~8h | S1 |
| #887 | S3 — Course-type classifier + SCORING-SCHEME-V1 contract | ~6h | S1 |
| #888 | S4 — "Suggest defaults" per step via pending-changes tray (aiSuggested: true) | ~6h | S2, S3 |
| #889 | S4b — Gate wizard-ai-output-guard.ts band-stripping on IELTS detector | ~3h | S3 |
| #890 | S5 — Unified Progress panel: setup half + runtime half | ~8h | S2, S3 |

Total: ~39h

## Key files involved
- `lib/domain/course-readiness.ts` — current readiness loader (S2 extends)
- `lib/domain/course-type-classifier.ts` — new in S3
- `hooks/useCourseSetupStatus.ts` — client-side stage derivation (S0 patches, S5 extends to 7 stages)
- `app/api/courses/[courseId]/setup-status/route.ts` — server-side check (S0 + S2)
- `apps/admin/scripts/audit-epic-100.ts` — add ~6 setupGap.* counters (S2 + S3)
- `docs-archive/bdd-specs/COURSE-READY-002-course-readiness.spec.json` — new spec (S1)
- `docs/CHAIN-CONTRACTS.md` — new §3b SETUP cluster (S1 + S2 + S3)
- `components/shared/CourseSetupTracker.tsx` — extended to unified panel (S5)
- `lib/chat/wizard-ai-output-guard.ts` — band-stripping gated on course type (S4b)

## Non-negotiables
- IELTS non-regression: golden caller `f17d8616-3c31-4814-8de1-626fb42f16f6` (Nico Grant) must pass all new checks
- AI suggestions MUST use pending-changes tray with `aiSuggested: true` (guard chain #874/#878/#879)
- Slug-scope invariants: `resolveModuleByLogicalId` required for any CurriculumModule.slug touch

**Why:** `docs/decisions/2026-05-26-extend-chain-contracts-to-setup-readiness.md` — "Ready to Teach" reporting green with no content uploaded; IELTS-shaped checks falsely passing for non-IELTS courses.
**How to apply:** Start with S0 (2h stopgap — pickable immediately). S1 and S3 can run in parallel. S4b is a fast follow after S3.

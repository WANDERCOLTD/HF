# Shared TypeScript types between API routes and their consumers

**Date**: 2026-05-17
**Status**: Pilot (Phase 1) — see #428 for sweep plan
**Context**: Issue #428, prior incidents #418 / #420 / #424

## Decision

Every API route under `apps/admin/app/api/**/route.ts` exports its success-path
response shape as a TypeScript interface in a **colocated `types.ts`** file.
Both the route handler AND every client-side consumer (hook, component) import
this single source of truth.

```
apps/admin/app/api/courses/[courseId]/setup-status/
├── route.ts       ← imports + returns the typed shape
└── types.ts       ← single source of truth for the response

apps/admin/hooks/
└── useCourseSetupStatus.ts   ← imports the same type from the route folder
```

## Why

#418 shipped a "Curriculum: Authored / Derived" chip that silently never
rendered for ~6 hours in production. The client-side hook read
`activeCurriculumMode` from `/api/courses/[courseId]/setup-status` but the
route had stopped returning the field. **There was no compile-time link
between the two**, so the drift was invisible until manually reported.

- The `@api @response` JSDoc was the only spec — drifted from reality
- #424 / PR #426 added a *runtime* test that catches this at test time
- This ADR adds a **compile-time** check: drift → tsc error → PR fails CI
  before it can merge

The runtime test stays as belt-and-braces.

## Pattern (route side)

```ts
// app/api/courses/[courseId]/setup-status/types.ts
export interface SetupStatusResponse {
  ok: true;
  lessonPlanBuilt: boolean;
  // ...
  activeCurriculumMode: "authored" | "derived";
}

// app/api/courses/[courseId]/setup-status/route.ts
import type { SetupStatusResponse, SetupStatusErrorResponse } from "./types";

// Build payload as typed const FIRST, then pass to NextResponse.json.
// `NextResponse.json` itself accepts unknown — the typed const is what
// pins the shape. Missing/extra/renamed fields become tsc errors here.
const payload: SetupStatusResponse = { ok: true, /* ... */ };
return NextResponse.json(payload);
```

## Pattern (consumer side)

```ts
// hooks/useCourseSetupStatus.ts
import type { SetupStatusResponse } from "@/app/api/courses/[courseId]/setup-status/types";

// Use Partial/Omit/Pick to express subset relationships when needed.
// Here: callers can synthesise inline readiness (no `ok` field) and may
// pass partial shapes (legacy migration), so we use:
readiness: Partial<Omit<SetupStatusResponse, "ok">> | null;
```

When the route adds/removes/renames a field, the hook's import breaks at
compile time. No more silent runtime drift.

## Negative test (proves the discipline)

After the pilot landed, a deliberate mutation was tested:

1. Rename `activeCurriculumMode` → `currentMode` in `types.ts`
2. `npx tsc --noEmit` fails:
   - In `route.ts`: property doesn't exist on `SetupStatusResponse`
   - In `useCourseSetupStatus.ts`: the inline `readiness?.activeCurriculumMode` reads disappear from autocomplete
   - In `CurriculumSourcePill` / `ModeToggle`: their reads fail

This is exactly the early-fail behaviour #418 was missing.

## Out of scope (this pilot)

- Phase 2 sweep across every API route — separate follow-up issues per `/api` subtree
- Phase 3 enforcement (ESLint rule that every `route.ts` has a colocated `types.ts`)
- Removing `@api @response` JSDoc — that stays as human-readable docs
- Auto-generating types from OpenAPI / route handler return type — heavier change

## Related

- #418 — silently-shipped broken chip (root incident)
- #424 / PR #426 — runtime contract test (catches same drift at test time)
- #423 / PR #425 — VM branch-health (catches the WHERE-is-code variant)
- #428 — Phase 1 pilot tracking issue (this ADR's primary reference)

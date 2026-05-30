---
paths:
  - "apps/admin/app/api/**/*.ts"
---

# API Route Conventions

## Auth Pattern (Every Route)

```typescript
import { requireAuth, isAuthError } from "@/lib/permissions";

export async function GET() {
  const auth = await requireAuth("VIEWER"); // VIEWER | OPERATOR | ADMIN
  if (isAuthError(auth)) return auth.error;
  // ... handler logic
}
```

Every `app/api/**/route.ts` must call `requireAuth`. CI enforces coverage via a route-auth scanner test.

## Caller-scoped reads (multi-caller GET routes)

If a GET route admits STUDENT-level sessions (`requireAuth("VIEWER")` or lower — note `STUDENT` and `VIEWER` are both role level 1) AND accepts a `?callerId=` query param, you **must** scope it through `lib/learner-scope.ts::resolveCallerScopeForReading` before the Prisma `where`. Otherwise a logged-in learner can read any other caller's data by supplying the foreign UUID — the leak class fixed in #977.

```typescript
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";

export async function GET(req: Request) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const requestedCallerId = new URL(req.url).searchParams.get("callerId");
  const scope = await resolveCallerScopeForReading(auth.session, requestedCallerId);
  if (isScopeError(scope)) return scope.error;
  const callerId = scope.scopedCallerId; // STUDENT → own; OPERATOR+ → passthrough

  // ...use callerId in your where clause
}
```

STUDENT-only routes (`/api/student/**`) should use `requireStudentOrAdmin()` from `lib/student-access.ts` instead — it enforces STUDENT ↔ LEARNER linkage and is the canonical pattern for that namespace.

## Public Routes (no auth required)

`/api/auth/*`, `/api/health`, `/api/ready`, `/api/system/readiness`, `/api/invite/*`, `/api/join/*`

## Webhook Routes (secret-validated, no session auth)

`/api/vapi/*`, `/api/webhook/*` — validated via `lib/vapi/auth.ts`

## Sim Routes

All sim routes use `requireAuth("VIEWER")`.

## API Documentation

All routes must have `@api` JSDoc. After modifying any route.ts, update the JSDoc then run the API doc generator.

## Response Shape

Return `{ data, error }` shape from all API handlers.

## Validation

Use zod for request body validation in every handler.

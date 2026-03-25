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

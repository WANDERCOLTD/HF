---
paths:
  - "apps/admin/lib/permissions*"
  - "apps/admin/app/api/**/*.ts"
  - "apps/admin/middleware.ts"
---

# RBAC

**SUPERADMIN (5) > ADMIN (4) > OPERATOR/EDUCATOR (3) > SUPER_TESTER (2) > TESTER/STUDENT/VIEWER (1) > DEMO (0)**

- `EDUCATOR` (level 3) — educator portal, scoped to own cohorts + students
- `STUDENT` (level 1) — student portal, own data only
- `VIEWER` — deprecated alias for TESTER

Higher roles inherit lower permissions. Define role levels as constants, not magic strings.

Public routes are explicitly allow-listed. Every other route must call `requireAuth()`.

---
paths:
  - "apps/admin/prisma/**"
  - "apps/admin/app/api/**/*.ts"
  - "apps/admin/lib/**/*.ts"
---

# Database Patterns

## Prisma Best Practices

```typescript
// Prefer _count over denormalized counts
const items = await prisma.thing.findMany({
  include: { _count: { select: { children: true } } }
});

// Avoid N+1 — use include/select, never fetch-all + filter in JS

// Transactions for related writes
await prisma.$transaction(async (tx) => {
  const parent = await tx.parent.create({ data: parentData });
  await tx.child.createMany({
    data: children.map(c => ({ ...c, parentId: parent.id }))
  });
});
```

## Seed Data

Spec JSONs in `docs-archive/bdd-specs/` are seed data only. After seeding, DB owns the data.

## Config Import — Avoid TDZ Shadowing

```typescript
import { config } from "@/lib/config";

// const config = spec.config;  <- Temporal Dead Zone crash
// const specConfig = spec.config;  <- correct
```

Never shadow an imported name with a local variable of the same name.

---
name: hf-nextjs-patterns
description: HF-specific Next.js, Prisma, and TypeScript patterns. Use when writing API routes, database queries, AI calls, or UI components in the HF codebase. Auto-triggers on implementation work in apps/admin/.
allowed-tools: Read, Grep, Glob
---

# HF Next.js Patterns

> Reusable patterns for Next.js + Prisma + TypeScript in HF.

## Auth Pattern (Every Route)

```typescript
import { requireAuth, isAuthError } from "@/lib/permissions";

export async function GET() {
  const auth = await requireAuth("VIEWER"); // VIEWER | OPERATOR | ADMIN
  if (isAuthError(auth)) return auth.error;
  // ... handler logic
}
```

## Config Import — Avoid TDZ Shadowing

```typescript
import { config } from "@/lib/config";

// const config = spec.config;  <- Temporal Dead Zone crash
// const specConfig = spec.config;  <- correct
```

## Async Registry Pattern

```typescript
// Registry/cache helpers that may hit DB are always async
await Registry.get("key") // never sync Registry.get("key")
```

## AI Calls — Always Metered

```typescript
// import { getConfiguredMeteredAICompletion } from "@/lib/metering"
// Never import directly from "@/lib/ai/client"
```

All AI calls go through metered wrappers. ESLint enforces this. Direct client imports are banned. Never pass explicit maxTokens/temperature — use cascade.

## CSS — No Hardcoded Values

```typescript
// style={{ color: '#6b7280' }}       <- banned
// color: `${cssVar}99`               <- banned (hex opacity hack)
// className="text-muted"             <- correct
// color-mix(in srgb, var(--color) 60%, transparent)  <- correct for alpha
```

## RBAC Hierarchy

Higher roles inherit lower permissions. Define role levels as constants, not magic strings. Public routes (no auth) are explicitly allow-listed.

## Prompt Composition Pattern

Run data loaders in parallel. Use a template compiler with Mustache-style syntax (`{{variable}}`, `{{#if}}`, `{{#each}}`). Keep transform logic in named transform modules, not inline in the loader.

## Bugs to Avoid

| Bug | Wrong | Right |
|-----|-------|-------|
| TDZ shadowing | `const config = x.config` when `config` is imported | `const xConfig = x.config` |
| CSS alpha | `${cssVar}99` | `color-mix(in srgb, ${color} 60%, transparent)` |
| Missing await | `Registry.get("key")` | `await Registry.get("key")` |
| Hardcoded slugs | `"pipeline-001"` | `config.specs.pipeline` |
| Unmetered AI | direct client import | metered wrapper import |

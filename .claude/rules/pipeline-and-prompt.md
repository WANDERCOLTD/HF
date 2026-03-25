---
paths:
  - "apps/admin/lib/pipeline/**/*.ts"
  - "apps/admin/lib/prompt/**/*.ts"
  - "apps/admin/lib/contracts/**/*.ts"
  - "apps/admin/lib/bdd/**/*.ts"
---

# Pipeline & Prompt Composition

## The Adaptive Loop

```
Call -> Transcript -> Pipeline (EXTRACT -> AGGREGATE -> REWARD -> ADAPT -> SUPERVISE -> COMPOSE) -> Next Prompt
```

Every feature must respect this loop. Pipeline stages are spec-driven from `PIPELINE-001` in the DB.

## SpecRole Taxonomy

- `ORCHESTRATE` — Flow/sequence control (PIPELINE-001, INIT-001)
- `EXTRACT` — Measurement and learning (PERS-001, VARK-001, MEM-001)
- `SYNTHESISE` — Combine/transform data (COMP-001, REW-001, ADAPT-*)
- `CONSTRAIN` — Bounds and guards (GUARD-001)
- `OBSERVE` — System health/metrics (AIKNOW-001, ERRMON-001, METER-001)
- `IDENTITY` — Agent personas (TUT-001, COACH-001)
- `CONTENT` — Curriculum material (WNF-CONTENT-001)
- `VOICE` — Voice guidance (VOICE-001)

## Prompt Composition Pattern

Run data loaders in parallel. Use a template compiler with Mustache-style syntax (`{{variable}}`, `{{#if}}`, `{{#each}}`). Keep transform logic in named transform modules, not inline in the loader.

## Async Registry Pattern

```typescript
// Registry/cache helpers that may hit DB are always async
await Registry.get("key") // never sync Registry.get("key")
```

## Contracts

DB-backed DataContract registry with 30s TTL cache. All ContractRegistry methods need `await`.

## Hardcoded Slugs

Use `config.specs.*` — never hardcode spec slug strings like `"pipeline-001"`.

## AI Calls

All AI calls go through metered wrappers (`getConfiguredMeteredAICompletion`). ESLint enforces this. Never pass explicit maxTokens/temperature — use cascade.

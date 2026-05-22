---
paths:
  - "apps/admin/lib/pipeline/**/*.ts"
  - "apps/admin/lib/prompt/**/*.ts"
  - "apps/admin/lib/contracts/**/*.ts"
  - "apps/admin/lib/bdd/**/*.ts"
---

# Pipeline & Prompt Composition

## ⚠️ HARD RULE — read the canonical map first

**Before adding a stage, runner, cross-stage DB write, guardrail, or ADAPT sub-op, read [`docs/PIPELINE.md`](../../docs/PIPELINE.md) first.** It is the single source of truth for the 7-stage table, the executor map, the parallel-batch hardcode, the SUPERVISE clamp surface, and the landmines (including: stage name ≠ `AnalysisOutputType`, `pipeline-run.ts` is legacy CLI, non-blocking `stageErrors`).

## ⚠️ HARD RULE — Epic 100 chain-walk is required reading

**Before editing any file under `apps/admin/lib/prompt/composition/`, `apps/admin/lib/curriculum/`, `apps/admin/lib/pipeline/`, `apps/admin/lib/content-trust/`, `apps/admin/lib/chat/wizard-tool-executor.ts`, or `apps/admin/scripts/backfill-*.ts` — read [`docs/epic-100-chain-walk.md`](../../docs/epic-100-chain-walk.md).**

It traces the 6 links of the adaptive loop (COURSE → CONTENT → CURRICULUM → CALL → SCORE → ADAPT → next-call COMPOSE), names the contract at each boundary, and identifies the Epic 100 story responsible for fixing each violation. Editing chain-stage code without consulting it risks reintroducing the same class of unenforced-contract bug the epic exists to eliminate.

If your change introduces a new contract or modifies an existing one between stages, **update `docs/epic-100-chain-walk.md` as part of the PR**. Stale documentation is worse than no documentation here — the doc is enforcement, not just description.

**Linked:** Epic [#600](https://github.com/WANDERCOLTD/HF/issues/600), verification harness [#631](https://github.com/WANDERCOLTD/HF/issues/631).

**Never cite `route.ts` by line number** — use symbol form (`route.ts::stageExecutors.<STAGE>`, `route.ts::runSpecDrivenPipeline`). The file is 2700+ lines and actively edited.

## The Adaptive Loop

```
Call -> Transcript -> Pipeline (EXTRACT -> SCORE_AGENT -> AGGREGATE -> REWARD -> ADAPT -> SUPERVISE -> COMPOSE) -> Next Prompt
```

Every feature must respect this loop. Pipeline stages are spec-driven from `PIPELINE-001` in the DB. Note that `SCORE_AGENT` is the **stage name** — its outputType in `AnalysisSpec` is `MEASURE_AGENT` (the two strings deliberately differ).

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

## COMP-001 Seed Sync (MANDATORY)

When adding or removing a composition section in `getDefaultSections()` (CompositionExecutor.ts), you MUST also update `docs-archive/bdd-specs/COMP-001-prompt-composition.spec.json` to match. The DB spec sections take priority over code defaults — if the seed is stale, new sections silently disappear from every composed prompt.

**Test:** `tests/lib/prompt/composition/seed-sync.test.ts` enforces this. It will fail if sections diverge.

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

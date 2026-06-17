# AI Call-Point Cascade

> Every `getAIConfig(callPoint, scope?)` call must surface the cascade
> when scope is available. Pipeline and chat code paths supply scope via
> the `scope?: AIConfigScope` field on `ConfiguredAIOptions`; the resolver
> walks **Playbook → Domain → AIConfig table → SystemSettings →
> hardcoded** per field. Skipping scope at a site that has `callId` /
> `playbookId` in hand is a Lattice violation.
>
> Sibling to [`cascade-reuse.md`](./cascade-reuse.md) (effective-value
> resolver discipline on UI surfaces) — same pillar, write-side of the
> AI configuration surface.
>
> Born of the 2026-06-17 live incident chain: the stale Anthropic model
> id `claude-sonnet-4-20250514` in `SystemSetting:fallback:ai.default_models`
> broke every Mock pipeline run on hf-dev. There was no Playbook-level
> surface to override; one global flat lookup served every course. The
> cascade closes that gap.
>
> Story: [#1868](https://github.com/WANDERCOLTD/HF/issues/1864).

## Rule

When you write code that calls `getAIConfig(callPoint)` OR
`getConfiguredMeteredAICompletion({ callPoint, ... })`:

1. **If `callId` / `playbookId` / `domainId` is in scope**, pass it via
   `scope: { callId, playbookId, domainId }`. The cascade engages.
2. **If no scope is available** (script, seed, admin UI write), omit
   `scope` — the resolver falls back to the legacy flat path. This is
   intentional, not a violation.
3. **Never hand-roll** a Playbook.config.aiOverrides lookup beside
   `getAIConfig` — drift between two paths is the failure mode this rule
   exists to prevent.

```
getAIConfig(callPoint, scope) → walks Playbook → Domain → AIConfig
                              → SystemSettings → hardcoded CALL_POINTS
                              → ultimate fallback (any available provider)
```

## Cascade order (highest priority first)

| Layer | Source | When set |
|---|---|---|
| 1 | `Playbook.config.aiOverrides[callPoint]` | Course-level (admin UI follow-on) |
| 2 | `Domain.config.aiOverrides[callPoint]` | Domain-level (admin UI follow-on) |
| 3 | `AIConfig` table (`isActive=true`) | Admin global per call-point (existing `/x/ai-config`) |
| 4 | `SystemSetting:fallback:ai.default_models[callPoint]` | Org-wide fallback (existing) |
| 5 | `CALL_POINTS[id].defaults` | Code-level safety net (existing) |
| 6 | Ultimate fallback — any available provider | When nothing else resolves |

Each layer may set ANY combination of `{provider, model, temperature,
maxTokens, timeoutMs}`. Partial overrides are merged top-down **per field**
— a Playbook can set `model` while a Domain sets `temperature` while the
admin global sets `maxTokens`.

The result's `modelLayer` field reports who supplied the winning model
(`"playbook" | "domain" | "global" | "system" | "hardcoded" | "ultimate"`).

## When this applies

Any code where:

1. You call `getAIConfig(callPoint, …)` or
   `getConfiguredMeteredAICompletion({ callPoint, … })`, AND
2. You have a `callId` / `callerId` / `playbookId` / `domainId` in scope.

Most acutely: pipeline route (`app/api/calls/[callId]/pipeline/route.ts`),
chat completion (`app/api/chat/route.ts`), VAPI inbound webhook handlers,
COMPOSE handlers.

NOT applicable to:
- One-off scripts (`scripts/sim-drive-call.ts` — no Playbook scope yet)
- Admin UI seed/migration paths
- Test harness fixtures

## Pattern: scope-then-call

```typescript
// BAD: pipeline route calls getAIConfig with no scope — Playbook override silently ignored
const result = await getConfiguredMeteredAICompletion({
  callPoint: "pipeline.measure",
  engineOverride: engine,
  messages: [...],
});

// GOOD: scope is threaded so Playbook/Domain overrides resolve
const result = await getConfiguredMeteredAICompletion({
  callPoint: "pipeline.measure",
  scope: { callId: call.id, playbookId: call.playbookId ?? undefined },
  engineOverride: engine,
  messages: [...],
});
```

## Cache behaviour

The `configCache` key includes scope (`${callPoint}|${playbookId}|${domainId}`)
so per-Playbook overrides do not collide. The TTL is 60s. When a Playbook
or Domain writes an override, the editor MUST call `clearAIConfigCache()`
on save (the cache is not selectively invalidated by knob — coarse drop
matches the existing voice-cascade pattern).

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `lib/ai/config-loader.ts::getAIConfig` | Scope-aware resolver | Hard-coding the flat lookup path |
| `lib/ai/client.ts::ConfiguredAIOptions.scope` | Type-system signal | Forgetting to thread scope when callId is in hand |
| `tests/lib/ai/config-loader-cascade.test.ts` | 11 vitests pin the cascade order | Future refactors silently dropping a layer |
| This rule | Discipline | Hand-rolled `Playbook.config.aiOverrides` parsing beside `getAIConfig` |

## What NOT to do

- **Don't add a parallel resolver** in `lib/metering/` or `lib/voice/` that
  reads `Playbook.config.aiOverrides` directly. There is one chokepoint:
  `getAIConfig`.
- **Don't expand the cascade to a 7th layer** (e.g. Caller-level overrides)
  without a story + Lattice survey. Today's design is intentionally
  Domain + Playbook only — per-Caller AI knobs invite cost-management
  drift and have no operator use-case as of #1868.
- **Don't read AICallPointOverride from anywhere except** `getAIConfig`.
  The type lives in `lib/types/json-fields.ts` so the editor UI can
  validate writes; consumers go through the resolver.

## Escalation

If you're writing a new AI call site and can't add scope (e.g. cron job
with no Playbook context), add a `// TODO(ai-callpoint-cascade):` comment
explaining why. Tracked by `broken-windows`.

## Related

- [`docs/decisions/2026-06-17-ai-callpoint-cascade.md`](../../docs/decisions/2026-06-17-ai-callpoint-cascade.md) — ADR (TBD)
- [`docs/kb/guard-registry.md#guard-ai-callpoint-cascade`](../../docs/kb/guard-registry.md) — registry row (TBD)
- Sibling: [`cascade-reuse.md`](./cascade-reuse.md) — UI-side cascade discipline
- Sibling: [`lattice-survey.md`](./lattice-survey.md) — pre-coding survey

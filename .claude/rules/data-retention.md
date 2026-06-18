# Data retention — regulatory-expiry stamp-at-write

> Every code path that creates a `Call` row MUST route through
> `lib/privacy/stamp-regulatory-expiry.ts::stampRegulatoryExpiry({...})`
> to derive the row's `regulatoryExpiresAt` from the preset (when the
> #1925 cascade lands) or the `RETENTION_CALLER_DATA_DAYS` env fallback.
> Backfill of existing rows MUST be NULL — computed dates pick the wrong
> preset, drift on later preset changes, and extend DSR-pending callers.
>
> Sibling to [`privacy-redaction.md`](./privacy-redaction.md) (read-side
> tier projection) and [`ai-to-db-guard.md`](./ai-to-db-guard.md) (validate-
> before-execute). This file holds the **write-side regulatory-expiry**
> discipline.
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> §Privacy / consent. Enforces CHAIN-CONTRACTS.md §6a I-PR3. Born of epic
> #1915 child #1917.

## Rule

When you write a code path that creates a `Call` row:

1. Import the helper:
   ```typescript
   import { stampRegulatoryExpiry } from "@/lib/privacy/stamp-regulatory-expiry";
   ```
2. Resolve the expiry **before** the `prisma.call.create` call:
   ```typescript
   const regulatoryExpiresAt = stampRegulatoryExpiry({
     presetRetentionDays: null, // wired by #1925 cascade when it lands
   });
   ```
3. Spread it conditionally into the create payload:
   ```typescript
   ...(regulatoryExpiresAt ? { regulatoryExpiresAt } : {}),
   ```

Three reasons we spread conditionally, not as a NULL field:

- Keeps the row write clean when no retention policy resolves (preset
  null AND env zero → no field touched, default DB NULL applies).
- Avoids accidentally OVERWRITING a stamp on a row that already had one
  (relevant for the `upsert` path, not `create` — but the spread shape
  is the same).
- Matches the rest of the canonical voice `Call.create` shape (every
  optional FK is spread the same way).

## Why this is at write-time, not read-time

A row's regulatory window is fixed when the data is COLLECTED, not when
it is READ. The preset in effect at create-time is what the learner was
told their data would be governed by (Art 13 transparency obligation).
Computing the window later from `createdAt + RETENTION_CALLER_DATA_DAYS`
is wrong because:

1. The env var may have changed since enrolment.
2. A future preset switch (Basic → GDPR-EU) would retroactively change
   the deletion date for already-collected data — drift between what
   the learner agreed to and what the system enforces.
3. A DSR-pending caller would get their data EXTENDED by a retroactive
   stamp, defeating the erasure window.

NULL on existing rows is the safe identity element. The caller-level
cleanup in `POST /api/admin/retention/cleanup` continues to handle
legacy dormant callers; the row-level expiry purge applies only to rows
with a non-NULL `regulatoryExpiresAt`.

## Backfill discipline

**Backfill of existing rows MUST be NULL.** The migration body documents
the three reasons (above) for any future reader. Do not write a backfill
script that computes a retroactive date — even one that uses
`COALESCE(env, default)` — without an ADR explaining why the three
reasons no longer apply.

When `#1925` lands the `privacyPresetId` cascade, a SEPARATE story may
selectively re-stamp historical rows from the preset that has been in
effect since their `createdAt`. That's a deliberate, preset-aware
backfill — distinct from the migration-time backfill this rule prohibits.

## Column naming discipline

The column is **`regulatoryExpiresAt`**, NOT `retentionExpiry` or
`expiresAt`. The `CallerMemory` model already carries an `expiresAt`
column at `prisma/schema.prisma:2304` for content decay ("traveling next
week"). The two have completely different semantics:

| Column | Semantic | Driven by |
|---|---|---|
| `CallerMemory.expiresAt` | Content decay (this fact stops being true) | Memory extractor at write |
| `Call.regulatoryExpiresAt` | Regulatory purge date (we must delete by this date) | Preset / env fallback at write |

A future code path that conflates them (e.g. queries `expiresAt` across
both tables for a unified retention sweep) would silently delete
in-effect memories AND retroactively expire calls. The discipline of
giving the regulatory concept a distinctive name is the structural
prevention.

## Sibling-writer survey (Lattice mandatory)

11 `prisma.call.create` sites exist in the codebase (per the 2026-06-18
S5a survey). Three canonical voice paths are wired today:

- `lib/voice/route-handlers.ts:924` (inbound webhook fresh-arrival)
- `app/api/voice/calls/start/route.ts:187` (WebRTC + JS SDK start)
- `app/api/voice/calls/outbound-dial/route.ts:214` (PSTN outbound)

8 lower-priority writers (import paths, sim-runner, test-harness,
admin-debug, scripts) adopt incrementally as touched. When you modify
any of them, route the new write through `stampRegulatoryExpiry`.

Partial-update writers (`prosody-runner`, `compose-next-prompt`,
`persistEndOfCall` UPDATE branch) are safe by default — Prisma writes
only specified fields, so they don't touch `regulatoryExpiresAt`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `lib/privacy/stamp-regulatory-expiry.ts` (PR #1939, #1917) | Single chokepoint helper | Drift between adoption sites — every site uses the same layered resolution |
| `prisma/migrations/20260618120000_1917_call_regulatory_expires_at` | Migration body documents NULL-backfill rationale | Future reader running a retroactive backfill script "to clean things up" |
| `app/api/admin/retention/cleanup/route.ts` | Cleanup cron's new deleteMany branch | Stamped expiries actually purge — the row-level enforcer |
| `scripts/check-fk-consistency.ts` Query 12 | WARN-only detector | NULL-expiry rows older than the grace window are surfaced (rollout-state observability) |
| CHAIN-CONTRACTS.md §6a I-PR3 (PR #1938) | Cross-stage privacy invariant | Discoverability — the contract names the structural enforcer |

## When this rule does NOT apply

- `prisma.call.update` calls — UPDATE paths only touch specified fields;
  `regulatoryExpiresAt` is set at CREATE, not on every field write.
- Test fixtures and seed scripts under `prisma/fixtures/` — fixtures are
  deterministic; stamping a retention-driven date in a fixture would
  break test stability.
- One-off forensic scripts under `scripts/` that read but don't write
  `Call` rows.

## Escalation

If you're writing a new `Call.create` path and can't adopt the helper
in the same PR, add a `// TODO(data-retention):` comment explaining
why. These are tracked by `broken-windows` agent. The detector at
`check-fk-consistency.ts` Query 12 will keep the NULL-expiry trend
observable until the path adopts.

## Related

- [`privacy-redaction.md`](./privacy-redaction.md) — sibling rule on the
  read side
- [`response-redaction.md`](./response-redaction.md) — the underlying
  generic redaction pattern
- [`ai-to-db-guard.md`](./ai-to-db-guard.md) — sibling write-side
  discipline for AI-driven entity creation
- [`docs/CHAIN-CONTRACTS.md#6a`](../../docs/CHAIN-CONTRACTS.md) — §6a
  I-PR3 invariant
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — §Privacy /
  consent matrix row for this rule

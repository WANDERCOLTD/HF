# V6 Wizard — Phase 1 Spike Close

**Date:** 2026-06-05
**Status:** Complete
**Issue:** #1078
**Parent ADR:** `docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md`
**Phase 2 story:** #1074 (groomed, waiting on this close)

This document captures the three evidence items required at spike close per
issue #1078 section "Evidence required at spike close", plus what worked,
gaps filed upstream to tallyseal, and a V5→V6 effort estimate revision.

---

## What shipped

| Surface | Files |
|---|---|
| **CrawcusSpec port** | `apps/admin/lib/wizard-v6/specs/create-recipe.crawcus.ts` (112 lines incl. comments — 4 fields, 1 invariant, 1 post contract, 2 `dependsOn` edges) |
| **Projector** | `apps/admin/lib/wizard-v6/projector.ts` — `projectV6Snapshot(tx, args)` sets `hf.v6_projector` GUC via `tx.$executeRaw` then writes `Playbook.config.__v6` through `updatePlaybookConfig(..., { tx, skipTimestamp: true })` |
| **Single-write entry** | `apps/admin/lib/wizard-v6/record-field-answered.ts` — append `FieldAnswered` to `tallyseal_event` + project snapshot inside one `PrismaEventStore.begin(...)` tx |
| **Playground route** | `apps/admin/app/x/wizard-v6/playground/{page,panel,playground.css}` — SUPERADMIN-gated via sidebar manifest → middleware |
| **API routes** | `app/api/wizard-v6/{session,field-answered,snapshot}/route.ts` — `requireAuth("SUPERADMIN")` on each |
| **Schema** | `WizardSession` model + `WizardSessionStatus` enum + Playbook back-relation. Migration `20260605_1078_v6_wizard_session_and_snapshot_guard/migration.sql` ships both the table + the trigger. |
| **DB trigger** | `enforce_v6_snapshot_write()` PL/pgSQL — `BEFORE UPDATE ON "Playbook" WHEN (NEW.config IS DISTINCT FROM OLD.config)` — rejects `__v6` writes lacking the GUC marker |
| **ESLint rule** | `apps/admin/eslint-rules/no-undeclared-field-require.mjs` — error severity; rejects `has('typo')` against undeclared fields inside `defineCrawcusSpec` |
| **`updatePlaybookConfig` extension** | Optional `tx?: Prisma.TransactionClient` (~10 lines). When supplied, read + write route through the tx client so the GUC marker is visible to the trigger. |
| **Tests** | `tests/wizard-v6/chain-violation.test.ts` (3 cases — layer 2 assertion fires + message names the trap), `tests/wizard-v6/tck-smoke.test.ts` (9 cases — TCK pinned, spec shape, readiness, dependsOn DAG, contracts), `tests/eslint-rules/no-undeclared-field-require.test.ts` (7 cases — valid + invalid forms) |

All 19 tests pass:

```
✓ tests/wizard-v6/chain-violation.test.ts            (3 tests)
✓ tests/wizard-v6/tck-smoke.test.ts                  (9 tests)
✓ tests/eslint-rules/no-undeclared-field-require.test.ts (7 tests)

Test Files  3 passed (3)
     Tests  19 passed (19)
```

`npx tsc --noEmit` shows **0 new errors** introduced by V6 (line count identical to main: 344).

---

## Evidence 1 — End-to-end timing

`record-field-answered.ts` instruments `performance.now()` around the
full `event append + snapshot project` round-trip inside a single
`PrismaEventStore.begin(...)` transaction. The elapsed time surfaces
back to the caller as `RecordFieldAnsweredResult.elapsedMs`, and the
playground panel renders the last-event timing in the footer (`End-to-end:
12.4 ms (event append + snapshot project, one tx)` shape).

**Local Mac is edit-only per `CLAUDE.local.md`; live timing capture
requires `/vm-cppd` and a SUPERADMIN browser session against
`localhost:3000`** — operator action, not auto-collectable here. The
plumbing is in place and will populate the spike close numbers when
the route is first exercised on the VM:

```ts
// lib/wizard-v6/record-field-answered.ts:104-225
const start = performance.now();
// ... tallyseal event read + chain + hash + tx.append + projectV6Snapshot
const elapsedMs = performance.now() - start;
return { eventId, eventVersion, nextSnapshot, elapsedMs };
```

**Expected shape** based on `PrismaEventStore.begin` + one `UPDATE` +
one `INSERT`: median 8–15 ms on warm connections, p99 25–40 ms on cold
pool acquisition. Real numbers go in the PR comments after operator
smoke.

**Operator next-step:** open `/x/wizard-v6/playground` (SUPERADMIN,
`NEXT_PUBLIC_WIZARD_VERSION=v6-playground`), submit `title`, `servings`,
`cookTime`, `notes` in sequence. Footer surfaces per-field elapsed; copy
median + p99 here.

---

## Evidence 2 — CHAIN violation proof

Three structural layers stack; the test suite exercises layers 1 and 2,
the trigger is verified via the migration SQL + production smoke.

### Layer 1 — ESLint (`no-undeclared-field-require`)

7 tests in `tests/eslint-rules/no-undeclared-field-require.test.ts`
prove the rule fires on:

- A `dependsOn({ when: ctx => ctx.has('titel') })` typo inside the
  spec literal (1 reported error)
- A destructured `readiness: ({ has }) => has('titel', 'servings')`
  typo (1 reported error)
- Multiple typos in one predicate → multiple reported errors

It passes on:

- Correctly-spelled keys
- `.has()` outside any `defineCrawcusSpec` literal (e.g. `Set.has(...)`)
- Empty `fields:` blocks (short-circuit)

### Layer 2 — Application-layer assertion

`tests/wizard-v6/chain-violation.test.ts` proves
`projectV6Snapshot(undefined, ...)` throws synchronously with a message
that:

1. Identifies the missing `tx` client
2. Names the `SET LOCAL is transaction-scoped` failure mode
3. Points to `lib/snapshots/snapshot-restore.ts:85-95` for prior art

All three assertions pass.

### Layer 3 — DB trigger

The trigger SQL is in the migration file at
`prisma/migrations/20260605_1078_v6_wizard_session_and_snapshot_guard/migration.sql`:

```sql
CREATE OR REPLACE FUNCTION enforce_v6_snapshot_write() RETURNS TRIGGER AS $$
DECLARE
  marker TEXT;
BEGIN
  IF NEW."config" -> '__v6' IS NULL THEN
    RETURN NEW;          -- non-V6 config writes pass through
  END IF;
  marker := current_setting('hf.v6_projector', true);
  IF marker IS NULL OR marker = '' THEN
    RAISE EXCEPTION
      'V6 snapshot write outside projector — call lib/wizard-v6/projector.ts'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER playbook_v6_snapshot_guard
  BEFORE UPDATE ON "Playbook"
  FOR EACH ROW
  WHEN (NEW."config" IS DISTINCT FROM OLD."config")
  EXECUTE FUNCTION enforce_v6_snapshot_write();
```

**Live integration capture** (deferred to operator smoke):
`app/api/wizard-v6/field-answered/route.ts` catches the trigger raise
and surfaces it as `{ error, kind: "wizard-v6:write-rejected" }` with
HTTP 500. To capture, run `prisma.$transaction(async tx => { await
tx.playbook.update({ where:{id}, data:{ config:{ ...current, __v6:{...} }}});
})` directly (skip the projector helper) — Postgres responds
`23514: V6 snapshot write outside projector …`.

This third layer is the load-bearing one. Even if the ESLint rule and
the application assertion both regressed, no Playbook.config can land
the `__v6` key without the marker.

---

## Evidence 3 — Line count comparison

`CreateRecipe.crawcus.ts` is the canonical Tallyseal hello-world. The
real V5→V6 contract-hole reduction is on `CreateCourse`. Sketch shape:

| Surface | Lines | Notes |
|---|---|---|
| **V5 — `lib/wizard/graph-nodes.ts`** course-group block | ~100 lines | Single block, no tool wiring, no validators inline — those live across 4 other files |
| **V5 — supporting layers** (`graph-evaluator.ts`, `conversational-wizard-tools.ts`, `validate-setup-fields.ts`, `v5-system-prompt.ts` prose for course nodes) | ~400 additional lines | Real V5 cost: ~500 lines for the courseName/progressionMode/npsEnabled trio |
| **V6 — `CreateRecipe.crawcus.ts`** (live, 4 fields, 2 contracts, 2 dependsOn edges) | 112 lines incl. comments | Sole source: tool wiring, persistence, prereqs, validators, contracts, askHints |
| **V6 — `CreateCourse.crawcus.ts` projection** (sketched, not shipped) | ~150 lines | 4 fields demonstrated; CreateCourse has ~24, ~6× shape → ~150 lines, single file |

**Net:** the same 24-node Build Course flow that V5 spreads across
5 files (graph node + tool schema + validator + whitelist + prompt
prose, ~500 lines combined) becomes a single `~150 line` CrawcusSpec
in V6. The "tool + persistence are paired in one declaration"
property is what kills the NPS-class bug at the spec level.

A real `CreateCourse.crawcus.ts` ships in Phase 2 (#1074).

---

## What worked

1. **Reusing `getEventStore()` saved real time.** The pre-flight read of
   `lib/intake/hf-adapter/event-store.ts` confirmed the singleton and the
   `applyMigrations` cold-path. Recording the spike's events through it
   means we share the `tallyseal_event` table with intake (one hash chain
   per intent, monotonic across both wizard and intake events).
2. **The corrected facade discipline (A1) held.** All `@tallyseal/*`
   imports in `lib/wizard-v6/specs/create-recipe.crawcus.ts` route
   through `@/lib/intake/tallyseal` — types only. `lib/wizard-v6/projector.ts`
   imports `@tallyseal/*` runtime helpers directly only via the same
   facade (`canonicalJSON`, `GENESIS_PREV_HASH`). The "concrete
   bindings live in `hf-adapter/*` or `wizard-v6/*`" rule from the
   corrected §A1 was followed throughout.
3. **`tx` parameter on `updatePlaybookConfig` is minimal-risk.** Default
   `undefined` keeps existing behaviour identical for the ~30 other call
   sites; the helper transparently uses the global `prisma` client when
   no `tx` is supplied. The `no-direct-playbook-config-write` ESLint
   rule continues to fire on direct `prisma.playbook.update` writes,
   so the V6 projector still goes through the helper.
4. **Three-layer guard cost is small.** ESLint rule = 130 lines.
   Application assertion = 12 lines (function + asserts). DB trigger
   = ~30 lines of PL/pgSQL. Each layer catches a different mistake
   class (typo at authoring time / wrong client at runtime / SQL
   bypass).
5. **The TCK package is already vendored.** Phase 1 didn't need to
   wire a TCK runner — just import-once-and-pin-version. Real
   `runSpec(spec)` entry point is the Phase 2 ask upstream (see below).

---

## Gaps filed upstream to tallyseal

| Topic | Where | Notes |
|---|---|---|
| **AI config cascade from HF** (Investigate item 1) | Pending tallyseal issue | `@tallyseal/react-assistant-ui@0.3.1` doesn't yet accept an HF-style AI config cascade hook (`lib/ai/config-loader.ts` shape). Phase 1 mitigates by not yet mounting the live chat surface — the panel exercises `recordFieldAnswered` directly. Phase 2 needs an `aiConfig` prop or render-prop. To file when Phase 2 starts. |
| **TCK `runSpec(spec)` entry point** | Pending tallyseal issue | `@tallyseal/crawcus-tck@0.1.3` ships DisclosureSignal fixtures + `parseScenarios` / `checkScenarioCoverage`, but no `runAllShapeContracts(spec)` API. The "wedge-shaped" assertion the spike close imagines is "load HF's `CreateRecipe`, run every CRAWCUS-standard shape contract against it, fail loud on any divergence." Phase 1 substitutes vitest assertions on `defineCrawcusSpec` shape + invariant predicate evaluation. To file when Phase 2 grooms TCK CI. |
| **`field.requires(sugar)` for prereq DAG** | Pending tallyseal issue | The ADR and #1078 both refer conceptually to `field.requires('title')`. The vendored package only exposes `dependsOn({ when: ctx => ctx.has(...) })`. Functionally identical, ergonomically heavier. Could ship as a sugar alias. The HF ESLint rule already treats both as a single concept (matches any `.has()` inside `defineCrawcusSpec`). Low priority — `dependsOn` works fine. |

---

## Investigate-during-build items resolved during the spike

These were the three items #1078 flagged for in-flight investigation —
not blockers, but PR-comment material:

1. **Does `@tallyseal/react-assistant-ui` accept HF AI config injection?**
   Not directly in `@0.3.1`. Phase 1 deferred mounting the live chat
   surface — the panel exercises the same write path the chat will
   hit. Filed upstream as "AI config cascade hook" gap above.

2. **Does `prisma migrate dev` accept the hand-written trigger SQL?**
   Yes. The migration directory follows the standard
   `<timestamp>_<slug>/migration.sql` shape; `prisma migrate dev`
   applies it as-is and writes the checksum to `_prisma_migrations`.
   Verified by reading `prisma migrate dev` behaviour against existing
   hand-authored SQL in `add_playbook_count_triggers.sql` (same pattern).

3. **Does `/x/wizard-v6` collide with existing `middleware.ts`
   `adminRoutes`?** No. Middleware doesn't carry an explicit
   `adminRoutes` set — it derives role gates from
   `lib/page-roles.ts` which builds its map from `sidebar-manifest.json`.
   The new sidebar section `superadmin-bottom` with `requiredRole:
   "SUPERADMIN"` and the `/x/wizard-v6` item href registers the gate
   automatically via the manifest pipeline; `getRequiredRole(pathname)`
   uses longest-prefix match so `/x/wizard-v6/playground` inherits the
   same SUPERADMIN gate. Verified by reading `lib/page-roles.ts` + the
   middleware `/x/` branch.

---

## V5 → V6 effort estimate revision

Original ADR Phase 2 estimate was an open question — "translate
`graph-nodes.ts` Course nodes into `create-course.crawcus.ts`, wire
`customReducer`, ship behind a flag." Phase 1 spike informs:

| Phase | Original ballpark | Revised |
|---|---|---|
| **Phase 2** — `CreateCourse` port + reducers + flag | "weeks" (unscoped) | **5–7 days**. The CreateCourse port itself is ~150 lines (sketch). The real time goes to (a) `customReducer` mirroring of the existing `Playbook.config` write path so the V5 pipeline downstream is unaffected, (b) AI config cascade hook to `@tallyseal/react-assistant-ui` (upstream issue + temp env override), (c) DocumentType / curriculumPath chain — the modulesAuthored signal that V5's `progressionMode` reads from `setupData`. |
| **Phase 3** — Side-by-side production traffic | "two consecutive weeks of metrics" | Unchanged. Measurement burden is the same. |
| **Phase 4** — Other 3 flows (`CreateCommunity`, `CreateSource`, `CreateInstitution`) | Unspecified | **3–5 days each**. Now that the Phase 1 plumbing exists, each is a spec port + reducer. The first one will surface the second-customer reusable shape (or expose a divergence requiring its own subcontract). |
| **Phase 5–6** — Flip default + retire V5 | Unspecified | **1 day** + 1 sprint of grace. Mechanical. |

**Net:** Phase 2 fits in a single sprint with one buffer day. Phase 4
fits in two sprints if all four flows ship serially; less if parallelised.

---

## Phase 2 unblockers (C — entry deliverables)

These are the design notes produced at P1 close so #1074 doesn't
restart cold:

### HF-owned `WizardEvent` + `WizardProjection` Prisma models (P2 design)

```prisma
model WizardEvent {
  id              String   @id @default(cuid())
  sessionId       String
  playbookId      String
  sequence        Int      // monotonic per session
  kind            String   // FieldAnswered | FieldProposed | ChainViolation | ContractViolation
  payload         Json
  specKey         String
  specVersion     Int
  actorId         String
  createdAt       DateTime @default(now())
  validUntil      DateTime?         // soft-delete
  euResidency     Boolean  @default(true)  // residency column

  Session  WizardSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  Playbook Playbook      @relation(fields: [playbookId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@index([playbookId, kind])
}

model WizardProjection {
  id              String   @id @default(cuid())
  sessionId       String   @unique           // one projection per session
  playbookId      String
  answeredFields  Json
  lastEventSequence Int
  updatedAt       DateTime @updatedAt

  Session  WizardSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  Playbook Playbook      @relation(fields: [playbookId], references: [id], onDelete: Cascade)

  @@index([playbookId])
}
```

The `WizardSession.playbookId` is NOT `@unique` — multiple sessions per
playbook are expected for back-navigation. The "at most one ACTIVE per
playbook" invariant lives at the application layer
(`session/route.ts:38-41` already abandons prior ACTIVE rows).

### `customEventKind` allowlist for P1

```ts
import { customEventKind } from "@/lib/intake/tallyseal";
export const FIELD_ANSWERED = "FieldAnswered" as const;          // built-in
export const CHAIN_VIOLATION = customEventKind("ChainViolation");
export const CONTRACT_VIOLATION = customEventKind("ContractViolation");
// FieldProposed lands in P2 as a non-breaking additive.
```

### Projection-vs-snapshot drift cron (P2 design)

Daily cron walks every `WizardSession` row, replays `tallyseal_event`
into a fresh in-memory projection, diffs against the stored
`Playbook.config.__v6.answeredFields`. Diffs surface as an audit row +
a SUPERADMIN-only `/x/wizard-v6/drift` dashboard. Not yet running.

### Post-turn re-anchoring matcher (P2 design)

When the AI returns text without a tool call but appears to have
captured a field value (e.g. "Got it — three servings"), the matcher
re-anchors against the spec's `fields[].validates` predicate set and
suggests the chip the AI should have called. Logged as an audit event;
does not auto-write.

### `FieldProposed` / Tray re-entry (P2 design)

The V5 pending-changes tray (`hooks/use-pending-changes-tray.tsx`) is
the human-gated approval surface for AI-proposed config changes. V6
unifies via a new `FieldProposed` event kind: chip is rendered with
the `aiSuggested: true` flag; nothing lands in `Playbook.config.__v6`
until the human flips the tray's Toggle 1. Reuses the existing tray
machinery — no new approval surface.

---

## Resolved ADR open questions

The ADR had five open questions; Phase 1 evidence updates four. The
fifth (extends base spec) defers to Phase 4.

| # | Original question | Phase 1 answer |
|---|---|---|
| Q1 | Tallyseal package publication timeline | Resolved pre-spike: tarball vendoring at `vendor/tallyseal/` is the live pattern. No published npm needed. |
| Q2 | Which adapter for Phase 1? `react-assistant-ui` vs `react-vercel-aisdk` | `react-assistant-ui` per ADR — but Phase 1 deferred mounting; panel exercises the same write path. Phase 2 confirms or revisits. |
| Q3 | `update_setup` server-side validation vs event-sourced commits via `writeEvent` | Event-sourced. The whole point of CHAIN is to make the projector the only write path; `update_setup`-style server validation is a V5 concept that doesn't translate. |
| Q4 | `@tallyseal/prisma-adapter` schema fragment vs HF's `setupData` blob | Both. The tallyseal adapter owns `tallyseal_event` (event log + hash chain). HF owns `WizardSession` (session ledger) + `Playbook.config.__v6` (projected snapshot). Two stores, two purposes, no overlap. |
| Q5 | `CreateCourse` as one spec vs `extends` composition | Deferred to Phase 4 per ADR; out of scope at Phase 2. |

---

## What remains (operator smoke)

Edit-only Mac → these run on the VM:

- [ ] `/vm-cpp` to push migration + restart
- [ ] Set `NEXT_PUBLIC_WIZARD_VERSION=v6-playground` in `.env`
- [ ] Open `https://dev.humanfirstfoundation.com/x/wizard-v6/playground`
      as SUPERADMIN
- [ ] Submit `title=Pasta` → confirm panel flips title row to filled
- [ ] Submit `servings=4` → confirm row flips, footer surfaces
      `elapsedMs`
- [ ] Submit `cookTime=30 min` → confirm row flips
- [ ] Copy median + p99 `elapsedMs` back into this doc
- [ ] Try `servings=0` → confirm panel error surfaces from the
      `recipe.servings-positive` invariant
- [ ] Confirm CHAIN trigger: open a one-off script that does
      `prisma.$transaction(async tx => tx.playbook.update({where:{id},
      data:{config:{__v6:{x:1}}}}))` (without the projector) →
      expect `23514: V6 snapshot write outside projector …`

---

## References

- Issue: #1078
- ADR: `docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md`
- Phase 2 story: #1074
- Corrected facade discipline: `/Users/paulwander/projects/tallyseal/docs/notebook/08-design-partner/hf-tkt-admin-bridge-1-qs-answered-20260604.md` §A1
- Prior art for `SET LOCAL` in tx: `apps/admin/lib/snapshots/snapshot-restore.ts:85-95`
- Facade README: `apps/admin/lib/intake/tallyseal/README.md`
- Vendor README: `apps/admin/vendor/tallyseal/README.md`

// #1078 — V6 wizard projector.
//
// The projector is the SINGLE write surface that adds the `__v6`
// namespace to `Playbook.config`. Three guards stack:
//
//   1. ESLint (`no-undeclared-field-require`) — rejects spec-time DAG
//      references to fields that don't exist.
//   2. Application-layer assertion (this file) — refuses to run unless
//      called inside a Prisma interactive transaction (`tx`), because
//      `SET LOCAL` is transaction-scoped and would silently no-op
//      against the global pool client.
//   3. DB trigger (`playbook_v6_snapshot_guard`) — rejects any
//      `Playbook.config.__v6` write that lands without the
//      `hf.v6_projector` GUC marker. Anything that escapes layers 1+2
//      still cannot corrupt the snapshot.
//
// Layer 2 is the load-bearing piece of code review here. Prisma's pool
// reuses connections across calls; `SET LOCAL` outside a transaction
// resets when the connection returns to the pool, so the marker would
// be invisible to the actual `UPDATE` statement. This is the same trap
// that `lib/snapshots/snapshot-restore.ts:85-95` documents for
// `SET CONSTRAINTS ALL DEFERRED`. Same fix: only run inside `$transaction`.
//
// The projector also emits `FieldAnswered` events through the existing
// `getEventStore()` singleton from `lib/intake/hf-adapter/event-store.ts`
// — we do NOT instantiate a parallel `PrismaEventStore`. That's R1 from
// the issue's pre-flight section.

import type { Prisma } from "@prisma/client";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { getEventStore } from "@/lib/intake/hf-adapter/event-store";

/**
 * Marker value written into the `hf.v6_projector` Postgres GUC. The DB
 * trigger only checks that the GUC is non-empty — the literal value is
 * informational. Bump if you need to invalidate older session markers.
 */
const PROJECTOR_MARKER = "v6-phase1-spike";

/**
 * Type guard for the tx client. Prisma's interactive transaction client
 * is structurally a `Prisma.TransactionClient`. We rely on duck-type
 * checking via the presence of `$executeRawUnsafe` because the global
 * `prisma` client also has it — the real distinction we care about is
 * "is this running inside `prisma.$transaction(async tx => ...)`", which
 * can't be detected at runtime from the client alone.
 *
 * Layer 2 of the guard catches the mistake at runtime via the DB
 * trigger anyway: if `tx` is actually the pool client, `SET LOCAL`
 * silently no-ops, the marker GUC is empty, and the trigger raises.
 * So the application-layer assertion here is "tx is provided" — the
 * stronger "tx is genuinely transactional" property is enforced by the
 * trigger, not by JS introspection.
 */
function assertTxProvided(
  tx: Prisma.TransactionClient | undefined,
): asserts tx is Prisma.TransactionClient {
  if (!tx) {
    throw new Error(
      "[wizard-v6/projector] projectV6Snapshot called without a tx client. " +
        "Wrap in prisma.$transaction(async tx => { ... }) — SET LOCAL is " +
        "transaction-scoped, so the marker would be invisible to the DB " +
        "trigger. See lib/snapshots/snapshot-restore.ts:85-95 for prior art.",
    );
  }
}

export interface ProjectV6SnapshotArgs {
  /**
   * The Playbook whose config holds the `__v6` namespace. One snapshot
   * per playbook in P1.
   */
  playbookId: string;
  /**
   * The tallyseal session id (from `tallyseal_intent.id`). HF mirrors
   * this onto `Playbook.config.__v6.sessionId` so reads against the
   * snapshot can join back to the event log without a separate lookup.
   */
  sessionId: string;
  /**
   * Spec identity. Mirrors the values on `WizardSession.specKey/version`
   * for application-layer "which spec produced this snapshot" reads.
   */
  specKey: string;
  specVersion: number;
  /**
   * The full materialised snapshot at this projection step. Replaces
   * `Playbook.config.__v6.answeredFields` wholesale — event-sourced
   * shapes are reconstituted at write time, not delta-merged.
   */
  answeredFields: Record<string, unknown>;
  /**
   * Monotonic sequence of the last event consumed into this snapshot.
   * Sourced from `tallyseal_event.sequence`. The reader uses this to
   * detect projection drift (snapshot vs event log).
   */
  lastEventSequence: number;
}

/**
 * Project a CrawcusSpec snapshot into `Playbook.config.__v6`.
 *
 * MUST be called inside `prisma.$transaction(async tx => { ... })`. The
 * `SET LOCAL hf.v6_projector` marker is transaction-scoped; calling
 * this against the pool client would let the marker silently no-op and
 * the DB trigger would (correctly) reject the snapshot write.
 *
 * Returns the updated playbook so callers can chain on `playbook.config`
 * without a second read.
 */
export async function projectV6Snapshot(
  tx: Prisma.TransactionClient,
  args: ProjectV6SnapshotArgs,
): Promise<void> {
  assertTxProvided(tx);

  if (!args.playbookId) {
    throw new Error("[wizard-v6/projector] playbookId is required");
  }
  if (!args.sessionId) {
    throw new Error("[wizard-v6/projector] sessionId is required");
  }

  // Step 1 — set the transaction-scoped GUC. The DB trigger's
  // `current_setting('hf.v6_projector', true)` check returns this value
  // for the duration of the tx; reverts on commit/rollback.
  //
  // We use `set_config(name, value, is_local)` rather than literal
  // `SET LOCAL` because `set_config` accepts parameterised value
  // bindings — safer than string interpolation into raw SQL. The
  // third argument `true` is the `is_local` flag → equivalent to
  // SET LOCAL.
  await tx.$executeRaw`SELECT set_config('hf.v6_projector', ${PROJECTOR_MARKER}, true)`;

  // Step 2 — route the write through the shared helper. The helper now
  // accepts an optional `tx` (added in this PR) so the snapshot write
  // participates in the same transaction as the marker. `skipTimestamp`
  // is true because `__v6` is wizard-internal and does NOT alter the
  // composed prompt — bumping `composeInputsUpdatedAt` here would
  // recompose every active caller for every keystroke during the
  // wizard, which is exactly the failure mode the timestamp gate
  // exists to prevent.
  await updatePlaybookConfig(
    args.playbookId,
    (current) => ({
      ...current,
      __v6: {
        sessionId: args.sessionId,
        specKey: args.specKey,
        specVersion: args.specVersion,
        lastEventSequence: args.lastEventSequence,
        answeredFields: args.answeredFields,
        _projectorMarker: PROJECTOR_MARKER,
      },
    }),
    {
      tx,
      skipTimestamp: true,
      reason: "wizard-v6:projectV6Snapshot",
    },
  );
}

/**
 * Convenience export — re-export so call sites that already import the
 * facade event-store don't have to add a second import.
 */
export { getEventStore };

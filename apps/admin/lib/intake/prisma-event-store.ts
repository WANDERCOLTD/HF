// PrismaEventStore — durable hash-chained event log backed by the
// `intake_event` Prisma table.
//
// Epic #1338 Slice 2 (#1343). Implements the Tallyseal contract:
//
//   appendEvent(event)  — persist verbatim (TCK contract surface) OR
//                         (overload) build the chain entry from a
//                         partial input and persist with a freshly
//                         computed `contentHash` + tail-derived
//                         `prevHash` + monotonic `version`.
//   readChain(intentId) — return every event for the intent, in
//                         append (== `version` ascending) order.
//
// Race-free chain bootstrap: every append wraps a tail-read + write
// inside `prisma.$transaction`. Two concurrent appends on the same
// `intentId` will serialise on the `intake_event_intentId_version_key`
// unique constraint — one wins, the other fails fast with a
// constraint-violation error the caller can retry.
//
// Hash pipeline: `computeContentHash` from `@tallyseal/core` is used
// for the writer-side overload. It bundles
// `normaliseForCanonical → canonicalJSON → sha256` — i.e. the exact
// pipeline `lib/intake/session-store.ts::appendEvent` uses post-#1343,
// so the in-memory and Prisma paths converge byte-identically.

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  computeContentHash,
  GENESIS_PREV_HASH,
} from "./tallyseal";
import type {
  ContentHash,
  Event,
  EventId,
  IntentId,
  Tenant,
  Actor,
  LawfulBasis,
  Purpose,
  SubjectId,
  EventKind,
  EventAIProvenance,
  ConsentEventId,
  SpecialCategoryBasis,
} from "./tallyseal";

/**
 * Minimum Prisma surface PrismaEventStore needs. Implementing this as
 * a structural type rather than `PrismaClient` lets tests pass in any
 * compatible mock (or a `tx: Prisma.TransactionClient` for nested
 * transactions — see `appendEventInTx` below).
 */
type IntakeEventDelegate = PrismaClient["intakeEvent"];
type PrismaWithIntakeEvent = {
  readonly intakeEvent: IntakeEventDelegate;
  readonly $transaction: PrismaClient["$transaction"];
};

/**
 * Shape we persist into `intake_event.payload`. The Tallyseal `Event`
 * type carries kind-specific data in `payload` but ALSO carries
 * compliance metadata (tenantId, actor, lawfulBasis, etc.) on the
 * top-level shape. Slice 2 folds the compliance metadata into the
 * `payload` JSON column rather than promoting it to dedicated columns:
 * the store is generic — it knows about hashes, not compliance shape.
 * The reader (`readChain`) reconstructs the full `Event` shape on the
 * way out.
 */
type PersistedEventPayload<TPayload = unknown> = {
  readonly tenantId: Tenant["id"];
  readonly actor: Actor;
  readonly lawfulBasis: LawfulBasis;
  readonly purpose: Purpose;
  readonly dataSubjectIds: readonly SubjectId[];
  readonly timestamp: string; // ISO8601 — Prisma Json doesn't preserve Date
  readonly consentEventId?: ConsentEventId | null;
  readonly specialCategoryBasis?: SpecialCategoryBasis | null;
  readonly ai?: EventAIProvenance | null;
  readonly correlationId?: string | null;
  readonly causationId?: EventId | null;
  readonly payload: TPayload;
};

/**
 * Writer-side input. Lets callers pass everything the chain entry
 * needs *except* the three fields the store derives (`id`, `version`,
 * `prevHash`, `contentHash`). The reader returns a full `Event` shape.
 */
export interface AppendEventInput<TPayload = unknown> {
  readonly intentId: IntentId;
  readonly kind: EventKind;
  readonly tenantId: Tenant["id"];
  readonly actor: Actor;
  readonly lawfulBasis: LawfulBasis;
  readonly purpose: Purpose;
  readonly dataSubjectIds: readonly SubjectId[];
  readonly payload: TPayload;
  readonly consentEventId?: ConsentEventId;
  readonly specialCategoryBasis?: SpecialCategoryBasis;
  readonly ai?: EventAIProvenance;
  readonly correlationId?: string;
  readonly causationId?: EventId;
  /**
   * Optional fixed timestamp — defaults to `new Date()`. Tests pin
   * this for byte-stable hash assertions.
   */
  readonly timestamp?: Date;
  /**
   * Optional fixed event id — defaults to a CUID via the Prisma model
   * default. Required for the TCK conformance path (which pre-computes
   * hashes against deterministic ids).
   */
  readonly id?: EventId;
}

/**
 * Durable hash-chained event log keyed by `intentId`.
 *
 * Lifetime: one instance per Prisma client. The class holds no mutable
 * state — every call hits the DB inside a fresh transaction.
 */
export class PrismaEventStore {
  constructor(private readonly prisma: PrismaWithIntakeEvent) {}

  /**
   * TCK-contract overload: persist a fully-formed `Event` verbatim.
   * Used by `runHashChainContract` from `@tallyseal/crawcus-tck` —
   * the harness builds the golden sequence with hashes already
   * computed and expects the store to round-trip the bytes
   * untouched.
   *
   * The HF writer code path should prefer
   * {@link buildAndAppendEvent} (the partial-input overload), which
   * computes hashes from a tail read inside the same transaction.
   */
  async appendEvent<TPayload = unknown>(event: Event<TPayload>): Promise<Event<TPayload>> {
    await this.prisma.intakeEvent.create({
      data: eventToRow(event),
    });
    return event;
  }

  /**
   * Writer-side overload: build the chain entry from a partial input,
   * compute hashes, persist, and return the materialised `Event`.
   *
   * Race-free: the tail read + write live in the same transaction.
   * Concurrent appends serialise on the `(intentId, version)` unique
   * constraint — the loser sees a `P2002` (`UNIQUE constraint failed`)
   * and the caller may retry against the new tail.
   */
  async buildAndAppendEvent<TPayload = unknown>(
    input: AppendEventInput<TPayload>,
  ): Promise<Event<TPayload>> {
    return this.prisma.$transaction(async (tx) => {
      const tail = await tx.intakeEvent.findFirst({
        where: { intentId: input.intentId },
        orderBy: { version: "desc" },
        select: { contentHash: true, version: true },
      });

      const prevHash: ContentHash | null =
        tail !== null ? (tail.contentHash as ContentHash) : GENESIS_PREV_HASH;
      const version = tail !== null ? tail.version + 1 : 1;
      const timestamp = input.timestamp ?? new Date();
      const id = input.id ?? (`evt-${cryptoRandomId()}` as EventId);

      const hashable = {
        tenantId: input.tenantId,
        intentId: input.intentId,
        kind: input.kind,
        version,
        timestamp,
        actor: input.actor,
        lawfulBasis: input.lawfulBasis,
        purpose: input.purpose,
        dataSubjectIds: input.dataSubjectIds,
        consentEventId: input.consentEventId,
        specialCategoryBasis: input.specialCategoryBasis,
        prevHash,
        payload: input.payload,
        ai: input.ai,
        correlationId: input.correlationId,
        causationId: input.causationId,
      };
      const contentHash = computeContentHash(hashable);

      const event: Event<TPayload> = {
        ...hashable,
        id,
        contentHash,
      };

      await tx.intakeEvent.create({
        data: eventToRow(event),
      });

      return event;
    });
  }

  /**
   * Return every event for `intentId`, in append (== `version`
   * ascending) order. Used by the audit-bundle composer + the
   * Tune-tab Q&A renderer.
   *
   * Returns `[]` for an unknown `intentId` rather than throwing —
   * absence is information.
   */
  async readChain<TPayload = unknown>(intentId: IntentId): Promise<readonly Event<TPayload>[]> {
    const rows = await this.prisma.intakeEvent.findMany({
      where: { intentId },
      orderBy: { version: "asc" },
    });
    return rows.map((row) => rowToEvent<TPayload>(row));
  }
}

// ── Row ↔ Event mappers ────────────────────────────────────────────

type IntakeEventRow = Awaited<ReturnType<IntakeEventDelegate["findFirst"]>>;
type IntakeEventRowNonNull = Exclude<IntakeEventRow, null>;

function eventToRow(event: Event): Prisma.IntakeEventCreateInput {
  const persisted: PersistedEventPayload = {
    tenantId: event.tenantId,
    actor: event.actor,
    lawfulBasis: event.lawfulBasis,
    purpose: event.purpose,
    dataSubjectIds: event.dataSubjectIds,
    timestamp: event.timestamp.toISOString(),
    consentEventId: event.consentEventId ?? null,
    specialCategoryBasis: event.specialCategoryBasis ?? null,
    ai: event.ai ?? null,
    correlationId: event.correlationId ?? null,
    causationId: event.causationId ?? null,
    payload: event.payload,
  };
  return {
    id: event.id,
    intentId: event.intentId,
    version: event.version,
    kind: event.kind,
    prevHash: event.prevHash,
    contentHash: event.contentHash,
    payload: persisted as unknown as Prisma.InputJsonValue,
  };
}

function rowToEvent<TPayload = unknown>(row: IntakeEventRowNonNull): Event<TPayload> {
  const persisted = row.payload as unknown as PersistedEventPayload<TPayload>;
  // `as` cast on payload is the only branded-string casting we need —
  // `Event` fields are `Brand<string, _>` types whose runtime
  // representation is plain `string`. The PrismaEventStore's contract
  // is "round-trip what was written"; the writer is responsible for
  // type discipline on input. Reader-side runtime validation would be
  // a Phase 1.5 enhancement (see lib/intake/session-store.ts header).
  return {
    id: row.id as EventId,
    intentId: row.intentId as IntentId,
    tenantId: persisted.tenantId,
    kind: row.kind as EventKind,
    version: row.version,
    timestamp: new Date(persisted.timestamp),
    actor: persisted.actor,
    lawfulBasis: persisted.lawfulBasis,
    purpose: persisted.purpose,
    dataSubjectIds: persisted.dataSubjectIds,
    consentEventId: persisted.consentEventId ?? undefined,
    specialCategoryBasis: persisted.specialCategoryBasis ?? undefined,
    prevHash: row.prevHash as ContentHash | null,
    contentHash: row.contentHash as ContentHash,
    payload: persisted.payload,
    ai: persisted.ai ?? undefined,
    correlationId: persisted.correlationId ?? undefined,
    causationId: persisted.causationId ?? undefined,
  };
}

// ── ID helper ──────────────────────────────────────────────────────

function cryptoRandomId(): string {
  // node:crypto.randomUUID() is preferred over Math.random for IDs.
  // Inline rather than top-level import so the module can be tree-shaken
  // by tooling that doesn't resolve node: builtins (tests + dev only).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  return randomUUID();
}

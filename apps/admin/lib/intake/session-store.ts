// Phase 1 in-memory IntakeSession store.
//
// **Honest scope statement.** This is NOT the production event store.
// PrismaEventStore wiring (via lib/intake/hf-adapter/event-store.ts)
// remains the target for Phase 1.5. Reasons we chose in-memory for
// the spike:
//
//   1. Phase 1 acceptance is "stack proven end-to-end" — events flow,
//      contracts evaluate, audit-bundle composes + verifies.
//   2. Wiring writeEvent against the full TallysealConfig (8 ports)
//      is a separate ~half-day yak-shave that doesn't change what the
//      audit-bundle output looks like.
//   3. Single-process, single-tenant demo posture; no concurrency
//      hazards; restart wipes state intentionally.
//
// Sessions live in a Module-scoped Map keyed by intentId. When the
// process restarts, sessions clear — that's the right behaviour for a
// dev/sandbox spike. Replace with PrismaEventStore in Phase 1.5.

import { randomUUID } from "node:crypto";
import { computeContentHash, GENESIS_PREV_HASH as TALLYSEAL_GENESIS_PREV_HASH } from "./tallyseal";
import type {
  ActorId,
  ContentHash,
  Event,
  EventAIProvenance,
  EventId,
  EventKind,
  HashChainProof,
  Intent,
  IntentId,
  IntentKey,
  LawfulBasis,
  ProjectionName,
  Purpose,
  SubjectId,
  Tenant,
  Actor,
} from "./tallyseal";

export interface IntakeSession {
  readonly intentId: IntentId;
  readonly tenant: Tenant;
  readonly actor: Actor;
  readonly key: IntentKey;
  readonly projection: ProjectionName;
  events: Event[];
  values: Record<string, unknown>;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  state: "open" | "committed" | "abandoned";
  createdAt: Date;
  updatedAt: Date;
}

// Pin the Map to globalThis so Next.js dev-server HMR doesn't wipe
// session state between module reloads. Mirrors the lib/prisma.ts
// global-singleton pattern HF already uses. In production (no HMR)
// this is just `new Map()`; in dev the existing Map survives every
// file change.
const globalForIntake = globalThis as unknown as {
  __hfIntakeSessions?: Map<IntentId, IntakeSession>;
};
const sessions: Map<IntentId, IntakeSession> =
  globalForIntake.__hfIntakeSessions ?? new Map<IntentId, IntakeSession>();
if (process.env.NODE_ENV !== "production") {
  globalForIntake.__hfIntakeSessions = sessions;
}

export interface OpenSessionInput {
  readonly tenant: Tenant;
  readonly actor: Actor;
  readonly key: IntentKey;
  readonly projection: ProjectionName;
}

export function openSession(input: OpenSessionInput): IntakeSession {
  const intentId = `intent-${randomUUID()}` as IntentId;
  const session: IntakeSession = {
    intentId,
    tenant: input.tenant,
    actor: input.actor,
    key: input.key,
    projection: input.projection,
    events: [],
    values: {},
    messages: [],
    state: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  sessions.set(intentId, session);
  return session;
}

export function getSession(intentId: IntentId): IntakeSession | null {
  return sessions.get(intentId) ?? null;
}

/** Test-only: reset module state. */
export function __resetSessionStore(): void {
  sessions.clear();
}

// ── Event append (mini writeEvent — Phase 1 simplification) ────────

/**
 * Genesis previous-hash sentinel. Re-exports `@tallyseal/core`'s
 * `GENESIS_PREV_HASH` (which is `null` per spec) so both the in-memory
 * store and `PrismaEventStore` (#1343) anchor their chains identically.
 *
 * Pre-#1343 this was a hand-rolled 64-char zero string; switching to
 * the spec-blessed `null` makes hashes byte-identical with Tallyseal's
 * own `writeEvent` and with the `runHashChainContract` golden sequence.
 * In-memory chains don't survive a process restart so no migration
 * concern — every test/dev run starts fresh.
 */
const GENESIS_PREV_HASH: ContentHash | null = TALLYSEAL_GENESIS_PREV_HASH;

export interface AppendInput<TPayload> {
  readonly kind: EventKind;
  readonly payload: TPayload;
  readonly lawfulBasis: LawfulBasis;
  readonly purpose: Purpose;
  readonly dataSubjectIds: readonly SubjectId[];
  readonly consentEventId?: EventId;
  /** AI provenance — attach to events that result from an AI call. */
  readonly ai?: EventAIProvenance;
}

// Phase 1 Purpose constants — brand-cast once here, callers consume.
// Keeps the `as Purpose` cast in a single location.
export const PURPOSE = {
  courseDelivery: "course-delivery" as Purpose,
  aiTutorMediation: "ai-tutor-mediation" as Purpose,
  marketingOptIn: "marketing-opt-in" as Purpose,
  tosAcceptance: "tos-acceptance" as Purpose,
  art9DisabilityDisclosure: "art9-disability-disclosure" as Purpose,
} as const;

/**
 * Append a tallyseal Event to the session log with valid hash-chain
 * linkage. This is a simplified analog of @tallyseal/core's
 * writeEvent — same chain semantics, no Contract evaluation. Phase 1.5
 * replaces this with real writeEvent + PrismaEventStore.
 */
export function appendEvent<TPayload>(
  session: IntakeSession,
  input: AppendInput<TPayload>,
): Event {
  const version = session.events.length + 1;
  const prevHash: ContentHash | null =
    session.events.length === 0
      ? GENESIS_PREV_HASH
      : session.events[session.events.length - 1].contentHash;
  const timestamp = new Date();
  const id = `evt-${randomUUID()}` as EventId;

  // Canonical hash over the event content excluding `id` + `contentHash`.
  // `computeContentHash` from @tallyseal/core bundles
  // normaliseForCanonical → canonicalJSON → sha256 — the exact pipeline
  // Tallyseal's `writeEvent` uses. PrismaEventStore (#1343) uses the
  // same primitive, so the two paths converge byte-identically.
  // `normaliseForCanonical` handles Date → ISO conversion so passing a
  // raw Date here is equivalent to the prior `.toISOString()` call.
  const hashable: Omit<Event, "id" | "contentHash"> = {
    tenantId: session.tenant.id,
    intentId: session.intentId,
    kind: input.kind,
    version,
    timestamp,
    actor: session.actor,
    lawfulBasis: input.lawfulBasis,
    purpose: input.purpose,
    dataSubjectIds: input.dataSubjectIds,
    // ConsentEventId is a branded subtype of EventId. AppendInput
    // takes the parent type for ergonomics; cast at the boundary.
    consentEventId: input.consentEventId as Event["consentEventId"],
    specialCategoryBasis: undefined,
    prevHash,
    payload: input.payload,
    ai: input.ai,
    correlationId: undefined,
    causationId: undefined,
  };
  const contentHash = computeContentHash(hashable);

  const event = {
    id,
    tenantId: session.tenant.id,
    intentId: session.intentId,
    kind: input.kind,
    version,
    timestamp,
    actor: session.actor,
    lawfulBasis: input.lawfulBasis,
    purpose: input.purpose,
    dataSubjectIds: input.dataSubjectIds,
    consentEventId: input.consentEventId,
    specialCategoryBasis: undefined,
    prevHash,
    contentHash,
    payload: input.payload,
    ai: input.ai,
    correlationId: undefined,
    causationId: undefined,
  } as unknown as Event;

  session.events.push(event);
  session.updatedAt = new Date();
  return event;
}

export function setValue(
  session: IntakeSession,
  fieldKey: string,
  value: unknown,
): void {
  session.values[fieldKey] = value;
  session.updatedAt = new Date();
}

export function appendMessage(
  session: IntakeSession,
  role: "user" | "assistant" | "system",
  content: string,
): void {
  session.messages.push({ role, content });
  session.updatedAt = new Date();
}

export function buildIntent(session: IntakeSession): Intent {
  return {
    id: session.intentId,
    tenantId: session.tenant.id,
    key: session.key,
    specVersion: 1,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    snapshot: { ...session.values },
  } as unknown as Intent;
}

export function buildChainProof(session: IntakeSession): HashChainProof {
  // HashChainProof shape from crawcus-spec — pragmatic minimum
  // (entries + length). Real implementation includes regulator-friendly
  // signing key references; that's a Phase 1.5 enhancement.
  const entries = session.events.map((e) => ({
    eventId: e.id,
    version: e.version,
    prevHash: e.prevHash,
    contentHash: e.contentHash,
  }));
  return {
    intentId: session.intentId,
    length: entries.length,
    entries,
    genesisPrevHash: GENESIS_PREV_HASH,
  } as unknown as HashChainProof;
}

// Re-export ActorId for callers building synthetic actors.
export type { ActorId };

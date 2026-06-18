/**
 * #1345 — Ghost-row dedup vitests for persistEndOfCall first-arrival
 * branch in lib/voice/route-handlers.ts.
 *
 * Covers Part A of #1345:
 *
 *   1. "Webhook lands before externalId stamped" race — dedup query
 *      finds the placeholder, persistEndOfCall ADOPTS it (UPDATE not
 *      CREATE), one Call row exists.
 *   2. "VAPI redials with new id" — second webhook merges onto the
 *      first placeholder (extends case 1).
 *   3. No placeholder in window → falls through to fresh-create path
 *      (regression guard for the normal happy path).
 *   4. Placeholder older than GHOST_ROW_DEDUP_WINDOW_SECONDS → ignored
 *      (window threshold respected).
 *
 * Mock pattern follows tests/lib/voice/poll-stale-calls.test.ts —
 * vi.hoisted in-memory call store keyed by id, so the dedup findFirst
 * + the create/update branches operate against a single in-memory
 * graph.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import type { NormalisedEndOfCallEvent } from "@/lib/voice/types";

interface MockCallRow {
  id: string;
  callerId: string | null;
  source: string;
  voiceProvider: string;
  externalId: string | null;
  transcript: string;
  endedAt: Date | null;
  endSource: string | null;
  // #1344 Slice 4 — `callSequence` retained on the mock interface as
  // null-only so existing where-clauses that check `callSequence !== null`
  // (legacy dedup filter) still type-check; the column is dropped in
  // production. New fan-out lives on `sessionId`.
  callSequence: number | null;
  sessionId: string | null;
  createdAt: Date;
  playbookId: string | null;
  usedPromptId: string | null;
  // #1917 — regulatory expiry column; nullable, populated by
  // stampRegulatoryExpiry() at create-time via the fresh-arrival path.
  regulatoryExpiresAt: Date | null;
}

const stores = vi.hoisted(() => ({
  callStore: new Map<string, MockCallRow>(),
  callerStore: new Map<string, { id: string; phone: string | null; name: string | null }>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: {
      // Find by (externalId, source) — used by the merge branch
      // AND by the new dedup search (with different where shape).
      findFirst: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: Record<string, unknown>;
          select?: Record<string, unknown>;
        }) => {
          const rows = [...stores.callStore.values()].filter((r) => {
            if (where.externalId !== undefined) {
              if (where.externalId === null && r.externalId !== null) return false;
              if (typeof where.externalId === "string" && r.externalId !== where.externalId) return false;
            }
            if (where.source !== undefined && r.source !== where.source) return false;
            if (where.voiceProvider !== undefined && r.voiceProvider !== where.voiceProvider) return false;
            if (where.callerId !== undefined && r.callerId !== where.callerId) return false;
            if (where.endedAt !== undefined) {
              if (where.endedAt === null && r.endedAt !== null) return false;
            }
            if (where.createdAt !== undefined) {
              const cf = where.createdAt as { gt?: Date };
              if (cf.gt && r.createdAt.getTime() <= cf.gt.getTime()) return false;
            }
            if (where.callSequence !== undefined) {
              const cs = where.callSequence as { not: null };
              if (cs.not === null && r.callSequence === null) return false;
            }
            if (where.id !== undefined) {
              const id = where.id as { not?: string };
              if (id.not && r.id === id.not) return false;
            }
            return true;
          });
          if (orderBy) {
            const [key] = Object.keys(orderBy);
            const dir = (orderBy as Record<string, "asc" | "desc">)[key];
            rows.sort((a, b) => {
              const av = (a as unknown as Record<string, unknown>)[key];
              const bv = (b as unknown as Record<string, unknown>)[key];
              if (av instanceof Date && bv instanceof Date) {
                return dir === "desc"
                  ? bv.getTime() - av.getTime()
                  : av.getTime() - bv.getTime();
              }
              if (typeof av === "number" && typeof bv === "number") {
                return dir === "desc" ? bv - av : av - bv;
              }
              return 0;
            });
          }
          return rows[0] ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Partial<MockCallRow> }) => {
        const id = data.id ?? `created-${stores.callStore.size + 1}`;
        const row: MockCallRow = {
          id,
          callerId: data.callerId ?? null,
          source: data.source ?? "vapi",
          voiceProvider: data.voiceProvider ?? "vapi",
          externalId: data.externalId ?? null,
          transcript: data.transcript ?? "",
          endedAt: data.endedAt ?? null,
          endSource: data.endSource ?? null,
          callSequence: data.callSequence ?? null,
          // #1344 Slice 4 — fresh-create branch threads `sessionId`
          // from `createSession`. Honour it in the mock so the test
          // can assert the link.
          sessionId: data.sessionId ?? null,
          createdAt: data.createdAt ?? new Date(),
          playbookId: data.playbookId ?? null,
          usedPromptId: data.usedPromptId ?? null,
          // #1917 — regulatory expiry; spread conditionally by the
          // route, so the field may be absent from `data` when the
          // env retention is disabled.
          regulatoryExpiresAt: data.regulatoryExpiresAt ?? null,
        };
        stores.callStore.set(id, row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MockCallRow>;
        }) => {
          const row = stores.callStore.get(where.id);
          if (!row) {
            const err = new Error("Record not found");
            (err as { code?: string }).code = "P2025";
            throw err;
          }
          Object.assign(row, data);
          return row;
        },
      ),
    },
    caller: {
      findFirst: vi.fn(
        async ({ where }: { where: { phone: string } }) => {
          for (const c of stores.callerStore.values()) {
            if (c.phone === where.phone) return c;
          }
          return null;
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { phone: string; name: string };
        }) => {
          const id = `caller-${stores.callerStore.size + 1}`;
          const c = { id, phone: data.phone, name: data.name };
          stores.callerStore.set(id, c);
          return c;
        },
      ),
    },
    composedPrompt: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: vi.fn().mockResolvedValue(null),
}));

// #1344 Slice 4 — `persistEndOfCall` now calls `createSession({kind:VOICE_CALL})`
// for fresh-arrival rows (no placeholder match within the dedup window).
// Mock so the test doesn't need to stand up `CallerSequenceCounter` /
// PlaybookCurriculum / etc. The fresh-create branch will read
// `result.session.id` and write it onto the new Call row's `sessionId`.
vi.mock("@/lib/voice/create-session", () => ({
  createSession: vi.fn(async (_args: { callerId: string; kind: string }) => ({
    session: {
      id: "fresh-session-1",
      sequenceNumber: 1,
      learnerFacingNumber: 1,
      kind: _args.kind,
    },
    playbookId: null,
    requestedModuleId: null,
    curriculumModuleId: null,
    usedPromptId: null,
    voiceConfigSnapshot: null,
    countsTowardLearnerNumber: true,
    countsTowardPipelineNumber: true,
    skipStages: [] as string[],
  })),
}));

// #1344 Slice 4 — persistEndOfCall fires `endSession` for fresh rows.
// Mock to a no-op so the test doesn't need the Session writer plumbing.
vi.mock("@/lib/voice/end-session", () => ({
  endSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/voice/load-voice-config", () => ({
  loadResolvedVoiceConfig: vi.fn().mockResolvedValue({
    fields: { autoPipeline: { value: false } },
  }),
}));

vi.mock("@/lib/voice/sse-registry", () => ({
  broadcastToCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  config: {
    app: { url: "http://localhost:3000" },
    security: { internalApiSecret: "test-secret" },
    ai: {
      claude: { model: "claude-3-5-sonnet", maxTokens: 4096, temperature: 0.7 },
      openai: { model: "gpt-4o-mini", maxTokens: 4096, temperature: 0.7 },
    },
    // #1917 — stampRegulatoryExpiry reads this at create-time. Zero
    // means "no env-driven retention" so the column stays NULL in
    // the mock store — matches the existing post-fix-create assertions
    // (the field is added to MockCallRow but defaults to null when
    // env retention is disabled, which preserves the pre-#1917 shape).
    retention: { callerDataDays: 0, auditLogDays: 365 },
  },
}));

// route-handlers transitively imports lib/voice/tool-router which pulls
// in lib/fallback-settings which reads config.ai.claude at module load.
// Short-circuit the tool-router so the chain stays loadable.
vi.mock("@/lib/voice/tool-router", () => ({
  routeToolCall: vi.fn(),
}));

// Build a normalised event with sensible defaults.
function makeEvent(overrides: Partial<NormalisedEndOfCallEvent> = {}): NormalisedEndOfCallEvent {
  return {
    eventKind: "full",
    externalCallId: "vapi-call-abc123",
    customerPhone: "+447700900000",
    customerName: "Test Caller",
    transcript: "Hello world",
    capture: {
      durationSeconds: 42,
      endedReason: "customer-ended-call",
    },
    providerRaw: { test: true },
    ...overrides,
  };
}

// Defer the import until AFTER vi.mock has registered — vi.hoisted
// gets us the stores up-front, but the SUT must load lazily so the
// mocked prisma is wired in by the time persistEndOfCall reads it.
async function loadSut() {
  return await import("@/lib/voice/route-handlers");
}

describe("#1345 — persistEndOfCall ghost-row dedup", () => {
  beforeEach(() => {
    stores.callStore.clear();
    stores.callerStore.clear();
    vi.clearAllMocks();
    delete process.env.GHOST_ROW_DEDUP_WINDOW_SECONDS;
  });

  it("adopts a pending placeholder when webhook lands before externalId is stamped", async () => {
    // Arrange — caller exists; a placeholder Call from /outbound-dial
    // sits with externalId=NULL, endedAt=NULL, 5s old.
    const callerId = "ae3362f0-3e66-4e49-96f1-d83e10bce321";
    stores.callerStore.set(callerId, {
      id: callerId,
      phone: "+447700900000",
      name: "Bertie Tallstaff",
    });
    stores.callStore.set("placeholder-1", {
      id: "placeholder-1",
      callerId,
      source: "vapi",
      voiceProvider: "vapi",
      externalId: null,
      transcript: "",
      endedAt: null,
      endSource: null,
      callSequence: null,
      sessionId: null,
      createdAt: new Date(Date.now() - 5000),
      playbookId: null,
      usedPromptId: null,
    });

    const { persistEndOfCall } = await loadSut();

    // Act
    const result = await persistEndOfCall(makeEvent(), "vapi", {
      sourceTag: "webhook",
    });

    // Assert — exactly one Call row, adopted (id unchanged), externalId stamped.
    expect(stores.callStore.size).toBe(1);
    const adopted = stores.callStore.get("placeholder-1");
    expect(adopted).toBeDefined();
    expect(adopted?.externalId).toBe("vapi-call-abc123");
    expect(adopted?.endedAt).not.toBeNull();
    expect(adopted?.endSource).toBe("webhook");
    expect(adopted?.transcript).toBe("Hello world");
    expect(result.ok).toBe(true);
    expect(result.callId).toBe("placeholder-1");
    expect(result.merged).toBe(true);
  });

  it("falls through to fresh-create when no placeholder exists within the window", async () => {
    // Arrange — caller exists; NO placeholder.
    const callerId = "caller-no-placeholder";
    stores.callerStore.set(callerId, {
      id: callerId,
      phone: "+447700900001",
      name: "No Placeholder",
    });

    const { persistEndOfCall } = await loadSut();

    // Act
    const result = await persistEndOfCall(
      makeEvent({ customerPhone: "+447700900001" }),
      "vapi",
      { sourceTag: "webhook" },
    );

    // Assert — one fresh Call row was created.
    expect(stores.callStore.size).toBe(1);
    const created = [...stores.callStore.values()][0];
    expect(created.externalId).toBe("vapi-call-abc123");
    expect(created.endedAt).not.toBeNull();
    // #1344 Slice 4 — `Call.callSequence` dropped; sequencing now lives on
    // `Session.learnerFacingNumber`. The fresh-create branch threads the
    // mocked `createSession` Session id onto `Call.sessionId`.
    expect(created.sessionId).toBe("fresh-session-1");
    expect(result.ok).toBe(true);
    expect(result.merged).toBeUndefined();
  });

  it("ignores placeholders older than GHOST_ROW_DEDUP_WINDOW_SECONDS (default 30s)", async () => {
    // Arrange — caller exists; placeholder is 60s old (beyond the
    // 30s default window) so dedup should NOT adopt it.
    const callerId = "caller-stale-placeholder";
    stores.callerStore.set(callerId, {
      id: callerId,
      phone: "+447700900002",
      name: "Stale Placeholder",
    });
    stores.callStore.set("placeholder-stale", {
      id: "placeholder-stale",
      callerId,
      source: "vapi",
      voiceProvider: "vapi",
      externalId: null,
      transcript: "",
      endedAt: null,
      endSource: null,
      callSequence: null,
      sessionId: null,
      createdAt: new Date(Date.now() - 60_000),
      playbookId: null,
      usedPromptId: null,
    });

    const { persistEndOfCall } = await loadSut();

    // Act
    const result = await persistEndOfCall(
      makeEvent({ customerPhone: "+447700900002" }),
      "vapi",
      { sourceTag: "webhook" },
    );

    // Assert — fresh row created; the stale placeholder lingers.
    // (poll-stale-calls will eventually reap it.)
    expect(stores.callStore.size).toBe(2);
    const placeholder = stores.callStore.get("placeholder-stale");
    expect(placeholder?.externalId).toBeNull();
    expect(placeholder?.endedAt).toBeNull();
    expect(result.merged).toBeUndefined();
  });

  it("respects GHOST_ROW_DEDUP_WINDOW_SECONDS env override (wider window)", async () => {
    // Arrange — placeholder is 60s old. Env override widens the window
    // to 120s so the placeholder MUST be adopted.
    process.env.GHOST_ROW_DEDUP_WINDOW_SECONDS = "120";
    const callerId = "caller-wide-window";
    stores.callerStore.set(callerId, {
      id: callerId,
      phone: "+447700900003",
      name: "Wide Window",
    });
    stores.callStore.set("placeholder-wide", {
      id: "placeholder-wide",
      callerId,
      source: "vapi",
      voiceProvider: "vapi",
      externalId: null,
      transcript: "",
      endedAt: null,
      endSource: null,
      callSequence: null,
      sessionId: null,
      createdAt: new Date(Date.now() - 60_000),
      playbookId: null,
      usedPromptId: null,
    });

    const { persistEndOfCall } = await loadSut();

    // Act
    await persistEndOfCall(
      makeEvent({ customerPhone: "+447700900003" }),
      "vapi",
      { sourceTag: "webhook" },
    );

    // Assert — adoption happened despite the placeholder being 60s old.
    expect(stores.callStore.size).toBe(1);
    const adopted = stores.callStore.get("placeholder-wide");
    expect(adopted?.externalId).toBe("vapi-call-abc123");
  });

  it("VAPI redials with new id → second webhook merges onto fresh placeholder (no fresh-row duplicate)", async () => {
    // Arrange — caller exists. First dial places a placeholder, then
    // VAPI re-dials with a different call id (e.g. fast retry). The
    // SECOND webhook lands and must adopt the placeholder, not create
    // a third row.
    const callerId = "caller-redial";
    stores.callerStore.set(callerId, {
      id: callerId,
      phone: "+447700900004",
      name: "Redial",
    });
    stores.callStore.set("placeholder-redial", {
      id: "placeholder-redial",
      callerId,
      source: "vapi",
      voiceProvider: "vapi",
      externalId: null,
      transcript: "",
      endedAt: null,
      endSource: null,
      callSequence: null,
      sessionId: null,
      createdAt: new Date(Date.now() - 2000),
      playbookId: null,
      usedPromptId: null,
    });

    const { persistEndOfCall } = await loadSut();

    // Act — webhook arrives carrying a brand-new externalId.
    const result = await persistEndOfCall(
      makeEvent({
        customerPhone: "+447700900004",
        externalCallId: "vapi-call-redial-xyz",
      }),
      "vapi",
      { sourceTag: "webhook" },
    );

    // Assert — placeholder ADOPTED with the redial's externalId; one row only.
    expect(stores.callStore.size).toBe(1);
    const adopted = stores.callStore.get("placeholder-redial");
    expect(adopted?.externalId).toBe("vapi-call-redial-xyz");
    expect(result.merged).toBe(true);
  });
});

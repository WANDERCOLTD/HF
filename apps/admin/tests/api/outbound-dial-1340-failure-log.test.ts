/**
 * #1340 (epic #1338 Slice 1) — outbound-dial FailureLog wiring.
 *
 * AC vitest: simulated VAPI 502 → FailureLog row + Session.status=FAILED
 *            + ADAPT signal emitted (downstream via extractFailureAdaptation).
 *
 * Scope:
 *   1. VAPI POST /call returns non-2xx → recordCallFailure writes a
 *      FailureLog(kind=VAPI_502), mints a parent Session(status=FAILED),
 *      and preserves the placeholder Call row.
 *   2. The emitted FailureLog, when piped into extractFailureAdaptation,
 *      yields a non-empty soft signal (the ADAPT-side wiring point).
 *   3. Pre-Slice 1 behaviour (placeholder.delete) is gone — assert that
 *      the Call row stays in the store.
 *
 * Mock shape mirrors `outbound-dial-1345.test.ts` (#1345 Part B) — same
 * in-memory store; extended with Session + FailureLog tables.
 */

import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

interface MockCall {
  id: string;
  callerId: string;
  source: string;
  voiceProvider: string;
  transcript: string;
  externalId: string | null;
  sessionId: string | null;
  endedAt: Date | null;
  endSource: string | null;
  voiceEndedReason: string | null;
  playbookId: string | null;
  createdAt: Date;
}

interface MockSession {
  id: string;
  callerId: string;
  playbookId: string | null;
  kind: string;
  sequenceNumber: number;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  skipStages: string[];
  countsTowardLearnerNumber: boolean;
  countsTowardPipelineNumber: boolean;
}

interface MockFailureLog {
  id: string;
  sessionId: string;
  kind: string;
  attemptNumber: number;
  errorPayload: Record<string, unknown>;
  occurredAt: Date;
}

const stores = vi.hoisted(() => ({
  callStore: new Map<string, MockCall>(),
  sessionStore: new Map<string, MockSession>(),
  failureLogStore: new Map<string, MockFailureLog>(),
  callerStore: new Map<
    string,
    { id: string; phone: string | null; name: string | null }
  >(),
  providerStore: new Map<
    string,
    {
      id: string;
      slug: string;
      adapterKey: string;
      enabled: boolean;
      credentials: Record<string, unknown>;
      config: Record<string, unknown>;
    }
  >(),
  // 502 simulation toggle (VAPI POST /call non-2xx response).
  vapiReturns502: { value: false },
  // Track delete calls — should remain empty under #1340.
  deleteCalls: [] as string[],
  logCalls: [] as Array<{ event: string; payload: Record<string, unknown> }>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: {
      create: vi.fn(async ({ data }: { data: Partial<MockCall> }) => {
        const id = `call-${stores.callStore.size + 1}`;
        const row: MockCall = {
          id,
          callerId: data.callerId ?? "",
          source: data.source ?? "vapi",
          voiceProvider: data.voiceProvider ?? "vapi",
          transcript: data.transcript ?? "",
          externalId: data.externalId ?? null,
          // #1344 Slice 4 — outbound-dial now writes `sessionId` on the
          // placeholder Call (linking to the Session created by
          // `createSession`). The mock honours it so the
          // `recordCallFailure` else-branch (sessionId-not-null) is
          // exercised — otherwise the test would mint a second Session.
          sessionId: data.sessionId ?? null,
          endedAt: null,
          endSource: null,
          voiceEndedReason: null,
          playbookId: data.playbookId ?? null,
          createdAt: new Date(),
        };
        stores.callStore.set(id, row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
          const row = stores.callStore.get(where.id);
          if (!row) return null;
          // Honour select to mirror real Prisma shape.
          if (select) {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(select)) {
              if (select[k]) out[k] = (row as unknown as Record<string, unknown>)[k];
            }
            return out;
          }
          return row;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MockCall>;
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
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; sessionId?: null; endedAt?: null };
          data: Partial<MockCall>;
        }) => {
          const row = stores.callStore.get(where.id);
          if (!row) return { count: 0 };
          if (where.sessionId === null && row.sessionId !== null) return { count: 0 };
          if (where.endedAt === null && row.endedAt !== null) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        // #1340 — should NOT be called by any error path. Track it so
        // the test can assert the pre-Slice 1 behaviour is dead.
        stores.deleteCalls.push(where.id);
        stores.callStore.delete(where.id);
        return { id: where.id };
      }),
    },
    caller: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return stores.callerStore.get(where.id) ?? null;
      }),
    },
    voiceProvider: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        return stores.providerStore.get(where.slug) ?? null;
      }),
    },
    session: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { callerId: string; kind: string };
        }) => {
          const matches = [...stores.sessionStore.values()].filter(
            (s) => s.callerId === where.callerId && s.kind === where.kind,
          );
          if (matches.length === 0) return null;
          matches.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
          return matches[0];
        },
      ),
      create: vi.fn(async ({ data }: { data: Partial<MockSession> }) => {
        const id = `session-${stores.sessionStore.size + 1}`;
        const row: MockSession = {
          id,
          callerId: data.callerId ?? "",
          playbookId: data.playbookId ?? null,
          kind: data.kind ?? "VOICE_CALL",
          sequenceNumber: data.sequenceNumber ?? 1,
          status: data.status ?? "STARTED",
          startedAt: data.startedAt ?? new Date(),
          endedAt: data.endedAt ?? null,
          skipStages: data.skipStages ?? [],
          countsTowardLearnerNumber: data.countsTowardLearnerNumber ?? true,
          countsTowardPipelineNumber: data.countsTowardPipelineNumber ?? true,
        };
        stores.sessionStore.set(id, row);
        return row;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: { in: string[] } };
          data: Partial<MockSession>;
        }) => {
          const row = stores.sessionStore.get(where.id);
          if (!row) return { count: 0 };
          if (where.status?.in && !where.status.in.includes(row.status))
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    failureLog: {
      count: vi.fn(
        async ({
          where,
        }: {
          where: { sessionId: string; kind: string };
        }) => {
          return [...stores.failureLogStore.values()].filter(
            (f) => f.sessionId === where.sessionId && f.kind === where.kind,
          ).length;
        },
      ),
      create: vi.fn(async ({ data }: { data: Partial<MockFailureLog> }) => {
        const id = `failurelog-${stores.failureLogStore.size + 1}`;
        const row: MockFailureLog = {
          id,
          sessionId: data.sessionId ?? "",
          kind: data.kind ?? "",
          attemptNumber: data.attemptNumber ?? 1,
          errorPayload:
            (data.errorPayload as Record<string, unknown>) ?? {},
          occurredAt: data.occurredAt ?? new Date(),
        };
        stores.failureLogStore.set(id, row);
        return row;
      }),
    },
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "admin-user", role: "ADMIN" } },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/learner-scope", () => ({
  resolveCallerScopeForReading: vi.fn(
    async (_session: unknown, callerId: string) => ({ scopedCallerId: callerId }),
  ),
  isScopeError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/voice/resolve-voice-provider", () => ({
  resolveVoiceProviderForCaller: vi.fn().mockResolvedValue({ slug: "vapi" }),
}));

vi.mock("@/lib/voice/build-assistant-config", () => ({
  buildAssistantConfigForCaller: vi.fn().mockResolvedValue({
    assistantConfig: { assistant: { model: { provider: "anthropic" } } },
  }),
}));

// #1344 Slice 4 — `create-call-entering-pipeline` wrapper deleted; the
// outbound-dial route now calls `createSession({kind:VOICE_CALL})` then
// `prisma.call.create` inline. Mock `createSession` to mint a Session
// row in the test store and return the canonical builder shape; the
// Call row is written by the real route through the `prisma.call.create`
// stub above.
vi.mock("@/lib/voice/create-session", () => ({
  createSession: vi.fn(
    async (args: {
      callerId: string;
      kind: string;
      source?: string;
      voiceProvider?: string | null;
    }) => {
      const id = `session-${stores.sessionStore.size + 1}`;
      const row: MockSession = {
        id,
        callerId: args.callerId,
        playbookId: null,
        kind: args.kind,
        sequenceNumber: stores.sessionStore.size + 1,
        status: "STARTED",
        startedAt: new Date(),
        endedAt: null,
        skipStages: [],
        countsTowardLearnerNumber: args.kind === "VOICE_CALL",
        countsTowardPipelineNumber: true,
      };
      stores.sessionStore.set(id, row);
      return {
        session: {
          id,
          sequenceNumber: row.sequenceNumber,
          learnerFacingNumber: null,
          kind: args.kind,
        },
        playbookId: null,
        requestedModuleId: null,
        curriculumModuleId: null,
        usedPromptId: null,
        voiceConfigSnapshot: null,
        countsTowardLearnerNumber: row.countsTowardLearnerNumber,
        countsTowardPipelineNumber: row.countsTowardPipelineNumber,
        skipStages: row.skipStages,
      };
    },
  ),
}));

vi.mock("@/lib/voice/telemetry", () => ({
  startVoiceSpan: vi.fn().mockReturnValue(() => undefined),
  logVoiceEvent: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: vi.fn(
    (_kind: string, event: string, payload: Record<string, unknown>) => {
      stores.logCalls.push({ event, payload });
    },
  ),
}));

vi.mock("@/lib/voice/phone-format", () => ({
  toE164: vi.fn((p: string) => p),
  isE164: vi.fn().mockReturnValue(true),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  stores.callStore.clear();
  stores.sessionStore.clear();
  stores.failureLogStore.clear();
  stores.callerStore.clear();
  stores.providerStore.clear();
  stores.deleteCalls.length = 0;
  stores.logCalls.length = 0;
  stores.vapiReturns502.value = false;

  global.fetch = vi.fn().mockImplementation(async () => {
    if (stores.vapiReturns502.value) {
      return {
        ok: false,
        status: 502,
        json: async () => ({
          error: "Pipeline error: provider returned 502",
          message: "voice provider rejected the request",
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "vapi-call-xyz" }),
    } as Response;
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

function seedState(): void {
  stores.callerStore.set("caller-1", {
    id: "caller-1",
    phone: "+447700900000",
    name: "Bertie",
  });
  stores.providerStore.set("vapi", {
    id: "vp-1",
    slug: "vapi",
    adapterKey: "vapi",
    enabled: true,
    credentials: { apiKey: "test-key" },
    config: { phoneNumberId: "test-phone-id" },
  });
}

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/voice/calls/outbound-dial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callerId: "caller-1" }),
  });
}

describe("#1340 — outbound-dial VAPI 502 → FailureLog + Session(FAILED)", () => {
  it("VAPI 502: writes FailureLog(VAPI_502), mints Session(FAILED), preserves Call placeholder", async () => {
    seedState();
    stores.vapiReturns502.value = true;
    const { POST } = await import("@/app/api/voice/calls/outbound-dial/route");

    const res = await POST(makeRequest());
    const body = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("VAPI returned");

    // (AC) FailureLog row created with kind=VAPI_502.
    const failures = [...stores.failureLogStore.values()];
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("VAPI_502");
    expect(failures[0].errorPayload.stage).toBe("vapi_post_call");
    expect(failures[0].errorPayload.httpStatus).toBe(502);

    // (AC) parent Session row exists with status=FAILED + skipStages.
    const sessions = [...stores.sessionStore.values()];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("FAILED");
    expect(sessions[0].kind).toBe("VOICE_CALL");
    expect(sessions[0].skipStages).toEqual([
      "EXTRACT",
      "SCORE_AGENT",
      "PROSODY",
      "REWARD",
    ]);
    expect(sessions[0].countsTowardLearnerNumber).toBe(false);

    // (AC) Call placeholder is PRESERVED — pre-Slice 1 deleted it,
    // costing the Tune tab its FAILED card.
    expect(stores.callStore.size).toBe(1);
    expect(stores.deleteCalls).toHaveLength(0);

    // Call is now linked to its parent Session.
    const call = [...stores.callStore.values()][0];
    expect(call.sessionId).toBe(sessions[0].id);
    expect(call.endedAt).not.toBeNull();

    // (AC) ADAPT-side: pipe the emitted FailureLog into
    //      extractFailureAdaptation → non-empty signal.
    const { extractFailureAdaptation } = await import(
      "@/lib/pipeline/extract-failure-adaptation"
    );
    const signal = extractFailureAdaptation({
      id: failures[0].id,
      sessionId: failures[0].sessionId,
      kind: failures[0].kind,
      attemptNumber: failures[0].attemptNumber,
      errorPayload: failures[0].errorPayload,
      occurredAt: failures[0].occurredAt,
    } as unknown as Parameters<typeof extractFailureAdaptation>[0]);
    expect(signal).not.toBeNull();
    expect(signal?.signal.length).toBeGreaterThan(0);
    expect(signal?.kind).toBe("VAPI_502");
  });

  it("OUTBOUND_DIAL_FAILED: VAPI fetch throws → FailureLog kind=OUTBOUND_DIAL_FAILED, Call preserved", async () => {
    seedState();
    // Force fetch to throw rather than return 502.
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network timeout"));
    const { POST } = await import("@/app/api/voice/calls/outbound-dial/route");

    const res = await POST(makeRequest());
    const body = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("Failed to call VAPI");

    const failures = [...stores.failureLogStore.values()];
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe("OUTBOUND_DIAL_FAILED");
    expect(failures[0].errorPayload.stage).toBe("vapi_fetch_throw");
    expect(failures[0].errorPayload.errorMessage).toContain("network timeout");

    // No bare deletes.
    expect(stores.deleteCalls).toHaveLength(0);
    expect(stores.callStore.size).toBe(1);
  });
});

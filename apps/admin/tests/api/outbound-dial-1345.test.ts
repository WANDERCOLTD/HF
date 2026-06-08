/**
 * #1345 Part B — outbound-dial externalId-stamp safety.
 *
 * Covers the try/catch wrap added at app/api/voice/calls/outbound-dial/
 * route.ts around the post-VAPI `prisma.call.update({ externalId })`.
 *
 *   1. Happy path — externalId stamps normally, placeholder kept,
 *      200 returned. (Regression guard.)
 *   2. Stamp exception — Prisma throws on the update; route deletes the
 *      placeholder explicitly, logs structured context, returns 502.
 */

import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

interface MockCall {
  id: string;
  callerId: string;
  source: string;
  voiceProvider: string;
  transcript: string;
  externalId: string | null;
}

const stores = vi.hoisted(() => ({
  callStore: new Map<string, MockCall>(),
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
  // Controls whether prisma.call.update throws on the stamp.
  failStampUpdate: { value: false },
  // Track delete calls so we can assert the cleanup path.
  deleteCalls: [] as string[],
  // Track log calls for the structured-context assertion.
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
          data: Partial<MockCall>;
        }) => {
          if (stores.failStampUpdate.value) {
            stores.failStampUpdate.value = false; // one-shot
            throw new Error("simulated prisma exception on externalId stamp");
          }
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
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
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
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: {
      user: {
        id: "admin-user",
        role: "ADMIN",
      },
    },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/learner-scope", () => ({
  resolveCallerScopeForReading: vi.fn(async (_session: unknown, callerId: string) => ({
    scopedCallerId: callerId,
  })),
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

// Mock global fetch — VAPI's POST /call.
const originalFetch = global.fetch;

beforeEach(() => {
  stores.callStore.clear();
  stores.callerStore.clear();
  stores.providerStore.clear();
  stores.deleteCalls.length = 0;
  stores.logCalls.length = 0;
  stores.failStampUpdate.value = false;
  // Re-stub global fetch (don't clear vi mocks, just rewire fetch).
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: "vapi-call-xyz" }),
  } as Response);
});

afterAll(() => {
  global.fetch = originalFetch;
});

async function loadRoute() {
  return await import("@/app/api/voice/calls/outbound-dial/route");
}

function makeRequest() {
  return new Request("http://localhost:3000/api/voice/calls/outbound-dial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callerId: "caller-1" }),
  });
}

function seedHappyState() {
  stores.callerStore.set("caller-1", {
    id: "caller-1",
    phone: "+447700900000",
    name: "Test Caller",
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

describe("#1345 Part B — outbound-dial externalId-stamp safety", () => {
  it("happy path: stamps externalId, placeholder kept, 200 returned", async () => {
    seedHappyState();
    const { POST } = await loadRoute();

    const res = await POST(makeRequest());
    const body = (await res.json()) as { ok: boolean; vapiCallId: string };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.vapiCallId).toBe("vapi-call-xyz");
    expect(stores.callStore.size).toBe(1);
    const placeholder = [...stores.callStore.values()][0];
    expect(placeholder.externalId).toBe("vapi-call-xyz");
    expect(stores.deleteCalls).toHaveLength(0);
  });

  it("stamp exception: placeholder explicitly deleted, 502 returned, structured error logged", async () => {
    seedHappyState();
    stores.failStampUpdate.value = true;
    const { POST } = await loadRoute();

    const res = await POST(makeRequest());
    const body = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("externalId");
    expect(body.error).toContain("simulated prisma exception");
    // Placeholder explicitly cleaned up — no ghost row left.
    expect(stores.deleteCalls).toHaveLength(1);
    expect(stores.callStore.size).toBe(0);
    // Structured error logged with captured context.
    const stampLog = stores.logCalls.find(
      (l) => l.event === "voice.outbound_dial.externalid_stamp_failed",
    );
    expect(stampLog).toBeDefined();
    expect(stampLog?.payload.callerId).toBe("caller-1");
    expect(stampLog?.payload.vapiCallId).toBe("vapi-call-xyz");
    expect(stampLog?.payload.providerSlug).toBe("vapi");
    expect(stampLog?.payload.error).toContain("simulated prisma exception");
  });
});

/**
 * Poll fallback unit tests (#1178).
 *
 * 6 acceptance-criteria vitests:
 *   1. Recovery — VAPI says `pipeline-error-openai-llm-failed`, persist + tag
 *   2. Idempotency — Call already has endedAt → no VAPI call, no DB write
 *   3. VAPI 404 → row marked vapi_poll_failed, stops re-polling
 *   4. VAPI 401 → telemetry-only, NOT marked failed (apiKey may rotate)
 *   5. VAPI 429 → batch aborts early, abortedOn429:true
 *   6. RACE: webhook lands during poll → poll's update is a structural
 *           no-op via `where: { endedAt: null }` guard
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted runs BEFORE the vi.mock factories so the maps are
// instantiated by the time the factory closures execute. Dodges the
// "Cannot access 'callStore' before initialization" hoist bug.
const stores = vi.hoisted(() => ({
  callStore: new Map<string, Record<string, unknown>>(),
  providerStore: new Map<string, Record<string, unknown>>(),
  persistCalls: [] as Array<{ sourceTag: string; externalId: string | null }>,
}));
const { callStore, providerStore, persistCalls } = stores;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        const rows = [...stores.callStore.values()].filter((r) => {
          if (r.endedAt !== null) return false;
          if (!r.externalId) return false;
          if (r.source !== (where.source as string)) return false;
          const cutoff = (where.createdAt as { lt: Date }).lt;
          if ((r.createdAt as Date).getTime() >= cutoff.getTime()) return false;
          return true;
        });
        return rows.slice(0, take ?? rows.length);
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; endedAt?: null };
          data: Record<string, unknown>;
        }) => {
          const row = stores.callStore.get(where.id);
          if (!row) {
            const err = new Error("Record not found");
            (err as { code?: string }).code = "P2025";
            throw err;
          }
          if (where.endedAt === null && row.endedAt !== null) {
            const err = new Error("Record not found");
            (err as { code?: string }).code = "P2025";
            throw err;
          }
          Object.assign(row, data);
          return row;
        },
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { externalId: string; source: string } }) => {
          for (const r of stores.callStore.values()) {
            if (r.externalId === where.externalId && r.source === where.source) {
              return r;
            }
          }
          return null;
        },
      ),
    },
    voiceProvider: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        return stores.providerStore.get(where.slug) ?? null;
      }),
    },
  },
}));

vi.mock("@/lib/voice/provider-factory", () => ({
  getVoiceProvider: vi.fn().mockResolvedValue({
    slug: "vapi",
    normaliseEndOfCallEvent: (body: { message?: { call?: { id?: string }; endedReason?: string; durationSeconds?: number; cost?: number } }) => {
      const msg = body.message ?? {};
      const callId = msg.call?.id ?? null;
      if (!callId) return null;
      return {
        eventKind: "full",
        externalCallId: callId,
        customerPhone: null,
        customerName: null,
        transcript: "(stub)",
        capture: {
          endedReason: msg.endedReason,
          durationSeconds: msg.durationSeconds,
          costUsd: msg.cost,
        },
        providerRaw: body,
      };
    },
  }),
}));

vi.mock("@/lib/voice/route-handlers", () => ({
  persistEndOfCall: vi.fn(
    async (
      event: { externalCallId: string; capture: { endedReason?: string } },
      _slug: string,
      opts: { sourceTag?: string } = {},
    ) => {
      stores.persistCalls.push({
        sourceTag: opts.sourceTag ?? "webhook",
        externalId: event.externalCallId,
      });
      const row = [...stores.callStore.values()].find(
        (r) => r.externalId === event.externalCallId,
      );
      if (!row) {
        return { ok: true, callId: "unknown" };
      }
      // Race-loss simulation: caller controls via setting endedAt before calling.
      if (opts.sourceTag === "fallback" && row.endedAt !== null) {
        return {
          ok: true,
          callId: row.id as string,
          merged: true,
          skippedRace: true,
        };
      }
      row.endedAt = new Date();
      row.voiceEndedReason = event.capture.endedReason ?? null;
      return { ok: true, callId: row.id as string, merged: true };
    },
  ),
}));

vi.mock("@/lib/voice/telemetry", () => ({
  logVoiceEvent: vi.fn(),
}));

import { pollStaleVoiceCalls } from "@/lib/voice/poll-stale-calls";

function seedProvider(): void {
  providerStore.set("vapi", {
    credentials: { apiKey: "test-key", webhookSecret: "secret" },
    enabled: true,
  });
}

function seedStaleCall(
  overrides: Partial<{
    id: string;
    externalId: string;
    createdAt: Date;
    endedAt: Date | null;
    source: string;
  }> = {},
): string {
  const id = overrides.id ?? `c_${Math.random().toString(36).slice(2, 8)}`;
  callStore.set(id, {
    id,
    externalId: overrides.externalId ?? `vapi_${id}`,
    source: overrides.source ?? "vapi",
    createdAt: overrides.createdAt ?? new Date(Date.now() - 5 * 60 * 1000),
    endedAt: overrides.endedAt ?? null,
  });
  return id;
}

describe("pollStaleVoiceCalls", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    callStore.clear();
    providerStore.clear();
    persistCalls.length = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    seedProvider();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("recovers a stale call when VAPI reports it ended (pipeline-error)", async () => {
    const id = seedStaleCall({ externalId: "vapi_failed_1" });
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ended",
          endedReason: "pipeline-error-openai-llm-failed",
          call: { id: "vapi_failed_1" },
          durationSeconds: 8,
          cost: 0.011,
        }),
        { status: 200 },
      ),
    );
    const result = await pollStaleVoiceCalls();
    expect(result.stale).toBe(1);
    expect(result.recovered).toBe(1);
    expect(persistCalls).toEqual([
      { sourceTag: "fallback", externalId: "vapi_failed_1" },
    ]);
    const row = callStore.get(id)!;
    expect(row.endedAt).not.toBeNull();
    expect(row.voiceEndedReason).toBe("pipeline-error-openai-llm-failed");
  });

  it("idempotency — a call that already has endedAt is excluded from the stale query", async () => {
    seedStaleCall({ endedAt: new Date() }); // Has endedAt — not stale
    const result = await pollStaleVoiceCalls();
    expect(result.stale).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("VAPI 404 → marks row vapi_poll_failed (stops re-polling)", async () => {
    const id = seedStaleCall({ externalId: "vapi_gone" });
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    const result = await pollStaleVoiceCalls();
    expect(result.notFound).toBe(1);
    const row = callStore.get(id)!;
    expect(row.voiceEndedReason).toBe("vapi_poll_failed");
    expect(row.endedAt).not.toBeNull();
  });

  it("VAPI 401 → counts as authFailed, does NOT mark the row (apiKey may rotate)", async () => {
    const id = seedStaleCall({ externalId: "vapi_unauth" });
    fetchSpy.mockResolvedValue(new Response("nope", { status: 401 }));
    const result = await pollStaleVoiceCalls();
    expect(result.authFailed).toBe(1);
    const row = callStore.get(id)!;
    expect(row.voiceEndedReason).toBeUndefined();
    expect(row.endedAt).toBeNull();
  });

  it("VAPI 429 → batch aborts early with abortedOn429:true", async () => {
    seedStaleCall({ externalId: "vapi_1" });
    seedStaleCall({ externalId: "vapi_2" });
    seedStaleCall({ externalId: "vapi_3" });
    // First call: 429. p-limit concurrency=3 so multiple may fire before
    // the abort takes effect; assert the abort flag landed.
    fetchSpy.mockResolvedValue(new Response("slow down", { status: 429 }));
    const result = await pollStaleVoiceCalls({ concurrency: 1 });
    expect(result.abortedOn429).toBe(true);
    expect(result.attempted).toBeLessThanOrEqual(3);
    // No row should be marked recovered or failed — 429 leaves the rows alone.
    expect(result.recovered).toBe(0);
    expect(result.notFound).toBe(0);
  });

  it("RACE — webhook lands during the poll cycle → persistEndOfCall returns skippedRace:true", async () => {
    const id = seedStaleCall({ externalId: "vapi_race" });
    // Simulate the webhook landing BEFORE persistEndOfCall is invoked
    // by pre-stamping endedAt on the row.
    fetchSpy.mockImplementation(async () => {
      callStore.get(id)!.endedAt = new Date(); // webhook beat us
      return new Response(
        JSON.stringify({
          status: "ended",
          endedReason: "customer-ended-call",
          call: { id: "vapi_race" },
        }),
        { status: 200 },
      );
    });
    const result = await pollStaleVoiceCalls();
    expect(result.racedAgainstWebhook).toBe(1);
    expect(result.recovered).toBe(0);
  });
});

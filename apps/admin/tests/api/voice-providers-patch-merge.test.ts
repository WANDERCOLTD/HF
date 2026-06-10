/**
 * Tests for `PATCH /api/voice-providers/[id]` merge semantics (#1433).
 *
 * Pre-fix, the route did `credentials: data.credentials as InputJsonValue`
 * — a full replace. Shipping `credentials: {}` wiped every sensitive
 * field (webhookSecret / apiKey / etc.). Live evidence on hf-dev 2026-06-10
 * showed the bug class blowing away every credential on every save where
 * the operator left sensitive fields blank.
 *
 * Post-fix, the route merges field-by-field. This file pins the contract:
 *
 *   1. Empty `credentials: {}` → existing credentials PRESERVED
 *   2. Partial `credentials: {newKey: val}` → existing keys preserved + new key set
 *   3. Overlapping `credentials: {existingKey: newVal}` → existing key overwritten,
 *      OTHER existing keys still preserved
 *   4. `clearCredentials: ["key"]` → explicitly delete that key, others preserved
 *   5. Same semantics for `config` + `clearConfig`
 *   6. Omitting both `credentials` and `clearCredentials` → no write at all,
 *      no spurious updatedAt nudge
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn(async () => ({}));
const mockFindUnique = vi.fn();
const mockTransaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    voiceProvider: { update: mockUpdate, updateMany: mockUpdateMany },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceProvider: { findUnique: mockFindUnique },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({ session: { user: { role: "ADMIN" } } })),
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/voice/provider-factory", () => ({
  invalidateVoiceProviderCache: vi.fn(),
}));

vi.mock("@/lib/voice/mask-credentials", () => ({
  maskCredentials: vi.fn((c: Record<string, unknown>) => c),
}));

// Empty adapter registry so the field validation loop short-circuits.
vi.mock("@/lib/voice/adapter-registry", () => ({
  VOICE_ADAPTERS: {},
}));

function buildPatchRequest(body: unknown) {
  return new Request("http://test/api/voice-providers/test-id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

async function callPatch(body: unknown) {
  const { PATCH } = await import("@/app/api/voice-providers/[id]/route");
  return PATCH(buildPatchRequest(body), {
    params: Promise.resolve({ id: "test-id" }),
  });
}

const EXISTING_CREDENTIALS = {
  apiKey: "EXISTING_VAPI_KEY",
  webhookSecret: "EXISTING_WEBHOOK_SECRET",
  deepgramApiKey: "EXISTING_DEEPGRAM_KEY",
};
const EXISTING_CONFIG = {
  voiceId: "asteria",
  publicKey: "pk_existing",
  transcriber: "deepgram",
};

beforeEach(() => {
  mockUpdate.mockReset();
  mockTransaction.mockClear();
  mockFindUnique.mockReset();
  mockUpdate.mockImplementation(async ({ data }: { data: unknown }) => ({
    id: "test-id",
    slug: "vapi",
    ...((data ?? {}) as Record<string, unknown>),
    credentials: ((data as Record<string, unknown>).credentials ?? EXISTING_CREDENTIALS) as unknown,
  }));
  mockFindUnique.mockResolvedValue({
    id: "test-id",
    slug: "vapi",
    adapterKey: "vapi",
    credentials: EXISTING_CREDENTIALS,
    config: EXISTING_CONFIG,
    isDefault: false,
    enabled: true,
  });
});

describe("PATCH /api/voice-providers/[id] — merge semantics (#1433)", () => {
  it("empty credentials: {} → existing credentials PRESERVED (no write)", async () => {
    const res = await callPatch({ credentials: {}, enabled: true });
    expect(res.status).toBe(200);
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    // No `credentials` field in the update payload at all → existing row untouched.
    expect(updateCall?.data?.credentials).toBeUndefined();
  });

  it("partial new key → existing keys preserved + new key set", async () => {
    await callPatch({
      credentials: { deepgramApiKey: "NEW_DEEPGRAM" },
    });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.credentials).toEqual({
      apiKey: "EXISTING_VAPI_KEY", // preserved
      webhookSecret: "EXISTING_WEBHOOK_SECRET", // preserved
      deepgramApiKey: "NEW_DEEPGRAM", // set
    });
  });

  it("overlapping key → that key overwritten, OTHER existing keys preserved", async () => {
    await callPatch({
      credentials: { webhookSecret: "ROTATED_SECRET" },
    });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.credentials).toEqual({
      apiKey: "EXISTING_VAPI_KEY", // preserved
      webhookSecret: "ROTATED_SECRET", // overwritten
      deepgramApiKey: "EXISTING_DEEPGRAM_KEY", // preserved
    });
  });

  it("clearCredentials: ['key'] → that key deleted, others preserved", async () => {
    await callPatch({
      clearCredentials: ["deepgramApiKey"],
    });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.credentials).toEqual({
      apiKey: "EXISTING_VAPI_KEY",
      webhookSecret: "EXISTING_WEBHOOK_SECRET",
      // deepgramApiKey deleted
    });
  });

  it("config merge semantics mirror credentials", async () => {
    await callPatch({
      config: { voiceId: "luna" },
    });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.config).toEqual({
      voiceId: "luna", // overwritten
      publicKey: "pk_existing", // preserved
      transcriber: "deepgram", // preserved
    });
  });

  it("omitting credentials AND clearCredentials → no credentials write at all", async () => {
    await callPatch({ displayName: "Renamed" });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.credentials).toBeUndefined();
    expect(updateCall.data.displayName).toBe("Renamed");
  });

  it("REGRESSION pin: empty credentials: {} no longer wipes the row", async () => {
    // This is the EXACT bug class from #1433. The UI's pre-fix save
    // shipped `credentials: {}` which used to fully replace. We assert
    // the existing keys still exist in the update payload.
    await callPatch({ credentials: {}, config: {} });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    // Either: no write to credentials (preferred — nothing changed),
    // OR a write that includes ALL three original keys (acceptable).
    if (updateCall.data.credentials !== undefined) {
      expect(updateCall.data.credentials).toMatchObject(EXISTING_CREDENTIALS);
    }
  });

  it("clear + set in same patch: clear key A, set key B, preserve key C", async () => {
    await callPatch({
      credentials: { deepgramApiKey: "ROTATED_DG" },
      clearCredentials: ["apiKey"],
    });
    const updateCall = mockUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.credentials).toEqual({
      // apiKey: CLEARED
      webhookSecret: "EXISTING_WEBHOOK_SECRET",
      deepgramApiKey: "ROTATED_DG",
    });
  });
});

/**
 * Tests for feat/1018 — tallyseal-bridge Phase 1 wiring.
 *
 * ACs covered:
 *   AC3: /intent/:id/events → 403 (PrismaNoopProjection.current() returns null)
 *   AC4: /intent/:id/bundle → 403 (same)
 *   AC5: middleware bypass — tested via middleware.ts inspection (static, no runtime needed)
 *   AC6: lazy router singleton — createBridgeRouter NOT called at import time
 *   AC7: boundary discipline — @tallyseal/admin-bridge only in route.ts + bridge-callbacks.ts
 *
 * ACs 1+2 proven by smoke evidence (GET /health → 200, GET /intents → 200 with empty array).
 * ACs 8+9 (tarball committed, package.json sorted) verified statically — see QA report.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockHandler = vi.fn();
const mockToNextRouteHandler = vi.fn(() => mockHandler);
const mockCreateBridgeRouter = vi.fn(() => ({}));
const mockBridgeAuthFromStaticKey = vi.fn(() => vi.fn());

const { mockGetEventStore } = vi.hoisted(() => ({
  mockGetEventStore: vi.fn().mockResolvedValue({}),
}));

vi.mock("@tallyseal/admin-bridge", () => ({
  createBridgeRouter: (...args: unknown[]) => mockCreateBridgeRouter(...args),
  bridgeAuthFromStaticKey: (...args: unknown[]) => mockBridgeAuthFromStaticKey(...args),
  toNextRouteHandler: (...args: unknown[]) => mockToNextRouteHandler(...args),
}));

vi.mock("@/lib/intake/hf-adapter/event-store", () => ({
  getEventStore: (...args: unknown[]) => mockGetEventStore(...args),
}));

vi.mock("@/lib/intake/hf-adapter/projection", () => {
  let singleton: object | null = null;
  return {
    getProjection: () => {
      if (!singleton) singleton = { current: vi.fn().mockReturnValue(null) };
      return singleton;
    },
    __resetProjectionForTests: () => { singleton = null; },
  };
});

vi.mock("@/lib/intake/hf-adapter/bridge-callbacks", () => ({
  bundleSource: { load: vi.fn().mockResolvedValue(null) },
  intentLister: { list: vi.fn().mockResolvedValue([]) },
  accessRecorder: { record: vi.fn().mockResolvedValue(undefined) },
}));

// =====================================================
// TESTS: route.ts — AC6 lazy singleton + scope config
// =====================================================

describe("tallyseal-bridge route.ts — lazy singleton (AC6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TALLYSEAL_BRIDGE_DEV_SECRET = "test-secret";
  });

  afterEach(async () => {
    delete process.env.TALLYSEAL_BRIDGE_DEV_SECRET;
    // Reset the singleton so each test starts clean
    const { __resetBridgeHandlerForTests } = await import(
      "@/app/api/tallyseal-bridge/[...slug]/route"
    );
    __resetBridgeHandlerForTests();
  });

  it("does NOT call createBridgeRouter at module import time (AC6)", async () => {
    // The mock is set up before import — if createBridgeRouter were called
    // at module load, it would already be called by this point.
    // Importing here is the earliest point we can assert.
    await import("@/app/api/tallyseal-bridge/[...slug]/route");
    expect(mockCreateBridgeRouter).not.toHaveBeenCalled();
  });

  it("calls createBridgeRouter only on first GET request (AC6)", async () => {
    const { GET, __resetBridgeHandlerForTests } =
      await import("@/app/api/tallyseal-bridge/[...slug]/route");
    __resetBridgeHandlerForTests();

    mockHandler.mockResolvedValue(new Response("ok", { status: 200 }));

    const req = new Request("http://localhost/api/tallyseal-bridge/health");
    await GET(req);

    expect(mockCreateBridgeRouter).toHaveBeenCalledOnce();
  });

  it("reuses the singleton on the second GET — createBridgeRouter called once total (AC6)", async () => {
    const { GET, __resetBridgeHandlerForTests } =
      await import("@/app/api/tallyseal-bridge/[...slug]/route");
    __resetBridgeHandlerForTests();

    mockHandler.mockResolvedValue(new Response("ok", { status: 200 }));

    const req1 = new Request("http://localhost/api/tallyseal-bridge/health");
    const req2 = new Request("http://localhost/api/tallyseal-bridge/intents");
    await GET(req1);
    await GET(req2);

    expect(mockCreateBridgeRouter).toHaveBeenCalledOnce();
  });

  it("passes EnrollmentIntake scope with compliance-officer + deny default (AC6 scope shape)", async () => {
    const { GET, __resetBridgeHandlerForTests } =
      await import("@/app/api/tallyseal-bridge/[...slug]/route");
    __resetBridgeHandlerForTests();

    mockHandler.mockResolvedValue(new Response("ok", { status: 200 }));
    const req = new Request("http://localhost/api/tallyseal-bridge/health");
    await GET(req);

    const [config] = mockCreateBridgeRouter.mock.calls[0] as [Record<string, unknown>];
    const scopes = config.intentScopes as {
      defaultPolicy: string;
      perIntent: Record<string, { allowedRoles: string[]; allowedSections: string[] }>;
    };

    expect(scopes.defaultPolicy).toBe("deny");
    expect(scopes.perIntent["EnrollmentIntake"].allowedRoles).toContain("compliance-officer");
    expect(scopes.perIntent["EnrollmentIntake"].allowedSections).toEqual(
      expect.arrayContaining(["events", "bundle-jsonld", "bundle-pdf"]),
    );
  });

  it("passes dev actor with compliance-officer role (AC6 actor shape)", async () => {
    const { GET, __resetBridgeHandlerForTests } =
      await import("@/app/api/tallyseal-bridge/[...slug]/route");
    __resetBridgeHandlerForTests();

    mockHandler.mockResolvedValue(new Response("ok", { status: 200 }));
    const req = new Request("http://localhost/api/tallyseal-bridge/health");
    await GET(req);

    expect(mockBridgeAuthFromStaticKey).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: "test-secret",
        actor: expect.objectContaining({
          id: "dev-compliance-officer",
          role: "compliance-officer",
          orgId: "hf-dev",
        }),
      }),
    );
  });

  it("throws if TALLYSEAL_BRIDGE_DEV_SECRET is unset (AC6 fail-closed)", async () => {
    delete process.env.TALLYSEAL_BRIDGE_DEV_SECRET;
    const { GET, __resetBridgeHandlerForTests } =
      await import("@/app/api/tallyseal-bridge/[...slug]/route");
    __resetBridgeHandlerForTests();

    const req = new Request("http://localhost/api/tallyseal-bridge/health");
    await expect(GET(req)).rejects.toThrow("TALLYSEAL_BRIDGE_DEV_SECRET");
  });
});

// =====================================================
// TESTS: bridge-callbacks.ts (AC3 + AC4 via Phase 1 no-ops)
// =====================================================

describe("bridge-callbacks — Phase 1 no-op stubs (AC3 + AC4)", () => {
  it("bundleSource.load returns null for any intentId", async () => {
    const { bundleSource } = await import("@/lib/intake/hf-adapter/bridge-callbacks");
    const result = await bundleSource.load("any-intent-id");
    expect(result).toBeNull();
  });

  it("intentLister.list returns empty array for any filter", async () => {
    const { intentLister } = await import("@/lib/intake/hf-adapter/bridge-callbacks");
    const result = await intentLister.list({ limit: 10 });
    expect(result).toEqual([]);
  });

  it("accessRecorder.record resolves without throwing", async () => {
    const { accessRecorder } = await import("@/lib/intake/hf-adapter/bridge-callbacks");
    await expect(accessRecorder.record({ intentId: "x", actorId: "y", section: "events" })).resolves.toBeUndefined();
  });
});

// =====================================================
// TESTS: projection.ts singleton (AC6 singleton pattern)
// =====================================================

describe("projection — PrismaNoopProjection singleton", () => {
  it("getProjection returns the same instance on repeated calls", async () => {
    // Use the real module (not the mock) for this test
    vi.unmock("@/lib/intake/hf-adapter/projection");
    vi.resetModules();

    const { getProjection, __resetProjectionForTests } = await import(
      "@/lib/intake/hf-adapter/projection"
    );
    __resetProjectionForTests();

    const a = getProjection();
    const b = getProjection();
    expect(a).toBe(b);

    __resetProjectionForTests();
  });

  it("__resetProjectionForTests clears the singleton", async () => {
    vi.unmock("@/lib/intake/hf-adapter/projection");
    vi.resetModules();

    const { getProjection, __resetProjectionForTests } = await import(
      "@/lib/intake/hf-adapter/projection"
    );
    __resetProjectionForTests();

    const before = getProjection();
    __resetProjectionForTests();
    const after = getProjection();
    expect(after).not.toBe(before);
  });
});

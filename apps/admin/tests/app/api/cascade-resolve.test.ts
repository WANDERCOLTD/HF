/**
 * Tests for GET /api/cascade/resolve (Slice 2 of #1454 / Epic #1442).
 *
 * Covers:
 *   - requireAuth("OPERATOR") — VIEWER returns 403
 *   - knobKey required (400)
 *   - unknown knobKey returns 400
 *   - missing required scope returns 400
 *   - Playbook not found returns 404
 *   - happy path returns the Effective<T> envelope
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAuth = vi.fn();
const isAuthError = vi.fn();
const resolveEffective = vi.fn();

vi.mock("@/lib/permissions", () => ({ requireAuth, isAuthError }));
vi.mock("@/lib/cascade/effective-value", () => ({
  resolveEffective,
  invalidateKnob: vi.fn(),
  invalidateAll: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  isAuthError.mockReturnValue(false);
  requireAuth.mockResolvedValue({ session: { user: { id: "u1" } } });
});

function makeRequest(qs: string): Request {
  return new Request(`http://localhost:3000/api/cascade/resolve?${qs}`);
}

describe("GET /api/cascade/resolve", () => {
  it("returns 403 when requireAuth refuses", async () => {
    isAuthError.mockReturnValueOnce(true);
    requireAuth.mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    });
    const { GET } = await import("@/app/api/cascade/resolve/route");
    const res = await GET(makeRequest("knobKey=BEH-WARMTH&playbookId=pb1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when knobKey missing", async () => {
    const { GET } = await import("@/app/api/cascade/resolve/route");
    const res = await GET(makeRequest("playbookId=pb1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/knobKey/);
  });

  it("returns 400 on unknown knobKey", async () => {
    resolveEffective.mockRejectedValueOnce(
      new Error('Unknown cascade knob key: "totally-fake"'),
    );
    const { GET } = await import("@/app/api/cascade/resolve/route");
    const res = await GET(
      makeRequest("knobKey=totally-fake&playbookId=pb1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when a required scope id is missing", async () => {
    resolveEffective.mockRejectedValueOnce(
      new Error("resolveWelcomeMessage requires `playbookId` in scopeChain (got: {})"),
    );
    const { GET } = await import("@/app/api/cascade/resolve/route");
    const res = await GET(makeRequest("knobKey=welcomeMessage"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when underlying entity not found", async () => {
    resolveEffective.mockRejectedValueOnce(
      new Error("Playbook not found: pb1"),
    );
    const { GET } = await import("@/app/api/cascade/resolve/route");
    const res = await GET(makeRequest("knobKey=welcomeMessage&playbookId=pb1"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with the Effective<T> envelope on success", async () => {
    const envelope = {
      value: 0.6,
      source: "DOMAIN",
      layers: [
        {
          layer: "SYSTEM",
          scopeId: null,
          scopeLabel: "System default",
          value: 0.5,
          setAt: null,
          setBy: null,
        },
        {
          layer: "DOMAIN",
          scopeId: "dom1",
          scopeLabel: "Education",
          value: 0.6,
          setAt: "2026-05-22T00:00:00.000Z",
          setBy: null,
        },
      ],
      isInherited: true,
      recommendedLayerForEdit: "PLAYBOOK",
    };
    resolveEffective.mockResolvedValueOnce(envelope);
    const { GET } = await import("@/app/api/cascade/resolve/route");
    const res = await GET(
      makeRequest("knobKey=BEH-WARMTH&playbookId=pb1&callerId=c1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(envelope);
  });

  it("threads playbookId/callerId/domainId into scopeChain", async () => {
    resolveEffective.mockResolvedValueOnce({
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });
    const { GET } = await import("@/app/api/cascade/resolve/route");
    await GET(
      makeRequest(
        "knobKey=welcomeMessage&playbookId=pb1&callerId=c1&domainId=dom1",
      ),
    );
    expect(resolveEffective).toHaveBeenCalledWith({
      knobKey: "welcomeMessage",
      scopeChain: { playbookId: "pb1", callerId: "c1", domainId: "dom1" },
    });
  });

  it("accepts courseId as an operator-facing alias for playbookId", async () => {
    resolveEffective.mockResolvedValueOnce({
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });
    const { GET } = await import("@/app/api/cascade/resolve/route");
    await GET(makeRequest("knobKey=welcomeMessage&courseId=pb1"));
    expect(resolveEffective).toHaveBeenCalledWith({
      knobKey: "welcomeMessage",
      scopeChain: { playbookId: "pb1" },
    });
  });

  it("prefers courseId over playbookId when both supplied", async () => {
    resolveEffective.mockResolvedValueOnce({
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });
    const { GET } = await import("@/app/api/cascade/resolve/route");
    await GET(makeRequest("knobKey=welcomeMessage&courseId=course1&playbookId=legacy1"));
    expect(resolveEffective).toHaveBeenCalledWith({
      knobKey: "welcomeMessage",
      scopeChain: { playbookId: "course1" },
    });
  });
});

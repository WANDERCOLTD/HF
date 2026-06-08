/**
 * Tests for GET /api/callers/[callerId]/cascade/voice (#1348 Cascade Lens v1).
 *
 * Security + shape properties:
 *   - OPERATOR → 200 + VoiceCascadeExplanation
 *   - STUDENT → 403 (requireAuth returns Forbidden, not Unauthorized,
 *     for insufficient role — see lib/permissions.ts)
 *   - OPERATOR+ on a different caller → 200 (route is NOT caller-scoped;
 *     OPERATOR is trusted to browse anyone)
 *   - Caller with no active enrollment → 200 + null playbookId/courseId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockRequireAuth = vi.fn();
const mockExplainVoiceCascade = vi.fn();

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

vi.mock("@/lib/cascade/voice-explain", () => ({
  explainVoiceCascade: (...args: unknown[]) => mockExplainVoiceCascade(...args),
}));

function makeSession(role: string) {
  return {
    session: {
      expires: new Date(Date.now() + 86400000).toISOString(),
      user: {
        id: "user-1",
        email: "u@example.com",
        name: "U",
        image: null,
        role,
      },
    },
  };
}

async function callGet(callerId: string) {
  const mod = await import(
    "@/app/api/callers/[callerId]/cascade/voice/route"
  );
  const req = new Request(
    `http://test/api/callers/${callerId}/cascade/voice`,
  );
  const res = await mod.GET(req, {
    params: Promise.resolve({ callerId }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const explanationFor = (callerId: string, playbookId: string | null) => ({
  cascade: "voice" as const,
  callerId,
  playbookId,
  courseId: playbookId,
  providerId: "vp-1",
  resolvedAt: new Date("2026-06-08T00:00:00Z").toISOString(),
  fields: [
    {
      key: "voiceId",
      resolvedValue: "asteria",
      winningSource: "provider" as const,
      locked: false,
      chain: [
        { layer: "system" as const, value: null, present: false },
        { layer: "provider" as const, value: "asteria", present: true },
        { layer: "domain" as const, value: null, present: false },
        { layer: "course" as const, value: null, present: false },
      ],
    },
  ],
});

describe("GET /api/callers/[callerId]/cascade/voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OPERATOR → 200 + VoiceCascadeExplanation shape", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
    mockExplainVoiceCascade.mockResolvedValue(explanationFor("c-1", "pb-1"));

    const { status, json } = await callGet("c-1");

    expect(status).toBe(200);
    expect(json.data.cascade).toBe("voice");
    expect(json.data.callerId).toBe("c-1");
    expect(json.data.playbookId).toBe("pb-1");
    expect(json.data.fields).toHaveLength(1);
    expect(mockRequireAuth).toHaveBeenCalledWith("OPERATOR");
  });

  it("STUDENT → 403 (requireAuth rejects sub-OPERATOR roles)", async () => {
    mockRequireAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    });

    const { status } = await callGet("c-1");

    expect(status).toBe(403);
    expect(mockExplainVoiceCascade).not.toHaveBeenCalled();
  });

  it("OPERATOR+ on a different caller → 200 (route is NOT caller-scoped)", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
    mockExplainVoiceCascade.mockResolvedValue(
      explanationFor("victim-caller", "pb-9"),
    );

    const { status, json } = await callGet("victim-caller");

    expect(status).toBe(200);
    expect(json.data.callerId).toBe("victim-caller");
    expect(mockExplainVoiceCascade).toHaveBeenCalledWith("victim-caller");
  });

  it("Caller with no active enrollment → 200 + null playbookId/courseId", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("ADMIN"));
    mockExplainVoiceCascade.mockResolvedValue(explanationFor("c-orphan", null));

    const { status, json } = await callGet("c-orphan");

    expect(status).toBe(200);
    expect(json.data.playbookId).toBeNull();
    expect(json.data.courseId).toBeNull();
  });
});

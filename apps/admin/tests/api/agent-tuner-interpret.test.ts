/**
 * Tests for /api/agent-tuner/interpret
 *
 * POST: Translates natural language intent into behavior pills.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK DATA
// =====================================================

const mockParams = [
  {
    parameterId: "BEH-WARMTH",
    name: "Warmth",
    domainGroup: "engagement",
    interpretationHigh: "Very warm and friendly",
    interpretationLow: "Cool and detached",
  },
  {
    parameterId: "BEH-PATIENCE-LEVEL",
    name: "Patience Level",
    domainGroup: "engagement",
    interpretationHigh: "Extremely patient",
    interpretationLow: "Impatient",
  },
  {
    parameterId: "BEH-FORMALITY",
    name: "Formality",
    domainGroup: "voice-guidance",
    interpretationHigh: "Very formal",
    interpretationLow: "Very casual",
  },
];

const mockSystemTargets = [
  { parameterId: "BEH-WARMTH", targetValue: 0.5 },
  { parameterId: "BEH-PATIENCE-LEVEL", targetValue: 0.5 },
  { parameterId: "BEH-FORMALITY", targetValue: 0.5 },
];

const validPillsResponse = JSON.stringify({
  pills: [
    {
      id: "warm-tone",
      label: "Warm Tone",
      description: "Approachable and empathetic",
      intensity: 0.8,
      parameters: [
        { parameterId: "BEH-WARMTH", atFull: 0.9 },
        { parameterId: "BEH-PATIENCE-LEVEL", atFull: 0.85 },
      ],
    },
    {
      id: "professional",
      label: "Professional",
      description: "Formal and structured",
      intensity: 0.7,
      parameters: [{ parameterId: "BEH-FORMALITY", atFull: 0.75 }],
    },
  ],
  interpretation: "A warm but professional style",
});

// =====================================================
// MOCKS
// =====================================================

const mockPrisma = {
  parameter: { findMany: vi.fn() },
  behaviorTarget: { findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

const mockAI = vi.fn();
vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: mockAI,
}));

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: mockRequireAuth,
  isAuthError: mockIsAuthError,
}));

// =====================================================
// HELPERS
// =====================================================

function makeRequest(body: any) {
  return new Request("http://localhost/api/agent-tuner/interpret", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// =====================================================
// TESTS
// =====================================================

describe("/api/agent-tuner/interpret", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: authenticated operator
    mockIsAuthError.mockReturnValue(false);
    mockRequireAuth.mockResolvedValue({
      session: {
        user: { id: "u-1", email: "a@b.com", name: "Admin", role: "OPERATOR", image: null },
        expires: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    // Default Prisma mocks
    mockPrisma.parameter.findMany.mockResolvedValue(mockParams);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue(mockSystemTargets);

    // Default AI mock
    mockAI.mockResolvedValue({ content: validPillsResponse });

    const mod = await import("../../app/api/agent-tuner/interpret/route");
    POST = mod.POST;
  });

  it("should return pills from AI for a valid intent", async () => {
    const response = await POST(makeRequest({ intent: "warm but professional" }));
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills).toHaveLength(2);
    expect(data.pills[0].id).toBe("warm-tone");
    expect(data.pills[0].label).toBe("Warm Tone");
    expect(data.pills[0].source).toBe("intent");
    expect(data.pills[0].parameters).toHaveLength(2);
    expect(data.pills[1].id).toBe("professional");
    expect(data.interpretation).toBe("A warm but professional style");
  });

  it("should set atZero from system targets", async () => {
    const response = await POST(makeRequest({ intent: "warm and patient" }));
    const data = await response.json();

    const warmthParam = data.pills[0].parameters.find(
      (p: any) => p.parameterId === "BEH-WARMTH"
    );
    expect(warmthParam.atZero).toBe(0.5);
  });

  it("should clamp atFull and intensity values to 0-1 range", async () => {
    mockAI.mockResolvedValue({
      content: JSON.stringify({
        pills: [
          {
            id: "extreme",
            label: "Extreme",
            description: "Over the top",
            intensity: 1.5,
            parameters: [
              { parameterId: "BEH-WARMTH", atFull: 1.5 },
              { parameterId: "BEH-FORMALITY", atFull: -0.3 },
            ],
          },
        ],
        interpretation: "Clamped",
      }),
    });

    const response = await POST(makeRequest({ intent: "extreme style" }));
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills[0].intensity).toBe(1);
    expect(data.pills[0].parameters[0].atFull).toBe(1);
    expect(data.pills[0].parameters[1].atFull).toBe(0);
  });

  it("should filter out pills referencing invalid parameter IDs", async () => {
    mockAI.mockResolvedValue({
      content: JSON.stringify({
        pills: [
          {
            id: "valid",
            label: "Valid",
            description: "Has valid params",
            intensity: 0.7,
            parameters: [{ parameterId: "BEH-WARMTH", atFull: 0.8 }],
          },
          {
            id: "invalid",
            label: "Invalid",
            description: "Has invalid params only",
            intensity: 0.5,
            parameters: [{ parameterId: "BEH-NONEXISTENT", atFull: 0.9 }],
          },
        ],
        interpretation: "Mixed",
      }),
    });

    const response = await POST(makeRequest({ intent: "test intent" }));
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills).toHaveLength(1);
    expect(data.pills[0].id).toBe("valid");
  });

  it("should return 400 for empty intent", async () => {
    const response = await POST(makeRequest({ intent: "" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it("should return 400 for intent too short", async () => {
    const response = await POST(makeRequest({ intent: "ab" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
  });

  it("should return 400 when no adjustable parameters exist", async () => {
    mockPrisma.parameter.findMany.mockResolvedValue([]);

    const response = await POST(makeRequest({ intent: "warm and patient" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("No adjustable behavior parameters");
  });

  it("should handle malformed AI response gracefully", async () => {
    mockAI.mockResolvedValue({ content: "not valid json at all" });

    const response = await POST(makeRequest({ intent: "warm and friendly" }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("malformed");
  });

  it("should handle markdown-fenced AI response", async () => {
    mockAI.mockResolvedValue({
      content: "```json\n" + validPillsResponse + "\n```",
    });

    const response = await POST(makeRequest({ intent: "warm style" }));
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills).toHaveLength(2);
  });

  it("should reject unauthenticated requests", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockRequireAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await POST(makeRequest({ intent: "warm" }));
    expect(response.status).toBe(401);
  });

  it("should call AI with correct call point", async () => {
    await POST(makeRequest({ intent: "warm and patient" }));

    expect(mockAI).toHaveBeenCalledWith(
      expect.objectContaining({ callPoint: "agent-tuner.interpret" }),
      expect.objectContaining({ sourceOp: "agent-tuner:interpret" })
    );
  });

  it("should pass context into the prompt when provided", async () => {
    await POST(
      makeRequest({
        intent: "warm and patient",
        context: { domainName: "Food Safety", subjectName: "Level 2 Hygiene" },
      })
    );

    expect(mockAI).toHaveBeenCalledTimes(1);
    const systemMsg = mockAI.mock.calls[0][0].messages[0].content;
    expect(systemMsg).toContain("Food Safety");
  });

  it("should filter pills with missing required fields", async () => {
    mockAI.mockResolvedValue({
      content: JSON.stringify({
        pills: [
          {
            id: "valid",
            label: "Valid",
            description: "OK",
            intensity: 0.7,
            parameters: [{ parameterId: "BEH-WARMTH", atFull: 0.8 }],
          },
          {
            // missing id
            label: "No ID",
            description: "Missing id",
            intensity: 0.5,
            parameters: [{ parameterId: "BEH-FORMALITY", atFull: 0.7 }],
          },
          {
            id: "no-label",
            // missing label
            description: "Missing label",
            intensity: 0.5,
            parameters: [{ parameterId: "BEH-FORMALITY", atFull: 0.7 }],
          },
          {
            id: "no-params",
            label: "No Params",
            description: "Missing parameters array",
            intensity: 0.5,
            // missing parameters
          },
        ],
        interpretation: "Filtered",
      }),
    });

    const response = await POST(makeRequest({ intent: "test filters" }));
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills).toHaveLength(1);
    expect(data.pills[0].id).toBe("valid");
  });
});

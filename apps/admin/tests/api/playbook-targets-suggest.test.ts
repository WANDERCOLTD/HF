/**
 * Tests for /api/playbooks/:playbookId/targets/suggest
 *
 * POST: AI-generates behavior pills (concept bundles) from natural language intent
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================
// MOCK DATA
// =====================================================

const mockPlaybook = {
  id: "pb-1",
  name: "Test Playbook",
  status: "DRAFT",
  domain: { id: "dom-1", slug: "food-safety", name: "Food Safety" },
  behaviorTargets: [
    { parameterId: "BEH-WARMTH", targetValue: 0.6 },
    { parameterId: "BEH-PATIENCE-LEVEL", targetValue: 0.7 },
  ],
};

const mockParams = [
  {
    parameterId: "BEH-WARMTH",
    name: "Warmth",
    definition: "How warm the tutor is",
    domainGroup: "engagement",
    interpretationHigh: "Very warm and friendly",
    interpretationLow: "Cool and detached",
  },
  {
    parameterId: "BEH-PATIENCE-LEVEL",
    name: "Patience Level",
    definition: "How patient the tutor is",
    domainGroup: "engagement",
    interpretationHigh: "Extremely patient",
    interpretationLow: "Impatient",
  },
  {
    parameterId: "BEH-FORMALITY",
    name: "Formality",
    definition: "Formality of language",
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
  interpretation: "Adjusted for a warm but professional style",
});

// =====================================================
// MOCKS
// =====================================================

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
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
  return new Request(
    "http://localhost/api/playbooks/pb-1/targets/suggest",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

const params = { params: Promise.resolve({ playbookId: "pb-1" }) };

// =====================================================
// TESTS
// =====================================================

describe("/api/playbooks/:playbookId/targets/suggest", () => {
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
    mockPrisma.playbook.findUnique.mockResolvedValue(mockPlaybook);
    mockPrisma.parameter.findMany.mockResolvedValue(mockParams);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue(mockSystemTargets);

    // Default AI mock
    mockAI.mockResolvedValue({ content: validPillsResponse });

    const mod = await import(
      "../../app/api/playbooks/[playbookId]/targets/suggest/route"
    );
    POST = mod.POST;
  });

  it("should return pills from AI for a valid intent", async () => {
    const response = await POST(makeRequest({ intent: "warm but professional" }), params);
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills).toHaveLength(2);
    expect(data.pills[0].id).toBe("warm-tone");
    expect(data.pills[0].label).toBe("Warm Tone");
    expect(data.pills[0].source).toBe("intent");
    expect(data.pills[0].parameters).toHaveLength(2);
    expect(data.pills[1].id).toBe("professional");
    expect(data.interpretation).toBeTruthy();
  });

  it("should set atZero to current effective value for each parameter", async () => {
    const response = await POST(makeRequest({ intent: "warm and patient" }), params);
    const data = await response.json();

    // BEH-WARMTH has playbook override 0.6, so atZero should be 0.6
    const warmthParam = data.pills[0].parameters.find(
      (p: any) => p.parameterId === "BEH-WARMTH"
    );
    expect(warmthParam.atZero).toBe(0.6);

    // BEH-FORMALITY has no playbook override, system default 0.5
    const formalityParam = data.pills[1].parameters.find(
      (p: any) => p.parameterId === "BEH-FORMALITY"
    );
    expect(formalityParam.atZero).toBe(0.5);
  });

  it("should clamp atFull values to 0-1 range", async () => {
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

    const response = await POST(makeRequest({ intent: "extreme style" }), params);
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

    const response = await POST(makeRequest({ intent: "test" }), params);
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.pills).toHaveLength(1);
    expect(data.pills[0].id).toBe("valid");
  });

  it("should mark pills as domain-context source in more mode", async () => {
    const response = await POST(
      makeRequest({ intent: "warm", mode: "more", existingPillIds: ["warm-tone"] }),
      params
    );
    const data = await response.json();

    expect(data.ok).toBe(true);
    for (const pill of data.pills) {
      expect(pill.source).toBe("domain-context");
    }
  });

  it("should return 400 for empty intent", async () => {
    const response = await POST(makeRequest({ intent: "" }), params);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("intent must be at least 3 characters");
  });

  it("should return 400 for invalid mode", async () => {
    const response = await POST(makeRequest({ intent: "warm", mode: "invalid" }), params);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('mode must be "initial" or "more"');
  });

  it("should return 404 for non-existent playbook", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const response = await POST(makeRequest({ intent: "warm and friendly" }), params);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Playbook not found");
  });

  it("should return 502 when AI returns unparseable response", async () => {
    mockAI.mockResolvedValue({ content: "not valid json" });

    const response = await POST(makeRequest({ intent: "warm" }), params);
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toContain("Failed to parse AI response");
  });

  it("should reject unauthenticated requests", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockRequireAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await POST(makeRequest({ intent: "warm" }), params);
    expect(response.status).toBe(401);
  });

  it("should call AI with correct call point", async () => {
    await POST(makeRequest({ intent: "warm and patient" }), params);

    expect(mockAI).toHaveBeenCalledWith(
      expect.objectContaining({ callPoint: "targets.suggest" }),
      expect.objectContaining({ sourceOp: "targets:suggest" })
    );
  });
});

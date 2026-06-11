/**
 * Tests for GET /api/courses/[courseId]/cascade/welcome-message (#1471).
 *
 * Security + shape:
 *   - OPERATOR → 200 + Effective<string | null>
 *   - STUDENT → 403 (insufficient role)
 *   - Resolver throw → 500 + { data: null, error }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("@/lib/permissions");

const mockRequireAuth = vi.fn();
const mockResolveWelcomeMessage = vi.fn();

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (v: unknown): v is { error: unknown } =>
    Boolean(v && typeof v === "object" && "error" in (v as Record<string, unknown>)),
}));

vi.mock("@/lib/cascade/resolvers/welcome-message", () => ({
  resolveWelcomeMessage: (...args: unknown[]) => mockResolveWelcomeMessage(...args),
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

async function callGet(courseId: string) {
  const mod = await import(
    "@/app/api/courses/[courseId]/cascade/welcome-message/route"
  );
  const req = new Request(
    `http://test/api/courses/${courseId}/cascade/welcome-message`,
  );
  const res = await mod.GET(req, {
    params: Promise.resolve({ courseId }),
  });
  // Only parse JSON for non-auth-error responses. The auth helper returns
  // a plain-text 401/403 response, which JSON.parse would choke on.
  if (res.status === 401 || res.status === 403) {
    return { status: res.status, json: null as null };
  }
  const json = await res.json();
  return { status: res.status, json };
}

const playbookWinningEnvelope = {
  value: "Welcome, friend!",
  source: "PLAYBOOK" as const,
  layers: [
    {
      layer: "PLAYBOOK" as const,
      scopeId: "pb-1",
      scopeLabel: "OCEAN",
      value: "Welcome, friend!",
      setAt: null,
      setBy: null,
    },
  ],
  isInherited: false,
  recommendedLayerForEdit: "PLAYBOOK" as const,
};

describe("GET /api/courses/[courseId]/cascade/welcome-message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OPERATOR → 200 + Effective envelope", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
    mockResolveWelcomeMessage.mockResolvedValue(playbookWinningEnvelope);

    const { status, json } = await callGet("pb-1");

    expect(status).toBe(200);
    expect(json.data.source).toBe("PLAYBOOK");
    expect(json.data.value).toBe("Welcome, friend!");
    expect(mockRequireAuth).toHaveBeenCalledWith("OPERATOR");
    expect(mockResolveWelcomeMessage).toHaveBeenCalledWith({
      playbookId: "pb-1",
    });
  });

  it("STUDENT → 403 (role gate)", async () => {
    const forbidden = new Response("Forbidden", { status: 403 });
    mockRequireAuth.mockResolvedValue({ error: forbidden });

    const { status } = await callGet("pb-1");

    expect(status).toBe(403);
    expect(mockResolveWelcomeMessage).not.toHaveBeenCalled();
  });

  it("Resolver throw → 500 with error message", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
    mockResolveWelcomeMessage.mockRejectedValue(new Error("Playbook not found"));

    const { status, json } = await callGet("missing-pb");

    expect(status).toBe(500);
    expect(json.data).toBeNull();
    expect(json.error).toBe("Playbook not found");
  });

  it("DOMAIN inheritance → source=DOMAIN, isInherited=true", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
    mockResolveWelcomeMessage.mockResolvedValue({
      value: "Domain greeting",
      source: "DOMAIN" as const,
      layers: [
        {
          layer: "DOMAIN" as const,
          scopeId: "dom-1",
          scopeLabel: "Education",
          value: "Domain greeting",
          setAt: null,
          setBy: null,
        },
      ],
      isInherited: true,
      recommendedLayerForEdit: "PLAYBOOK" as const,
    });

    const { status, json } = await callGet("pb-1");

    expect(status).toBe(200);
    expect(json.data.source).toBe("DOMAIN");
    expect(json.data.isInherited).toBe(true);
    expect(json.data.layers[0].scopeLabel).toBe("Education");
  });

  it("SYSTEM (neither layer set) → source=SYSTEM, empty layers", async () => {
    mockRequireAuth.mockResolvedValue(makeSession("OPERATOR"));
    mockResolveWelcomeMessage.mockResolvedValue({
      value: null,
      source: "SYSTEM" as const,
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK" as const,
    });

    const { status, json } = await callGet("pb-1");

    expect(status).toBe(200);
    expect(json.data.source).toBe("SYSTEM");
    expect(json.data.value).toBeNull();
    expect(json.data.layers).toHaveLength(0);
  });
});

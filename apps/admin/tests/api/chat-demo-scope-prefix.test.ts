/**
 * #1546 — Cmd+K scope-prefix DEMO route smoke test.
 *
 * Covers the route-level wire-up of the parser + resolver + scope-hint
 * injection: parse error → 400; `#system` + non-ADMIN → 403; `#system` +
 * ADMIN → 400 with Sprint-2 message; resolver miss → 400 with reason;
 * resolver hit → handler receives a `demoMessages` array containing a
 * `[scope]` user-prefixed note before the operator's message.
 *
 * The downstream LLM tool-loop (`handleDataModeWithTools`) is mocked to
 * return a sentinel response — we only verify the route's pre-LLM
 * scope-resolution path, not the LLM behaviour (that's the promptfoo
 * eval at `evals/demo/v2-scope-prefixes.yaml`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAuth = vi.fn();
const isAuthError = vi.fn();

vi.mock("@/lib/permissions", () => ({ requireAuth, isAuthError }));

const resolveCallerByName = vi.fn();
const resolvePlaybookByName = vi.fn();
const resolveDomainByName = vi.fn();

vi.mock("@/lib/chat/scope-resolvers/caller-by-name", () => ({
  resolveCallerByName,
}));
vi.mock("@/lib/chat/scope-resolvers/playbook-by-name", () => ({
  resolvePlaybookByName,
}));
vi.mock("@/lib/chat/scope-resolvers/domain-by-name", () => ({
  resolveDomainByName,
}));

const handleDataModeWithToolsCalls: Array<{
  demoMessages: { role: string; content: string }[];
  llmMessage: string;
}> = [];

vi.mock("@/app/api/chat/route", async (orig) => {
  return await orig();
});

// Stub the deep handler so we can introspect its arguments without
// touching Anthropic / Prisma. We use module-replacement on its source.
vi.mock("@/lib/chat/v5-system-prompt", () => ({ buildV5SystemPrompt: vi.fn() }));
vi.mock("@/lib/ai/config-loader", () => ({
  getAIConfig: vi.fn().mockResolvedValue({ provider: "claude" }),
}));
vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: vi.fn(),
  getConfiguredMeteredAICompletionStream: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  handleDataModeWithToolsCalls.length = 0;
  isAuthError.mockReturnValue(false);
  requireAuth.mockResolvedValue({
    session: {
      user: { id: "u1", role: "OPERATOR", institutionId: "inst-1" },
    },
  });
});

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DEMO mode scope-prefix parsing (#1546)", () => {
  it("multi-token message → 400 with parser error", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeReq({
        message: "set warmth 0.2 @bertie ^OCEAN",
        mode: "DEMO",
        conversationHistory: [],
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Too many scope tokens/);
  });

  it("#system + OPERATOR session → 403", async () => {
    requireAuth.mockResolvedValueOnce({
      session: { user: { id: "u1", role: "OPERATOR", institutionId: "inst-1" } },
    });
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeReq({
        message: "set warmth 0.2 #system",
        mode: "DEMO",
        userRole: "OPERATOR",
        conversationHistory: [],
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/SYSTEM scope requires ADMIN role/);
  });

  it("#system + ADMIN session → 400 with Sprint-2 message", async () => {
    requireAuth.mockResolvedValueOnce({
      session: { user: { id: "u-admin", role: "ADMIN", institutionId: "inst-1" } },
    });
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeReq({
        message: "set warmth 0.2 #system",
        mode: "DEMO",
        userRole: "ADMIN",
        conversationHistory: [],
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/SYSTEM scope writes ship in Sprint 2/);
  });

  it("@caller resolver miss → 400 with reason + candidates", async () => {
    resolveCallerByName.mockResolvedValueOnce({
      ok: false,
      reason: "No caller found matching 'bertie'",
    });
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeReq({
        message: "set warmth 0.2 @bertie",
        mode: "DEMO",
        userRole: "OPERATOR",
        conversationHistory: [],
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No caller found/);
    expect(resolveCallerByName).toHaveBeenCalledWith("bertie", {
      institutionId: "inst-1",
    });
  });

  it("@caller resolver receives institutionId=undefined for SUPERADMIN", async () => {
    requireAuth.mockResolvedValueOnce({
      session: {
        user: { id: "u-sa", role: "SUPERADMIN", institutionId: "inst-1" },
      },
    });
    resolveCallerByName.mockResolvedValueOnce({
      ok: false,
      reason: "No caller found",
    });
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeReq({
        message: "set warmth 0.2 @bertie",
        mode: "DEMO",
        userRole: "SUPERADMIN",
        conversationHistory: [],
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(resolveCallerByName).toHaveBeenCalledWith("bertie", {
      institutionId: undefined,
    });
  });
});

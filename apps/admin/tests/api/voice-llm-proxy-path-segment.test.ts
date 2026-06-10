/**
 * Tests for the path-segment auth surface on the VAPI custom-LLM proxy
 * (#TBD-pathseg). Pins:
 *
 *   - Non-hex path → 400 (defence against `..` traversal)
 *   - Short / long path → 400 (bounds)
 *   - Hex path but no webhookSecret on row → 401
 *   - Hex path mismatching webhookSecret → 401
 *   - Hex path matching webhookSecret → handler reached (200 from mocked run)
 *
 * Body-handler logic itself is tested separately by the existing
 * `tests/api/voice-llm-proxy.test.ts` (which uses the header surface).
 * This file only exercises the path-segment route's auth layer +
 * format-validation guard.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceProvider: { findUnique: mockFindUnique },
  },
}));

const mockRunVapiChatCompletion = vi.fn(
  async () =>
    new Response("body-handler-ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }),
);
vi.mock("@/lib/voice/llm-proxy/run-vapi-chat-completion", () => ({
  runVapiChatCompletion: mockRunVapiChatCompletion,
}));

vi.mock("@/lib/voice/telemetry", () => ({
  startVoiceSpan: vi.fn(() => () => undefined),
  logVoiceEvent: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

const EXPECTED_HEX = "f7143c63081d22eb14bde7e6ad4de5408fb8885714fd38ad88fa8d83782082ac"; // 64-char

beforeEach(() => {
  mockFindUnique.mockReset();
  mockRunVapiChatCompletion.mockClear();
});

function postRequest(): Request {
  return new Request("http://test/api/voice/llm-proxy/auth/X/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", messages: [], stream: false }),
  });
}

async function callRoute(secret: string) {
  const mod = await import(
    "@/app/api/voice/llm-proxy/auth/[secret]/chat/completions/route"
  );
  return mod.POST(postRequest(), {
    params: Promise.resolve({ secret }),
  });
}

describe("POST /api/voice/llm-proxy/auth/[secret]/chat/completions (#TBD-pathseg)", () => {
  it("400 — empty secret param", async () => {
    const res = await callRoute("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/Empty path secret/);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("400 — too short (below 8 chars)", async () => {
    const res = await callRoute("ab12cd");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/length out of bounds/);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("400 — too long (above 256 chars)", async () => {
    const tooLong = "a".repeat(257);
    const res = await callRoute(tooLong);
    expect(res.status).toBe(400);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("400 — non-hex characters (path-traversal defence)", async () => {
    const res = await callRoute("../../../etc/passwd");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/hexadecimal/);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("400 — slash in secret (path-traversal defence)", async () => {
    const res = await callRoute("abc/def");
    expect(res.status).toBe(400);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("401 — no VoiceProvider row for the slug", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await callRoute(EXPECTED_HEX);
    expect(res.status).toBe(401);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("401 — webhookSecret is empty on the row (path-segment requires it)", async () => {
    mockFindUnique.mockResolvedValueOnce({
      slug: "vapi",
      credentials: {},
    });
    const res = await callRoute(EXPECTED_HEX);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toMatch(/requires a configured webhookSecret/);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("401 — path secret doesn't match stored webhookSecret", async () => {
    mockFindUnique.mockResolvedValueOnce({
      slug: "vapi",
      credentials: { webhookSecret: "deadbeefcafebabe1234567890abcdef" },
    });
    const res = await callRoute(EXPECTED_HEX);
    expect(res.status).toBe(401);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("401 — length mismatches stored webhookSecret (defends timing-safe-equal)", async () => {
    mockFindUnique.mockResolvedValueOnce({
      slug: "vapi",
      credentials: { webhookSecret: "shortabcd" },
    });
    const res = await callRoute(EXPECTED_HEX);
    expect(res.status).toBe(401);
    expect(mockRunVapiChatCompletion).not.toHaveBeenCalled();
  });

  it("200 — hex path secret matches stored webhookSecret → calls body handler", async () => {
    mockFindUnique.mockResolvedValueOnce({
      slug: "vapi",
      credentials: { webhookSecret: EXPECTED_HEX },
    });
    const res = await callRoute(EXPECTED_HEX);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body-handler-ok");
    expect(mockRunVapiChatCompletion).toHaveBeenCalledTimes(1);
  });
});

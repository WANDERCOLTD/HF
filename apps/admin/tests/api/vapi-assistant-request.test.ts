/**
 * Tests for app/api/vapi/assistant-request/route.ts
 *
 * Validates that voice call settings (provider, model, tools, knowledgePlan)
 * are consumed from DB-backed VoiceCallSettings, not hardcoded.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Mock VAPI auth ─────────────────────────────────
vi.mock("@/lib/voice/providers/vapi/auth", () => ({
  verifyVapiRequest: vi.fn().mockReturnValue(null),
}));

// ── Mock voice call settings ───────────────────────
const mockGetVoiceCallSettings = vi.fn();
vi.mock("@/lib/system-settings", () => ({
  getVoiceCallSettings: (...args: any[]) => mockGetVoiceCallSettings(...args),
}));

// ── Mock prisma ────────────────────────────────────
const mockCallerFindFirst = vi.fn();
const mockCallerFindUnique = vi.fn();
const mockComposedPromptFindFirst = vi.fn();
// AnyVoice #1027 — assistant-request route now calls
// resolveVoiceProviderForCaller(callerId), which reads
// prisma.caller.findUnique({ select: { voiceProvider, cohortGroupId } }).
// Default returns null voiceProvider so the cascade falls through to
// SYSTEM default via getDefaultVoiceProviderSlug (mocked below).
const mockVoiceProviderFindFirst = vi.fn();
const mockVoiceProviderFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    caller: {
      findFirst: (...args: any[]) => mockCallerFindFirst(...args),
      findUnique: (...args: any[]) => mockCallerFindUnique(...args),
    },
    composedPrompt: { findFirst: (...args: any[]) => mockComposedPromptFindFirst(...args) },
    voiceProvider: {
      findFirst: (...args: any[]) => mockVoiceProviderFindFirst(...args),
      findUnique: (...args: any[]) => mockVoiceProviderFindUnique(...args),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

// AnyVoice #1031 — factory reads VoiceProvider from DB. Mock the
// adapter directly so the cost-of-instantiation + VAPI-spec coupling
// stay out of these wire-format tests.
vi.mock("@/lib/voice/provider-factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/provider-factory")>();
  return {
    ...actual,
    getVoiceProvider: vi.fn(async () => {
      const { VapiProvider } = await import("@/lib/voice/providers/vapi");
      return new VapiProvider({ webhookSecret: "" }, {});
    }),
    getDefaultVoiceProviderSlug: vi.fn(async () => "vapi"),
  };
});

// ── Mock config ────────────────────────────────────
vi.mock("@/lib/config", () => ({
  config: {
    app: { url: "https://test.example.com" },
    ai: {
      openai: { model: "gpt-4o" },
      claude: { model: "claude-sonnet-4-5-20250929" },
    },
    // AnyVoice #1019 — loadToolDefinitions reads config.specs.voiceTools.
    specs: {
      voiceTools: "TOOLS-001",
    },
  },
}));

// AnyVoice #1019 — loadToolDefinitions otherwise tries to read the
// AnalysisSpec from prisma; short-circuit with empty tools array so
// these wire-format tests stay focused on assistant-config shape.
vi.mock("@/lib/voice/load-tool-definitions", () => ({
  loadToolDefinitions: vi.fn().mockResolvedValue([]),
}));

// ── Mock fallback-settings (prevents config.ai.claude crash) ──
vi.mock("@/lib/fallback-settings", () => ({
  getActivitiesConfig: vi.fn().mockResolvedValue({
    enabled: true,
    textProvider: "stub",
    maxActivitiesPerSession: 2,
    maxTextsPerWeek: 2,
    betweenSessionTextsEnabled: false,
  }),
  FALLBACK_SETTINGS_REGISTRY: [],
}));

// ── Mock renderProviderPrompt ─────────────────────────
vi.mock("@/lib/prompt/composition/renderPromptSummary", () => ({
  renderProviderPrompt: vi.fn().mockReturnValue("You are a test voice prompt."),
}));

// ── Mock resolvePlaybookId ─────────────────────────
vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: vi.fn().mockResolvedValue(null),
}));

// ── Mock vapi tools route ──
// Post-#1043: TOOL_SETTING_KEYS and VAPI_TOOL_DEFINITIONS no longer
// exist. The assistant-request route loads tools via
// `loadToolDefinitions`, which the test mocks directly below.
vi.mock("@/app/api/vapi/tools/route", () => ({
  POST: vi.fn(),
}));

// ── Import route AFTER mocks ───────────────────────
const { POST } = await import("@/app/api/vapi/assistant-request/route");

// ── Helpers ────────────────────────────────────────

const defaultSettings = {
  provider: "openai",
  model: "gpt-4o",
  knowledgePlanEnabled: true,
  autoPipeline: true,
  unknownCallerPrompt: "You are a helpful voice assistant.",
  noActivePromptFallback: "You are a helpful voice tutor.",
};

function makeRequest(body: Record<string, any>) {
  return new NextRequest("https://test.example.com/api/vapi/assistant-request", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function assistantRequestBody(phone = "+441234567890") {
  return {
    message: {
      type: "assistant-request",
      call: { customer: { number: phone } },
    },
  };
}

describe("POST /api/vapi/assistant-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVoiceCallSettings.mockResolvedValue({ ...defaultSettings });
    // AnyVoice #1027 — default: caller has no override, cascade falls
    // through to SYSTEM default ("vapi"). Per-test can override
    // mockCallerFindUnique to return a different voiceProvider.
    mockCallerFindUnique.mockResolvedValue({
      voiceProvider: null,
      cohortGroupId: null,
    });
  });

  it("uses provider and model from VoiceCallSettings", async () => {
    mockGetVoiceCallSettings.mockResolvedValue({
      ...defaultSettings,
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
    mockCallerFindFirst.mockResolvedValue({ id: "c1", name: "Alice", phone: "+441234567890" });
    mockComposedPromptFindFirst.mockResolvedValue({
      id: "p1",
      llmPrompt: { _quickStart: { first_line: "Hi Alice!" } },
      prompt: {},
    });

    const res = await POST(makeRequest(assistantRequestBody()));
    const json = await res.json();

    expect(json.assistant.model.provider).toBe("anthropic");
    expect(json.assistant.model.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("omits knowledgePlan when knowledgePlanEnabled is false", async () => {
    mockGetVoiceCallSettings.mockResolvedValue({
      ...defaultSettings,
      knowledgePlanEnabled: false,
    });
    mockCallerFindFirst.mockResolvedValue({ id: "c1", name: "Alice", phone: "+441234567890" });
    mockComposedPromptFindFirst.mockResolvedValue({
      id: "p1",
      llmPrompt: { _quickStart: { first_line: "Hi!" } },
      prompt: {},
    });

    const res = await POST(makeRequest(assistantRequestBody()));
    const json = await res.json();

    expect(json.assistant.knowledgePlan).toBeUndefined();
  });

  it("includes knowledgePlan when knowledgePlanEnabled is true", async () => {
    mockCallerFindFirst.mockResolvedValue({ id: "c1", name: "Alice", phone: "+441234567890" });
    mockComposedPromptFindFirst.mockResolvedValue({
      id: "p1",
      llmPrompt: { _quickStart: { first_line: "Hi!" } },
      prompt: {},
    });

    const res = await POST(makeRequest(assistantRequestBody()));
    const json = await res.json();

    expect(json.assistant.knowledgePlan).toBeDefined();
    expect(json.assistant.knowledgePlan.provider).toBe("custom-knowledge-base");
  });

  it("filters out disabled tools (spec-level enabled flag, #1043)", async () => {
    // AnyVoice #1043 — per-tool enablement lives on the TOOLS-001 spec
    // entry's `enabled` field, applied by loadToolDefinitions BEFORE
    // returning to the route. The route no longer filters. So this
    // test mocks loadToolDefinitions to simulate the post-filter result.
    const { loadToolDefinitions } = await import("@/lib/voice/load-tool-definitions");
    const toolsSpec = await import("../../docs-archive/bdd-specs/TOOLS-001-voice-tool-definitions.spec.json");
    const filteredTools = ((toolsSpec as any).default.config.tools as Array<{
      function: { name: string };
    }>)
      .filter((t) => !["lookup_teaching_point", "send_text_to_caller", "request_artifact"].includes(t.function.name))
      .map((t) => {
        // Strip the `enabled` field the loader strips before returning
        const { enabled: _e, ...rest } = t as any;
        return rest;
      });
    (loadToolDefinitions as ReturnType<typeof vi.fn>).mockResolvedValueOnce(filteredTools);

    mockGetVoiceCallSettings.mockResolvedValue({ ...defaultSettings });
    mockCallerFindFirst.mockResolvedValue({ id: "c1", name: "Alice", phone: "+441234567890" });
    mockComposedPromptFindFirst.mockResolvedValue({
      id: "p1",
      llmPrompt: { _quickStart: { first_line: "Hi!" } },
      prompt: {},
    });

    const res = await POST(makeRequest(assistantRequestBody()));
    const json = await res.json();

    const toolNames = json.assistant.model.tools.map((t: any) => t.function.name);
    expect(toolNames).not.toContain("lookup_teaching_point");
    expect(toolNames).not.toContain("send_text_to_caller");
    expect(toolNames).not.toContain("request_artifact");
    // These should still be present
    expect(toolNames).toContain("check_mastery");
    expect(toolNames).toContain("record_observation");
    expect(toolNames).toContain("get_practice_question");
    expect(toolNames).toContain("get_next_module");
    expect(toolNames).toContain("log_activity_result");
  });

  it("uses unknownCallerPrompt from settings for unknown callers", async () => {
    mockGetVoiceCallSettings.mockResolvedValue({
      ...defaultSettings,
      unknownCallerPrompt: "Custom: who are you?",
    });
    mockCallerFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(assistantRequestBody()));
    const json = await res.json();

    expect(json.assistant.model.messages[0].content).toBe("Custom: who are you?");
  });

  it("uses noActivePromptFallback from settings when caller has no prompt", async () => {
    mockGetVoiceCallSettings.mockResolvedValue({
      ...defaultSettings,
      noActivePromptFallback: "Custom fallback.",
    });
    mockCallerFindFirst.mockResolvedValue({ id: "c1", name: "Bob", phone: "+441234567890" });
    mockComposedPromptFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(assistantRequestBody()));
    const json = await res.json();

    expect(json.assistant.model.messages[0].content).toContain("Custom fallback.");
    expect(json.assistant.model.messages[0].content).toContain("Bob");
  });

  it("acknowledges non-assistant-request events", async () => {
    const res = await POST(makeRequest({
      message: { type: "status-update", status: "in-progress" },
    }));
    const json = await res.json();

    expect(json.ok).toBe(true);
  });

  it("returns 400 when no phone number provided", async () => {
    const res = await POST(makeRequest({
      message: { type: "assistant-request", call: {} },
    }));

    expect(res.status).toBe(400);
  });
});

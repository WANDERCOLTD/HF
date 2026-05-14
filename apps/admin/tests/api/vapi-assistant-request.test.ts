/**
 * Tests for app/api/vapi/assistant-request/route.ts
 *
 * Validates that voice call settings (provider, model, tools, knowledgePlan)
 * are consumed from DB-backed VoiceCallSettings, not hardcoded.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Mock VAPI auth ─────────────────────────────────
vi.mock("@/lib/vapi/auth", () => ({
  verifyVapiRequest: vi.fn().mockReturnValue(null),
}));

// ── Mock voice call settings ───────────────────────
const mockGetVoiceCallSettings = vi.fn();
vi.mock("@/lib/system-settings", () => ({
  getVoiceCallSettings: (...args: any[]) => mockGetVoiceCallSettings(...args),
}));

// ── Mock prisma ────────────────────────────────────
const mockCallerFindFirst = vi.fn();
const mockComposedPromptFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    caller: { findFirst: (...args: any[]) => mockCallerFindFirst(...args) },
    composedPrompt: { findFirst: (...args: any[]) => mockComposedPromptFindFirst(...args) },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

// ── Mock config ────────────────────────────────────
vi.mock("@/lib/config", () => ({
  config: {
    app: { url: "https://test.example.com" },
    ai: {
      openai: { model: "gpt-4o" },
      claude: { model: "claude-sonnet-4-5-20250929" },
    },
  },
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

// ── Mock renderVoicePrompt ─────────────────────────
vi.mock("@/lib/prompt/composition/renderPromptSummary", () => ({
  renderVoicePrompt: vi.fn().mockReturnValue("You are a test voice prompt."),
}));

// ── Mock resolvePlaybookId ─────────────────────────
vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: vi.fn().mockResolvedValue(null),
}));

// ── Mock vapi tools route (for VAPI_TOOL_DEFINITIONS & TOOL_SETTING_KEYS) ──
vi.mock("@/app/api/vapi/tools/route", () => ({
  VAPI_TOOL_DEFINITIONS: [
    {
      type: "function",
      function: {
        name: "lookup_teaching_point",
        description: "Look up teaching content",
        parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      },
    },
    {
      type: "function",
      function: {
        name: "check_mastery",
        description: "Check mastery",
        parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      },
    },
    {
      type: "function",
      function: {
        name: "record_observation",
        description: "Record observation",
        parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_practice_question",
        description: "Get practice question",
        parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_next_module",
        description: "Get next module",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "log_activity_result",
        description: "Log activity result",
        parameters: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
      },
    },
    {
      type: "function",
      function: {
        name: "send_text_to_caller",
        description: "Send text",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    },
    {
      type: "function",
      function: {
        name: "request_artifact",
        description: "Request artifact",
        parameters: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
      },
    },
  ],
  TOOL_SETTING_KEYS: {
    lookup_teaching_point: "toolLookupTeachingPoint",
    check_mastery: "toolCheckMastery",
    record_observation: "toolRecordObservation",
    get_practice_question: "toolGetPracticeQuestion",
    get_next_module: "toolGetNextModule",
    log_activity_result: "toolLogActivityResult",
    send_text_to_caller: "toolSendText",
    request_artifact: "toolRequestArtifact",
  },
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
  toolLookupTeachingPoint: true,
  toolCheckMastery: true,
  toolRecordObservation: true,
  toolGetPracticeQuestion: true,
  toolGetNextModule: true,
  toolLogActivityResult: true,
  toolSendText: true,
  toolRequestArtifact: true,
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

  it("filters out disabled tools", async () => {
    mockGetVoiceCallSettings.mockResolvedValue({
      ...defaultSettings,
      toolLookupTeachingPoint: false,
      toolSendText: false,
      toolRequestArtifact: false,
    });
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

/**
 * Wizard Picker Dedup Harness — #978
 *
 * Drives the V5 wizard chat through `/api/chat` (WIZARD mode) across a scripted
 * 5-turn course-build conversation and stops at `create_course`. Mocks the AI
 * client so tool-call sequences are deterministic and the test runs in <1s.
 *
 * Purpose
 *   1. Baseline the API contract (`{ content, toolCalls }`) per turn so the
 *      three picker-dedup slices can verify the server-side response shape
 *      is unchanged.
 *   2. Run a small `predictRenderPlan(...)` derived from today's client-side
 *      assembly logic (`ConversationalWizard.tsx` `handleSend` lines 765-805,
 *      `processToolCalls` lines 506-636). Each slice will update the predictor
 *      to match the new behavior; the diff between slices IS the spec.
 *
 * What this test does NOT cover
 *   - Full React render. The client logic is replicated as a pure function in
 *     this file (`predictRenderPlan`). A separate unit test on any extracted
 *     helper covers the in-component branches.
 *   - Real LLM behavior. The system prompt is exercised but the model output
 *     is canned.
 *   - DB writes for `create_course`. Mocked at the executor boundary.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── MOCKS (must precede route import) ────────────────────────────────────

const { mockCompletion, mockExecuteWizardTool, mockGetAIConfig, mockEvaluateGraph,
  mockBuildSystemPrompt, mockGetSubjects } = vi.hoisted(() => ({
  mockCompletion: vi.fn(),
  mockExecuteWizardTool: vi.fn(),
  mockGetAIConfig: vi.fn(),
  mockEvaluateGraph: vi.fn(),
  mockBuildSystemPrompt: vi.fn(),
  mockGetSubjects: vi.fn(),
}));

vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: mockCompletion,
  getConfiguredMeteredAICompletionStream: vi.fn(),
  logMockAIUsage: vi.fn(),
}));

vi.mock("@/lib/chat/wizard-tool-executor", () => ({
  executeWizardTool: mockExecuteWizardTool,
}));

vi.mock("@/lib/ai/config-loader", () => ({
  getAIConfig: mockGetAIConfig,
}));

vi.mock("@/lib/wizard/graph-evaluator", () => ({
  evaluateGraph: mockEvaluateGraph,
  buildGraphFallback: vi.fn(() => ""),
}));

vi.mock("@/lib/chat/v5-system-prompt", () => ({
  buildV5SystemPrompt: mockBuildSystemPrompt,
}));

vi.mock("@/lib/system-settings", () => ({
  getKnowledgeRetrievalSettings: vi.fn(async () => ({ enabled: false })),
  getSubjectsCatalog: mockGetSubjects,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { id: "test-user", role: "OPERATOR" } },
  })),
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/ai/knowledge-accumulation", () => ({
  logAIInteraction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
  logAI: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// chat/route imports many siblings — stub the ones that touch DB.
vi.mock("@/app/api/chat/system-prompts", () => ({
  buildSystemPrompt: vi.fn(async () => "system"),
}));
vi.mock("@/app/api/chat/page-context", () => ({
  parsePageContext: vi.fn(() => null),
}));
vi.mock("@/app/api/chat/tray-reflection", () => ({
  parseTrayReflections: vi.fn(() => []),
  buildReflectionMessages: vi.fn(() => []),
}));
vi.mock("@/lib/chat/commands", () => ({
  executeCommand: vi.fn(),
  parseCommand: vi.fn(() => null),
}));
vi.mock("@/app/api/chat/tools", () => ({
  CHAT_TOOLS: [],
  executeToolCall: vi.fn(),
  buildContentCatalog: vi.fn(async () => ({})),
}));
vi.mock("@/lib/chat/admin-tools", () => ({ ADMIN_TOOLS: [] }));
vi.mock("@/lib/chat/admin-tool-handlers", () => ({
  executeAdminTool: vi.fn(),
}));
vi.mock("@/lib/chat/pending-change-payload", () => ({
  extractPendingChangeFromToolResult: vi.fn(() => null),
}));
vi.mock("@/lib/chat/course-ref-tools", () => ({ COURSE_REF_TOOLS: [] }));
vi.mock("@/lib/chat/course-ref-system-prompt", () => ({
  buildCourseRefSystemPrompt: vi.fn(async () => "system"),
}));
vi.mock("@/lib/chat/course-ref-tool-handlers", () => ({
  executeCourseRefTool: vi.fn(),
}));
vi.mock("@/lib/chat/conversational-wizard-tools", () => ({
  CONVERSATIONAL_TOOLS: [],
}));
vi.mock("@/lib/embeddings", () => ({ embedText: vi.fn() }));
vi.mock("@/lib/knowledge/retriever", () => ({
  retrieveKnowledgeForPrompt: vi.fn(async () => null),
}));
vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSourceIdsForDomain: vi.fn(async () => []),
  getSourceIdsForPlaybook: vi.fn(async () => []),
}));
vi.mock("@/lib/enrollment/resolve-playbook", () => ({
  resolvePlaybookId: vi.fn(async () => null),
}));
vi.mock("@/lib/knowledge/assertions", () => ({
  searchAssertionsHybrid: vi.fn(async () => []),
  searchAssertions: vi.fn(async () => []),
  searchCallerMemories: vi.fn(async () => []),
  formatAssertion: vi.fn(() => ""),
}));
vi.mock("@/lib/ai/client", () => ({
  isEngineAvailable: vi.fn(() => true),
}));
vi.mock("@/lib/ai/error-utils", () => ({
  classifyAIError: vi.fn(() => ({ code: "UNKNOWN" })),
  userMessageForError: vi.fn(() => "error"),
}));

// ─── TYPES ────────────────────────────────────────────────────────────────

interface CannedToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface CannedResponse {
  content: string;
  toolUses?: CannedToolUse[];
  rawContentBlocks?: unknown[];
}

interface ApiResponse {
  content: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  toolCallCount: number;
}

interface RenderPlan {
  /** Does the assistant text bubble appear in the message stream? */
  hasAssistantBubble: boolean;
  /** Picker present on this turn (stream-form or fieldPicker) */
  picker: {
    question: string;
    mode: "radio" | "checklist";
    fieldPicker: boolean;
    optionCount: number;
  } | null;
  /** Suggestion chips floating rail at bottom of chat (legacy location). */
  suggestionChips: string[] | null;
  /** #978 Slice 2 — chips attached to the picker footer (new location). */
  pickerChips: string[] | null;
  /** Whether ... MessageActions menu would render alongside assistant bubble */
  messageActionsOnAssistantBubble: boolean;
}

// ─── PREDICTOR (mirrors handleSend assembly + processToolCalls — TODAY) ───

/**
 * Mirrors `ConversationalWizard.tsx` `handleSend` assembly + `processToolCalls`.
 *
 * Current state: slices 1 + 2 applied. Slice 3 (MessageActions on picker)
 * updates this function further.
 *
 * Rules in force:
 *   - show_options with fieldPicker=true → fieldPickerPanel (NOT in stream)
 *   - show_options without fieldPicker → systemType:"options" in stream
 *   - response.content non-empty AND no stream-form picker → assistant bubble (SLICE 1)
 *   - _welcomePhases checklist → drops co-emitted show_suggestions (precedent)
 *   - Stream-form non-welcomePhases picker + co-emitted show_suggestions →
 *     chips attach to picker footer (pickerChips); floating rail suppressed (SLICE 2)
 *   - All other show_suggestions → floating rail (suggestionChips)
 *   - MessageActions menu renders on assistant bubble (today; slice 3 will add to picker)
 */
function predictRenderPlan(api: ApiResponse): RenderPlan {
  const optionsCalls = api.toolCalls.filter((t) => t.name === "show_options");
  const streamOptionsCall = optionsCalls.find((t) => t.input.fieldPicker !== true);
  const fieldPickerCall = optionsCalls.find((t) => t.input.fieldPicker === true);
  const suggestionsCall = api.toolCalls.find((t) => t.name === "show_suggestions");

  const hasWelcomePhasesChecklist = optionsCalls.some(
    (t) => t.input.mode === "checklist" && t.input.dataKey === "_welcomePhases",
  );

  // Pick the picker that surfaces this turn — stream-form preferred.
  const pickerSource = streamOptionsCall ?? fieldPickerCall;

  // SLICE 2 — chips attach to picker iff: stream-form picker present, NOT
  // welcome-phases, AND show_suggestions co-emitted this turn.
  const streamFormPickerNonWelcome =
    streamOptionsCall && streamOptionsCall.input.dataKey !== "_welcomePhases";
  const pickerChips: string[] | null =
    streamFormPickerNonWelcome && suggestionsCall && !hasWelcomePhasesChecklist
      ? (suggestionsCall.input.suggestions as string[] | undefined) ?? null
      : null;

  const picker: RenderPlan["picker"] = pickerSource
    ? {
        question: String(pickerSource.input.question ?? ""),
        mode: pickerSource.input.mode === "checklist" ? "checklist" : "radio",
        fieldPicker: pickerSource.input.fieldPicker === true,
        optionCount: Array.isArray(pickerSource.input.options)
          ? (pickerSource.input.options as unknown[]).length
          : 0,
      }
    : null;

  // Floating rail: chips suppressed when attached to a picker, or when
  // welcome-phases dropped them.
  const suggestionChips =
    suggestionsCall && !hasWelcomePhasesChecklist && !pickerChips
      ? (suggestionsCall.input.suggestions as string[] | undefined) ?? null
      : null;

  // SLICE 1: suppress assistant bubble when a stream-form picker is on the
  // same turn. FieldPicker turns are out of scope (AC-FieldPicker-Scope).
  const hasStreamFormPicker = streamOptionsCall !== undefined;
  const hasAssistantBubble = api.content.length > 0 && !hasStreamFormPicker;

  return {
    hasAssistantBubble,
    picker,
    suggestionChips,
    pickerChips,
    messageActionsOnAssistantBubble: hasAssistantBubble,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

/**
 * Queue canned AI responses for the next `postChat` call. After any response
 * that includes toolUses, an empty `end_turn` follow-up is auto-appended — the
 * wizard tool loop always calls the AI once more to give it a chance to ack
 * the tool results, and without a queued follow-up the mock returns undefined
 * and the route 500s.
 */
function queueCompletions(responses: CannedResponse[]) {
  mockCompletion.mockReset();
  for (const r of responses) {
    mockCompletion.mockResolvedValueOnce({
      content: r.content,
      engine: "claude",
      model: "claude-sonnet-4-5-20250929",
      stopReason: r.toolUses?.length ? "tool_use" : "end_turn",
      toolUses: r.toolUses ?? [],
      rawContentBlocks: r.rawContentBlocks ?? [
        ...(r.content ? [{ type: "text", text: r.content }] : []),
        ...(r.toolUses ?? []).map((t) => ({
          type: "tool_use",
          id: t.id,
          name: t.name,
          input: t.input,
        })),
      ],
    });
    if (r.toolUses && r.toolUses.length > 0) {
      // Auto follow-up: tool loop calls AI again after executing tools.
      mockCompletion.mockResolvedValueOnce({
        content: "",
        engine: "claude",
        model: "claude-sonnet-4-5-20250929",
        stopReason: "end_turn",
        toolUses: [],
        rawContentBlocks: [],
      });
    }
  }
}

async function postChat(message: string, conversationHistory: Array<{ role: string; content: string }>, setupData: Record<string, unknown>): Promise<ApiResponse> {
  const { POST } = await import("@/app/api/chat/route");
  const req = new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({
      mode: "WIZARD",
      message,
      conversationHistory,
      setupData,
      entityContext: [],
    }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await POST(req);
  const body = await res.json();
  if (res.status !== 200) {
    throw new Error(`postChat ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as ApiResponse;
}

// ─── TESTS ────────────────────────────────────────────────────────────────

describe("Wizard picker dedup harness — #978 baseline (pre-slice-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAIConfig.mockResolvedValue({
      engine: "claude",
      model: "claude-sonnet-4-5-20250929",
      maxTokens: 4096,
      temperature: 0.7,
    });
    mockEvaluateGraph.mockResolvedValue({
      promptSection: "",
      blockedFields: [],
      completedFields: [],
    });
    mockBuildSystemPrompt.mockResolvedValue("V5 SYSTEM PROMPT");
    mockGetSubjects.mockResolvedValue([]);
    // Default executor — never called for show_* tools, only for update_setup
    // and create_course. Returns minimal success shape.
    mockExecuteWizardTool.mockImplementation(async (name: string) => ({
      tool_use_id: "x",
      content: "ok",
      is_error: false,
      ...(name === "create_course"
        ? { setupDataPatch: { draftPlaybookId: "pb-test", courseName: "Test Course" } }
        : {}),
    }));
  });

  it("drives 5 scripted turns and stops at create_course", async () => {
    const history: Array<{ role: string; content: string }> = [];
    let setupData: Record<string, unknown> = {};
    const turnLog: Array<{ user: string; api: ApiResponse; render: RenderPlan }> = [];

    // ── Turn 1: typeSlug picker ───────────────────────────────────────
    queueCompletions([
      {
        content: "What kind of course are you building?",
        toolUses: [
          {
            id: "t1-1",
            name: "show_options",
            input: {
              question: "What kind of course are you building?",
              dataKey: "typeSlug",
              mode: "radio",
              fieldPicker: false,
              options: [
                { value: "language", label: "Language", description: "" },
                { value: "professional", label: "Professional skills", description: "" },
              ],
            },
          },
        ],
      },
    ]);
    let api = await postChat("I want to build a course", history, setupData);
    history.push({ role: "user", content: "I want to build a course" });
    history.push({ role: "assistant", content: api.content });
    turnLog.push({ user: "I want to build a course", api, render: predictRenderPlan(api) });

    // ── Turn 2: audience picker ───────────────────────────────────────
    setupData = { ...setupData, typeSlug: "language" };
    queueCompletions([
      {
        content: "Great — language. Who's the audience?",
        toolUses: [
          {
            id: "t2-1",
            name: "show_options",
            input: {
              question: "Who's the audience?",
              dataKey: "audience",
              mode: "radio",
              fieldPicker: false,
              options: [
                { value: "ielts-prep", label: "IELTS prep", description: "" },
                { value: "business-english", label: "Business English", description: "" },
              ],
            },
          },
        ],
      },
    ]);
    api = await postChat("Language", history, setupData);
    history.push({ role: "user", content: "Language" });
    history.push({ role: "assistant", content: api.content });
    turnLog.push({ user: "Language", api, render: predictRenderPlan(api) });

    // ── Turn 3: goals checklist + co-emitted chips ────────────────────
    setupData = { ...setupData, audience: "ielts-prep" };
    queueCompletions([
      {
        content: "IELTS prep — what are the learner goals?",
        toolUses: [
          {
            id: "t3-1",
            name: "show_options",
            input: {
              question: "What goals should learners hit?",
              dataKey: "learningOutcomes",
              mode: "checklist",
              fieldPicker: false,
              options: [
                { value: "band-7", label: "Band 7 overall", description: "" },
                { value: "fluency", label: "Speaking fluency", description: "" },
              ],
            },
          },
          {
            id: "t3-2",
            name: "show_suggestions",
            input: {
              suggestions: ["Sounds right", "Something else", "Skip"],
            },
          },
        ],
      },
    ]);
    api = await postChat("IELTS prep", history, setupData);
    history.push({ role: "user", content: "IELTS prep" });
    history.push({ role: "assistant", content: api.content });
    turnLog.push({ user: "IELTS prep", api, render: predictRenderPlan(api) });

    // ── Turn 4: progressionMode picker (THE picker turn — fix #978) ───
    setupData = { ...setupData, learningOutcomes: ["band-7", "fluency"] };
    queueCompletions([
      {
        content: "Your course-ref doc declares a module catalogue. How should learners progress?",
        toolUses: [
          {
            id: "t4-1",
            name: "show_options",
            input: {
              question: "Your course-ref doc declares a module catalogue. How should learners progress?",
              dataKey: "progressionMode",
              mode: "radio",
              fieldPicker: false,
              options: [
                {
                  value: "learner-picks",
                  label: "Let learners pick from a menu",
                  description: "",
                  recommended: true,
                },
                { value: "ai-led", label: "AI directs the sequence", description: "" },
              ],
            },
          },
          {
            id: "t4-2",
            name: "show_suggestions",
            input: {
              suggestions: ["Continue", "I have a question", "Something else"],
            },
          },
        ],
      },
    ]);
    api = await postChat("Band 7 + fluency", history, setupData);
    history.push({ role: "user", content: "Band 7 + fluency" });
    history.push({ role: "assistant", content: api.content });
    turnLog.push({ user: "Band 7 + fluency", api, render: predictRenderPlan(api) });

    // ── Turn 5: create_course (STOP) ──────────────────────────────────
    setupData = { ...setupData, progressionMode: "learner-picks" };
    queueCompletions([
      {
        content: "Building your course now…",
        toolUses: [
          {
            id: "t5-1",
            name: "create_course",
            input: {
              courseName: "IELTS Prep Lab",
              typeSlug: "language",
              audience: "ielts-prep",
            },
          },
        ],
      },
    ]);
    api = await postChat("Let learners pick", history, setupData);
    turnLog.push({ user: "Let learners pick", api, render: predictRenderPlan(api) });

    // ── ASSERT: per-turn API shape (the stable contract) ──────────────

    expect(turnLog).toHaveLength(5);

    // Turn 1 — picker on typeSlug
    expect(turnLog[0].api.toolCalls).toEqual([
      expect.objectContaining({ name: "show_options" }),
    ]);
    expect(turnLog[0].api.content).toBe("What kind of course are you building?");

    // Turn 2 — picker on audience
    expect(turnLog[1].api.toolCalls).toEqual([
      expect.objectContaining({ name: "show_options" }),
    ]);

    // Turn 3 — picker + chips
    expect(turnLog[2].api.toolCalls.map((t) => t.name).sort()).toEqual([
      "show_options",
      "show_suggestions",
    ]);

    // Turn 4 — THE picker turn — picker + chips co-emit
    expect(turnLog[3].api.toolCalls.map((t) => t.name).sort()).toEqual([
      "show_options",
      "show_suggestions",
    ]);
    const t4Options = turnLog[3].api.toolCalls.find((t) => t.name === "show_options")!;
    expect(t4Options.input.dataKey).toBe("progressionMode");
    expect((t4Options.input.options as unknown[]).length).toBe(2);

    // Turn 5 — create_course fires and STOPS
    expect(turnLog[4].api.toolCalls).toEqual([
      expect.objectContaining({ name: "create_course" }),
    ]);
    expect(mockExecuteWizardTool).toHaveBeenCalledWith(
      "create_course",
      expect.objectContaining({ courseName: "IELTS Prep Lab" }),
      "test-user",
      expect.any(Object),
    );

    // ── ASSERT: render-plan after slices 1 + 2 ───────────────────────

    // Turn 1: picker present → assistant bubble SUPPRESSED (slice 1)
    expect(turnLog[0].render).toEqual({
      hasAssistantBubble: false,
      picker: expect.objectContaining({
        question: "What kind of course are you building?",
        fieldPicker: false,
      }),
      suggestionChips: null,
      pickerChips: null,
      messageActionsOnAssistantBubble: false,
    });

    // Turn 4: THE picker turn — bubble suppressed (slice 1), chips moved
    // under picker (slice 2) — floating rail empty
    expect(turnLog[3].render).toEqual({
      hasAssistantBubble: false,
      picker: expect.objectContaining({
        question: expect.stringContaining("module catalogue"),
        fieldPicker: false,
        mode: "radio",
        optionCount: 2,
      }),
      suggestionChips: null,
      pickerChips: ["Continue", "I have a question", "Something else"],
      messageActionsOnAssistantBubble: false,
    });

    // Turn 5: no picker — assistant bubble RENDERS (regression check)
    expect(turnLog[4].render).toEqual({
      hasAssistantBubble: true,
      picker: null,
      suggestionChips: null,
      pickerChips: null,
      messageActionsOnAssistantBubble: true,
    });
  });

  // Slice 2 — chips under picker
  it("welcome-phases checklist drops co-emitted chips (existing precedent)", async () => {
    queueCompletions([
      {
        content: "What welcome moments do you want?",
        toolUses: [
          {
            id: "wp-1",
            name: "show_options",
            input: {
              question: "What welcome moments do you want?",
              dataKey: "_welcomePhases",
              mode: "checklist",
              fieldPicker: false,
              options: [
                { value: "goals", label: "Goals", description: "" },
                { value: "intro", label: "AI Introduction", description: "" },
              ],
            },
          },
          {
            id: "wp-2",
            name: "show_suggestions",
            input: { suggestions: ["This should be dropped"] },
          },
        ],
      },
    ]);
    const api = await postChat("Tell me about welcome", [], {});
    const render = predictRenderPlan(api);

    // Picker present, chips suppressed by _welcomePhases guard (slice 2
    // must NOT reintroduce chips on this turn — AC-WelcomePhases-Preservation).
    expect(render.picker).not.toBeNull();
    expect(render.suggestionChips).toBeNull();
    expect(render.pickerChips).toBeNull();
  });

  it("fieldPicker=true panel renders above input bar (not in stream-form preExtras)", async () => {
    queueCompletions([
      {
        content: "Pick a course type",
        toolUses: [
          {
            id: "fp-1",
            name: "show_options",
            input: {
              question: "Pick a course type",
              dataKey: "typeSlug",
              mode: "radio",
              fieldPicker: true,
              options: [{ value: "language", label: "Language", description: "" }],
            },
          },
        ],
      },
    ]);
    const api = await postChat("ready", [], {});
    const render = predictRenderPlan(api);

    expect(render.picker?.fieldPicker).toBe(true);
    // AC-FieldPicker-Scope: slice 1 MUST NOT touch fieldPicker turns. The
    // assistant bubble still renders alongside the fieldPicker panel.
    expect(render.hasAssistantBubble).toBe(true);
  });
});

describe("Wizard picker dedup — slice 1 (assistant bubble suppression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAIConfig.mockResolvedValue({
      engine: "claude",
      model: "claude-sonnet-4-5-20250929",
      maxTokens: 4096,
      temperature: 0.7,
    });
    mockEvaluateGraph.mockResolvedValue({
      promptSection: "",
      blockedFields: [],
      completedFields: [],
    });
    mockBuildSystemPrompt.mockResolvedValue("V5 SYSTEM PROMPT");
    mockGetSubjects.mockResolvedValue([]);
    mockExecuteWizardTool.mockResolvedValue({
      tool_use_id: "x",
      content: "ok",
      is_error: false,
    });
  });

  it("non-picker turn: assistant bubble + menu render normally (regression)", async () => {
    queueCompletions([
      { content: "Pure prose, no tools.", toolUses: [] },
    ]);
    const api = await postChat("hi", [], {});
    const render = predictRenderPlan(api);
    expect(render.hasAssistantBubble).toBe(true);
    expect(render.picker).toBeNull();
    expect(render.messageActionsOnAssistantBubble).toBe(true);
  });

  it("show_suggestions alone (no picker): chips render, bubble renders", async () => {
    queueCompletions([
      {
        content: "Pick one:",
        toolUses: [
          {
            id: "s-1",
            name: "show_suggestions",
            input: { suggestions: ["A", "B", "C"] },
          },
        ],
      },
    ]);
    const api = await postChat("hi", [], {});
    const render = predictRenderPlan(api);
    expect(render.hasAssistantBubble).toBe(true);
    expect(render.picker).toBeNull();
    expect(render.suggestionChips).toEqual(["A", "B", "C"]);
  });

  it("stream-form picker only (no chips): bubble suppressed, picker rendered", async () => {
    queueCompletions([
      {
        content: "What kind?",
        toolUses: [
          {
            id: "p-1",
            name: "show_options",
            input: {
              question: "What kind?",
              dataKey: "typeSlug",
              mode: "radio",
              fieldPicker: false,
              options: [{ value: "a", label: "A", description: "" }],
            },
          },
        ],
      },
    ]);
    const api = await postChat("hi", [], {});
    const render = predictRenderPlan(api);
    expect(render.hasAssistantBubble).toBe(false);
    expect(render.picker).not.toBeNull();
    expect(render.pickerChips).toBeNull();
    expect(render.messageActionsOnAssistantBubble).toBe(false);
  });
});

describe("Wizard picker dedup — slice 2 (chip rail under picker)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAIConfig.mockResolvedValue({
      engine: "claude",
      model: "claude-sonnet-4-5-20250929",
      maxTokens: 4096,
      temperature: 0.7,
    });
    mockEvaluateGraph.mockResolvedValue({
      promptSection: "",
      blockedFields: [],
      completedFields: [],
    });
    mockBuildSystemPrompt.mockResolvedValue("V5 SYSTEM PROMPT");
    mockGetSubjects.mockResolvedValue([]);
    mockExecuteWizardTool.mockResolvedValue({
      tool_use_id: "x",
      content: "ok",
      is_error: false,
    });
  });

  it("stream-form picker + co-emitted chips: chips ATTACH to picker, floating rail empty", async () => {
    queueCompletions([
      {
        content: "Pick progression mode",
        toolUses: [
          {
            id: "p-1",
            name: "show_options",
            input: {
              question: "How should learners progress?",
              dataKey: "progressionMode",
              mode: "radio",
              fieldPicker: false,
              options: [
                { value: "learner-picks", label: "Let learners pick", description: "" },
                { value: "ai-led", label: "AI directs", description: "" },
              ],
            },
          },
          {
            id: "s-1",
            name: "show_suggestions",
            input: { suggestions: ["Continue", "Something else"] },
          },
        ],
      },
    ]);
    const api = await postChat("ready", [], {});
    const render = predictRenderPlan(api);
    expect(render.picker).not.toBeNull();
    expect(render.pickerChips).toEqual(["Continue", "Something else"]);
    expect(render.suggestionChips).toBeNull();
  });

  it("show_suggestions WITHOUT picker: floating rail renders normally (regression)", async () => {
    queueCompletions([
      {
        content: "What next?",
        toolUses: [
          {
            id: "s-1",
            name: "show_suggestions",
            input: { suggestions: ["A", "B"] },
          },
        ],
      },
    ]);
    const api = await postChat("hi", [], {});
    const render = predictRenderPlan(api);
    expect(render.picker).toBeNull();
    expect(render.suggestionChips).toEqual(["A", "B"]);
    expect(render.pickerChips).toBeNull();
  });

  it("fieldPicker + chips: chips do NOT attach to picker (out of scope)", async () => {
    queueCompletions([
      {
        content: "Pick something",
        toolUses: [
          {
            id: "fp-1",
            name: "show_options",
            input: {
              question: "Pick",
              dataKey: "typeSlug",
              mode: "radio",
              fieldPicker: true,
              options: [{ value: "a", label: "A", description: "" }],
            },
          },
          {
            id: "s-1",
            name: "show_suggestions",
            input: { suggestions: ["Continue"] },
          },
        ],
      },
    ]);
    const api = await postChat("hi", [], {});
    const render = predictRenderPlan(api);
    // FieldPicker is out of scope for slice 2 — chips stay as floating rail
    expect(render.picker?.fieldPicker).toBe(true);
    expect(render.pickerChips).toBeNull();
    expect(render.suggestionChips).toEqual(["Continue"]);
  });
});

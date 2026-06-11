/**
 * #1485 / Epic #1442 Layer 3 Slice 4 — DEMO mode chat assistant tests.
 *
 * Six cases covering the action palette:
 *   1. test_voice — happy path delegates to dispatchSample (no DB write)
 *   2. dry_run_prompt — happy path delegates to executeComposition (no persist)
 *   3. apply_demo_preset — multi-field write goes through updatePlaybookConfig
 *      with fanoutScope='none' AND writeBehaviorTarget('BEH-RESPONSE-LEN', 0.2)
 *      AND emits a pendingChange payload (the tray-not-bypassed proof)
 *   4. precompose_for_fresh_learner — delegates to autoComposeForCaller; never
 *      calls prisma.call.create (no-bare-call-create rule contract)
 *   5. open_sim — returns a navigation hint with no DB write
 *   6. apply_demo_preset NEVER passes fanoutScope:'all' (the structural
 *      no-ai-fanout-all guarantee)
 *
 * Plus DEMO_SYSTEM_PROMPT invariant — pins the "demo caller" phrase the
 * AC requires and the "fan out to production learners" rule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  playbook: { findUnique: vi.fn() },
  caller: { findUnique: vi.fn(), findFirst: vi.fn() },
  callerPlaybook: { findFirst: vi.fn() },
  voiceProvider: { findUnique: vi.fn() },
  composedPrompt: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockDispatchSample = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/voice-providers/[id]/sample/route", () => ({
  dispatchSample: mockDispatchSample,
}));

const mockUpdatePlaybookConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: mockUpdatePlaybookConfig,
}));

const mockWriteBehaviorTarget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-tuner/write-target", () => ({
  writeBehaviorTarget: mockWriteBehaviorTarget,
  writeCallerBehaviorTarget: vi.fn(),
}));

const mockAutoComposeForCaller = vi.hoisted(() => vi.fn());
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: mockAutoComposeForCaller,
}));

const mockExecuteComposition = vi.hoisted(() => vi.fn());
const mockLoadComposeConfig = vi.hoisted(() => vi.fn());
const mockRenderPromptSummary = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prompt/composition", () => ({
  executeComposition: mockExecuteComposition,
  loadComposeConfig: mockLoadComposeConfig,
  persistComposedPrompt: vi.fn(),
}));
vi.mock("@/lib/prompt/composition/renderPromptSummary", () => ({
  renderPromptSummary: mockRenderPromptSummary,
}));

vi.mock("@/lib/voice/system-settings", () => ({
  getVoiceSystemSettings: vi.fn(async () => ({
    defaultProviderSlug: "vapi",
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    voicemailDetectionEnabled: true,
    endCallPhrases: [],
    maxCostPerCallUsd: null,
  })),
}));

// Stubs for the other voice helpers admin-tool-handlers imports at module
// load time. Same shape as `admin-tools-pending-change.test.ts`.
vi.mock("@/lib/voice/provider-factory", () => ({
  getVoiceProvider: vi.fn(async () => ({
    slug: "vapi",
    getConfigSchema: () => ({ fields: [] }),
  })),
}));
vi.mock("@/lib/cascade/voice-explain", () => ({
  explainVoiceCascade: vi.fn(),
}));

// `bump-timestamp` is imported by the handler module — guard against
// accidental real calls.
vi.mock("@/lib/compose/bump-timestamp", () => ({
  bumpPlaybookComposeTimestamp: vi.fn(),
  bumpCallerComposeTimestamp: vi.fn(),
}));

vi.mock("@/lib/compose/eager-reprompt-on-bump", () => ({
  triggerEagerRepromptForDemoCallers: vi.fn(),
}));

// ─── Tests ──────────────────────────────────────────────────────────────

describe("DEMO mode admin tools (#1485)", () => {
  let executeAdminTool: typeof import("@/lib/chat/admin-tool-handlers").executeAdminTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/chat/admin-tool-handlers");
    executeAdminTool = mod.executeAdminTool;
  });

  // ── 1. test_voice ──────────────────────────────────────────────────

  it("test_voice — happy path delegates to dispatchSample, no DB write beyond reads", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Prep",
      config: {
        welcomeMessage: "Welcome to the lab.",
        voice: { voiceProvider: "deepgram", voiceId: "aura-asteria-en" },
      },
    });
    mockPrisma.voiceProvider.findUnique.mockResolvedValueOnce({
      id: "vp-1",
      slug: "vapi",
      credentials: { deepgramApiKey: "dg-test" },
      config: { voiceProvider: "deepgram", voiceId: "aura-asteria-en" },
    });
    const fakeBytes = new ArrayBuffer(2048);
    mockDispatchSample.mockResolvedValueOnce({
      audioBytes: fakeBytes,
      engine: "deepgram",
      isExactPreview: true,
    });

    const raw = await executeAdminTool(
      "test_voice",
      { playbook_id: "pb-1" },
      "SUPER_TESTER",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.voice_provider_engine).toBe("deepgram");
    expect(result.voice_id).toBe("aura-asteria-en");
    expect(result.is_exact_preview).toBe(true);
    // Default text should be the playbook's welcomeMessage
    expect(result.text_sampled).toBe("Welcome to the lab.");
    expect(mockDispatchSample).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Welcome to the lab.",
        voiceProvider: "deepgram",
        voiceId: "aura-asteria-en",
        deepgramKey: "dg-test",
      }),
    );
  });

  // ── 2. dry_run_prompt ──────────────────────────────────────────────

  it("dry_run_prompt — happy path delegates to executeComposition, surfaces ≤400-char summary", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Prep",
      domainId: "d-1",
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValueOnce({
      callerId: "c-demo-1",
    });
    mockLoadComposeConfig.mockResolvedValueOnce({
      fullSpecConfig: {},
      sections: [],
      specSlug: "compose-001",
    });
    mockExecuteComposition.mockResolvedValueOnce({
      llmPrompt: { greeting: "hi" },
      loadedData: {},
      resolvedSpecs: {},
      metadata: {},
    });
    // Make the rendered summary >400 chars to exercise truncation
    const long = "x".repeat(500);
    mockRenderPromptSummary.mockReturnValueOnce(long);

    const raw = await executeAdminTool(
      "dry_run_prompt",
      { course_id: "pb-1", call_sequence: 1 },
      "SUPER_TESTER",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.course_id).toBe("pb-1");
    expect(result.caller_id).toBe("c-demo-1");
    expect(result.summary_full_length).toBe(500);
    expect(result.summary_truncated.length).toBeLessThanOrEqual(401); // 400 + ellipsis
    expect(mockExecuteComposition).toHaveBeenCalled();
  });

  // ── 3. apply_demo_preset — multi-field write through tray ──────────

  it("apply_demo_preset — writes through updatePlaybookConfig + writeBehaviorTarget AND emits pendingChange", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Prep",
      config: { firstCallMode: "onboarding", welcome: { aboutYou: { enabled: true } } },
    });
    mockUpdatePlaybookConfig.mockResolvedValueOnce({
      playbook: { id: "pb-1" },
      composeAffectingChanged: true,
      timestampBumped: true,
      fanoutScope: "none",
    });
    mockWriteBehaviorTarget.mockResolvedValueOnce({
      ok: true,
      action: "updated",
      parameterId: "BEH-RESPONSE-LEN",
      value: 0.2,
    });

    const raw = await executeAdminTool(
      "apply_demo_preset",
      {
        playbook_id: "pb-1",
        welcome_message: "Demo mode welcome",
        reason: "demo prep",
      },
      "OPERATOR",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.fields_written).toEqual(
      expect.arrayContaining([
        "firstCallMode",
        "welcome.aboutYou.enabled",
        "welcome.aiIntroCall.enabled",
        "welcomeMessage",
        "BEH-RESPONSE-LEN",
      ]),
    );
    // pendingChange must surface the batch in the tray with the playbook scope.
    expect(result.pendingChange).toMatchObject({
      scope: "playbook",
      scopeId: "pb-1",
      key: "firstCallMode",
      fanoutScope: "caller", // buildPendingChangePayload always sets 'caller' for AI
    });

    // Verify updatePlaybookConfig was called with the right merge shape.
    expect(mockUpdatePlaybookConfig).toHaveBeenCalledTimes(1);
    const [pid, transformer, options] = mockUpdatePlaybookConfig.mock.calls[0];
    expect(pid).toBe("pb-1");
    expect(options).toMatchObject({ fanoutScope: "none" });
    const next = transformer({ firstCallMode: "onboarding", welcome: { aboutYou: { enabled: true } } });
    expect(next.firstCallMode).toBe("teach_immediately");
    expect(next.welcome.aboutYou.enabled).toBe(false);
    expect(next.welcome.aiIntroCall.enabled).toBe(false);
    expect(next.welcomeMessage).toBe("Demo mode welcome");

    // BehaviorTarget write.
    expect(mockWriteBehaviorTarget).toHaveBeenCalledWith(
      "pb-1",
      "BEH-RESPONSE-LEN",
      0.2,
      expect.objectContaining({ source: "TUNING_CHAT" }),
    );
  });

  // ── 4. precompose_for_fresh_learner ────────────────────────────────

  it("precompose_for_fresh_learner — delegates to autoComposeForCaller; no prisma.call.create called", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Prep",
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValueOnce({
      callerId: "c-demo-1",
    });
    mockAutoComposeForCaller.mockResolvedValueOnce(undefined);
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce({
      composedAt: new Date("2026-06-11T10:00:00Z"),
    });

    const raw = await executeAdminTool(
      "precompose_for_fresh_learner",
      { playbook_id: "pb-1", reason: "smoke before demo" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.caller_id).toBe("c-demo-1");
    expect(result.composed_at).toBeDefined();
    expect(mockAutoComposeForCaller).toHaveBeenCalledWith("c-demo-1", "pb-1");
    // The findFirst that resolved the demo caller must filter by policyMode='demo'
    expect(mockPrisma.callerPlaybook.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { playbookId: "pb-1", policyMode: "demo", status: "ACTIVE" },
      }),
    );
  });

  // ── 5. open_sim ────────────────────────────────────────────────────

  it("open_sim — VIEWER can call; returns navigation hint with no DB write", async () => {
    mockPrisma.caller.findUnique.mockResolvedValueOnce({
      id: "c-1",
      name: "Demo Operator",
    });

    const raw = await executeAdminTool(
      "open_sim",
      { caller_id: "c-1" },
      "VIEWER",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.url).toBe("/x/sim/c-1");
    expect(result.caller_name).toBe("Demo Operator");
  });

  // ── 6. structural fanout='none' invariant (tray not bypassed) ──────

  it("apply_demo_preset — NEVER passes fanoutScope='all' to updatePlaybookConfig", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Prep",
      config: {},
    });
    mockUpdatePlaybookConfig.mockResolvedValueOnce({
      playbook: { id: "pb-1" },
      composeAffectingChanged: true,
      timestampBumped: true,
      fanoutScope: "none",
    });
    mockWriteBehaviorTarget.mockResolvedValueOnce({
      ok: true,
      action: "updated",
      parameterId: "BEH-RESPONSE-LEN",
      value: 0.2,
    });

    await executeAdminTool(
      "apply_demo_preset",
      { playbook_id: "pb-1", reason: "tray proof" },
      "OPERATOR",
    );

    expect(mockUpdatePlaybookConfig).toHaveBeenCalled();
    const callsWithAllFanout = mockUpdatePlaybookConfig.mock.calls.filter(
      (call: unknown[]) => {
        const opts = call[2] as { fanoutScope?: string } | undefined;
        return opts?.fanoutScope === "all";
      },
    );
    expect(callsWithAllFanout).toHaveLength(0);
    // And the one we DID make explicitly carries 'none'
    const opts = mockUpdatePlaybookConfig.mock.calls[0][2] as { fanoutScope?: string };
    expect(opts.fanoutScope).toBe("none");
  });
});

// ── DEMO_SYSTEM_PROMPT invariant ─────────────────────────────────────────

describe("DEMO mode system prompt invariants (#1485)", () => {
  it("contains the phrase 'demo caller' so the grounding contract is documented", async () => {
    const { DEMO_SYSTEM_PROMPT_RAW } = await import("@/lib/chat/demo-system-prompt");
    expect(DEMO_SYSTEM_PROMPT_RAW).toMatch(/demo caller/i);
  });

  it("explicitly forbids fan-out to production learners", async () => {
    const { DEMO_SYSTEM_PROMPT_RAW } = await import("@/lib/chat/demo-system-prompt");
    expect(DEMO_SYSTEM_PROMPT_RAW).toMatch(/production learners|never fan out|fan out to production/i);
  });

  it("enumerates all five tools by name", async () => {
    const { DEMO_SYSTEM_PROMPT_RAW } = await import("@/lib/chat/demo-system-prompt");
    expect(DEMO_SYSTEM_PROMPT_RAW).toContain("test_voice");
    expect(DEMO_SYSTEM_PROMPT_RAW).toContain("dry_run_prompt");
    expect(DEMO_SYSTEM_PROMPT_RAW).toContain("apply_demo_preset");
    expect(DEMO_SYSTEM_PROMPT_RAW).toContain("precompose_for_fresh_learner");
    expect(DEMO_SYSTEM_PROMPT_RAW).toContain("open_sim");
  });
});

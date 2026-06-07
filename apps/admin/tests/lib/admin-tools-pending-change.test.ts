/**
 * Tests for the #873 follow-up — pendingChange emission across every
 * compose-affecting admin tool handler.
 *
 * Per CHAIN-CONTRACTS Link 3, the producer set is: Playbook.config,
 * Domain.config, AnalysisSpec.config, BehaviorTarget, curriculum / LO /
 * assertion writes, goal lifecycle. Each of those handlers MUST emit a
 * `pendingChange` payload in its result when the timestamp bumped so
 * the chat route's `X-Pending-Changes` header carries it to the client
 * and the tray picks it up with `aiSuggested: true`.
 *
 * One test per migrated handler asserting the contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbook: { findUnique: vi.fn(), update: vi.fn() },
  caller: { findUnique: vi.fn(), update: vi.fn() },
  callerAttribute: { findFirst: vi.fn(), update: vi.fn() },
  curriculum: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  curriculumModule: { findUnique: vi.fn(), update: vi.fn() },
  learningObjective: { findUnique: vi.fn(), update: vi.fn() },
  contentAssertion: { update: vi.fn() },
  goal: { findUnique: vi.fn(), update: vi.fn() },
  // #1225 Slice B — swap/attach/detach curriculum tools
  playbookCurriculum: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  // Pass-through transaction so the swap handler's $transaction block
  // exercises the same mock as the surrounding handler.
  $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// #1225 Slice B — update_voice_config calls updatePlaybookConfig. Mock the
// helper so the test asserts the pendingChange emission contract without
// needing to set up a real Playbook row.
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: vi.fn(async () => undefined),
}));

vi.mock("@/lib/compose/bump-timestamp", () => ({
  bumpPlaybookComposeTimestamp: vi.fn(),
  bumpCallerComposeTimestamp: vi.fn(),
}));

// Resolve helpers — stub to return predictable playbook IDs.
// Both helpers live in lib/curriculum/resolve-playbook-for-curriculum.ts.
// #1034 — `resolvePlaybookIdForCurriculum` now returns `string[]` for CC-B fanout.
vi.mock("@/lib/curriculum/resolve-playbook-for-curriculum", () => ({
  resolvePlaybookIdForCurriculum: vi.fn(async () => ["pb-1"]),
  resolvePlaybookIdsForContentSource: vi.fn(async () => ["pb-1", "pb-2"]),
}));

// BehaviorTarget writer (used by update_behavior_target handler)
vi.mock("@/lib/agent-tuner/write-target", () => ({
  writeBehaviorTarget: vi.fn(async () => ({
    ok: true,
    parameterId: "BEH-WARMTH",
    action: "updated",
    value: 0.7,
  })),
  writeCallerBehaviorTarget: vi.fn(async () => ({
    ok: true,
    parameterId: "TOL-MASTERY-THRESHOLD",
    action: "updated",
    value: 0.55,
  })),
}));

describe("Admin tool handlers — pendingChange emission (#873 follow-up)", () => {
  let executeAdminTool: typeof import("@/lib/chat/admin-tool-handlers").executeAdminTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    // #925 added cheap-lookup `prisma.caller.findUnique` and
    // `prisma.playbook.findUnique` calls inside `handleUpdateBehaviorTarget`
    // to populate the tray entry's friendly scopeLabel (`Learner <name>` /
    // `Course <name>`). The lookup is `.catch(() => null)`-guarded but the
    // mock still has to return a Promise — bare `vi.fn()` resolves to
    // `undefined`, and `undefined.catch` throws synchronously before the
    // catch handler fires. Each test that needs a specific name can override
    // these in its own body.
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const mod = await import("@/lib/chat/admin-tool-handlers");
    executeAdminTool = mod.executeAdminTool;
  });

  it("update_behavior_target LEARNER emits pendingChange (scopeId=null)", async () => {
    const raw = await executeAdminTool(
      "update_behavior_target",
      { scope: "LEARNER", caller_id: "c-1", parameter_id: "TOL-MASTERY-THRESHOLD", target_value: 0.55 },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.pendingChange).toMatchObject({
      key: "TOL-MASTERY-THRESHOLD",
      scope: "playbook",
      scopeId: null,
      fanoutScope: "caller",
    });
  });

  it("update_behavior_target PLAYBOOK emits pendingChange with playbookId", async () => {
    const raw = await executeAdminTool(
      "update_behavior_target",
      { scope: "PLAYBOOK", playbook_id: "pb-7", parameter_id: "BEH-WARMTH", target_value: 0.7 },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.pendingChange).toMatchObject({
      scope: "playbook",
      scopeId: "pb-7",
      fanoutScope: "caller",
    });
  });

  it("update_curriculum_module emits pendingChange when playbook resolves", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: "mod-1",
      slug: "intro",
      title: "Intro",
      curriculumId: "cur-1",
    });
    mockPrisma.curriculumModule.update.mockResolvedValue({
      id: "mod-1",
      slug: "intro",
      title: "Intro 2",
    });
    const raw = await executeAdminTool(
      "update_curriculum_module",
      { module_id: "mod-1", title: "Intro 2" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.compose_inputs_bumped).toBe(true);
    expect(result.pendingChange).toMatchObject({
      key: "title",
      scope: "playbook",
      scopeId: "pb-1",
    });
  });

  it("update_assertion_lo_link emits pendingChange with first playbook", async () => {
    mockPrisma.contentAssertion.update.mockResolvedValue({
      id: "a-1",
      sourceId: "src-1",
      learningObjectiveId: "lo-1",
      learningOutcomeRef: "LO-1",
      linkConfidence: 1.0,
    });
    mockPrisma.learningObjective.findUnique.mockResolvedValue({ id: "lo-1", ref: "LO-1" });
    const raw = await executeAdminTool(
      "update_assertion_lo_link",
      { assertion_id: "a-1", learning_objective_id: "lo-1" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.pendingChange).toMatchObject({
      scope: "playbook",
      scopeId: "pb-1",
      key: "learningObjectiveId",
    });
  });

  it("confirm_goal emits pendingChange (caller-only, scopeId=null)", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue({
      id: "g-1",
      name: "Goal A",
      callerId: "c-1",
      isAssessmentTarget: false,
      status: "PENDING",
    });
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({ id: "ca-1" });
    mockPrisma.goal.update.mockResolvedValue({
      status: "COMPLETED",
      completedAt: new Date("2026-05-26"),
      progress: 1.0,
    });
    const raw = await executeAdminTool("confirm_goal", { goal_id: "g-1" }, "OPERATOR");
    const result = JSON.parse(raw);
    expect(result.pendingChange).toMatchObject({
      key: "status",
      scope: "playbook",
      scopeId: null,
      fanoutScope: "caller",
    });
    expect(result.pendingChange.afterValue).toBe("COMPLETED");
  });

  it("dismiss_goal emits pendingChange (caller-only)", async () => {
    mockPrisma.goal.findUnique.mockResolvedValue({
      id: "g-1",
      name: "Goal A",
      callerId: "c-1",
    });
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({ id: "ca-1" });
    mockPrisma.callerAttribute.update.mockResolvedValue({});
    const raw = await executeAdminTool("dismiss_goal", { goal_id: "g-1" }, "OPERATOR");
    const result = JSON.parse(raw);
    expect(result.pendingChange).toMatchObject({
      key: "completionSignal",
      scope: "playbook",
      scopeId: null,
    });
  });

  it("update_learning_objective emits pendingChange when bumped", async () => {
    mockPrisma.learningObjective.findUnique.mockResolvedValue({
      id: "lo-1",
      ref: "LO-1",
      moduleId: "mod-1",
      module: { curriculumId: "cur-1" },
    });
    mockPrisma.learningObjective.update.mockResolvedValue({
      id: "lo-1",
      ref: "LO-1",
      description: "Revised",
    });
    const raw = await executeAdminTool(
      "update_learning_objective",
      { learning_objective_id: "lo-1", description: "Revised" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.compose_inputs_bumped).toBe(true);
    expect(result.pendingChange).toMatchObject({
      key: "description",
      scope: "playbook",
    });
  });

  it("update_curriculum_metadata emits pendingChange with the representative sibling Playbook (#1034)", async () => {
    // #1034 — handler now resolves sibling Playbooks via resolvePlaybookIdForCurriculum
    // instead of reading the deprecated Curriculum.playbookId column directly.
    // pendingChange.scopeId is the representative (first = primary by ordering).
    mockPrisma.curriculum.findUnique.mockResolvedValue({
      id: "cur-1",
      name: "Old",
    });
    mockPrisma.curriculum.update.mockResolvedValue({
      id: "cur-1",
      name: "New",
      description: null,
      sourceTitle: null,
      sourceYear: null,
      authors: [],
    });
    const { resolvePlaybookIdForCurriculum } = await import(
      "@/lib/curriculum/resolve-playbook-for-curriculum"
    );
    (resolvePlaybookIdForCurriculum as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(["pb-9", "pb-variant-1", "pb-variant-2"]);
    const raw = await executeAdminTool(
      "update_curriculum_metadata",
      { curriculum_id: "cur-1", name: "New" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.pendingChange).toMatchObject({
      scope: "playbook",
      scopeId: "pb-9",
      key: "name",
    });
  });

  it("does NOT emit pendingChange when timestamp didn't bump (no playbook linked)", async () => {
    mockPrisma.curriculumModule.findUnique.mockResolvedValue({
      id: "mod-1",
      slug: "intro",
      title: "Intro",
      curriculumId: "cur-orphan",
    });
    // Override the resolve mock to return [] (no playbook linked).
    // #1034 — empty array = no siblings to fan out to.
    const { resolvePlaybookIdForCurriculum } = await import(
      "@/lib/curriculum/resolve-playbook-for-curriculum"
    );
    (resolvePlaybookIdForCurriculum as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    mockPrisma.curriculumModule.update.mockResolvedValue({
      id: "mod-1",
      slug: "intro",
      title: "Renamed",
    });
    const raw = await executeAdminTool(
      "update_curriculum_module",
      { module_id: "mod-1", title: "Renamed" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.compose_inputs_bumped).toBe(false);
    // pendingChange field should be absent (or undefined)
    expect(result.pendingChange).toBeUndefined();
  });

  // ── #1225 Slice B — three new compose-affecting tools ────────────────

  it("swap_primary_curriculum emits pendingChange with previous + new primary curriculum IDs", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Sales 101" });
    mockPrisma.curriculum.findUnique.mockResolvedValue({ id: "cur-target", name: "New Primary" });
    mockPrisma.playbookCurriculum.findFirst.mockResolvedValue({
      curriculumId: "cur-old",
    });
    mockPrisma.playbookCurriculum.update.mockResolvedValue({});
    mockPrisma.playbookCurriculum.upsert.mockResolvedValue({});
    const raw = await executeAdminTool(
      "swap_primary_curriculum",
      { playbook_id: "pb-1", curriculum_id: "cur-target", reason: "course refresh" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.compose_inputs_bumped).toBe(true);
    expect(result.pendingChange).toMatchObject({
      key: "primaryCurriculumId",
      scope: "playbook",
      scopeId: "pb-1",
      beforeValue: "cur-old",
      afterValue: "cur-target",
    });
  });

  it("attach_linked_curriculum emits pendingChange when a new join row is created", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Sales 101" });
    mockPrisma.curriculum.findUnique.mockResolvedValue({ id: "cur-new", name: "Variant Curriculum" });
    // No existing row → handler creates a new 'linked' join.
    mockPrisma.playbookCurriculum.findUnique.mockResolvedValue(null);
    mockPrisma.playbookCurriculum.create.mockResolvedValue({
      playbookId: "pb-1",
      curriculumId: "cur-new",
      role: "linked",
    });
    const raw = await executeAdminTool(
      "attach_linked_curriculum",
      { playbook_id: "pb-1", curriculum_id: "cur-new", reason: "offer variant" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.compose_inputs_bumped).toBe(true);
    expect(result.pendingChange).toMatchObject({
      key: "linkedCurriculumAttached",
      scope: "playbook",
      scopeId: "pb-1",
      afterValue: "cur-new",
    });
  });

  it("update_voice_config emits pendingChange against config.voice.* key", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "pb-1",
      name: "Sales 101",
      config: { voice: { provider: "vapi", model: "claude-old" } },
    });
    const raw = await executeAdminTool(
      "update_voice_config",
      {
        playbook_id: "pb-1",
        settings: { model: "claude-opus-4-7" },
        reason: "model bump",
      },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.compose_inputs_bumped).toBe(true);
    expect(result.pendingChange).toMatchObject({
      key: "voice.model",
      scope: "playbook",
      scopeId: "pb-1",
      beforeValue: "claude-old",
      afterValue: "claude-opus-4-7",
    });
  });

  // #1241 Slice 3 — autoPipeline must pass the ALLOWED whitelist and emit
  // a pendingChange against `voice.autoPipeline`. Catches the regression
  // where the key gets dropped from either the schema or the runtime set.
  it("update_voice_config accepts autoPipeline (#1241)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "pb-2",
      name: "IELTS Speaking",
      config: { voice: { autoPipeline: true } },
    });
    const raw = await executeAdminTool(
      "update_voice_config",
      {
        playbook_id: "pb-2",
        settings: { autoPipeline: false },
        reason: "manual review for this play",
      },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.updated_keys).toContain("autoPipeline");
    expect(result.pendingChange).toMatchObject({
      key: "voice.autoPipeline",
      scope: "playbook",
      scopeId: "pb-2",
      beforeValue: true,
      afterValue: false,
    });
  });

  // Note: update_intake_spec_draft does NOT bump Playbook compose stamp
  // (IntakeSpec is a separate authoring artifact, not a compose input).
  // It also does NOT emit pendingChange — there's no Playbook scope to
  // attach to. Verifying that explicitly here so a future refactor that
  // accidentally bumps the Playbook would be caught.
  it("update_intake_spec_draft does NOT emit pendingChange (no Playbook scope)", async () => {
    // We can't easily mock @tallyseal/spec-emitter, so this test asserts
    // the contract by intercepting at the spec-store layer.
    vi.doMock("@/lib/intake/spec-store", () => ({
      findById: vi.fn(async () => ({
        id: "spec-1",
        key: "CreateCourse",
        version: "0.1.0",
        status: "DRAFT",
        body: { fields: { placeholder: { type: "string", required: false } } },
        source: "",
      })),
      updateDraft: vi.fn(async () => ({
        id: "spec-1",
        updatedAt: new Date("2026-06-06"),
      })),
    }));
    vi.doMock("@/lib/intake/crawcus-serde", () => ({
      projectBodyFromEditable: vi.fn(() => ({
        fields: { placeholder: { type: "string", required: false } },
      })),
    }));
    vi.doMock("@tallyseal/spec-emitter", () => ({
      parse: vi.fn(() => ({})),
      SpecParseError: class extends Error {},
    }));
    vi.resetModules();
    const { executeAdminTool: freshExec } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await freshExec(
      "update_intake_spec_draft",
      {
        spec_id: "spec-1",
        source: "export const X = defineCrawcusSpec({ key: 'X', projection: 'X', version: 1, fields: {}, readiness: ({ has }) => has() });",
        reason: "field tweak",
      },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.pendingChange).toBeUndefined();
  });
});

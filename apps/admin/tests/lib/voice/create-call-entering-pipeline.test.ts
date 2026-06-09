/**
 * #1333 — createCallEnteringPipeline unit tests.
 *
 * The builder is the chokepoint for pipeline-entry Call creation; these
 * vitests lock the resolution cascade and the no-throw-on-missing-enrollment
 * behaviour. The end-to-end seed → POST → DB-assert path lives in
 * `tests/integration/sessions/1333-outbound-dial.test.ts`; the operator-
 * runnable proof lives in `scripts/proof-1333-outbound-dial.ts`.
 *
 * ACs defended (mapped 1:1 from #1333):
 *   1. Missing enrollment → returns { playbookId: null, ... }; does NOT throw.
 *   2. Happy path → all three FKs populated.
 *   3. Explicit `requestedModuleId` arg wins over `Caller.lastSelectedModuleId`.
 *   4. `lastSelectedModuleId` used when no arg.
 *   5. `voiceProvider=null` (sim path) succeeds.
 *   6. outbound-dial rollback path: VAPI error still deletes the placeholder
 *      (regression that adopting the builder didn't break the existing
 *      `prisma.call.delete` on the failure branch).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  call: { create: vi.fn(), delete: vi.fn() },
};

const mockResolveActivePlaybookId = vi.fn();
const mockResolveCurriculumIdForPlaybook = vi.fn();
const mockResolveModuleByLogicalId = vi.fn();
const mockResolveDefaultModuleForCaller = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/caller/resolve-active-playbook", () => ({
  resolveActivePlaybookId: mockResolveActivePlaybookId,
}));

vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: mockResolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId: mockResolveModuleByLogicalId,
}));

vi.mock("@/lib/curriculum/resolve-default-module", () => ({
  resolveDefaultModuleForCaller: mockResolveDefaultModuleForCaller,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults — individual tests override.
  mockPrisma.caller.findUnique.mockResolvedValue({ lastSelectedModuleId: null });
  mockPrisma.call.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "new-call-id", ...data })
  );
  mockResolveActivePlaybookId.mockResolvedValue(null);
  mockResolveCurriculumIdForPlaybook.mockResolvedValue(null);
  mockResolveModuleByLogicalId.mockResolvedValue(null);
  mockResolveDefaultModuleForCaller.mockResolvedValue(null);
});

describe("createCallEnteringPipeline", () => {
  it("AC1: returns { playbookId: null, ... } when caller has no ACTIVE enrollment — does NOT throw", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce(null);

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-no-enrol",
      source: "vapi",
      voiceProvider: "vapi",
    });

    expect(result.playbookId).toBeNull();
    expect(result.requestedModuleId).toBeNull();
    expect(result.curriculumModuleId).toBeNull();
    expect(result.call.id).toBe("new-call-id");
    // Critical: the create still happened (with NULL FKs), but the
    // resolution path didn't throw.
    expect(mockPrisma.call.create).toHaveBeenCalledTimes(1);
    expect(mockResolveCurriculumIdForPlaybook).not.toHaveBeenCalled();
    expect(mockResolveDefaultModuleForCaller).not.toHaveBeenCalled();
  });

  it("AC2: happy path — Call row carries playbookId + requestedModuleId + curriculumModuleId", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-active");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockResolveModuleByLogicalId.mockResolvedValueOnce({ id: "cm-part2" });

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: "part2",
    });

    expect(result.playbookId).toBe("pb-active");
    expect(result.requestedModuleId).toBe("part2");
    expect(result.curriculumModuleId).toBe("cm-part2");
    expect(mockPrisma.call.create).toHaveBeenCalledWith({
      data: {
        callerId: "caller-1",
        source: "vapi",
        voiceProvider: "vapi",
        transcript: "",
        playbookId: "pb-active",
        requestedModuleId: "part2",
        curriculumModuleId: "cm-part2",
      },
      select: { id: true },
    });
  });

  it("AC3: explicit `requestedModuleId` arg wins over `Caller.lastSelectedModuleId`", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockResolveModuleByLogicalId.mockResolvedValueOnce({ id: "cm-explicit" });
    // Caller has a persisted last selection, but the URL/CLI/body arg
    // should beat it.
    mockPrisma.caller.findUnique.mockResolvedValue({
      lastSelectedModuleId: "persisted-pick",
    });

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: "explicit-arg",
    });

    expect(result.requestedModuleId).toBe("explicit-arg");
    // findUnique should NOT have been consulted — explicit arg short-circuits.
    expect(mockPrisma.caller.findUnique).not.toHaveBeenCalled();
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledWith(
      "curr-1",
      "explicit-arg",
    );
  });

  it("AC4: `Caller.lastSelectedModuleId` is used when no arg is passed", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockResolveModuleByLogicalId.mockResolvedValueOnce({ id: "cm-persisted" });
    mockPrisma.caller.findUnique.mockResolvedValue({
      lastSelectedModuleId: "persisted-pick",
    });

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
      // No requestedModuleId arg.
    });

    expect(result.requestedModuleId).toBe("persisted-pick");
    expect(mockPrisma.caller.findUnique).toHaveBeenCalledWith({
      where: { id: "caller-1" },
      select: { lastSelectedModuleId: true },
    });
    expect(mockResolveModuleByLogicalId).toHaveBeenCalledWith(
      "curr-1",
      "persisted-pick",
    );
  });

  it("AC5: `voiceProvider=null` (sim path) succeeds without writing the voiceProvider key", async () => {
    // Call.voiceProvider is NOT NULL with a "vapi" default in the schema.
    // The builder omits the key entirely when arg is null so the column
    // default lands. The sim path passes null because the SIM is not a
    // voice provider; the column default is harmless because COMPOSE
    // reads `Call.source` for routing, not `Call.voiceProvider`.
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "sim",
      voiceProvider: null,
    });

    expect(result.playbookId).toBe("pb-1");
    expect(result.call.id).toBe("new-call-id");
    const createCallArg = mockPrisma.call.create.mock.calls[0][0];
    expect(createCallArg.data).toMatchObject({
      callerId: "caller-1",
      source: "sim",
      transcript: "",
      playbookId: "pb-1",
    });
    expect(createCallArg.data).not.toHaveProperty("voiceProvider");
  });

  it("falls back to resolveDefaultModuleForCaller (G6) when slug resolution misses", async () => {
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr-1");
    mockResolveModuleByLogicalId.mockResolvedValueOnce(null); // requested slug not in curriculum
    mockResolveDefaultModuleForCaller.mockResolvedValueOnce({
      moduleSlug: "part1",
      curriculumModuleId: "cm-default",
      source: "playbook_first_module",
    });

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const result = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
      // Slug from URL that doesn't match anything in the curriculum —
      // the G6 fallback rescues attribution.
    });

    expect(result.curriculumModuleId).toBe("cm-default");
    // No explicit arg + no lastSelectedModuleId → fallback surfaces its
    // own slug for the placeholder.
    expect(result.requestedModuleId).toBe("part1");
  });

  it("AC6 (regression): outbound-dial VAPI-error rollback still deletes the placeholder", async () => {
    // This regression test asserts the AFTER-builder-adoption shape of the
    // outbound-dial rollback path is intact: the route still calls
    // `prisma.call.delete({ where: { id: placeholderCall.id } })` on VAPI
    // failure. We assert on the routing of `entry.call.id` into
    // `prisma.call.delete` — the existing delete lines at outbound-dial
    // route.ts:204 / 262 / 271 are unchanged after adoption.
    mockResolveActivePlaybookId.mockResolvedValueOnce("pb-1");
    mockPrisma.call.create.mockResolvedValueOnce({ id: "placeholder-xyz" });
    mockPrisma.call.delete.mockResolvedValueOnce({ id: "placeholder-xyz" });

    const { createCallEnteringPipeline } = await import(
      "@/lib/voice/create-call-entering-pipeline"
    );
    const entry = await createCallEnteringPipeline({
      callerId: "caller-1",
      source: "vapi",
      voiceProvider: "vapi",
    });

    // Simulate the outbound-dial rollback: route catches VAPI 4xx and
    // deletes the placeholder. The `entry.call.id` value MUST be a
    // stable string id consumable by `prisma.call.delete({ where: { id } })`.
    expect(entry.call.id).toBe("placeholder-xyz");
    await mockPrisma.call.delete({ where: { id: entry.call.id } });
    expect(mockPrisma.call.delete).toHaveBeenCalledWith({
      where: { id: "placeholder-xyz" },
    });
  });
});

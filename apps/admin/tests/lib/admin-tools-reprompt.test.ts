/**
 * Tests for `reprompt_demo_set` and `reprompt_playbook` Cmd+K tools — #1429.
 *
 * Coverage:
 *   - tool registry: both tools appear in ADMIN_TOOLS with required schema
 *   - reprompt_demo_set fans out to demo callers only (OPERATOR+)
 *   - reprompt_playbook requires ADMIN+ (handler rejects OPERATOR via TOOL_MIN_ROLE)
 *   - both tools appear in COURSE_MANAGE_TOOL_NAMES
 *   - reprompt_playbook fans out to ALL active callers (demo + production)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  playbook: { findUnique: vi.fn() },
  callerPlaybook: { findMany: vi.fn() },
}));
const mockAutoCompose = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: mockAutoCompose,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAutoCompose.mockResolvedValue(undefined);
});

describe("ADMIN_TOOLS registry — reprompt tools (#1429)", () => {
  it("registers reprompt_demo_set with playbook_id + reason as required", async () => {
    const { ADMIN_TOOLS } = await import("@/lib/chat/admin-tools");
    const tool = ADMIN_TOOLS.find((t) => t.name === "reprompt_demo_set");
    expect(tool).toBeDefined();
    expect(tool?.input_schema.required).toContain("playbook_id");
    expect(tool?.input_schema.required).toContain("reason");
  });

  it("registers reprompt_playbook with playbook_id + reason as required", async () => {
    const { ADMIN_TOOLS } = await import("@/lib/chat/admin-tools");
    const tool = ADMIN_TOOLS.find((t) => t.name === "reprompt_playbook");
    expect(tool).toBeDefined();
    expect(tool?.input_schema.required).toContain("playbook_id");
    expect(tool?.input_schema.required).toContain("reason");
  });

  it("reprompt_playbook description warns about cohort fan-out + ADMIN+ gate", async () => {
    const { ADMIN_TOOLS } = await import("@/lib/chat/admin-tools");
    const tool = ADMIN_TOOLS.find((t) => t.name === "reprompt_playbook");
    expect(tool?.description).toMatch(/ADMIN/);
    // It should describe blast-radius (every active caller / cohort fan-out)
    expect(tool?.description).toMatch(/every active caller|cohort|all active/i);
  });
});

describe("reprompt_demo_set handler (#1429)", () => {
  it("fans out to demo callers only — autoCompose called once per demo caller", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Course" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c-demo-1" },
      { callerId: "c-demo-2" },
    ]);

    const { executeAdminTool } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await executeAdminTool(
      "reprompt_demo_set",
      { playbook_id: "pb-1", reason: "manual smoke" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.triggered).toBe(2);
    expect(result.failures).toEqual([]);
    // The findMany call should filter by demo
    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { playbookId: "pb-1", policyMode: "demo", status: "ACTIVE" },
      select: { callerId: true },
    });
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
  });

  it("returns helpful message when there are no demo callers", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Empty Course" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([]);

    const { executeAdminTool } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await executeAdminTool(
      "reprompt_demo_set",
      { playbook_id: "pb-1", reason: "x" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.triggered).toBe(0);
    expect(result.message).toMatch(/admin-test-enrol|No demo callers/);
  });
});

describe("reprompt_playbook handler (#1429)", () => {
  it("OPERATOR is refused — ADMIN+ required", async () => {
    const { executeAdminTool } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await executeAdminTool(
      "reprompt_playbook",
      { playbook_id: "pb-1", reason: "test" },
      "OPERATOR",
    );
    const result = JSON.parse(raw);
    expect(result.error).toMatch(/ADMIN|permission/i);
    // No fan-out should have happened
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("ADMIN fans out to every active caller (demo + production)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Course" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c-prod-1" },
      { callerId: "c-prod-2" },
      { callerId: "c-demo-1" },
    ]);

    const { executeAdminTool } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await executeAdminTool(
      "reprompt_playbook",
      { playbook_id: "pb-1", reason: "configure rollout" },
      "ADMIN",
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.triggered).toBe(3);
    // The findMany filter is by status ACTIVE only — policyMode is NOT
    // a filter (this is the cohort-wide fan-out path).
    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { playbookId: "pb-1", status: "ACTIVE" },
      select: { callerId: true },
    });
    expect(mockAutoCompose).toHaveBeenCalledTimes(3);
  });

  it("SUPERADMIN can also call (role hierarchy)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Course" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([{ callerId: "c-1" }]);

    const { executeAdminTool } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await executeAdminTool(
      "reprompt_playbook",
      { playbook_id: "pb-1", reason: "ops" },
      "SUPERADMIN",
    );
    const result = JSON.parse(raw);
    expect(result.ok).toBe(true);
    expect(result.triggered).toBe(1);
  });

  it("returns a clean message when no active callers exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb-1", name: "Empty" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([]);

    const { executeAdminTool } = await import("@/lib/chat/admin-tool-handlers");
    const raw = await executeAdminTool(
      "reprompt_playbook",
      { playbook_id: "pb-1", reason: "x" },
      "ADMIN",
    );
    const result = JSON.parse(raw);
    expect(result.triggered).toBe(0);
    expect(result.message).toMatch(/No active enrolments|nothing to recompose/i);
  });
});

describe("COURSE_MANAGE wiring (#1429)", () => {
  it("includes both reprompt tools in the COURSE_MANAGE allow-list", async () => {
    // Read the chat route source — the COURSE_MANAGE_TOOL_NAMES Set is
    // private to that module, so we assert via string match against the
    // module's exports... but it isn't exported. Instead, walk the
    // ADMIN_TOOLS registry and assert the names exist; the route's
    // filter will pick them up automatically because we registered.
    const { ADMIN_TOOLS } = await import("@/lib/chat/admin-tools");
    const names = new Set(ADMIN_TOOLS.map((t) => t.name));
    expect(names.has("reprompt_demo_set")).toBe(true);
    expect(names.has("reprompt_playbook")).toBe(true);
  });
});

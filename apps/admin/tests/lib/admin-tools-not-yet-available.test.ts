/**
 * Tests for NOT YET AVAILABLE roadmap stubs. Each stub must:
 *   - be discoverable via ADMIN_TOOLS (so the AI never invents the name)
 *   - have a description starting "NOT YET AVAILABLE"
 *   - route through handleNotYetAvailable (returns ok:false + not_yet_available:true)
 *   - be gated at OPERATOR (so STUDENT/VIEWER get the auth refusal before the stub fires)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // intentionally empty — stubs must NEVER hit the DB
  },
}));

const STUBS = [
  "list_caller_memories",
  "create_goal",
  "rename_subject",
  "replace_lesson_plan",
  "add_curriculum_module",
  "reset_caller",
];

describe("Cmd+K NOT YET AVAILABLE stubs", () => {
  let executeAdminTool: typeof import("@/lib/chat/admin-tool-handlers").executeAdminTool;
  let ADMIN_TOOLS: typeof import("@/lib/chat/admin-tools").ADMIN_TOOLS;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ executeAdminTool } = await import("@/lib/chat/admin-tool-handlers"));
    ({ ADMIN_TOOLS } = await import("@/lib/chat/admin-tools"));
  });

  describe.each(STUBS)("%s", (toolName) => {
    it("is declared in ADMIN_TOOLS", () => {
      const tool = ADMIN_TOOLS.find((t) => t.name === toolName);
      expect(tool).toBeDefined();
    });

    it("has a description starting with 'NOT YET AVAILABLE'", () => {
      const tool = ADMIN_TOOLS.find((t) => t.name === toolName);
      expect(tool?.description).toMatch(/^NOT YET AVAILABLE/);
    });

    it("returns ok:false + not_yet_available:true when invoked by an OPERATOR", async () => {
      const raw = await executeAdminTool(toolName, { reason: "test" }, "OPERATOR");
      const result = JSON.parse(raw);
      expect(result.ok).toBe(false);
      expect(result.not_yet_available).toBe(true);
      expect(result.tool).toBe(toolName);
      expect(result.message).toMatch(/on the roadmap/i);
    });

    it("rejects STUDENT before the stub fires (RBAC first)", async () => {
      const raw = await executeAdminTool(toolName, { reason: "test" }, "STUDENT");
      const result = JSON.parse(raw);
      expect(result.error).toMatch(/Insufficient permissions/);
      expect(result.not_yet_available).toBeUndefined();
    });
  });

  it("an undeclared tool name still returns 'Unknown tool', not the stub refusal", async () => {
    const raw = await executeAdminTool("totally_made_up_tool", {}, "OPERATOR");
    const result = JSON.parse(raw);
    expect(result.error).toMatch(/Unknown tool/);
  });
});

/**
 * Tests for the update_setup progressionMode gate (#318 follow-up).
 *
 * The gate refuses a "non-trivial" update_setup call when progressionMode
 * is unknown (not in fields AND not in setupData). It returns an is_error
 * directing the AI to call show_options for progressionModes first.
 *
 * "Non-trivial" = any field that is not an identity bag field
 * (institutionName, courseName, ids, etc.). The gate fires BEFORE any DB
 * lookups, so this test does not need Prisma.
 */

import { describe, it, expect, vi } from "vitest";

// Stub Prisma so the importing chain doesn't try to connect. The gate
// returns BEFORE any DB call, but the chain is loaded eagerly.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// Resolvers also import Prisma transitively; stub them so the import
// chain stays light.
vi.mock("@/lib/wizard/resolvers", () => ({
  resolveInstitutionByName: vi.fn(async () => null),
  resolveCourseByName: vi.fn(async () => null),
  resolveSubjectByName: vi.fn(async () => null),
  inferTypeFromName: vi.fn(() => undefined),
}));

import { executeWizardTool } from "@/lib/chat/wizard-tool-executor";

describe("update_setup — progressionMode gate (#318 follow-up)", () => {
  it("blocks non-trivial update_setup when progressionMode is missing", async () => {
    const result = await executeWizardTool(
      "update_setup",
      { fields: { interactionPattern: "directive", sessionCount: 8 } },
      "user-1",
      {},
    );
    expect(result.is_error).toBe(true);
    const payload = JSON.parse(result.content);
    expect(payload.ok).toBe(false);
    expect(payload.missingRequired).toEqual(["progressionMode"]);
    expect(payload.nextAction).toMatchObject({
      tool: "show_options",
      fieldKey: "progressionMode",
    });
  });

  it("allows identity-only update_setup without progressionMode", async () => {
    const result = await executeWizardTool(
      "update_setup",
      { fields: { courseName: "Hello", subjectDiscipline: "Maths" } },
      "user-1",
      {},
    );
    // Either success or downstream behavior — but NOT the progressionMode gate error.
    if (result.is_error) {
      const payload = JSON.parse(result.content);
      expect(payload.missingRequired).not.toEqual(["progressionMode"]);
    }
  });

  it("passes when progressionMode is set in this same call", async () => {
    const result = await executeWizardTool(
      "update_setup",
      { fields: { progressionMode: "ai-led", sessionCount: 8 } },
      "user-1",
      {},
    );
    if (result.is_error) {
      const payload = JSON.parse(result.content);
      expect(payload.missingRequired).not.toEqual(["progressionMode"]);
    }
  });

  it("passes when progressionMode was set in a prior call (setupData)", async () => {
    const result = await executeWizardTool(
      "update_setup",
      { fields: { sessionCount: 8 } },
      "user-1",
      { progressionMode: "learner-picks" },
    );
    if (result.is_error) {
      const payload = JSON.parse(result.content);
      expect(payload.missingRequired).not.toEqual(["progressionMode"]);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadWizardSteps, evaluateSkipCondition } from "@/lib/wizards/wizard-spec";

const mockPrisma = vi.hoisted(() => ({
  analysisSpec: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

describe("wizard-spec loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadWizardSteps", () => {
    it("loads wizard steps from ORCHESTRATE spec", async () => {
      const mockSteps = [
        {
          id: "source",
          label: "Add Source",
          activeLabel: "Adding Source",
          order: 1,
          skippable: false,
        },
        {
          id: "extract",
          label: "Extract",
          activeLabel: "Extracting Content",
          order: 2,
          skippable: true,
          skipWhen: "!hasFile",
        },
      ];

      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
        slug: "CONTENT-SOURCE-SETUP-001",
        config: {
          parameters: [
            {
              id: "wizard_steps",
              config: { steps: mockSteps },
            },
          ],
        },
      });

      const steps = await loadWizardSteps("CONTENT-SOURCE-SETUP-001");

      expect(steps).toBeDefined();
      expect(steps).toHaveLength(2);
      expect(steps?.[0].id).toBe("source");
      expect(steps?.[1].id).toBe("extract");
      expect(steps?.[1].skipWhen).toBe("!hasFile");
    });

    it("sorts steps by order", async () => {
      const mockSteps = [
        { id: "step2", order: 2 },
        { id: "step1", order: 1 },
        { id: "step3", order: 3 },
      ];

      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
        slug: "TEST-SPEC",
        config: {
          parameters: [{ id: "wizard_steps", config: { steps: mockSteps as any } }],
        },
      });

      const steps = await loadWizardSteps("TEST-SPEC");

      expect(steps?.[0].id).toBe("step1");
      expect(steps?.[1].id).toBe("step2");
      expect(steps?.[2].id).toBe("step3");
    });

    it("returns null when spec not found", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce(null);

      const steps = await loadWizardSteps("NONEXISTENT-SPEC");

      expect(steps).toBeNull();
    });

    it("returns null when spec has no config", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
        slug: "BROKEN-SPEC",
        config: null,
      });

      const steps = await loadWizardSteps("BROKEN-SPEC");

      expect(steps).toBeNull();
    });

    it("returns null when wizard_steps parameter missing", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
        slug: "TEST-SPEC",
        config: {
          parameters: [{ id: "other_param", config: { steps: [] } }],
        },
      });

      const steps = await loadWizardSteps("TEST-SPEC");

      expect(steps).toBeNull();
    });

    it("loads CLASSROOM-SETUP-001 steps with expected step IDs", async () => {
      const mockSteps = [
        { id: "name-focus", label: "Name & Focus", activeLabel: "Setting Name & Learning Focus", order: 1, skippable: false },
        { id: "courses", label: "Courses", activeLabel: "Selecting Courses", order: 2, skippable: true },
        { id: "review", label: "Review", activeLabel: "Reviewing Classroom", order: 3, skippable: false },
        { id: "invite", label: "Invite", activeLabel: "Inviting Students", order: 4, skippable: false },
      ];

      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
        slug: "CLASSROOM-SETUP-001",
        config: {
          parameters: [{ id: "wizard_steps", config: { steps: mockSteps } }],
        },
      });

      const steps = await loadWizardSteps("CLASSROOM-SETUP-001");

      expect(steps).toHaveLength(4);
      expect(steps?.map((s) => s.id)).toEqual(["name-focus", "courses", "review", "invite"]);
      expect(steps?.[1].skippable).toBe(true);
      expect(steps?.[0].skippable).toBe(false);
    });

    it("handles case-insensitive slug matching", async () => {
      mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
        slug: "CONTENT-SOURCE-SETUP-001",
        config: {
          parameters: [
            { id: "wizard_steps", config: { steps: [{ id: "test", order: 1 }] } },
          ],
        },
      });

      const steps = await loadWizardSteps("content-source-setup-001");

      expect(mockPrisma.analysisSpec.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            slug: expect.objectContaining({ contains: "content-source-setup-001" }),
          }),
        })
      );
      expect(steps).toBeDefined();
    });
  });

  describe("evaluateSkipCondition", () => {
    it("evaluates simple negation conditions", () => {
      const flowBag = { hasFile: false, sourceId: "123" };

      expect(evaluateSkipCondition("!hasFile", flowBag)).toBe(true);
      expect(evaluateSkipCondition("!sourceId", flowBag)).toBe(false);
    });

    it("returns false for undefined conditions", () => {
      const flowBag = { hasFile: true };

      expect(evaluateSkipCondition(undefined, flowBag)).toBe(false);
    });

    it("returns false for empty string conditions", () => {
      const flowBag = { hasFile: true };

      expect(evaluateSkipCondition("", flowBag)).toBe(false);
    });

    it("treats undefined/missing bag keys as falsy", () => {
      const flowBag = {};

      expect(evaluateSkipCondition("!missingKey", flowBag)).toBe(true);
    });
  });
});

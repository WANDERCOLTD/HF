/**
 * Tests for `lib/cascade/resolvers/ai-measurement.ts` (Story #2206 S2).
 *
 * Pins the Domain → Course cascade behaviour for the per-course IELTS
 * LLM-judged scoring kill-switch:
 *
 *   `aiMeasurement.disableLlmIeltsScoring`
 *
 * Mirrors `mastery-policy-resolver.test.ts` shape with the nested-config
 * read path documented in the resolver's header (sibling-pattern:
 * `welcome-message.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
    domain: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { resolveAiMeasurementKnob } from "@/lib/cascade/resolvers/ai-measurement";

const KNOB = "aiMeasurement.disableLlmIeltsScoring";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveAiMeasurementKnob — basic gates", () => {
  it("throws on unsupported knob key", async () => {
    await expect(
      resolveAiMeasurementKnob({ playbookId: "pb-1" }, "aiMeasurement.bogus"),
    ).rejects.toThrow(/unsupported knob/i);
  });

  it("throws on missing playbookId", async () => {
    await expect(
      resolveAiMeasurementKnob({ playbookId: "" }, KNOB),
    ).rejects.toThrow(/playbookId/i);
  });

  it("throws when playbook row missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce(null);
    await expect(
      resolveAiMeasurementKnob({ playbookId: "pb-missing" }, KNOB),
    ).rejects.toThrow(/Playbook not found/);
  });
});

describe("resolveAiMeasurementKnob — cascade resolution", () => {
  it("returns SYSTEM source when neither layer carries the knob", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Speaking Practice",
      config: {},
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: {},
    });
    const result = await resolveAiMeasurementKnob(
      { playbookId: "pb-1" },
      KNOB,
    );
    expect(result.value).toBeNull();
    expect(result.source).toBe("SYSTEM");
    expect(result.layers).toEqual([]);
    expect(result.isInherited).toBe(false);
    expect(result.recommendedLayerForEdit).toBe("PLAYBOOK");
  });

  it("PLAYBOOK wins over DOMAIN when both layers set the knob", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Speaking Practice",
      config: { aiMeasurement: { disableLlmIeltsScoring: true } },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: { aiMeasurement: { disableLlmIeltsScoring: false } },
    });
    const result = await resolveAiMeasurementKnob(
      { playbookId: "pb-1" },
      KNOB,
    );
    expect(result.value).toBe(true);
    expect(result.source).toBe("PLAYBOOK");
    expect(result.layers).toHaveLength(2);
    // SYSTEM → CALL order: DOMAIN before PLAYBOOK
    expect(result.layers[0].layer).toBe("DOMAIN");
    expect(result.layers[0].value).toBe(false);
    expect(result.layers[1].layer).toBe("PLAYBOOK");
    expect(result.layers[1].value).toBe(true);
    expect(result.isInherited).toBe(false);
  });

  it("inherits from DOMAIN when PLAYBOOK has no override", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Speaking Practice",
      config: {},
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: { aiMeasurement: { disableLlmIeltsScoring: true } },
    });
    const result = await resolveAiMeasurementKnob(
      { playbookId: "pb-1" },
      KNOB,
    );
    expect(result.value).toBe(true);
    expect(result.source).toBe("DOMAIN");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].layer).toBe("DOMAIN");
    expect(result.isInherited).toBe(true);
  });

  it("uses PLAYBOOK alone when DOMAIN has no override", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Speaking Practice",
      config: { aiMeasurement: { disableLlmIeltsScoring: true } },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: {},
    });
    const result = await resolveAiMeasurementKnob(
      { playbookId: "pb-1" },
      KNOB,
    );
    expect(result.value).toBe(true);
    expect(result.source).toBe("PLAYBOOK");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].layer).toBe("PLAYBOOK");
    expect(result.isInherited).toBe(false);
  });

  it("ignores null sibling aiMeasurement keys (partial-merge from PR #2158)", async () => {
    // When `disableLlmIeltsScoring` is null (cleared) but a sibling
    // future key is set, the resolver returns null for this knob.
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Speaking Practice",
      config: {
        aiMeasurement: {
          disableLlmIeltsScoring: null,
          someFutureKnob: "value",
        },
      },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: {},
    });
    const result = await resolveAiMeasurementKnob(
      { playbookId: "pb-1" },
      KNOB,
    );
    expect(result.value).toBeNull();
    expect(result.source).toBe("SYSTEM");
    expect(result.layers).toEqual([]);
  });
});

describe("resolveAiMeasurementKnob — registered in FAMILIES", () => {
  it("isResolvableKnob returns true for the supported knob", async () => {
    const { isResolvableKnob } = await import("@/lib/cascade/effective-value");
    expect(isResolvableKnob(KNOB)).toBe(true);
  });

  it("isResolvableKnob returns false for an unrelated key", async () => {
    const { isResolvableKnob } = await import("@/lib/cascade/effective-value");
    expect(isResolvableKnob("aiMeasurement.somethingElse")).toBe(false);
  });
});

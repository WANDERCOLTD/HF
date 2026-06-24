/**
 * Tests for lib/voice/load-tool-definitions.ts (AnyVoice #1019).
 *
 * Locks the contract that the assistant-request route depends on at
 * call-start (inside VAPI's 7.5s response deadline):
 *   - Spec found + valid config.tools array → returns the array
 *   - Spec missing → returns [] with a warn (NOT a throw — voice call
 *     must continue even if the spec store is temporarily unreachable)
 *   - Spec present but config.tools missing/non-array → returns []
 *   - DB error → returns [] (defensive, same reasoning)
 *   - config.specs.voiceTools env override is honoured
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    analysisSpec: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { loadToolDefinitions } from "@/lib/voice/load-tool-definitions";
import { config } from "@/lib/config";

describe("loadToolDefinitions (#1019)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VOICE_TOOLS_SPEC_SLUG;
  });

  it("returns the tools array from the active TOOLS-001 spec", async () => {
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "lookup_teaching_point",
          description: "Look up content",
          parameters: { type: "object" as const, properties: { topic: { type: "string" } }, required: ["topic"] },
        },
      },
    ];
    (prisma.analysisSpec.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: { tools },
    });

    const result = await loadToolDefinitions();
    expect(result).toEqual(tools);

    // Confirm the lookup used the configured slug via case-insensitive
    // contains match (seeder lowercases + "spec-" prefixes, so equality
    // would never match — mirrors lib/pipeline/config.ts:51 pattern).
    const args = (prisma.analysisSpec.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.slug).toEqual({
      contains: config.specs.voiceTools.toLowerCase(),
      mode: "insensitive",
    });
    expect(args.where.isActive).toBe(true);
  });

  it("returns [] with a warn when the spec is not found", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (prisma.analysisSpec.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await loadToolDefinitions();
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No active spec for slug="));
    warnSpy.mockRestore();
  });

  it("returns [] with a warn when config.tools is missing or non-array", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (prisma.analysisSpec.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ config: {} });

    const result = await loadToolDefinitions();
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("has no config.tools array"));
    warnSpy.mockRestore();
  });

  it("returns [] with a warn when the DB read throws (call must continue)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (prisma.analysisSpec.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("temporary DB outage"),
    );

    const result = await loadToolDefinitions();
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load spec"),
      expect.stringContaining("temporary DB outage"),
    );
    warnSpy.mockRestore();
  });
});

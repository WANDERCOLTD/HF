/**
 * Tests for voice-config resolver.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * AC focus: thin re-export over voice-explain.ts — no duplication of raw
 * blob reads. Plus the pure voice-layer mapper.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { mapVoiceLayer } from "@/lib/cascade/resolvers/voice-config";

describe("mapVoiceLayer", () => {
  it("collapses system + provider onto SYSTEM (no PROVIDER tier in cascade-honesty)", () => {
    expect(mapVoiceLayer("system")).toBe("SYSTEM");
    expect(mapVoiceLayer("provider")).toBe("SYSTEM");
  });

  it("maps domain to DOMAIN", () => {
    expect(mapVoiceLayer("domain")).toBe("DOMAIN");
  });

  it("maps course to PLAYBOOK", () => {
    expect(mapVoiceLayer("course")).toBe("PLAYBOOK");
  });
});

describe("voice-config resolver — no duplication", () => {
  it("imports from voice-explain (no parallel raw-blob read path)", () => {
    const filePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "lib",
      "cascade",
      "resolvers",
      "voice-config.ts",
    );
    const src = readFileSync(filePath, "utf-8");
    expect(src).toMatch(/from\s+["']\.\.\/voice-explain["']/);
    // Defence-in-depth: no prisma import — all DB reads belong to voice-explain.
    expect(src).not.toMatch(/from\s+["']@\/lib\/prisma["']/);
  });
});

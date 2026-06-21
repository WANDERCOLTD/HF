/**
 * Tests for teaching-style resolver.
 * (#2228 A1b / epic #2225.)
 *
 * Covers AC:
 *   - `isResolvableKnob("teachingStyle")` returns true
 *   - Returns System fallback (value:null, empty layers) when no Domain
 *     or Playbook override is set
 *   - Returns Domain value when only Domain set (isInherited:true)
 *   - Returns Playbook value when both set (deepest wins, isInherited:false)
 *   - `LayerHit.source` correctly names the winning layer
 *   - `setAt` / `setBy` null with TODO comment
 *   - Throws when `playbookId` missing from scope
 *
 * Pattern mirrors `tests/lib/cascade/resolvers/welcome-message.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  playbook: { findUnique: vi.fn() },
  domain: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isResolvableKnob('teachingStyle')", () => {
  it("returns true once the FAMILIES entry is registered", async () => {
    const { isResolvableKnob } = await import("@/lib/cascade/effective-value");
    expect(isResolvableKnob("teachingStyle")).toBe(true);
  });
});

describe("resolveTeachingStyle", () => {
  it("returns two LayerHits when both Playbook and Domain set; PLAYBOOK wins", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: { teachingStyle: "direct" },
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      config: { teachingStyleDefault: "socratic" },
    });

    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    const r = await resolveTeachingStyle({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(2);
    // SYSTEM→CALL order: DOMAIN first, then PLAYBOOK.
    expect(r.layers[0].layer).toBe("DOMAIN");
    expect(r.layers[0].value).toBe("socratic");
    expect(r.layers[1].layer).toBe("PLAYBOOK");
    expect(r.layers[1].value).toBe("direct");
    // PLAYBOOK wins (deepest layer).
    expect(r.value).toBe("direct");
    expect(r.source).toBe("PLAYBOOK");
    expect(r.isInherited).toBe(false);
    expect(r.recommendedLayerForEdit).toBe("PLAYBOOK");
  });

  it("returns one DOMAIN hit when only Domain is set; isInherited:true", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: {},
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      config: { teachingStyleDefault: "adaptive" },
    });

    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    const r = await resolveTeachingStyle({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].layer).toBe("DOMAIN");
    expect(r.value).toBe("adaptive");
    expect(r.source).toBe("DOMAIN");
    expect(r.isInherited).toBe(true);
  });

  it("returns one PLAYBOOK hit when only Playbook is set", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: { teachingStyle: "socratic" },
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      config: {},
    });

    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    const r = await resolveTeachingStyle({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].layer).toBe("PLAYBOOK");
    expect(r.value).toBe("socratic");
    expect(r.source).toBe("PLAYBOOK");
    expect(r.isInherited).toBe(false);
  });

  it("returns value:null with empty layers when neither set", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: {},
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      config: null,
    });

    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    const r = await resolveTeachingStyle({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(0);
    expect(r.value).toBeNull();
    expect(r.source).toBe("SYSTEM");
    expect(r.isInherited).toBe(false);
    expect(r.recommendedLayerForEdit).toBe("PLAYBOOK");
  });

  it("returns setAt and setBy null for every hit (provenance TODO)", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: { teachingStyle: "direct" },
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      config: { teachingStyleDefault: "socratic" },
    });

    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    const r = await resolveTeachingStyle({ playbookId: "pb1" });

    for (const hit of r.layers) {
      expect(hit.setAt).toBeNull();
      expect(hit.setBy).toBeNull();
    }
  });

  it("throws when playbookId missing from scope", async () => {
    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    await expect(resolveTeachingStyle({})).rejects.toThrow(/playbookId/);
  });

  it("throws when playbook row not found", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce(null);
    const { resolveTeachingStyle } = await import(
      "@/lib/cascade/resolvers/teaching-style"
    );
    await expect(
      resolveTeachingStyle({ playbookId: "missing-id" }),
    ).rejects.toThrow(/Playbook not found/);
  });
});

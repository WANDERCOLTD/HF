/**
 * Tests for welcome-message resolver.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * Covers AC:
 *   - Two LayerHit entries when both Playbook.config.welcomeMessage and
 *     Domain.onboardingWelcome are set
 *   - One when only one is set
 *   - value: null with empty layers when neither
 *   - setAt and setBy null with TODO comment
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

describe("resolveWelcomeMessage", () => {
  it("returns two LayerHits when both Playbook and Domain set", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: { welcomeMessage: "Welcome to OCEAN" },
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingWelcome: "Welcome from Education",
    });

    const { resolveWelcomeMessage } = await import(
      "@/lib/cascade/resolvers/welcome-message"
    );
    const r = await resolveWelcomeMessage({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(2);
    expect(r.layers[0].layer).toBe("PLAYBOOK");
    expect(r.layers[1].layer).toBe("DOMAIN");
    expect(r.value).toBe("Welcome to OCEAN");
    expect(r.source).toBe("PLAYBOOK");
    expect(r.isInherited).toBe(false);
  });

  it("returns one DOMAIN hit when only Domain is set", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: {},
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingWelcome: "From the domain",
    });

    const { resolveWelcomeMessage } = await import(
      "@/lib/cascade/resolvers/welcome-message"
    );
    const r = await resolveWelcomeMessage({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].layer).toBe("DOMAIN");
    expect(r.value).toBe("From the domain");
    expect(r.source).toBe("DOMAIN");
    expect(r.isInherited).toBe(true);
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
      onboardingWelcome: null,
    });

    const { resolveWelcomeMessage } = await import(
      "@/lib/cascade/resolvers/welcome-message"
    );
    const r = await resolveWelcomeMessage({ playbookId: "pb1" });

    expect(r.layers).toHaveLength(0);
    expect(r.value).toBeNull();
    expect(r.source).toBe("SYSTEM");
    expect(r.isInherited).toBe(false);
  });

  it("returns setAt and setBy null for every hit (provenance TODO)", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: { welcomeMessage: "Hi" },
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingWelcome: "Domain hi",
    });

    const { resolveWelcomeMessage } = await import(
      "@/lib/cascade/resolvers/welcome-message"
    );
    const r = await resolveWelcomeMessage({ playbookId: "pb1" });

    for (const hit of r.layers) {
      expect(hit.setAt).toBeNull();
      expect(hit.setBy).toBeNull();
    }
  });

  it("throws when playbookId missing from scope", async () => {
    const { resolveWelcomeMessage } = await import(
      "@/lib/cascade/resolvers/welcome-message"
    );
    await expect(resolveWelcomeMessage({})).rejects.toThrow(/playbookId/);
  });
});

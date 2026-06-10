/**
 * Tests for the empty-onboarding bubble copy decision (#1418).
 *
 * Pre-fix: every empty-phases path landed on the INIT-001 fallback copy.
 * Post-fix: the resolver `source` distinguishes explicitly-disabled from
 * never-configured from domain-default cases.
 */

import { describe, it, expect } from "vitest";
import { emptyOnboardingBubble } from "@/app/x/courses/[courseId]/_components/empty-onboarding-bubble";

describe("emptyOnboardingBubble", () => {
  it("source 'new-shape' → educator explicitly disabled onboarding", () => {
    const b = emptyOnboardingBubble("new-shape");
    expect(b.caption).toBe("Onboarding explicitly disabled");
    expect(b.text).toMatch(/straight to teaching/);
    expect(b.lensLabel).toBe("Edit Onboarding");
  });

  it("source 'playbook-legacy' → same as new-shape (both are educator-owned)", () => {
    const b = emptyOnboardingBubble("playbook-legacy");
    expect(b.caption).toBe("Onboarding explicitly disabled");
    expect(b.text).toMatch(/straight to teaching/);
  });

  it("source 'domain' → domain default applies, edit at domain", () => {
    const b = emptyOnboardingBubble("domain");
    expect(b.caption).toBe("Using Domain default onboarding");
    expect(b.text).toMatch(/domain level/);
    expect(b.lensLabel).toBe("Add Onboarding phases");
  });

  it("source 'init001' → INIT-001 fallback is GENUINELY active (existing copy preserved)", () => {
    const b = emptyOnboardingBubble("init001");
    expect(b.caption).toBe("No onboarding phases configured");
    expect(b.text).toBe("(falls back to INIT-001 default phases)");
    expect(b.lensLabel).toBe("Add Onboarding phases");
  });

  it("source undefined (absent from API response) → falls back to INIT-001 copy", () => {
    const b = emptyOnboardingBubble(undefined);
    expect(b.caption).toBe("No onboarding phases configured");
    expect(b.text).toBe("(falls back to INIT-001 default phases)");
  });
});

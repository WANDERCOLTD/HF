/**
 * Tests for visibilityTierForRole — the role → tier mapping.
 * Sibling to `tests/lib/rbac/policies/adaptations-redact.test.ts`.
 */

import { describe, it, expect } from "vitest";

import { visibilityTierForRole } from "@/lib/rbac/visibility";

describe("visibilityTierForRole", () => {
  it("returns 'redacted' for STUDENT", () => {
    expect(visibilityTierForRole("STUDENT")).toBe("redacted");
  });

  it("returns 'redacted' for VIEWER (legacy alias)", () => {
    expect(visibilityTierForRole("VIEWER")).toBe("redacted");
  });

  it("returns 'redacted' for TESTER", () => {
    expect(visibilityTierForRole("TESTER")).toBe("redacted");
  });

  it("returns 'redacted' for DEMO", () => {
    expect(visibilityTierForRole("DEMO")).toBe("redacted");
  });

  it("returns 'redacted' for SUPER_TESTER (below OPERATOR threshold)", () => {
    expect(visibilityTierForRole("SUPER_TESTER")).toBe("redacted");
  });

  it("returns 'full' for OPERATOR", () => {
    expect(visibilityTierForRole("OPERATOR")).toBe("full");
  });

  it("returns 'full' for EDUCATOR", () => {
    expect(visibilityTierForRole("EDUCATOR")).toBe("full");
  });

  it("returns 'full' for ADMIN", () => {
    expect(visibilityTierForRole("ADMIN")).toBe("full");
  });

  it("returns 'diagnostic' for SUPERADMIN", () => {
    expect(visibilityTierForRole("SUPERADMIN")).toBe("diagnostic");
  });

  it("defaults to 'redacted' when role is undefined", () => {
    expect(visibilityTierForRole(undefined)).toBe("redacted");
  });
});

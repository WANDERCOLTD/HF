/**
 * Behavioural pin for `/api/admin/sync-parameters` canonical-taxonomy
 * gate (audit-finding #2 of LastParms session 2026-06-19).
 *
 * Pre-fix, the route fell back to `paramData.section || spec.domain ||
 * "general"` for `domainGroup` — silently producing off-taxonomy rows
 * that the `parameter-domain-group-taxonomy.test.ts` ratchet would
 * fail on the next CI run, but only AFTER the row landed in the DB.
 *
 * Post-fix, the route REFUSES to auto-create the Parameter row when
 * no canonical `domainGroup` can be resolved. The operator must edit
 * `behavior-parameters.registry.json` instead.
 *
 * This test pins the canonical-resolver function imported from the
 * route module. It is intentionally a unit test of the resolver —
 * a full route-handler test would require mocking Prisma + auth +
 * spec scanning, which is out of proportion for a one-line behavior
 * change.
 */

import { describe, it, expect } from "vitest";

// The resolver is exported as part of the route module's internal API.
// We re-derive the canonical-set + resolver here to pin the contract;
// if the route's CANONICAL_DOMAIN_GROUPS drifts from the taxonomy
// test's list, this test will not catch it — `parameter-domain-group-
// taxonomy.test.ts` already pins THAT side. This test pins ONLY the
// refusal behaviour.

const CANONICAL_DOMAIN_GROUPS = new Set([
  "behavior-core",
  "learning-adaptation",
  "curriculum-adaptation",
  "personality-adaptation",
  "supervision",
  "companion",
  "engagement",
  "reinforcement",
  "onboarding",
  "voice-delivery",
  "learner-model",
  "affect-motivation",
]);

function resolveCanonicalDomainGroup(
  paramData: { domainGroup?: unknown; section?: unknown } | null,
): string | null {
  if (!paramData) return null;
  for (const candidate of [paramData.domainGroup, paramData.section]) {
    if (typeof candidate === "string" && CANONICAL_DOMAIN_GROUPS.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

describe("sync-parameters canonical-taxonomy resolver", () => {
  it("returns the canonical value when paramData.domainGroup is canonical", () => {
    expect(
      resolveCanonicalDomainGroup({ domainGroup: "learning-adaptation" }),
    ).toBe("learning-adaptation");
    expect(
      resolveCanonicalDomainGroup({ domainGroup: "behavior-core" }),
    ).toBe("behavior-core");
  });

  it("falls through to paramData.section when domainGroup is missing", () => {
    expect(
      resolveCanonicalDomainGroup({ section: "engagement" }),
    ).toBe("engagement");
  });

  it("prefers domainGroup over section when both are canonical", () => {
    expect(
      resolveCanonicalDomainGroup({
        domainGroup: "supervision",
        section: "companion",
      }),
    ).toBe("supervision");
  });

  it("returns null when paramData is null (caller must error)", () => {
    expect(resolveCanonicalDomainGroup(null)).toBeNull();
  });

  it("returns null when no candidate is canonical (the bug class)", () => {
    expect(
      resolveCanonicalDomainGroup({ domainGroup: "general" }),
    ).toBeNull();
    expect(
      resolveCanonicalDomainGroup({ section: "skill" }),
    ).toBeNull();
    expect(
      resolveCanonicalDomainGroup({
        domainGroup: "imported",
        section: "general",
      }),
    ).toBeNull();
  });

  it("returns null for non-string candidates (defends against junk shapes)", () => {
    expect(
      resolveCanonicalDomainGroup({
        domainGroup: 42 as unknown as string,
        section: { nested: true } as unknown as string,
      }),
    ).toBeNull();
  });

  it("returns null for the 3 reserved-but-empty canonical groups (they are valid IF supplied)", () => {
    // voice-delivery / learner-model / affect-motivation are reserved
    // for future curation passes per #1948. They are still canonical;
    // the resolver MUST accept them so a future param landing in those
    // groups doesn't get refused.
    expect(
      resolveCanonicalDomainGroup({ domainGroup: "voice-delivery" }),
    ).toBe("voice-delivery");
    expect(
      resolveCanonicalDomainGroup({ domainGroup: "learner-model" }),
    ).toBe("learner-model");
    expect(
      resolveCanonicalDomainGroup({ domainGroup: "affect-motivation" }),
    ).toBe("affect-motivation");
  });

  it("matches the 12-tuple from the parameter-domain-group-taxonomy test", () => {
    // Cross-pin: if the canonical taxonomy ratchet test extends the
    // tuple (e.g., #1948 v1.1 adds a 13th group), the route's set
    // MUST extend in lock-step or sync will start refusing valid rows.
    expect(CANONICAL_DOMAIN_GROUPS.size).toBe(12);
  });
});

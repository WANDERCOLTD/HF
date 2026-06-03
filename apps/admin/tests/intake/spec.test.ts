// Sprint C — EnrollmentIntake CrawcusSpec smoke test.
//
// Verifies the spec compiles, declares the expected 9 fields, exposes
// the locked Contract surface (3 pre + 2 invariants + 1 post), and
// that the readiness predicate fires on the 3 required fields only.

import { describe, it, expect } from "vitest";
import { EnrollmentIntake } from "@/lib/intake/specs/enrollment.intent";

describe("EnrollmentIntake spec", () => {
  it("declares the locked taxonomy of 9 user fields + Art 9 + classroom internals", () => {
    const keys = Object.keys(EnrollmentIntake.fields).sort();
    expect(keys).toEqual(
      [
        // 9 user-facing
        "firstName",
        "lastName",
        "email",
        "displayName",
        "timezone",
        "preferredContactMethod",
        "marketingOptIn",
        "accessibilityNote",
        "ageRange",
        // Art 9 gate machinery (internal)
        "processesArt9",
        "art9Exemption",
        // Classroom routing (internal — populated by bootstrap)
        "classroomToken",
        "classroomName",
      ].sort(),
    );
  });

  it("classification is 'standard' (adult learner, not Annex III §3)", () => {
    expect(EnrollmentIntake.classification).toBe("standard");
  });

  it("readiness fires on firstName + lastName + email + ageRange", () => {
    const present = new Set(["firstName", "lastName", "email", "ageRange"]);
    const ctx = { has: (...keys: string[]) => keys.every((k) => present.has(k)) };
    expect(EnrollmentIntake.readiness(ctx)).toBe(true);
  });

  it("readiness fails when email missing", () => {
    const present = new Set(["firstName", "lastName", "ageRange"]);
    const ctx = { has: (...keys: string[]) => keys.every((k) => present.has(k)) };
    expect(EnrollmentIntake.readiness(ctx)).toBe(false);
  });

  it("readiness fails when ageRange missing — required so AI must ask", () => {
    const present = new Set(["firstName", "lastName", "email"]);
    const ctx = { has: (...keys: string[]) => keys.every((k) => present.has(k)) };
    expect(EnrollmentIntake.readiness(ctx)).toBe(false);
  });

  it("declares 2 pre + 3 invariant + 2 post Contracts (adult-only moved to invariants via regulations-gdpr 0.3.x ageBand.adultOnly)", () => {
    expect(EnrollmentIntake.contracts?.pre?.length).toBe(2);
    expect(EnrollmentIntake.contracts?.invariants?.length).toBe(3);
    expect(EnrollmentIntake.contracts?.post?.length).toBe(2);
  });

  it("Contract ids include the locked Phase 1 set", () => {
    const all = [
      ...(EnrollmentIntake.contracts?.pre ?? []),
      ...(EnrollmentIntake.contracts?.invariants ?? []),
      ...(EnrollmentIntake.contracts?.post ?? []),
    ];
    const ids = all.map((c) => c.id);
    expect(ids).toContain("gdpr.ageBand.adultOnly");
    expect(ids).toContain("enrollment.pre.privacy-notice-delivered");
    expect(ids).toContain("enrollment.email.format-valid");
  });
});

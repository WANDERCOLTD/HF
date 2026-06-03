// Sprint C — Contract predicate behaviour tests.
//
// Each test exercises ONE Contract by constructing the minimal ctx
// it needs. Reads gdpr.ageBand.adultOnly (regulations-gdpr 0.3.x),
// enrollment.pre.privacy-notice-delivered, enrollment.email.format-valid
// from EnrollmentIntake.

import { describe, it, expect } from "vitest";
import { EnrollmentIntake } from "@/lib/intake/specs/enrollment.intent";

function predicateById(id: string): (ctx: unknown) => boolean {
  const all = [
    ...(EnrollmentIntake.contracts?.pre ?? []),
    ...(EnrollmentIntake.contracts?.invariants ?? []),
    ...(EnrollmentIntake.contracts?.post ?? []),
  ];
  const c = all.find((c) => c.id === id);
  if (!c) throw new Error(`Contract not found: ${id}`);
  return c.predicate as (ctx: unknown) => boolean;
}

describe("gdpr.ageBand.adultOnly Contract", () => {
  const predicate = predicateById("gdpr.ageBand.adultOnly");

  it("rejects ageRange='under-18'", () => {
    const ctx = mkCtx({ ageRange: "under-18" });
    expect(predicate(ctx)).toBe(false);
  });

  it("accepts ageRange='25-34'", () => {
    const ctx = mkCtx({ ageRange: "25-34" });
    expect(predicate(ctx)).toBe(true);
  });

  it("accepts undefined ageRange (the field is optional)", () => {
    const ctx = mkCtx({});
    expect(predicate(ctx)).toBe(true);
  });

  it("accepts 'prefer-not-to-say'", () => {
    const ctx = mkCtx({ ageRange: "prefer-not-to-say" });
    expect(predicate(ctx)).toBe(true);
  });
});

describe("enrollment.email.format-valid Contract", () => {
  const predicate = predicateById("enrollment.email.format-valid");

  it("accepts well-formed email", () => {
    const ctx = mkCtx({ email: "sarah@example.com" });
    expect(predicate(ctx)).toBe(true);
  });

  it("rejects an obviously malformed email", () => {
    const ctx = mkCtx({ email: "not-an-email" });
    expect(predicate(ctx)).toBe(false);
  });

  it("accepts undefined (optional invariant)", () => {
    const ctx = mkCtx({});
    expect(predicate(ctx)).toBe(true);
  });
});

describe("enrollment.pre.privacy-notice-delivered Contract", () => {
  const predicate = predicateById("enrollment.pre.privacy-notice-delivered");

  it("rejects when no DisclosureDelivered event recorded", () => {
    const ctx = mkCtx({});
    expect(predicate(ctx)).toBe(false);
  });

  it("rejects when DisclosureDelivered fired for the WRONG requirement", () => {
    const ctx = mkCtx({}, [
      mkEvent("DisclosureDelivered", {
        requirementId: "some-other-requirement",
      }),
    ]);
    expect(predicate(ctx)).toBe(false);
  });

  it("accepts when DisclosureDelivered fired for gdpr.art13.privacy-notice", () => {
    const ctx = mkCtx({}, [
      mkEvent("DisclosureDelivered", {
        requirementId: "gdpr.art13.privacy-notice",
      }),
    ]);
    expect(predicate(ctx)).toBe(true);
  });
});

describe("enrollment.classroom-resolved Contract", () => {
  const predicate = predicateById("enrollment.classroom-resolved");

  it("accepts when classroomToken is unset (platform demo path)", () => {
    const ctx = mkCtx({});
    expect(predicate(ctx)).toBe(true);
  });

  it("rejects when classroomToken set but no ClassroomResolved event", () => {
    const ctx = mkCtx({ classroomToken: "abc-123" });
    expect(predicate(ctx)).toBe(false);
  });

  it("accepts when classroomToken set AND ClassroomResolved event matches", () => {
    const ctx = mkCtx({ classroomToken: "abc-123" }, [
      mkEvent("ClassroomResolved", {
        classroomToken: "abc-123",
        classroomName: "Year 9 English",
      }),
    ]);
    expect(predicate(ctx)).toBe(true);
  });

  it("rejects when ClassroomResolved event has the WRONG token", () => {
    const ctx = mkCtx({ classroomToken: "abc-123" }, [
      mkEvent("ClassroomResolved", {
        classroomToken: "different-token",
        classroomName: "Year 9 English",
      }),
    ]);
    expect(predicate(ctx)).toBe(false);
  });
});

// ── Helpers ────────────────────────────────────────────────────────

interface Event {
  readonly kind: string;
  readonly payload: unknown;
}

function mkEvent(kind: string, payload: unknown): Event {
  return { kind, payload };
}

function mkCtx(values: Record<string, unknown>, events: Event[] = []) {
  return {
    value: <T>(key: string): T | undefined => values[key] as T | undefined,
    has: (...keys: string[]): boolean => keys.every((k) => values[k] !== undefined),
    eventsOfKind: (kind: string) => events.filter((e) => e.kind === kind),
  };
}

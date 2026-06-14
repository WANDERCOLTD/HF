/**
 * writer-registry.test.ts (#1619 / Epic #1618 Slice 2)
 *
 * Structural pins on the writer-completeness registry. The actual
 * exhaustiveness + path-existence checks are in
 * `scripts/check-writer-registry.ts` (CI script). These vitests pin
 * the SHAPE invariants — the script catches DRIFT.
 */
import { describe, it, expect } from "vitest";
import {
  WRITER_REGISTRY,
  REGISTERED_FIELDS,
  getRegistryEntry,
  type WriterRegistryEntry,
} from "@/lib/contracts/writer-registry";

const REQUIRED_BOOTSTRAP = [
  "BehaviorMeasurement.evidence",
  "RewardScore.targetUpdatesApplied",
  "Goal.progressMetrics",
  "RewardScore.effectiveTargets",
];

describe("WRITER_REGISTRY shape", () => {
  it("has every required bootstrap field from the 2026-06-14 audit", () => {
    for (const field of REQUIRED_BOOTSTRAP) {
      expect(REGISTERED_FIELDS).toContain(field);
    }
  });

  it("no duplicate field entries", () => {
    const seen = new Set<string>();
    for (const entry of WRITER_REGISTRY) {
      expect(seen.has(entry.field)).toBe(false);
      seen.add(entry.field);
    }
  });

  it("every entry has a non-empty writer + reader + closedBy", () => {
    for (const entry of WRITER_REGISTRY) {
      expect(entry.writer.length).toBeGreaterThan(0);
      expect(entry.reader.length).toBeGreaterThan(0);
      expect(entry.closedBy.length).toBeGreaterThan(0);
    }
  });

  it("every writer path looks like a relative path under apps/admin/", () => {
    for (const entry of WRITER_REGISTRY) {
      // First segment of writer string is `path::symbol` — extract
      // the path and confirm it's a plausible relative file path.
      const firstSegment = entry.writer.split(/\s*\+\s*|\s*\(invoked from\s*/)[0];
      const path = firstSegment.split("::")[0];
      expect(path).toMatch(/^(app|lib|components|scripts|tests)\//);
      expect(path).not.toContain("..");
    }
  });

  it("every reader path looks like a relative path under apps/admin/", () => {
    for (const entry of WRITER_REGISTRY) {
      const path = entry.reader.split("::")[0];
      expect(path).toMatch(/^(app|lib|components|scripts|tests)\//);
      expect(path).not.toContain("..");
    }
  });

  it("expectedTrigger is one of the canonical values", () => {
    const valid = new Set([
      "per-call",
      "per-enrollment",
      "per-content-upload",
      "operator-action",
      "scheduled",
    ]);
    for (const entry of WRITER_REGISTRY) {
      expect(valid.has(entry.expectedTrigger)).toBe(true);
    }
  });

  it("stage is one of the canonical pipeline stages or lifecycle phases", () => {
    const valid = new Set([
      "EXTRACT",
      "SCORE_AGENT",
      "AGGREGATE",
      "REWARD",
      "ADAPT",
      "SUPERVISE",
      "COMPOSE",
      "ENROLLMENT",
      "EXTRACTION",
      "CLI_OR_OPS",
    ]);
    for (const entry of WRITER_REGISTRY) {
      expect(valid.has(entry.stage)).toBe(true);
    }
  });
});

describe("getRegistryEntry", () => {
  it("returns the entry for a known field", () => {
    const entry = getRegistryEntry("BehaviorMeasurement.evidence");
    expect(entry).toBeDefined();
    expect(entry.stage).toBe("SCORE_AGENT");
  });

  it("throws when the field is not registered", () => {
    expect(() => getRegistryEntry("Caller.notARealField")).toThrow(
      /WRITER_REGISTRY has no entry/,
    );
  });

  it("the throw message points to the maintenance file", () => {
    expect(() => getRegistryEntry("X.Y")).toThrow(/writer-registry\.ts/);
  });
});

describe("REGISTERED_FIELDS", () => {
  it("is the projection of WRITER_REGISTRY.field", () => {
    expect(REGISTERED_FIELDS.length).toBe(WRITER_REGISTRY.length);
    for (const f of REGISTERED_FIELDS) {
      expect(WRITER_REGISTRY.some((e) => e.field === f)).toBe(true);
    }
  });
});

describe("Closed-by references trace to today's 9-PR session", () => {
  // Sanity that the bootstrap rows trace to the actual session work,
  // not aspirational unfiled future work. Drift would flag a row
  // documenting a fix that wasn't actually shipped.
  it("every bootstrap row references a known closed PR", () => {
    const validClosingPRs = ["#1608", "#1609", "#1614", "#1641"];
    const validClosingPRsRegex = new RegExp(`(${validClosingPRs.join("|")})`);
    for (const field of REQUIRED_BOOTSTRAP) {
      const entry = getRegistryEntry(field);
      expect(entry.closedBy).toMatch(validClosingPRsRegex);
    }
  });
});

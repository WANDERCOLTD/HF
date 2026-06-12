/**
 * #1513 Slice 3 — scripts/seed-system-behavior-defaults.ts.
 *
 * Two layers:
 *   1. Structural — the source file defaults to dry-run, requires
 *      --execute, reads LISTED_KNOBS as the source of truth, never
 *      overwrites existing rows.
 *   2. Functional — `buildSeedPlan` returns the 6 canonical BEH-*
 *      parameters at 0.5; `classifySeedPlan` partitions correctly
 *      across already-set / to-create / missing-Parameter buckets.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const scriptPath = path.resolve(
  __dirname,
  "../../scripts/seed-system-behavior-defaults.ts",
);
const source = fs.readFileSync(scriptPath, "utf8");

// ── Structural ───────────────────────────────────────────

describe("seed-system-behavior-defaults.ts (#1513) — structural", () => {
  it("file exists at the canonical scripts/ location", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("defaults to dry-run — --execute is required for writes", () => {
    expect(source).toMatch(/const execute = process\.argv\.includes\("--execute"\)/);
    // The write branch is gated on `execute`.
    expect(source).toMatch(/if \(execute && report\.toCreate\.length > 0\)/);
  });

  it("reads LISTED_KNOBS as the source of truth (not a hardcoded list)", () => {
    expect(source).toMatch(
      /import\s+\{\s*LISTED_KNOBS\s*\}\s+from\s+"\.\.\/lib\/cascade\/knob-keys"/,
    );
    expect(source).toMatch(
      /LISTED_KNOBS\.filter\(\(k\) => k\.family === "behavior-target"\)/,
    );
  });

  it("targets SCOPE=SYSTEM and playbookId=null only", () => {
    expect(source).toMatch(/scope:\s*"SYSTEM"/);
    expect(source).toMatch(/playbookId:\s*null/);
  });

  it("uses 0.5 as the canonical neutral default", () => {
    expect(source).toMatch(/DEFAULT_TARGET_VALUE\s*=\s*0\.5/);
  });

  it("never overwrites — uses findFirst + create pattern (no upsert)", () => {
    expect(source).toMatch(/prisma\.behaviorTarget\.findFirst/);
    expect(source).toMatch(/prisma\.behaviorTarget\.create/);
    expect(source).not.toMatch(/prisma\.behaviorTarget\.upsert/);
  });

  it("logs every action — PLAN / WROTE / NOOP / MISSING tokens present", () => {
    expect(source).toMatch(/NOOP/);
    expect(source).toMatch(/PLAN/);
    expect(source).toMatch(/WROTE/);
    expect(source).toMatch(/MISSING/);
  });
});

// ── Functional (DB-mocked) ───────────────────────────────

const mockParameterFindMany = vi.fn();
const mockBehaviorTargetFindFirst = vi.fn();
const mockBehaviorTargetCreate = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    parameter: { findMany: (...args: unknown[]) => mockParameterFindMany(...args) },
    behaviorTarget: {
      findFirst: (...args: unknown[]) => mockBehaviorTargetFindFirst(...args),
      create: (...args: unknown[]) => mockBehaviorTargetCreate(...args),
    },
  },
}));

import {
  buildSeedPlan,
  classifySeedPlan,
} from "../../scripts/seed-system-behavior-defaults";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("seed-system-behavior-defaults — buildSeedPlan", () => {
  it("returns exactly 6 canonical BEH-* parameters from LISTED_KNOBS", () => {
    const plan = buildSeedPlan();
    const ids = plan.map((p) => p.parameterId).sort();
    expect(ids).toEqual([
      "BEH-CONVERSATIONAL-TONE",
      "BEH-FORMALITY",
      "BEH-PAUSE-TOLERANCE",
      "BEH-RESPONSE-LEN",
      "BEH-TURN-LENGTH",
      "BEH-WARMTH",
    ]);
  });

  it("every entry uses value=0.5", () => {
    for (const entry of buildSeedPlan()) {
      expect(entry.targetValue).toBe(0.5);
    }
  });
});

describe("seed-system-behavior-defaults — classifySeedPlan", () => {
  it("partitions correctly — all known params + none already set", async () => {
    const plan = buildSeedPlan();
    mockParameterFindMany.mockResolvedValueOnce(
      plan.map((p) => ({ parameterId: p.parameterId })),
    );
    mockBehaviorTargetFindFirst.mockResolvedValue(null); // no rows exist yet

    const report = await classifySeedPlan(plan);

    expect(report.missingParameter).toEqual([]);
    expect(report.alreadySet).toEqual([]);
    expect(report.toCreate).toHaveLength(plan.length);
  });

  it("partitions correctly — every param already has a SYSTEM row", async () => {
    const plan = buildSeedPlan();
    mockParameterFindMany.mockResolvedValueOnce(
      plan.map((p) => ({ parameterId: p.parameterId })),
    );
    // Every findFirst returns an existing row → all classified as already-set.
    mockBehaviorTargetFindFirst.mockResolvedValue({
      id: "existing",
      targetValue: 0.5,
    });

    const report = await classifySeedPlan(plan);

    expect(report.toCreate).toEqual([]);
    expect(report.alreadySet).toHaveLength(plan.length);
    expect(report.missingParameter).toEqual([]);
  });

  it("partitions correctly — Parameter row missing means classify reports missingParameter", async () => {
    const plan = buildSeedPlan();
    // Only the first 3 Parameter rows are registered.
    const partial = plan.slice(0, 3).map((p) => ({ parameterId: p.parameterId }));
    mockParameterFindMany.mockResolvedValueOnce(partial);
    mockBehaviorTargetFindFirst.mockResolvedValue(null);

    const report = await classifySeedPlan(plan);

    expect(report.missingParameter).toHaveLength(plan.length - 3);
    expect(report.toCreate).toHaveLength(3);
    expect(report.alreadySet).toEqual([]);
  });

  it("pre-existing rows are never re-written (idempotent re-run)", async () => {
    const plan = buildSeedPlan();
    mockParameterFindMany.mockResolvedValueOnce(
      plan.map((p) => ({ parameterId: p.parameterId })),
    );
    // Half of the params already set, half empty.
    let call = 0;
    mockBehaviorTargetFindFirst.mockImplementation(async () => {
      call += 1;
      return call <= 3 ? { id: `existing-${call}`, targetValue: 0.5 } : null;
    });

    const report = await classifySeedPlan(plan);

    expect(report.alreadySet).toHaveLength(3);
    expect(report.toCreate).toHaveLength(3);
    // The classify pass NEVER calls .create — that's reserved for main().
    expect(mockBehaviorTargetCreate).not.toHaveBeenCalled();
  });
});

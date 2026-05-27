/**
 * #911 — `getEffectiveBehaviorTargetsForCaller` (the canonical bulk
 * authoring-side cascade reader) — unit tests.
 *
 * Covers the four contract points from the issue body:
 *   1. CALLER override wins when present.
 *   2. PLAYBOOK value wins when no CALLER row exists.
 *   3. MAX `targetValue` across two CallerIdentity rows for the same caller
 *      (chain-contract Link 3 multi-identity rule).
 *   4. Helper is READ-ONLY — zero `.update` / `.create` / `.upsert` / `.delete`
 *      calls reach prisma.
 *
 * Mocks prisma + the canonical identity-fanout primitive at the module
 * boundary, mirroring the convention from
 * `tests/lib/tolerance/resolve-tolerance.test.ts` (typed `Mock` casts; no
 * `vi.mocked()` since that triggers tsc errors in this codebase).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    behaviorTarget: {
      findMany: vi.fn(),
      // The forbidden methods — registered as spies so the read-only
      // assertion can prove they were never called.
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/agent-tuner/write-target", () => ({
  resolveCallerIdentityIds: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { resolveCallerIdentityIds } from "@/lib/agent-tuner/write-target";
import { getEffectiveBehaviorTargetsForCaller } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";

const findManyMock = prisma.behaviorTarget.findMany as unknown as Mock;
const resolveIdsMock = resolveCallerIdentityIds as unknown as Mock;

// Spy handles for the read-only assertion at the end of the suite.
const writeSpies = [
  prisma.behaviorTarget.create as unknown as Mock,
  prisma.behaviorTarget.createMany as unknown as Mock,
  prisma.behaviorTarget.update as unknown as Mock,
  prisma.behaviorTarget.updateMany as unknown as Mock,
  prisma.behaviorTarget.upsert as unknown as Mock,
  prisma.behaviorTarget.delete as unknown as Mock,
  prisma.behaviorTarget.deleteMany as unknown as Mock,
];

// Golden-caller fixture documented in MEMORY.md / Epic 100 verification harness.
const GOLDEN_CALLER_ID = "f17d8616-3c31-4814-8de1-626fb42f16f6";
const PLAYBOOK_ID = "playbook-test-001";

function resetMocks() {
  findManyMock.mockReset();
  resolveIdsMock.mockReset();
  for (const spy of writeSpies) spy.mockReset();
}

/**
 * Convenience helper: drive `findMany` per-scope using a switch on the
 * `scope` filter so the test fixture stays declarative.
 */
function arrangeFindMany(opts: {
  system?: Array<{ parameterId: string; targetValue: number }>;
  playbook?: Array<{ parameterId: string; targetValue: number }>;
  caller?: Array<{ parameterId: string; targetValue: number }>;
}) {
  findManyMock.mockImplementation(async (args: Record<string, unknown>) => {
    const where = (args?.where ?? {}) as Record<string, unknown>;
    const scope = where.scope as string | undefined;
    if (scope === "SYSTEM") return opts.system ?? [];
    if (scope === "PLAYBOOK") return opts.playbook ?? [];
    if (scope === "CALLER") return opts.caller ?? [];
    return [];
  });
}

describe("getEffectiveBehaviorTargetsForCaller", () => {
  beforeEach(resetMocks);

  it("returns the CALLER override value when a CALLER row exists", async () => {
    resolveIdsMock.mockResolvedValue({ ok: true, identityIds: ["identity-A"] });
    arrangeFindMany({
      system: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      playbook: [{ parameterId: "BEH-WARMTH", targetValue: 0.6 }],
      caller: [{ parameterId: "BEH-WARMTH", targetValue: 0.34 }],
    });

    const out = await getEffectiveBehaviorTargetsForCaller(
      PLAYBOOK_ID,
      GOLDEN_CALLER_ID,
    );

    expect(out).toHaveLength(1);
    expect(out[0].parameterId).toBe("BEH-WARMTH");
    expect(out[0].effectiveValue).toBe(0.34);
    expect(out[0].sourceScope).toBe("CALLER");
    expect(out[0].systemValue).toBe(0.5);
    expect(out[0].playbookValue).toBe(0.6);
    expect(out[0].callerValue).toBe(0.34);
  });

  it("returns the PLAYBOOK value when no CALLER row exists", async () => {
    resolveIdsMock.mockResolvedValue({ ok: true, identityIds: ["identity-A"] });
    arrangeFindMany({
      system: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      playbook: [{ parameterId: "BEH-WARMTH", targetValue: 0.6 }],
      caller: [],
    });

    const out = await getEffectiveBehaviorTargetsForCaller(
      PLAYBOOK_ID,
      GOLDEN_CALLER_ID,
    );

    expect(out).toHaveLength(1);
    expect(out[0].effectiveValue).toBe(0.6);
    expect(out[0].sourceScope).toBe("PLAYBOOK");
    expect(out[0].callerValue).toBeNull();
  });

  it("returns the SYSTEM value when only SYSTEM is populated", async () => {
    resolveIdsMock.mockResolvedValue({ ok: true, identityIds: ["identity-A"] });
    arrangeFindMany({
      system: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
    });

    const out = await getEffectiveBehaviorTargetsForCaller(
      PLAYBOOK_ID,
      GOLDEN_CALLER_ID,
    );

    expect(out).toHaveLength(1);
    expect(out[0].effectiveValue).toBe(0.5);
    expect(out[0].sourceScope).toBe("SYSTEM");
    expect(out[0].playbookValue).toBeNull();
    expect(out[0].callerValue).toBeNull();
  });

  it("takes MAX targetValue across two CallerIdentity rows for the same caller (chain-contract Link 3)", async () => {
    // Two identity rows, two BehaviorTarget(CALLER) rows for the same
    // parameter — most-favourable wins.
    resolveIdsMock.mockResolvedValue({
      ok: true,
      identityIds: ["identity-A", "identity-B"],
    });
    arrangeFindMany({
      playbook: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      caller: [
        { parameterId: "BEH-WARMTH", targetValue: 0.4 },
        { parameterId: "BEH-WARMTH", targetValue: 0.72 },
      ],
    });

    const out = await getEffectiveBehaviorTargetsForCaller(
      PLAYBOOK_ID,
      GOLDEN_CALLER_ID,
    );

    expect(out).toHaveLength(1);
    expect(out[0].effectiveValue).toBe(0.72);
    expect(out[0].sourceScope).toBe("CALLER");
    expect(out[0].callerValue).toBe(0.72);
  });

  it("skips the CALLER fanout query when the caller has no CallerIdentity rows", async () => {
    resolveIdsMock.mockResolvedValue({ ok: false, reason: "no_identity" });
    arrangeFindMany({
      system: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      playbook: [{ parameterId: "BEH-WARMTH", targetValue: 0.6 }],
    });

    const out = await getEffectiveBehaviorTargetsForCaller(
      PLAYBOOK_ID,
      GOLDEN_CALLER_ID,
    );

    // PLAYBOOK still wins because there's no CALLER layer to overlay.
    expect(out[0].effectiveValue).toBe(0.6);
    expect(out[0].sourceScope).toBe("PLAYBOOK");
    expect(out[0].callerValue).toBeNull();
    // CALLER findMany call should still not have fired (we early-return).
    const callerScopeCalls = findManyMock.mock.calls.filter(
      (c: unknown[]) => {
        const where = ((c[0] as Record<string, unknown>)?.where ?? {}) as Record<string, unknown>;
        return where.scope === "CALLER";
      },
    );
    expect(callerScopeCalls).toHaveLength(0);
  });

  it("returns an empty list when no layer has any rows", async () => {
    resolveIdsMock.mockResolvedValue({ ok: true, identityIds: ["identity-A"] });
    arrangeFindMany({});

    const out = await getEffectiveBehaviorTargetsForCaller(
      PLAYBOOK_ID,
      GOLDEN_CALLER_ID,
    );

    expect(out).toEqual([]);
  });

  it("makes ZERO writes (no .update / .create / .upsert / .delete on BehaviorTarget)", async () => {
    resolveIdsMock.mockResolvedValue({ ok: true, identityIds: ["identity-A"] });
    arrangeFindMany({
      system: [{ parameterId: "BEH-WARMTH", targetValue: 0.5 }],
      playbook: [{ parameterId: "BEH-WARMTH", targetValue: 0.6 }],
      caller: [{ parameterId: "BEH-WARMTH", targetValue: 0.34 }],
    });

    await getEffectiveBehaviorTargetsForCaller(PLAYBOOK_ID, GOLDEN_CALLER_ID);

    for (const spy of writeSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

/**
 * #2051 (epic #2049 sub-epic B / Contract 3) — `moduleSequencePolicy`.
 *
 * Pins two layers of the scheduler-pool semantics:
 *
 *   (a) `filterSchedulerModules` with `moduleSequencePolicy: "strict"` —
 *       excludes modules with unmet prerequisites; full-pool fallback
 *       when every module is gated.
 *   (b) `resolveInterleaveModeOverride` — returns `"review"` ONLY on the
 *       4th, 8th, 12th… call when policy is `"interleaved"`. `learner_led`
 *       and absent are byte-identical (no-op).
 *
 * `lockedModule` bypass is enforced by the enclosing block in `modules.ts`
 * (the `!lockedModule` guard at the scheduler block top — this filter is
 * never reached when a learner has picked).
 *
 * Decision 3 from the design brief: `"learner_led"` MUST produce
 * byte-identical scheduler input vs. the field being absent. The
 * "no-op identity" tests below pin both reference and structural
 * equality so a future refactor cannot accidentally introduce a delta.
 */

import { describe, it, expect } from "vitest";
import {
  filterSchedulerModules,
  resolveInterleaveModeOverride,
} from "@/lib/prompt/composition/transforms/modules";
import type { ModuleData } from "@/lib/prompt/composition/types";
import type { PlaybookConfig } from "@/lib/types/json-fields";

function mod(slug: string, opts: Partial<ModuleData> = {}): ModuleData {
  return {
    id: opts.id ?? `id-${slug}`,
    slug,
    name: opts.name ?? `Module ${slug}`,
    sortOrder: opts.sortOrder ?? 0,
    prerequisites: opts.prerequisites ?? [],
    ...opts,
  };
}

describe("filterSchedulerModules — moduleSequencePolicy strict (#2051 Contract 3)", () => {
  it("strict excludes modules with unmet prerequisites", () => {
    const modules: ModuleData[] = [
      mod("a", { prerequisites: [] }),
      mod("b", { prerequisites: ["a"] }),
      mod("c", { prerequisites: [] }),
    ];
    const pool = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(), // nothing completed
      pbConfig: { moduleSequencePolicy: "strict" } as PlaybookConfig,
      isFirstCall: false,
    });
    expect(pool.map((m) => m.slug).sort()).toEqual(["a", "c"]);
  });

  it("strict passes a module whose prerequisites are met", () => {
    const modules: ModuleData[] = [
      mod("a"),
      mod("b", { prerequisites: ["a"] }),
    ];
    const pool = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(["a"]),
      pbConfig: { moduleSequencePolicy: "strict" } as PlaybookConfig,
      isFirstCall: false,
    });
    expect(pool.map((m) => m.slug).sort()).toEqual(["a", "b"]);
  });

  it("strict falls back to full pool when every module is gated", () => {
    const modules: ModuleData[] = [
      mod("a", { prerequisites: ["foreign-prereq"] }),
      mod("b", { prerequisites: ["another-foreign"] }),
    ];
    const pool = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(),
      pbConfig: { moduleSequencePolicy: "strict" } as PlaybookConfig,
      isFirstCall: false,
    });
    expect(pool).toEqual(modules);
  });

  it("strict composes with firstCallCurriculumFocus on Call 1 (intersection)", () => {
    const modules: ModuleData[] = [
      mod("a"),
      mod("b", { prerequisites: ["a"] }),
      mod("c"),
    ];
    const pool = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(), // 'a' not completed
      pbConfig: {
        moduleSequencePolicy: "strict",
        // focus says only b is allowed on Call 1, but b's prereq 'a' is unmet.
        firstCallCurriculumFocus: ["b"],
      } as PlaybookConfig,
      isFirstCall: true,
    });
    // Strict excludes b (prereq unmet) → strict pool = [a, c].
    // Focus then intersects with [b] → empty → full-pool fallback.
    // The fallback returns the strict-narrowed pool ([a, c]) — not the
    // original modules — because that's the state of `pool` at the focus
    // step. This is a deliberate composition: each filter narrows, the
    // fallback restores only its own step.
    expect(pool.map((m) => m.slug).sort()).toEqual(["a", "c"]);
  });
});

describe("filterSchedulerModules — moduleSequencePolicy learner_led / absent (no-op pins)", () => {
  const modules: ModuleData[] = [
    mod("a", { prerequisites: ["unmet"] }),
    mod("b"),
    mod("c", { prerequisites: ["unmet"] }),
  ];

  it("absent (no field) → input array returned by reference (true no-op)", () => {
    const pool = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(),
      pbConfig: {} as PlaybookConfig,
      isFirstCall: false,
    });
    expect(pool).toBe(modules);
  });

  it("learner_led → input array returned by reference (true no-op)", () => {
    const pool = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(),
      pbConfig: {
        moduleSequencePolicy: "learner_led",
      } as PlaybookConfig,
      isFirstCall: false,
    });
    expect(pool).toBe(modules);
  });

  it("absent vs learner_led produce byte-identical filtered pools", () => {
    const poolAbsent = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(),
      pbConfig: {} as PlaybookConfig,
      isFirstCall: false,
    });
    const poolLearnerLed = filterSchedulerModules({
      modules,
      completedModules: new Set<string>(),
      pbConfig: {
        moduleSequencePolicy: "learner_led",
      } as PlaybookConfig,
      isFirstCall: false,
    });
    // Both no-op → identical reference (the input).
    expect(poolAbsent).toBe(modules);
    expect(poolLearnerLed).toBe(modules);
    // And by structural value (defensive — future refactor mustn't drift).
    expect(poolLearnerLed).toEqual(poolAbsent);
  });
});

describe("resolveInterleaveModeOverride — cadence formula (#2051 Contract 3)", () => {
  it("interleaved + call 1 → null (first call is always new material)", () => {
    expect(
      resolveInterleaveModeOverride({
        pbConfig: { moduleSequencePolicy: "interleaved" } as PlaybookConfig,
        callNumber: 1,
      }),
    ).toBeNull();
  });

  it("interleaved + calls 2,3 → null (cadence ticks 1/4, 2/4)", () => {
    for (const callNumber of [2, 3]) {
      expect(
        resolveInterleaveModeOverride({
          pbConfig: { moduleSequencePolicy: "interleaved" } as PlaybookConfig,
          callNumber,
        }),
      ).toBeNull();
    }
  });

  it("interleaved + call 4 → 'review' (cadence tick 3/4 fires)", () => {
    expect(
      resolveInterleaveModeOverride({
        pbConfig: { moduleSequencePolicy: "interleaved" } as PlaybookConfig,
        callNumber: 4,
      }),
    ).toBe("review");
  });

  it("interleaved + call 8 → 'review' (next quarter cadence tick)", () => {
    expect(
      resolveInterleaveModeOverride({
        pbConfig: { moduleSequencePolicy: "interleaved" } as PlaybookConfig,
        callNumber: 8,
      }),
    ).toBe("review");
  });

  it("interleaved + calls 5,6,7 → null (between cadence ticks)", () => {
    for (const callNumber of [5, 6, 7]) {
      expect(
        resolveInterleaveModeOverride({
          pbConfig: { moduleSequencePolicy: "interleaved" } as PlaybookConfig,
          callNumber,
        }),
      ).toBeNull();
    }
  });

  it("strict policy → null on all calls (cadence override is interleaved-only)", () => {
    for (const callNumber of [1, 4, 8]) {
      expect(
        resolveInterleaveModeOverride({
          pbConfig: { moduleSequencePolicy: "strict" } as PlaybookConfig,
          callNumber,
        }),
      ).toBeNull();
    }
  });

  it("learner_led → null on all calls (byte-identical to absent)", () => {
    for (const callNumber of [1, 4, 8]) {
      expect(
        resolveInterleaveModeOverride({
          pbConfig: {
            moduleSequencePolicy: "learner_led",
          } as PlaybookConfig,
          callNumber,
        }),
      ).toBeNull();
    }
  });

  it("absent → null on all calls", () => {
    for (const callNumber of [1, 4, 8]) {
      expect(
        resolveInterleaveModeOverride({
          pbConfig: {} as PlaybookConfig,
          callNumber,
        }),
      ).toBeNull();
    }
  });

  it("learner_led vs absent produce IDENTICAL output across the full cadence window", () => {
    // Per Design Brief Decision 3: learner_led MUST be byte-identical to
    // the field being absent. This pins the structural invariant across
    // a representative call-number window so a future refactor can't
    // accidentally introduce a no-op delta.
    for (const callNumber of [1, 2, 3, 4, 5, 7, 8, 12]) {
      const absent = resolveInterleaveModeOverride({
        pbConfig: {} as PlaybookConfig,
        callNumber,
      });
      const learnerLed = resolveInterleaveModeOverride({
        pbConfig: {
          moduleSequencePolicy: "learner_led",
        } as PlaybookConfig,
        callNumber,
      });
      expect(learnerLed).toBe(absent);
    }
  });

  it("non-numeric callNumber → null (defensive)", () => {
    expect(
      resolveInterleaveModeOverride({
        pbConfig: { moduleSequencePolicy: "interleaved" } as PlaybookConfig,
        callNumber: NaN,
      }),
    ).toBeNull();
  });
});

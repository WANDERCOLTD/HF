/**
 * #2051 (epic #2049 sub-epic B / Contract 2) — `firstCallCurriculumFocus`.
 *
 * Pins the EXCLUSIVE allow-list filter applied to the scheduler module
 * pool on Call 1. The filter lives in `filterSchedulerModules` in
 * `transforms/modules.ts` (next to the scheduler call site).
 *
 * Semantics (per docs/groomed/2051-call1-shape-consumers.md §Contract 2):
 *   - Absent / empty array → no filtering (current behaviour)
 *   - Non-empty array on Call 1 → ONLY modules whose `id` or `slug` matches
 *     the array remain in the scheduler pool
 *   - Call 2+ → no filtering (Call 1-only constraint)
 *   - All listed modules already mastered → full-pool fallback (prevents
 *     stall on a brand-new learner who completed everything out-of-band)
 *   - No matching slug → full-pool fallback with a warn log
 *
 * The filter does NOT mutate the input `modules` array or affect
 * `completedModules`, `tpProgress`, or `loMasteryMap` — only the scheduler
 * input is narrowed.
 */

import { describe, it, expect } from "vitest";
import { filterSchedulerModules } from "@/lib/prompt/composition/transforms/modules";
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

const MODULES: ModuleData[] = [
  mod("module-a"),
  mod("module-b"),
  mod("module-c"),
];

describe("filterSchedulerModules — firstCallCurriculumFocus (#2051 Contract 2)", () => {
  it("default (field absent) preserves the full module pool unchanged", () => {
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {} as PlaybookConfig,
      isFirstCall: true,
    });
    expect(pool).toEqual(MODULES);
  });

  it("empty array is treated as absent — full pool preserved", () => {
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: { firstCallCurriculumFocus: [] } as PlaybookConfig,
      isFirstCall: true,
    });
    expect(pool).toEqual(MODULES);
  });

  it("Call 1 + non-empty array → pool narrowed to allow-listed modules (by slug)", () => {
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {
        firstCallCurriculumFocus: ["module-a", "module-b"],
      } as PlaybookConfig,
      isFirstCall: true,
    });
    expect(pool.map((m) => m.slug)).toEqual(["module-a", "module-b"]);
  });

  it("Call 1 + array match-by-id also resolves (not just slug)", () => {
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {
        firstCallCurriculumFocus: ["id-module-a"],
      } as PlaybookConfig,
      isFirstCall: true,
    });
    expect(pool.map((m) => m.slug)).toEqual(["module-a"]);
  });

  it("Call 2+ → no filter applied even when array is set", () => {
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {
        firstCallCurriculumFocus: ["module-a"],
      } as PlaybookConfig,
      isFirstCall: false,
    });
    expect(pool).toEqual(MODULES);
  });

  it("all listed modules mastered → full-pool fallback (safety)", () => {
    const completed = new Set<string>(["module-a", "module-b"]);
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: completed,
      pbConfig: {
        firstCallCurriculumFocus: ["module-a", "module-b"],
      } as PlaybookConfig,
      isFirstCall: true,
    });
    // Fallback: full pool restored.
    expect(pool).toEqual(MODULES);
  });

  it("no matching slug → full-pool fallback (defensive)", () => {
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {
        firstCallCurriculumFocus: ["never-existed-slug"],
      } as PlaybookConfig,
      isFirstCall: true,
    });
    expect(pool).toEqual(MODULES);
  });

  it("does NOT mutate the input modules array (returns a new array)", () => {
    const original = [...MODULES];
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {
        firstCallCurriculumFocus: ["module-a"],
      } as PlaybookConfig,
      isFirstCall: true,
    });
    expect(MODULES).toEqual(original);
    // The filter returns a new array reference when narrowing.
    expect(pool).not.toBe(MODULES);
  });

  it("byte-identical when absent: returns the same array reference for no-op", () => {
    // No filters apply → the function returns the original `modules`
    // reference (no allocation). Pins the no-op fast-path.
    const pool = filterSchedulerModules({
      modules: MODULES,
      completedModules: new Set<string>(),
      pbConfig: {} as PlaybookConfig,
      isFirstCall: true,
    });
    expect(pool).toBe(MODULES);
  });
});

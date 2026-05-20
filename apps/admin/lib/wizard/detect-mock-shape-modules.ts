/**
 * Detects "mock-shape" modules in an authored module list and returns the
 * `coversModules` mapping that should be persisted on each.
 *
 * Background (#557): an IELTS Full Mock Exam module walks the learner through
 * Part 1, Part 2 and Part 3 in a single call. The pipeline's per-segment
 * MEASURE pass (`runPerSegmentScoring` in app/api/calls/[callId]/pipeline/
 * route.ts) is gated on `CurriculumModule.coversModules.length > 0` — without
 * a populated array the segmenter never runs and all 4 IELTS skill scores
 * collapse into a single mock-bound CallScore row.
 *
 * Today only the dedicated seed script (`prisma/seed-ielts-course.ts:213`)
 * sets `coversModules`. Wizard-created and import-modules-route-created
 * courses never get it populated. This helper centralises the detection so
 * both projection paths can call it.
 *
 * Detection heuristic — both conditions must hold:
 *   1. A module slugged "mock" (or "full-mock", "mock-exam") exists.
 *   2. Sibling modules with slugs "part1", "part2", "part3" all exist in
 *      the same module list.
 *
 * When matched, the mock module's `coversModules` is the list of part-N
 * sibling slugs (in slug order). Other modules return undefined.
 *
 * Future shape detection (e.g. "mock" + "section1..N" instead of
 * "part1..3") can be added here without touching callers.
 *
 * Slug-scope discipline (#407): this function never queries the DB. The
 * caller must scope the resulting writes by curriculumId.
 */

const MOCK_SLUGS = new Set(["mock", "full-mock", "mock-exam", "fullmock"]);
const IELTS_PART_SLUGS = ["part1", "part2", "part3"] as const;

export interface MockShapeInput {
  /** Module slug — must already be lower-cased + slugified. */
  slug: string;
}

/**
 * Returns the `coversModules` array for the given module slug, or undefined
 * when the module is not a recognised mock shape or its required siblings
 * are absent. Pure function.
 */
export function resolveCoversModulesForSlug(
  slug: string,
  allSlugs: ReadonlyArray<string>,
): string[] | undefined {
  if (!MOCK_SLUGS.has(slug)) return undefined;
  const have = new Set(allSlugs);
  const haveAllParts = IELTS_PART_SLUGS.every((p) => have.has(p));
  if (!haveAllParts) return undefined;
  return [...IELTS_PART_SLUGS];
}

/**
 * Bulk variant: takes a list of authored modules and returns a Map of
 * slug → coversModules array for those that match. Modules without a
 * matching shape are omitted from the map.
 */
export function detectMockShapeCovers<T extends MockShapeInput>(
  modules: ReadonlyArray<T>,
): Map<string, string[]> {
  const allSlugs = modules.map((m) => m.slug);
  const result = new Map<string, string[]>();
  for (const m of modules) {
    const covers = resolveCoversModulesForSlug(m.slug, allSlugs);
    if (covers) result.set(m.slug, covers);
  }
  return result;
}

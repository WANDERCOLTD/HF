/**
 * lo-ref-match — word-boundary matching for Learning Objective references.
 *
 * LO refs are strings like "LO1", "LO10", "R04-LO2-AC2.3". The old pattern
 * `a.includes(b)` caused "LO1" to match "LO10" (false positive), putting
 * teaching points in the wrong sessions / rows.
 *
 * This helper treats alphanumerics as a single "word" and requires the needle
 * to sit on non-alphanumeric boundaries (or start/end of string).
 *
 * Matching is **bidirectional** by default: a hierarchical assertion ref
 * ("R04-LO2-AC2.3") should match an entry tagged with just "LO2", and vice
 * versa — an assertion tagged "LO2" covers all ACs of LO2.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True if `needle` appears in `haystack` on non-alphanumeric boundaries.
 * Example: wordBoundaryContains("R04-LO2-AC2.3", "LO2") === true
 *          wordBoundaryContains("LO10", "LO1") === false
 */
export function wordBoundaryContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9])${escapeRegex(needle)}(?:[^A-Za-z0-9]|$)`,
  );
  return pattern.test(haystack);
}

/**
 * True if two LO refs match — bidirectional, word-boundary safe.
 * Handles hierarchical refs where one side is a parent of the other.
 */
export function loRefsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return wordBoundaryContains(a, b) || wordBoundaryContains(b, a);
}

/**
 * True if any ref in `targetRefs` matches `assertionRef`.
 * Use this for the common pattern: does this assertion belong to any of these LOs?
 */
export function assertionMatchesAnyLoRef(
  assertionRef: string | null | undefined,
  targetRefs: readonly string[],
): boolean {
  if (!assertionRef || targetRefs.length === 0) return false;
  return targetRefs.some((ref) => loRefsMatch(assertionRef, ref));
}

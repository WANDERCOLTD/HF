/**
 * Sanitize a scheduler-decision `reason` string for learner display.
 *
 * The scheduler writes `reason` to `CallerAttribute.jsonValue.reason` during
 * COMPOSE. It is AI-generated narrative ("Reviewing weak LOs from last call,
 * focus on Part 1 Familiar Topics") that may contain internal identifiers
 * (UUIDs, spec slugs) or HTML-tag-shaped fragments from upstream sources.
 *
 * Pipeline (order matters — strip tag-shaped content first so a tag that
 * coincidentally contains a UUID isn't replaced and then left behind):
 *   1. Strip anything matching `<[^>]*>` (defence-in-depth; React already
 *      text-escapes, but the same value is logged + may render in non-React
 *      surfaces later).
 *   2. Strip UUIDs.
 *   3. Strip spec slugs (`[A-Z]+-[A-Z0-9]+-\d{3}`).
 *   4. Collapse runs of whitespace, trim.
 *   5. If the result is < 20 chars, return `null` — too short to be useful.
 *   6. Truncate to 137 chars at the last word boundary and append `…`.
 *
 * Returns `null` when the sanitized result would be too short to provide
 * meaningful context — the caller hides the entire `reason` line.
 *
 * Tech Lead resolution (issue #917, comment 2026-05-27): the HTML strip is
 * defence-in-depth — single regex, no false positives on natural language.
 */

const TAG_PATTERN = /<[^>]*>/g;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SLUG_PATTERN = /\b[A-Z]+-[A-Z0-9]+-\d{3}\b/g;
const MIN_USEFUL_LENGTH = 20;
const MAX_LENGTH = 137;

export function sanitizeReason(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  // Strip tag-shaped content first, then identifiers, then collapse whitespace.
  let cleaned = raw
    .replace(TAG_PATTERN, " ")
    .replace(UUID_PATTERN, " ")
    .replace(SLUG_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < MIN_USEFUL_LENGTH) return null;

  if (cleaned.length > MAX_LENGTH) {
    // Truncate at last word boundary at or before MAX_LENGTH, then append ellipsis.
    const slice = cleaned.slice(0, MAX_LENGTH);
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
    cleaned = `${cut.replace(/[.,;:!?\s]+$/, "")}…`;
  }

  return cleaned;
}

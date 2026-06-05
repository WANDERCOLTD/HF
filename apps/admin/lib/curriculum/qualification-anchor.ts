/**
 * Qualification anchor — labelling/grouping field for Curricula teaching the same
 * regulated qualification. NOT a mastery-sharing mechanism (see #1081 — sharing
 * comes from PlaybookCurriculum role=linked, one shared Curriculum).
 *
 * The anchor is derived deterministically from declared frontmatter / wizard input
 * so the same qualification always lands on the same anchor across re-ingests.
 */

/**
 * Known-qualifications override table. Lookup is case-insensitive on the
 * (body, ref) pair; first match wins. Add canonical anchors here as new
 * regulated qualifications are onboarded.
 */
const KNOWN_QUALIFICATIONS: ReadonlyArray<readonly [body: string, ref: string, anchor: string]> = [
  ["Ofqual", "SIAS / The CIO/CTO Standard V6.0", "sias-cio-cto-v6"],
  ["SIAS", "The CIO/CTO Standard V6.0", "sias-cio-cto-v6"],
  // Add new known qualifications above this line.
];

/**
 * Derive the canonical qualificationAnchor for a (body, ref) pair.
 * Returns null if both inputs are null/empty (caller decides whether to leave
 * the Curriculum's anchor null or to derive from other inputs).
 */
export function deriveQualificationAnchor(
  body: string | null | undefined,
  ref: string | null | undefined,
): string | null {
  const b = (body ?? "").trim();
  const r = (ref ?? "").trim();
  if (!b && !r) return null;

  // 1. Known-qualifications override (case-insensitive lookup on body + ref).
  for (const [knownBody, knownRef, anchor] of KNOWN_QUALIFICATIONS) {
    if (b.toLowerCase() === knownBody.toLowerCase() && r.toLowerCase() === knownRef.toLowerCase()) {
      return anchor;
    }
  }

  // 2. Fallback: slugify body + ref, joined.
  const combined = [b, r].filter(Boolean).join(" ");
  return slugify(combined);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

/**
 * AI-to-DB guard (#1081 Slice 2B.2) — validate that a derived anchor is safe
 * to use as a sibling lookup key. Two acceptance paths:
 *   (a) The anchor is in the canonical override table (vetted by a human).
 *   (b) The anchor matches strict slug shape — only the slugify fallback
 *       above produces these, so an educator's free-text input sanitised
 *       through slugify will always pass; a future AI-generated anchor
 *       containing whitespace, punctuation, or unusual length will not.
 *
 * Caller pattern (see .claude/rules/ai-to-db-guard.md):
 *   const anchor = deriveQualificationAnchor(body, ref);
 *   if (anchor && !isAnchorSafe(anchor)) {
 *     console.warn("anchor failed safety check, treating as null");
 *     // proceed to mint fresh — still set anchor for labelling but skip lookup
 *   }
 *   if (anchor && isAnchorSafe(anchor)) {
 *     const sibling = await findCurriculumByAnchor(anchor, domainId);
 *     if (sibling) return linkToSibling(sibling);
 *   }
 *   return mintFresh({ qualificationAnchor: anchor });
 */
export function isAnchorSafe(anchor: string | null | undefined): boolean {
  if (!anchor) return false;
  // (a) Known canonical anchors from the override table.
  const known = new Set(KNOWN_QUALIFICATIONS.map(([, , a]) => a));
  if (known.has(anchor)) return true;
  // (b) Slug-form anchors. Single-char anchors (e.g. "a") are accepted; the
  // multi-char path requires alphanumeric start + alphanumeric end with
  // lowercase + hyphens between, length 2..80.
  return /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$|^[a-z0-9]$/.test(anchor);
}

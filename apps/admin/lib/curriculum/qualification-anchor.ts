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

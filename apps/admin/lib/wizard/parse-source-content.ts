/**
 * parse-source-content.ts (#1850 P3f)
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §"Per-module YAML settings blocks"
 *
 * Per-format parsers for the content-source files referenced from a
 * Course Reference's `## Content Sources` section. Each parser takes the
 * source file's raw text and returns the shape `AuthoredModuleSettings`
 * expects for the destination field.
 *
 * Format dispatch (today):
 *   - `cueCardBank`   → Array<{ topic, bullets[] }>
 *   - `stallScaffold` → string[]
 *
 * Both parsers are deterministic, dependency-free, and tolerant of the
 * cosmetic variations in the HFF-authored fixtures (extra blank lines,
 * `> ` quoted bodies, leading `## ` separators).
 *
 * Issue #1850 P3f.
 */

// ── Cue card bank (Source 2 — Part 2 cue cards) ──────────────────────
//
// Input format (verbatim from `ielts-speaking-question-bank-part2.md`):
//
//   ### Card 1 — Family member you admire
//
//   > Describe a family member you admire.
//   > You should say:
//   >   who this person is
//   >   how often you see them
//   >   what kind of personality they have
//   > and explain why you admire them.
//
//   _Rounding-off: …_
//
//   _(source: …)_
//
// Output: { topic: "Family member you admire", bullets: [
//   "who this person is", "how often you see them", ...
// ]}
//
// The "Describe …" verb-line and the "and explain …" closer are kept
// out of the bullets array — they're the cue-card framing, not the
// student's bullet list. The first 3-4 indented quote lines under
// "You should say:" are the bullets.

export interface CueCard {
  topic: string;
  bullets: string[];
}

const CUE_HEADER = /^###\s+Card\s+\d+\s*[—–-]\s+(.+?)\s*$/i;
const QUOTE_LINE = /^>\s?(.*)$/;

/** Strip surrounding whitespace + leading-trailing punctuation. */
function cleanBullet(s: string): string {
  return s.replace(/^[\s>]*|[\s.]*$/g, "").trim();
}

/**
 * Parse a cue-card-bank markdown file. Returns an array of cue cards
 * — one per `### Card N — Title` heading. Cards with no bullets are
 * dropped (defensive — the v1 fixture has none).
 */
export function parseCueCardBank(text: string): CueCard[] {
  const lines = text.split(/\r?\n/);
  const cards: CueCard[] = [];
  let i = 0;
  while (i < lines.length) {
    const headerMatch = lines[i].match(CUE_HEADER);
    if (!headerMatch) {
      i++;
      continue;
    }
    const topic = headerMatch[1].trim();
    i++;
    // Collect quoted lines until a blank-line or new heading.
    const quoted: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (/^###?\s/.test(line)) break;
      const q = line.match(QUOTE_LINE);
      if (q) {
        quoted.push(q[1]);
      } else if (line.trim() === "" && quoted.length > 0) {
        // End-of-block on blank line if we've already seen quoted lines
        break;
      }
      i++;
    }
    // Within the quoted block, the bullets are the lines AFTER
    // "You should say:" and BEFORE the "and explain …" closer.
    const bullets: string[] = [];
    let sawYouShouldSay = false;
    for (const raw of quoted) {
      const line = raw.trimEnd();
      if (/^you should say:?\s*$/i.test(line.trim())) {
        sawYouShouldSay = true;
        continue;
      }
      if (!sawYouShouldSay) continue;
      // The "and explain …" line closes the bullet list.
      if (/^and\s+explain\b/i.test(line.trim())) break;
      // A bullet line is indented inside the quote block.
      const cleaned = cleanBullet(line);
      if (cleaned.length === 0) continue;
      bullets.push(cleaned);
    }
    if (bullets.length > 0) {
      cards.push({ topic, bullets });
    }
  }
  return cards;
}

// ── Stall scaffolds (Source 6 + Source 7) ────────────────────────────
//
// Input format (verbatim from `stall-scaffolds-monologue.md`):
//
//   ## Scaffold pool
//
//   1. **early-stall** — "Take another moment."
//   2. **early-stall** — "Take your time."
//   ...
//   14. **early-stall** — "Mm." *(minimal back-channel; …)*
//
// Output: ["Take another moment.", "Take your time.", ...]
//
// The tag (early-stall / deep-stall / …) is dropped — the runtime
// stall detector picks at random and the schema is `string[]`. Trailing
// italic parenthetical notes are stripped.

const POOL_SECTION = /^##\s+Scaffold\s+pool\s*$/im;
/** Matches `1. **tag** — "text"` (em-dash, en-dash, hyphen all accepted). */
const SCAFFOLD_LINE = /^\s*\d+\.\s+\*\*[^*]+\*\*\s*[—–-]\s*"([^"]+)"\s*(?:\*\([^)]*\)\*)?\s*$/;

/**
 * Parse a stall-scaffold markdown file. Returns the flat list of scaffold
 * strings in source order (tags dropped — schema is `string[]`). Returns
 * an empty array when the `## Scaffold pool` section is missing.
 */
export function parseStallScaffolds(text: string): string[] {
  const lines = text.split(/\r?\n/);
  let sectionAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (POOL_SECTION.test(lines[i])) {
      sectionAt = i + 1;
      break;
    }
  }
  if (sectionAt < 0) return [];

  const out: string[] = [];
  for (let i = sectionAt; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // next top-level section ends the pool
    const m = line.match(SCAFFOLD_LINE);
    if (m) {
      const txt = m[1].trim();
      if (txt) out.push(txt);
    }
  }
  return out;
}

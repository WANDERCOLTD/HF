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

// ── Topic pool (Source 1 — Part 1 frames + Source 3 — Part 3 themes/sets)
//
// Two heading shapes are tolerated, both normalising to the same output
// shape `Array<{ topic, questions[] }>`:
//
//   PART 1 — `ielts-speaking-question-bank-part1.md`
//   ## Frame N — Topic title
//
//   _Optional signposting line (markdown italic)._
//
//   1. First question text?
//   2. Second question text?
//   ...
//
//   PART 3 — `ielts-speaking-question-bank-part3.md`
//   ## Theme: Society and generations
//
//   ### Set 1 — Possessions and status (linked to Part 2 "Object" cards)
//
//   _Let's consider how people's values have changed._
//
//   1. First question?
//   2. Second question?
//   ...
//
// In the Part 1 shape each `## Frame N — ...` is a topic and the
// numbered list under it is the question set.
// In the Part 3 shape each `### Set N — ...` (under a `## Theme:`
// parent) is a topic and the numbered list under it is the question
// set; the `## Theme:` line is NOT itself a topic.
//
// Italic signposting lines (`_..._`) + footer `_(source: …)_` notes +
// `---` separators are ignored. Output topics that produced 0
// questions are dropped (defensive).

export interface TopicPoolEntry {
  topic: string;
  questions: string[];
}

const FRAME_HEADER = /^##\s+Frame\s+\d+\s*[—–-]\s+(.+?)\s*$/i;
const THEME_HEADER = /^##\s+Theme\s*:\s*(.+?)\s*$/i;
const SET_HEADER = /^###\s+Set\s+\d+\s*[—–-]\s+(.+?)\s*$/i;
const NUMBERED_QUESTION = /^\s*\d+\.\s+(.+?)\s*$/;
const ITALIC_LINE = /^_.*_\s*$/;

/**
 * Parse a topic-bank / theme-bank markdown file into a flat list of
 * `{ topic, questions[] }` entries.
 *
 * The function decides Part 1 ("Frame") vs Part 3 ("Theme + Set") shape
 * dynamically by which heading types occur — the dispatcher in
 * `resolve-module-source-refs.ts` accepts BOTH `format: topic-pool` AND
 * `format: theme-pool` because they normalise to the same output shape.
 *
 * Tolerant: italic signposting lines + `_(source: …)_` footers +
 * `---` separators are skipped. A topic with zero questions is dropped.
 */
export function parseTopicPool(text: string): TopicPoolEntry[] {
  const lines = text.split(/\r?\n/);
  const out: TopicPoolEntry[] = [];

  let currentTopic: string | null = null;
  let currentQuestions: string[] = [];

  const flush = (): void => {
    if (currentTopic && currentQuestions.length > 0) {
      out.push({ topic: currentTopic, questions: [...currentQuestions] });
    }
    currentTopic = null;
    currentQuestions = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // Part 1 `## Frame N — Topic` — opens a topic.
    const frameMatch = line.match(FRAME_HEADER);
    if (frameMatch) {
      flush();
      currentTopic = frameMatch[1].trim();
      continue;
    }

    // Part 3 `## Theme: X` — closes any open topic but does NOT itself
    // open one (the `### Set N — Title` under it carries the topic).
    if (THEME_HEADER.test(line)) {
      flush();
      continue;
    }

    // Part 3 `### Set N — Title` — opens a topic.
    const setMatch = line.match(SET_HEADER);
    if (setMatch) {
      flush();
      currentTopic = setMatch[1].trim();
      continue;
    }

    // Any OTHER top-level `## ` heading ends the current topic and stops
    // consumption inside it. Top-level `# ` headings (single-hash) live
    // only at file-top in both fixtures and are tolerated as a no-op.
    if (/^##\s/.test(line)) {
      flush();
      continue;
    }

    // `---` separator — ignore.
    if (/^---+\s*$/.test(line)) continue;

    // Italic signposting / source-footer — ignore.
    if (ITALIC_LINE.test(line.trim())) continue;

    // Empty line — ignore (doesn't close the topic; questions may carry
    // blank lines between them in some authoring styles).
    if (line.trim() === "") continue;

    // Numbered question under the current topic.
    const qMatch = line.match(NUMBERED_QUESTION);
    if (qMatch && currentTopic !== null) {
      const q = qMatch[1].trim();
      if (q.length > 0) currentQuestions.push(q);
      continue;
    }

    // Other prose (e.g. paragraph between heading and questions) —
    // ignore; the next question/heading resumes parsing.
  }
  flush();
  return out;
}

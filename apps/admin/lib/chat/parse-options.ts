/**
 * Parse numbered/lettered/bulleted options from AI prose text.
 *
 * When the AI writes options in its text response instead of using show_options,
 * this parser detects them so the UI can render clickable chips.
 *
 * Conservative by design — better to miss options than false-positive.
 */

export interface ParsedOption {
  /** Original marker, e.g. "1", "A", "a", "•" */
  marker: string;
  /** Short label for chip display (first part before description separator) */
  label: string;
  /** Full matched text */
  fullText: string;
}

/** Minimum options to qualify as a choice */
const MIN_OPTIONS = 2;
/** Maximum options — beyond this it's a list, not a choice */
const MAX_OPTIONS = 10;
/** Max label length for chip display */
const MAX_LABEL_LENGTH = 60;

/**
 * Extract short label from full option text.
 * Splits on common separators: " — ", " - ", ": "
 */
function extractLabel(text: string): string {
  // Split on description separators — take the first part
  const separators = [" — ", " – ", " - ", ": "];
  for (const sep of separators) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < text.length - sep.length) {
      const candidate = text.slice(0, idx).trim();
      if (candidate.length > 0 && candidate.length <= MAX_LABEL_LENGTH) {
        return candidate;
      }
    }
  }
  // No separator found — use full text, truncated
  const trimmed = text.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    return trimmed.slice(0, MAX_LABEL_LENGTH - 1) + "\u2026";
  }
  return trimmed;
}

/**
 * Check if matched items form a contiguous block in the original text.
 * All matches must be within a section with no more than 1 blank line between them.
 */
function isContiguousBlock(text: string, matches: RegExpMatchArray[]): boolean {
  if (matches.length < 2) return true;

  const lines = text.split("\n");
  const matchLineIndices: number[] = [];

  for (const match of matches) {
    const matchText = match[0].trim();
    const lineIdx = lines.findIndex((line) => line.trim() === matchText);
    if (lineIdx >= 0) {
      matchLineIndices.push(lineIdx);
    }
  }

  if (matchLineIndices.length < 2) return true;

  matchLineIndices.sort((a, b) => a - b);

  for (let i = 1; i < matchLineIndices.length; i++) {
    const gap = matchLineIndices[i] - matchLineIndices[i - 1];
    // Allow up to 2 lines gap (1 blank line between items)
    if (gap > 2) return false;
  }

  return true;
}

/**
 * Try to parse numbered options: "1. X", "1) X", "1 - X"
 */
function parseNumberedOptions(text: string): ParsedOption[] | null {
  const regex = /^\s*(\d+)\s*[.):\-]\s+(.+)$/gm;
  const matches: RegExpMatchArray[] = [];
  let match: RegExpMatchArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }

  if (matches.length < MIN_OPTIONS || matches.length > MAX_OPTIONS) return null;

  // Check consecutive numbering
  for (let i = 0; i < matches.length; i++) {
    const num = parseInt(matches[i][1], 10);
    const expectedStart = parseInt(matches[0][1], 10);
    if (num !== expectedStart + i) return null;
  }

  if (!isContiguousBlock(text, matches)) return null;

  return matches.map((m) => ({
    marker: m[1],
    label: extractLabel(m[2].trim()),
    fullText: m[2].trim(),
  }));
}

/**
 * Try to parse lettered options: "A. X", "a) X", "A - X"
 */
function parseLetteredOptions(text: string): ParsedOption[] | null {
  const regex = /^\s*([A-Za-z])\s*[.):\-]\s+(.+)$/gm;
  const matches: RegExpMatchArray[] = [];
  let match: RegExpMatchArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }

  if (matches.length < MIN_OPTIONS || matches.length > MAX_OPTIONS) return null;

  // Check consecutive lettering
  const firstCode = matches[0][1].toUpperCase().charCodeAt(0);
  for (let i = 0; i < matches.length; i++) {
    const code = matches[i][1].toUpperCase().charCodeAt(0);
    if (code !== firstCode + i) return null;
  }

  if (!isContiguousBlock(text, matches)) return null;

  return matches.map((m) => ({
    marker: m[1],
    label: extractLabel(m[2].trim()),
    fullText: m[2].trim(),
  }));
}

/**
 * Try to parse "Option N:" / "Choice N:" patterns
 */
function parsePrefixedOptions(text: string): ParsedOption[] | null {
  const regex = /^\s*(?:Option|Choice)\s+(\d+|[A-Za-z])\s*[.:\-]?\s*(.+)$/gim;
  const matches: RegExpMatchArray[] = [];
  let match: RegExpMatchArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }

  if (matches.length < MIN_OPTIONS || matches.length > MAX_OPTIONS) return null;
  if (!isContiguousBlock(text, matches)) return null;

  return matches.map((m) => ({
    marker: m[1],
    label: extractLabel(m[2].trim()),
    fullText: m[2].trim(),
  }));
}

/**
 * Try to parse bulleted options: "- X", "• X", "* X"
 */
function parseBulletedOptions(text: string): ParsedOption[] | null {
  const regex = /^\s*[\-\u2022*]\s+(.+)$/gm;
  const matches: RegExpMatchArray[] = [];
  let match: RegExpMatchArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }

  if (matches.length < MIN_OPTIONS || matches.length > MAX_OPTIONS) return null;
  if (!isContiguousBlock(text, matches)) return null;

  return matches.map((m, i) => ({
    marker: "\u2022",
    label: extractLabel(m[1].trim()),
    fullText: m[1].trim(),
  }));
}

/**
 * Parse options from AI response text.
 * Returns empty array if no valid option list is detected.
 *
 * Tries patterns in priority order (first match wins):
 * 1. Numbered: "1. X", "1) X"
 * 2. Lettered: "A. X", "a) X"
 * 3. Prefixed: "Option 1: X", "Choice A: X"
 * 4. Bulleted: "- X", "• X"
 */
export function parseOptionsFromText(text: string): ParsedOption[] {
  return (
    parseNumberedOptions(text) ??
    parseLetteredOptions(text) ??
    parsePrefixedOptions(text) ??
    parseBulletedOptions(text) ??
    []
  );
}

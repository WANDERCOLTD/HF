/**
 * parse-content-sources.ts (#1850 P3f)
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §"Per-module YAML settings blocks"
 *
 * Parse the `## Content Sources` section of a Course Reference document
 * into an index keyed by `(moduleRef, settingRef)`. The YAML blocks
 * extracted by `detect-module-settings.ts` reference content with
 * `source:<id>` strings (e.g. `cueCardPool: source:cue-card-bank-v1`);
 * this index lets `resolve-module-source-refs.ts` look up the disk path
 * + format for each referenced source.
 *
 * Source block format (v2.3 fixture):
 *
 *   ### Source 2 — Part 2 cue card bank
 *   ### Source 2a — Part 2 cue card bank (Mock)
 *   ### Source 2b — Part 2 cue card bank (Baseline)
 *
 *   A bank of Part 2 cue cards in the standard IELTS structure ...
 *
 *   - *location:* `docs/external/ielts/ielts-speaking/Upload Docs/...`
 *   - *format:* structured-md
 *   - *moduleRef:* part2
 *   - *settingRef:* moduleCueCardPool
 *
 * The header text ("Source 2 — Part 2 cue card bank") is preserved as a
 * debug breadcrumb. The `(moduleRef, settingRef)` pair is the lookup key
 * downstream consumers use — sources without both fields are kept in the
 * index but flagged as unresolvable.
 *
 * Field-name normalisation mirrors `detect-module-settings.ts`: the
 * doc's `moduleCueCardPool` settingRef strips the `module` prefix to
 * `cueCardPool` for matching against `AuthoredModuleSettings` keys.
 *
 * Issue #1850 P3f.
 */

// ── Public types ─────────────────────────────────────────────────────

export interface ContentSourceEntry {
  /** Debug breadcrumb — the `### Source N — Title` header text. */
  header: string;
  /** Absolute or repo-rooted file path (verbatim from the doc). */
  location?: string;
  /** Format tag — drives the parser dispatch in `resolve-module-source-refs.ts`. */
  format?: string;
  /** Module slug the source attaches to (verbatim from the doc). */
  moduleRef?: string;
  /**
   * Setting key the source feeds, normalised to the unprefixed form
   * (`moduleCueCardPool` → `cueCardPool`) so it matches
   * `AuthoredModuleSettings` keys directly.
   */
  settingRef?: string;
}

export interface ParsedContentSources {
  /**
   * Lookup index keyed by `${moduleRef}:${settingRef}` (e.g.
   * `"part2:cueCardPool"`). Multiple entries per key are allowed (the
   * resolver picks the first); duplicates are not flagged here.
   */
  byModuleAndSetting: Map<string, ContentSourceEntry>;
  /** Every parsed source, in source-doc order. */
  all: ContentSourceEntry[];
}

// ── Detection ────────────────────────────────────────────────────────

const SECTION_HEADER = /^##\s+Content\s+Sources\s*$/im;
/**
 * Matches `### Source N — Title` or `### Source Na — Title`. Captures the
 * full header text. The optional single lowercase letter suffix (e.g. `2a`,
 * `6b`, `7c`) lets a parent source split into related sub-sources that route
 * to different consumers — for example `Source 2a` (Mock cue card bank) and
 * `Source 2b` (Baseline cue card bank). Sibling numbering preserves the
 * semantic relationship that flat renumbering (Source 9 / 10 / 11) loses.
 */
const SOURCE_HEADER = /^###\s+(Source\s+\d+[a-z]?\s*[—–-].+)$/i;
/** Heading of any depth that ends a source block (excluding our own ### Source rows). */
const ANY_HEADING = /^#{1,6}\s/;

/**
 * Strip italic / bold markers + leading bullet so the line's
 * `key: value` shape is recoverable regardless of cosmetic wrappers.
 */
function stripMarkdownDecorators(s: string): string {
  return s
    .replace(/^\s*[-*]\s+/, "") // leading "- " bullet
    .replace(/^\s*\*+/, "") // leading "*" bold/italic
    .replace(/\*+\s*$/, "") // trailing "*"
    .replace(/`/g, "") // backticks around values
    .trim();
}

/** Strip the `module` prefix from a settingRef so it matches AuthoredModuleSettings keys. */
function stripModulePrefix(key: string): string {
  if (key.startsWith("module") && key.length > 6) {
    return key.charAt(6).toLowerCase() + key.slice(7);
  }
  return key;
}

/** Parse a single source's body lines into a `ContentSourceEntry`. */
function parseSourceBody(header: string, bodyLines: string[]): ContentSourceEntry {
  const entry: ContentSourceEntry = { header };
  for (const raw of bodyLines) {
    const line = stripMarkdownDecorators(raw);
    if (!line) continue;
    // Recognise `key: value` shape where key is one of our known fields.
    // The doc uses italic keys (`*location:*`), already stripped above.
    const m = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].replace(/^\s*[`*]?|[`*]?\s*$/g, "").trim();
    if (!value) continue;
    switch (key.toLowerCase()) {
      case "location":
        entry.location = value;
        break;
      case "format":
        entry.format = value;
        break;
      case "moduleref":
        entry.moduleRef = value;
        break;
      case "settingref":
        entry.settingRef = stripModulePrefix(value);
        break;
      default:
        // Unknown key — ignored (the doc carries Outcomes/Ordering/Notes too)
        break;
    }
  }
  return entry;
}

// ── Public entry point ───────────────────────────────────────────────

/**
 * Walk the course-ref body, find the `## Content Sources` section, then
 * iterate every `### Source N — Title` block within it and extract the
 * `location` / `format` / `moduleRef` / `settingRef` fields. Returns
 * an empty index when the section is missing — the resolver treats
 * absence as "no source-refs to inline".
 */
export function parseContentSources(bodyText: string): ParsedContentSources {
  const result: ParsedContentSources = {
    byModuleAndSetting: new Map(),
    all: [],
  };
  const lines = bodyText.split(/\r?\n/);

  // Locate the section header.
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADER.test(lines[i])) {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart < 0) return result;

  // Walk forward; the section ends at the next `## ` heading.
  let i = sectionStart;
  while (i < lines.length) {
    const line = lines[i];
    // End of section — another top-level `## ` heading (not `### Source N`).
    if (/^##\s/.test(line) && !/^###/.test(line)) break;

    const headerMatch = line.match(SOURCE_HEADER);
    if (!headerMatch) {
      i++;
      continue;
    }
    const header = headerMatch[1].trim();
    // Collect body lines until the next heading or end-of-section.
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (ANY_HEADING.test(next)) break;
      body.push(next);
      j++;
    }
    const entry = parseSourceBody(header, body);
    result.all.push(entry);
    if (entry.moduleRef && entry.settingRef) {
      const key = `${entry.moduleRef}:${entry.settingRef}`;
      // First-write-wins: the doc lists sources in canonical order.
      if (!result.byModuleAndSetting.has(key)) {
        result.byModuleAndSetting.set(key, entry);
      }
    }
    i = j;
  }
  return result;
}

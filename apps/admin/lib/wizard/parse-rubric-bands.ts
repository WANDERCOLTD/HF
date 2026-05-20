/**
 * parse-rubric-bands.ts
 *
 * Pure parser for COURSE_REFERENCE_ASSESSOR_RUBRIC markdown documents.
 * Extracts per-criterion Band 0–9 descriptor tables and returns them keyed
 * by RUB code (e.g. "FC", "LR", "GRA", "P" for IELTS Speaking). Used by
 * the rubric-only second projection pass to populate
 * `Parameter.config.bandThresholds` on skill parameters.
 *
 * Stays pure: no DB calls, no AI, no side effects. Composable with
 * `run-projection-for-playbook.ts::runProjectionForPlaybook`.
 *
 * Issue #564 (builds the implementation called out in #561).
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §4 Phase 2.5 — rubric-only pass
 */

const RUB_HEADING = /^##\s+RUB-([A-Za-z0-9]+)\s*:\s*(.+?)\s*$/;
const BAND_TABLE_ROW = /^\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(.+?)\s*\|\s*$/;
// Any other H2 heading ends the current rubric section.
const SECTION_BOUNDARY = /^##\s+/;

/** One per RUB-XX heading — `code` is the suffix tag, `bands` is band→text. */
export interface ParsedRubricCriterion {
  /** Lowercased rubric code, e.g. "fc", "lr", "gra", "p". */
  code: string;
  /** Original criterion name from the heading, for logs and warnings. */
  criterionName: string;
  /** Band number → descriptor text. Bands may be integers or decimals. */
  bands: Record<string, string>;
}

export interface ParseRubricBandsResult {
  criteria: ParsedRubricCriterion[];
  /**
   * Soft warnings emitted by the parser — e.g. a heading with no following
   * band table. Surfaced by the caller for log visibility; never thrown.
   */
  warnings: string[];
}

/**
 * Scan a rubric markdown body for `## RUB-XX: Criterion Name` headings
 * followed by `| Band | Descriptor |` tables. Returns one ParsedRubricCriterion
 * per heading.
 *
 * The function is forgiving:
 *   - extra prose lines between heading and table are skipped
 *   - the `| Band | Descriptor |` header row + alignment row are tolerated
 *   - a rubric section ending without a table is reported as a warning
 *     (rather than dropped silently)
 */
export function parseRubricBands(bodyText: string): ParseRubricBandsResult {
  const lines = bodyText.split(/\r?\n/);
  const criteria: ParsedRubricCriterion[] = [];
  const warnings: string[] = [];

  let current: ParsedRubricCriterion | null = null;

  const flush = () => {
    if (!current) return;
    if (Object.keys(current.bands).length === 0) {
      warnings.push(
        `RUB-${current.code.toUpperCase()} (${current.criterionName}) — no band rows parsed`,
      );
    } else {
      criteria.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const heading = RUB_HEADING.exec(line);
    if (heading) {
      flush();
      current = {
        code: heading[1].toLowerCase(),
        criterionName: heading[2].trim(),
        bands: {},
      };
      continue;
    }
    if (current && SECTION_BOUNDARY.test(line)) {
      flush();
      continue;
    }
    if (!current) continue;

    const row = BAND_TABLE_ROW.exec(line);
    if (!row) continue;
    const band = row[1];
    const descriptor = row[2].trim();
    // Skip alignment + header rows (e.g. `|-----|` or `| Band | Descriptor |`).
    if (/^[-:|\s]+$/.test(descriptor)) continue;
    if (/^Descriptor$/i.test(descriptor)) continue;
    if (descriptor.length < 5) continue;
    current.bands[band] = descriptor;
  }

  flush();
  return { criteria, warnings };
}

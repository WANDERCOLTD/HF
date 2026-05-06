/**
 * detect-authored-modules.ts
 *
 * Parse a Course Reference markdown body for an author-declared Module
 * Catalogue. Sibling to `detect-pedagogy.ts` — deterministic regex/markdown
 * parsing, no AI calls.
 *
 * Inputs come from Course Reference template v5.1+:
 *   1. A header declaration `**Modules authored:** Yes | No | Partial`
 *   2. A `## Modules` section containing a Module Catalogue table:
 *      | ID | Label | Learner-selectable | Mode | Duration | Scoring fired |
 *      | Voice band readout | Session-terminal | Frequency | Content source |
 *      | Outcomes (primary) |
 *
 * When `Modules authored: Yes` (or absent + a `## Modules` heading is
 * detected), the catalogue table rows are parsed into AuthoredModule[].
 * Per-field-defaults-with-warnings: missing optional fields fall back
 * to the catalogue's Module Defaults block (or template defaults), and
 * a ValidationWarning is emitted so production publish can block.
 *
 * When `Modules authored: No`, returns `{ modulesAuthored: false, modules: [] }`
 * and skips section parsing entirely — today's derived path runs unchanged.
 *
 * Issue #236.
 */

import type {
  AuthoredModule,
  AuthoredModuleFrequency,
  AuthoredModuleMode,
  ModuleDefaults,
  ValidationWarning,
} from "@/lib/types/json-fields";

// ── Public types ──────────────────────────────────────────────────────

export interface DetectedAuthoredModules {
  /**
   * - true  → header explicitly declared `Yes`, OR `## Modules` section heuristically detected
   * - false → header explicitly declared `No`
   * - null  → no signal at all (caller falls back to derived modules)
   */
  modulesAuthored: boolean | null;
  /** Empty when modulesAuthored !== true. */
  modules: AuthoredModule[];
  /** Defaults block parsed from the document; empty object when none present. */
  moduleDefaults: Partial<ModuleDefaults>;
  /**
   * Outcome statements parsed from `**OUT-NN: <statement>.**` bold headings.
   * Keyed by outcome ID. Empty object when no such headings present.
   * #258.
   */
  outcomes: Record<string, string>;
  /** Warnings + errors raised during parsing. Drives the publish gate. */
  validationWarnings: ValidationWarning[];
  /** Raw text snippets that triggered each detection — surfaced for debug. */
  detectedFrom: string[];
}

// ── Outcome statement extraction (#258) ──────────────────────────────
// Matches a line like `**OUT-01: Extends every answer to ... .**`. Tolerates
// trailing whitespace, optional trailing period, and outcome ID widths.
const OUTCOME_STATEMENT_LINE = /^\s*\*\*\s*(OUT-\d+)\s*:\s*([^*]+?)\s*\*\*\s*$/;

export function extractOutcomeStatements(bodyText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of bodyText.split(/\r?\n/)) {
    const m = line.match(OUTCOME_STATEMENT_LINE);
    if (!m) continue;
    const [, id, statement] = m;
    // Strip a single trailing period to keep the value tidy when re-rendered.
    const cleaned = statement.replace(/\.$/, "").trim();
    if (cleaned) out[id] = cleaned;
  }
  return out;
}

// ── Module ID validation ──────────────────────────────────────────────

const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_MODULE_ID_LENGTH = 32;

// ── Header declaration patterns ───────────────────────────────────────

const MODULES_AUTHORED_HEADER = /\*\*Modules authored:\*\*\s*(Yes|No|Partial)\b/i;

// ── Modules section detection ─────────────────────────────────────────

const MODULES_SECTION_HEADING = /^##\s+Modules\s*$/im;

// ── Field-name aliases (table headers may vary slightly) ──────────────

const COLUMN_ALIASES: Record<string, string> = {
  id: "id",
  label: "label",
  name: "label",
  "learner-selectable": "learnerSelectable",
  "learner selectable": "learnerSelectable",
  selectable: "learnerSelectable",
  mode: "mode",
  duration: "duration",
  "scoring fired": "scoringFired",
  scoring: "scoringFired",
  "voice band readout": "voiceBandReadout",
  "voice readout": "voiceBandReadout",
  "session-terminal": "sessionTerminal",
  "session terminal": "sessionTerminal",
  terminal: "sessionTerminal",
  frequency: "frequency",
  "content source": "contentSourceRef",
  "content sources": "contentSourceRef",
  source: "contentSourceRef",
  "outcomes (primary)": "outcomesPrimary",
  outcomes: "outcomesPrimary",
  "primary outcomes": "outcomesPrimary",
  prerequisites: "prerequisites",
  position: "position",
};

// ── Mode / frequency normalisation ────────────────────────────────────

function normaliseMode(raw: string): AuthoredModuleMode | null {
  const t = raw.toLowerCase().trim();
  if (t.startsWith("examiner")) return "examiner";
  if (t.startsWith("tutor")) return "tutor";
  if (t.startsWith("mixed")) return "mixed";
  return null;
}

function normaliseFrequency(raw: string): AuthoredModuleFrequency | null {
  const t = raw.toLowerCase().trim();
  if (t.startsWith("once")) return "once";
  if (t.startsWith("repeatable") || t.startsWith("repeat")) return "repeatable";
  if (t.startsWith("cooldown")) return "cooldown";
  return null;
}

function parseYesNo(raw: string): boolean | null {
  const t = raw.toLowerCase().trim();
  if (/^(yes|y|true)\b/.test(t)) return true;
  if (/^(no|n|false)\b/.test(t)) return false;
  return null;
}

/**
 * Pull OUT-XX tokens out of a free-form string. Also expands the catalogue's
 * short-form list "OUT-01, 02, 05" into ["OUT-01", "OUT-02", "OUT-05"] so the
 * machine-readable summary table can stay compact.
 */
function parseOutcomesList(raw: string): string[] {
  const out: string[] = [];
  // Walk the string token-by-token; once we see a fully-prefixed OUT-XX,
  // subsequent bare numerics within the same comma/space-separated run are
  // treated as additional outcomes (carrying the OUT- prefix forward).
  const tokens = raw.split(/[,;]/);
  let prefixSeen = false;
  for (const tok of tokens) {
    const t = tok.trim();
    const fullMatch = t.match(/OUT-(\d+)/i);
    if (fullMatch) {
      out.push(`OUT-${fullMatch[1].padStart(2, "0")}`);
      prefixSeen = true;
      continue;
    }
    if (prefixSeen) {
      const bareMatch = t.match(/^(\d+)\b/);
      if (bareMatch) {
        out.push(`OUT-${bareMatch[1].padStart(2, "0")}`);
      }
    }
  }
  return Array.from(new Set(out));
}

// ── Markdown table parsing ────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Parse the first GFM-style pipe table found inside `block`. Returns null
 * if no table is detected. Tolerates leading/trailing pipes and inconsistent
 * whitespace. Skips the header separator row (the one with `---`).
 */
function parseFirstPipeTable(block: string): ParsedTable | null {
  const lines = block.split(/\r?\n/);
  const tableLines: string[] = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") || (inTable && trimmed.includes("|"))) {
      tableLines.push(trimmed);
      inTable = true;
    } else if (inTable && trimmed === "") {
      // Blank line ends the table
      break;
    }
  }
  if (tableLines.length < 2) return null;

  const cells = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  };

  const headers = cells(tableLines[0]).map((h) => h.replace(/\*\*/g, "").trim());
  // Drop the separator row (---|---|...)
  const dataLines = tableLines.slice(1).filter((l) => !/^\s*\|?\s*[-:]+/.test(l.replace(/\|/g, " ")));
  const rows = dataLines.map(cells).filter((r) => r.some((c) => c.length > 0));
  return { headers, rows };
}

// ── Module Defaults block parsing ─────────────────────────────────────

const DEFAULT_FIELD_PATTERN = /\*\*Default\s+([a-z\s\-()/]+):?\*\*\s*([^\n]+)/gi;

function parseModuleDefaults(modulesSection: string): Partial<ModuleDefaults> {
  const out: Partial<ModuleDefaults> = {};
  // Locate the "### Module Defaults" subsection if present
  const defaultsHeader = /###\s+Module Defaults[^\n]*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i;
  const m = modulesSection.match(defaultsHeader);
  if (!m) return out;
  const block = m[1];

  let match: RegExpExecArray | null;
  while ((match = DEFAULT_FIELD_PATTERN.exec(block)) !== null) {
    const key = match[1].toLowerCase().trim();
    const value = match[2].trim().replace(/\s*\([^)]*\)\s*$/, ""); // strip trailing parens

    if (key.startsWith("mode")) {
      const mode = normaliseMode(value);
      if (mode) out.mode = mode;
    } else if (key.startsWith("correction style")) {
      const v = value.toLowerCase();
      if (v.includes("single") || v.includes("single-issue") || v.includes("single_issue"))
        out.correctionStyle = "single_issue_loop";
      else if (v.includes("freeform") || v.includes("free-form")) out.correctionStyle = "freeform";
      else if (v.includes("none")) out.correctionStyle = "none";
    } else if (key.startsWith("theory")) {
      const v = value.toLowerCase();
      if (v.includes("embedded") || v.includes("no standalone"))
        out.theoryDelivery = "embedded_only";
      else if (v.includes("standalone")) out.theoryDelivery = "standalone_permitted";
    } else if (key.startsWith("band visibility")) {
      const v = value.toLowerCase();
      if (v.includes("hidden")) out.bandVisibility = "hidden_mid_module";
      else if (v.includes("indicative")) out.bandVisibility = "indicative_only";
      else if (v.includes("full")) out.bandVisibility = "full";
    } else if (key.startsWith("intake")) {
      const v = value.toLowerCase();
      if (v.includes("none")) out.intake = "none";
      else if (v.includes("required")) out.intake = "required";
      else if (v.includes("skippable")) out.intake = "skippable";
    }
  }
  return out;
}

// ── Footer consistency check ──────────────────────────────────────────

const FOOTER_DECLARATION = /\*\*Modules authored:\*\*\s*(Yes|No|Partial)\b/gi;

function checkHeaderFooterConsistency(
  bodyText: string,
  warnings: ValidationWarning[],
): void {
  const matches = Array.from(bodyText.matchAll(FOOTER_DECLARATION));
  if (matches.length < 2) return;
  const values = matches.map((m) => m[1].toLowerCase());
  const unique = new Set(values);
  if (unique.size > 1) {
    warnings.push({
      code: "MODULES_AUTHORED_INCONSISTENT",
      message: `Document has conflicting "Modules authored" declarations: ${Array.from(unique).join(", ")}. Treating header value as authoritative.`,
      severity: "warning",
    });
  }
}

// ── Module Catalogue row → AuthoredModule ─────────────────────────────

function rowToModule(
  headers: string[],
  row: string[],
  defaults: Partial<ModuleDefaults>,
  warnings: ValidationWarning[],
): AuthoredModule | null {
  // Build a map of canonical-field → value
  const fields: Record<string, string> = {};
  for (let i = 0; i < headers.length && i < row.length; i++) {
    const headerKey = headers[i].toLowerCase().replace(/`/g, "").trim();
    const canonical = COLUMN_ALIASES[headerKey];
    if (canonical) fields[canonical] = row[i];
  }

  // ID — required, must match pattern; no fallback
  const rawId = (fields.id ?? "").replace(/[`*]/g, "").trim();
  if (!rawId) return null;
  if (!MODULE_ID_PATTERN.test(rawId) || rawId.length > MAX_MODULE_ID_LENGTH) {
    warnings.push({
      code: "MODULE_ID_INVALID",
      message: `Module ID "${rawId}" does not match required pattern /^[a-z][a-z0-9_]*$/ (max ${MAX_MODULE_ID_LENGTH} chars).`,
      path: `modules.${rawId}.id`,
      severity: "error",
    });
    return null;
  }

  // Label — required
  const label = (fields.label ?? "").trim();
  if (!label) {
    warnings.push({
      code: "MODULE_LABEL_MISSING",
      message: `Module "${rawId}" has no label.`,
      path: `modules.${rawId}.label`,
      severity: "error",
    });
    return null;
  }

  // learnerSelectable — default true; treat anything starting with "yes" or "true" as true
  const lsRaw = fields.learnerSelectable ?? "Yes";
  const learnerSelectable = parseYesNo(lsRaw) ?? true;

  // mode — required, fall back to defaults, then warn
  let mode = normaliseMode(fields.mode ?? "");
  if (!mode) {
    mode = defaults.mode ?? "tutor";
    warnings.push({
      code: "MODULE_FIELD_DEFAULTED",
      message: `Module "${rawId}" has no mode declared; defaulted to "${mode}".`,
      path: `modules.${rawId}.mode`,
      severity: "warning",
    });
  }

  // duration — free-form, warn if blank
  let duration = (fields.duration ?? "").trim();
  if (!duration) {
    duration = "Student-led";
    warnings.push({
      code: "MODULE_FIELD_DEFAULTED",
      message: `Module "${rawId}" has no duration; defaulted to "Student-led".`,
      path: `modules.${rawId}.duration`,
      severity: "warning",
    });
  }

  // scoringFired — free-form, warn if blank
  let scoringFired = (fields.scoringFired ?? "").trim();
  if (!scoringFired) {
    scoringFired = "All four criteria";
    warnings.push({
      code: "MODULE_FIELD_DEFAULTED",
      message: `Module "${rawId}" has no scoring declared; defaulted to "All four criteria".`,
      path: `modules.${rawId}.scoringFired`,
      severity: "warning",
    });
  }

  const voiceBandReadout = parseYesNo(fields.voiceBandReadout ?? "No") ?? false;
  const sessionTerminal = parseYesNo(fields.sessionTerminal ?? "No") ?? false;

  // frequency — required, fall back, warn
  let frequency = normaliseFrequency(fields.frequency ?? "");
  if (!frequency) {
    frequency = "repeatable";
    warnings.push({
      code: "MODULE_FIELD_DEFAULTED",
      message: `Module "${rawId}" has no frequency; defaulted to "repeatable".`,
      path: `modules.${rawId}.frequency`,
      severity: "warning",
    });
  }

  const contentSourceRef = (fields.contentSourceRef ?? "").trim() || undefined;
  if (learnerSelectable && !contentSourceRef) {
    warnings.push({
      code: "MODULE_FIELD_DEFAULTED",
      message: `Module "${rawId}" is learner-selectable but has no content source reference.`,
      path: `modules.${rawId}.contentSourceRef`,
      severity: "warning",
    });
  }

  const outcomesPrimary = parseOutcomesList(fields.outcomesPrimary ?? "");

  const prereqsRaw = (fields.prerequisites ?? "").trim();
  const prerequisites: string[] =
    !prereqsRaw || /^(none|n\/a|—|-|)$/i.test(prereqsRaw)
      ? []
      : prereqsRaw
          .split(/[,;]/)
          .map((s) => s.replace(/[`*]/g, "").trim())
          .filter(Boolean);

  const positionRaw = (fields.position ?? "").trim();
  const position = positionRaw ? parseInt(positionRaw, 10) : undefined;

  return {
    id: rawId,
    label,
    learnerSelectable,
    mode,
    duration,
    scoringFired,
    voiceBandReadout,
    sessionTerminal,
    frequency,
    contentSourceRef,
    outcomesPrimary,
    prerequisites,
    position: Number.isFinite(position as number) ? position : undefined,
  };
}

// ── Cross-module validation ───────────────────────────────────────────

function validateCrossReferences(
  modules: AuthoredModule[],
  warnings: ValidationWarning[],
): void {
  const ids = new Set(modules.map((m) => m.id));

  // Duplicate IDs
  const seen = new Set<string>();
  for (const m of modules) {
    if (seen.has(m.id)) {
      warnings.push({
        code: "MODULE_ID_DUPLICATE",
        message: `Module ID "${m.id}" appears more than once.`,
        path: `modules.${m.id}.id`,
        severity: "error",
      });
    }
    seen.add(m.id);
  }

  // Prerequisite references must point to existing modules
  for (const m of modules) {
    for (const p of m.prerequisites) {
      if (!ids.has(p)) {
        warnings.push({
          code: "MODULE_PREREQUISITE_UNKNOWN",
          message: `Module "${m.id}" lists prerequisite "${p}" which is not a sibling module ID.`,
          path: `modules.${m.id}.prerequisites`,
          severity: "error",
        });
      }
    }
  }
}

// ── Modules section extraction ────────────────────────────────────────

/**
 * Return the body of `## Modules` up to the next H2 (`## `) or end-of-doc.
 * Implemented as a manual slice rather than a single regex because JS does
 * not support `\Z` (end-of-input) — relying on a lookahead alone would
 * fail when the Modules section is the last in the document.
 */
function extractModulesSection(bodyText: string): string | null {
  const headingMatch = bodyText.match(/^##\s+Modules\s*$/im);
  if (!headingMatch || headingMatch.index === undefined) return null;
  const startOfBody = headingMatch.index + headingMatch[0].length;
  const after = bodyText.slice(startOfBody);
  const nextHeading = after.match(/^##\s+/m);
  const end = nextHeading && nextHeading.index !== undefined ? nextHeading.index : after.length;
  return after.slice(0, end);
}

/** Return the catalogue table block. We look for a "Module Catalogue" subheading
 *  if present; otherwise fall back to the first pipe table in the modules section. */
function extractCatalogueBlock(modulesSection: string): string | null {
  const subHeading = /###\s+Module Catalogue[^\n]*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i;
  const m = modulesSection.match(subHeading);
  if (m) return m[1];
  return modulesSection;
}

// ── Public entry point ───────────────────────────────────────────────

export function detectAuthoredModules(bodyText: string): DetectedAuthoredModules {
  const result: DetectedAuthoredModules = {
    modulesAuthored: null,
    modules: [],
    moduleDefaults: {},
    outcomes: {},
    validationWarnings: [],
    detectedFrom: [],
  };

  // ── 0. Outcome statements (#258) — runs unconditionally so we never lose
  // the data even when the modules-authored signal is missing or partial.
  result.outcomes = extractOutcomeStatements(bodyText);

  // ── 1. Header declaration
  const headerMatch = bodyText.match(MODULES_AUTHORED_HEADER);
  if (headerMatch) {
    const value = headerMatch[1].toLowerCase();
    if (value === "yes" || value === "partial") {
      result.modulesAuthored = true;
      result.detectedFrom.push(`header: "Modules authored: ${headerMatch[1]}"`);
    } else if (value === "no") {
      result.modulesAuthored = false;
      result.detectedFrom.push(`header: "Modules authored: No"`);
      // No is final — skip section parsing.
      checkHeaderFooterConsistency(bodyText, result.validationWarnings);
      return result;
    }
  }

  // ── 2. Heuristic: ## Modules section present with no header flag
  const sectionPresent = MODULES_SECTION_HEADING.test(bodyText);
  if (result.modulesAuthored === null && sectionPresent) {
    result.modulesAuthored = true;
    result.detectedFrom.push(`heuristic: "## Modules" section detected`);
  }

  if (!result.modulesAuthored) {
    // No header, no section → null result, derived path runs unchanged
    return result;
  }

  // ── 3. Extract section + catalogue + defaults
  const section = extractModulesSection(bodyText);
  if (!section) {
    result.validationWarnings.push({
      code: "MODULES_SECTION_MISSING",
      message: `"Modules authored: Yes" was declared but no "## Modules" section was found.`,
      severity: "error",
    });
    checkHeaderFooterConsistency(bodyText, result.validationWarnings);
    return result;
  }

  result.moduleDefaults = parseModuleDefaults(section);

  // ── 4. Parse the catalogue table
  const catalogueBlock = extractCatalogueBlock(section);
  if (!catalogueBlock) {
    result.validationWarnings.push({
      code: "MODULE_CATALOGUE_MISSING",
      message: `"## Modules" section has no Module Catalogue table.`,
      severity: "error",
    });
    checkHeaderFooterConsistency(bodyText, result.validationWarnings);
    return result;
  }

  const table = parseFirstPipeTable(catalogueBlock);
  if (!table || table.rows.length === 0) {
    result.validationWarnings.push({
      code: "MODULE_CATALOGUE_EMPTY",
      message: `Module Catalogue table is missing or has no rows.`,
      severity: "error",
    });
    checkHeaderFooterConsistency(bodyText, result.validationWarnings);
    return result;
  }

  for (const row of table.rows) {
    const mod = rowToModule(table.headers, row, result.moduleDefaults, result.validationWarnings);
    if (mod) result.modules.push(mod);
  }

  validateCrossReferences(result.modules, result.validationWarnings);
  checkHeaderFooterConsistency(bodyText, result.validationWarnings);

  result.detectedFrom.push(`parsed ${result.modules.length} module(s) from catalogue`);
  return result;
}

/** Convenience predicate for pipeline branches. */
export function hasAuthoredModules(d: DetectedAuthoredModules): boolean {
  return d.modulesAuthored === true && d.modules.length > 0;
}

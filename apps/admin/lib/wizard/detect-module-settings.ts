/**
 * detect-module-settings.ts
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §3
 * @canonical-doc docs/CONTENT-PIPELINE.md §4
 *
 * Parse a Course Reference markdown body for per-module YAML settings
 * blocks under headings shaped:
 *
 *   #### Module N — <Label> — Settings
 *
 *   ```yaml
 *   moduleId: <id>
 *   appliesTo: [exam, structured]
 *   settings:
 *     minSpeakingSec: 600
 *     questionTarget: { min: 5, target: 8 }
 *     closingLine: |
 *       That's the end ...
 *     scheduledCues:
 *       - { at: 45, text: "15 seconds left" }
 *   ```
 *
 * Sibling to `detect-authored-modules.ts` — deterministic markdown parser,
 * no AI calls. Output is a `Map<moduleId, Partial<AuthoredModuleSettings>>`
 * that the projector merges into each `AuthoredModule.settings` field.
 *
 * Field name normalisation:
 *   - The YAML uses a `module` prefix for clarity in the doc context
 *     (e.g. `moduleCueCardPool`, `moduleClosingLine`). The parser strips
 *     the prefix before emitting — emitted keys match the
 *     `AuthoredModuleSettings` interface (e.g. `cueCardPool`, `closingLine`).
 *   - Fields in the YAML that don't map to `AuthoredModuleSettings` are
 *     skipped with a warning. This includes `cueCardPool` /
 *     `scaffoldPool` / `profileFieldsToCapture` when their YAML value is
 *     a source-reference STRING (e.g. `source:cue-card-bank-v1`) — the
 *     schema expects fully-resolved pools, not source refs. The resolver
 *     for these references is a later projector stage (not this parser).
 *
 * The parser supports a bounded YAML subset — enough for the v2.3
 * template's block shape, no more. No external dependency.
 *
 * Issue #1850.
 */

import type {
  AuthoredModuleSettings,
  ScoreReadoutMode,
  ValidationWarning,
} from "@/lib/types/json-fields";
import { SCORE_READOUT_MODE_VALUES } from "@/lib/types/json-fields";

// ── Public types ─────────────────────────────────────────────────────

export interface DetectedModuleSettings {
  /** Per-module-id settings map. Empty when no blocks present. */
  byModuleId: Map<string, Partial<AuthoredModuleSettings>>;
  /** Warnings: malformed blocks, unknown fields, mismatched shapes. */
  validationWarnings: ValidationWarning[];
  /** Count of recognised YAML blocks parsed (regardless of field outcomes). */
  blockCount: number;
}

// ── Heading + block detection ────────────────────────────────────────

/**
 * Matches a per-module settings heading:
 *   "#### Module N — <Label> — Settings"
 *   "#### Module N - <Label> - Settings"
 *   "#### Module N – <Label> – Settings"
 *
 * Captures: the rest of the heading line, used only as a debug marker.
 * The `moduleId` mapping comes from the YAML body's top-level
 * `moduleId:` key, NOT the heading text — robust to author reordering.
 */
const SETTINGS_HEADING = /^####\s+Module\s+\d+\s*[—–-]\s+.+?\s*[—–-]\s+Settings\s*$/im;

/** Fenced YAML block opener / closer. */
const YAML_FENCE_OPEN = /^```ya?ml\s*$/i;
const YAML_FENCE_CLOSE = /^```\s*$/;

// ── Field-name normalisation ─────────────────────────────────────────

/**
 * The YAML doc form uses a `module` prefix for readability
 * (e.g. `moduleCueCardPool`). The `AuthoredModuleSettings` interface
 * uses the unprefixed form (`cueCardPool`). Strip-and-lowercase-first.
 */
function stripModulePrefix(key: string): string {
  if (key.startsWith("module") && key.length > 6) {
    return key.charAt(6).toLowerCase() + key.slice(7);
  }
  return key;
}

/** Fields that map cleanly into AuthoredModuleSettings. */
const KNOWN_FIELDS: ReadonlySet<keyof AuthoredModuleSettings> = new Set([
  "minSpeakingSec",
  "questionTarget",
  "closingLine",
  "firstTimeOrientationLine",
  "scheduledCues",
  // #2162 — typed in lib/types/json-fields.ts as ScoreReadoutMode.
  "scoreReadoutMode",
  // #1955 — Part-3 pin focus (boolean).
  "pinFocusArea",
  // #1956 — silent baseline-assessment variant (boolean).
  "silentMode",
  // #1954 — generate SessionLessonPlan on exam-module AGGREGATE (boolean).
  "generateLessonPlan",
  // Below: present in schema but YAML uses source-reference strings in v2.3,
  // not the resolved shape. Parser skips them with a warning so the resolver
  // stage (not yet wired) can pick them up from the raw markdown if needed.
  // "cueCardPool" → Array<{ topic; bullets }>, YAML is a `source:…` string
  // "scaffoldPool" → string[], YAML is a `source:…` string
  // "profileFieldsToCapture" → ProfileFieldToCapture[], YAML is string[]
]);

/** Fields known to live in the YAML but intentionally skipped (not in schema). */
const NON_SCHEMA_FIELDS: ReadonlySet<string> = new Set([
  "appliesTo",
  "prepSilenceSec",
  "incompleteThresholdSec",
  "scoringCriteria",
  // Source-ref shapes (string instead of resolved structured value):
  // `topicPool` joined this group after #1932 added it to the schema —
  // its YAML form is a `source:<id>` string, the resolver substitutes
  // the inlined `Array<{ topic, questions[] }>` in
  // `lib/wizard/resolve-module-source-refs.ts`.
  "cueCardPool",
  "scaffoldPool",
  "topicPool",
  "profileFieldsToCapture",
]);

// ── Minimal YAML subset parser ───────────────────────────────────────
//
// Supports:
//   key: <scalar>          (number / quoted-string / bareword)
//   key: { a: 1, b: "x" }  (inline object)
//   key: [a, b, c]         (inline array)
//   key: []                (empty list)
//   key: |                 (block literal, indented lines below until dedent)
//     ...
//   key:                   (followed by indented list)
//     - { a: 1, b: "x" }
//
// Limitations: no anchors, no multi-document streams, no block-mapping
// inside list items, no folded scalars (`>`). The v2.3 fixture stays
// within these limits by design.

/** Strip a YAML inline comment (everything from a `#` not inside quotes). */
function stripInlineComment(s: string): string {
  let out = "";
  let inS: false | '"' | "'" = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inS) {
      out += ch;
      if (ch === inS && s[i - 1] !== "\\") inS = false;
    } else {
      if (ch === '"' || ch === "'") {
        inS = ch;
        out += ch;
      } else if (ch === "#") {
        break;
      } else {
        out += ch;
      }
    }
  }
  return out.trimEnd();
}

/** Parse a scalar value: number, bool, null, quoted-string, or bareword. */
function parseScalar(raw: string): unknown {
  const t = stripInlineComment(raw).trim();
  if (!t) return "";
  if (t === "null" || t === "~") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  // Quoted strings
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  // Numbers (integer or float, no scientific notation needed here)
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  // Bareword (e.g. on-screen, end-of-module, source:cue-card-bank-v1)
  return t;
}

/**
 * Tokenise the body of an inline object/array (after the brackets are
 * stripped) on top-level commas — commas inside nested `{...}`/`[...]`
 * or string literals don't split.
 */
function splitTopLevelCommas(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inS: false | '"' | "'" = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inS) {
      if (ch === inS && body[i - 1] !== "\\") inS = false;
    } else if (ch === '"' || ch === "'") {
      inS = ch;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (start <= body.length) out.push(body.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Parse an inline `{ a: 1, b: "x" }` object. */
function parseInlineObject(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  const body = t.slice(1, -1).trim();
  if (!body) return {};
  const out: Record<string, unknown> = {};
  for (const pair of splitTopLevelCommas(body)) {
    const colonAt = pair.indexOf(":");
    if (colonAt < 0) return null;
    const key = pair.slice(0, colonAt).trim().replace(/^['"]|['"]$/g, "");
    const val = pair.slice(colonAt + 1).trim();
    out[key] = parseValue(val);
  }
  return out;
}

/** Parse an inline `[a, b, c]` array. */
function parseInlineArray(raw: string): unknown[] | null {
  const t = raw.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const body = t.slice(1, -1).trim();
  if (!body) return [];
  return splitTopLevelCommas(body).map((item) => parseValue(item));
}

/** Dispatch — inline-object, inline-array, or scalar. */
function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith("{")) {
    const obj = parseInlineObject(t);
    if (obj !== null) return obj;
  }
  if (t.startsWith("[")) {
    const arr = parseInlineArray(t);
    if (arr !== null) return arr;
  }
  return parseScalar(t);
}

/**
 * Parse a YAML block body (the text between the fences) into a
 * nested object. Returns `null` on a hard structural failure
 * (caller treats it as malformed-skip + warning).
 */
function parseYamlBlock(body: string): Record<string, unknown> | null {
  const lines = body.split(/\r?\n/);
  // Top-level keys live at column 0; the body of `settings:` lives at 2-space
  // indent. We walk line-by-line, tracking indent, and build a 2-level tree.
  const root: Record<string, unknown> = {};

  // Stack of containers; index 0 is `root`, index 1 is current child object.
  let currentChild: Record<string, unknown> | null = null;
  let pendingListKey: string | null = null;
  let pendingListTarget: Record<string, unknown> | null = null;
  let pendingList: unknown[] | null = null;
  let pendingBlockLiteralKey: string | null = null;
  let pendingBlockLiteralTarget: Record<string, unknown> | null = null;
  let pendingBlockLiteralLines: string[] = [];
  let pendingBlockLiteralBaseIndent = -1;

  const flushPendingList = (): void => {
    if (pendingListKey && pendingListTarget && pendingList) {
      pendingListTarget[pendingListKey] = pendingList;
    }
    pendingListKey = null;
    pendingListTarget = null;
    pendingList = null;
  };
  const flushPendingBlockLiteral = (): void => {
    if (pendingBlockLiteralKey && pendingBlockLiteralTarget) {
      pendingBlockLiteralTarget[pendingBlockLiteralKey] =
        pendingBlockLiteralLines.join("\n").trimEnd();
    }
    pendingBlockLiteralKey = null;
    pendingBlockLiteralTarget = null;
    pendingBlockLiteralLines = [];
    pendingBlockLiteralBaseIndent = -1;
  };

  for (const rawLine of lines) {
    // Block-literal lines come first — they bypass YAML key parsing.
    if (pendingBlockLiteralKey !== null) {
      const indent = rawLine.search(/\S|$/);
      const isBlankOrAtLeastIndented =
        rawLine.trim() === "" || indent >= pendingBlockLiteralBaseIndent;
      if (isBlankOrAtLeastIndented) {
        // Accumulate the line minus the base indent
        if (rawLine.trim() === "") {
          pendingBlockLiteralLines.push("");
        } else {
          pendingBlockLiteralLines.push(
            rawLine.slice(pendingBlockLiteralBaseIndent),
          );
        }
        continue;
      }
      // Dedent — close the literal and fall through to process this line
      flushPendingBlockLiteral();
    }

    const cleaned = stripInlineComment(rawLine);
    if (!cleaned.trim()) {
      // Blank line ends a pending list as well
      flushPendingList();
      continue;
    }

    const indent = cleaned.search(/\S|$/);
    const content = cleaned.slice(indent);

    // List item under a pending list-key
    if (pendingListKey !== null && content.startsWith("- ") && indent >= 2) {
      const item = content.slice(2).trim();
      if (pendingList) pendingList.push(parseValue(item));
      continue;
    }
    // We see a non-list line while a list was open → close the list.
    flushPendingList();

    // Top-level key (indent 0)
    if (indent === 0) {
      const colonAt = content.indexOf(":");
      if (colonAt < 0) return null;
      const key = content.slice(0, colonAt).trim();
      const rest = content.slice(colonAt + 1).trim();
      // Special: `settings:` opens a child object
      if (key === "settings" && rest === "") {
        currentChild = {};
        root.settings = currentChild;
        continue;
      }
      // Bare top-level scalar
      root[key] = parseValue(rest);
      currentChild = null;
      continue;
    }

    // Child key (indent 2)
    if (indent === 2 && currentChild) {
      const colonAt = content.indexOf(":");
      if (colonAt < 0) return null;
      const key = content.slice(0, colonAt).trim();
      const rest = content.slice(colonAt + 1).trim();

      // Block-literal opener: `key: |`
      if (rest === "|" || rest === "|-") {
        pendingBlockLiteralKey = key;
        pendingBlockLiteralTarget = currentChild;
        pendingBlockLiteralBaseIndent = indent + 2;
        pendingBlockLiteralLines = [];
        continue;
      }
      // List opener: `key:` (rest is empty, expect indented `- …` below)
      if (rest === "") {
        pendingListKey = key;
        pendingListTarget = currentChild;
        pendingList = [];
        continue;
      }
      currentChild[key] = parseValue(rest);
      continue;
    }
    // Unknown indent — non-fatal, just skip the line
  }

  flushPendingList();
  flushPendingBlockLiteral();

  return root;
}

// ── Field-shape validators ───────────────────────────────────────────

function isQuestionTarget(v: unknown): v is { min: number; target: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { min: unknown }).min === "number" &&
    typeof (v as { target: unknown }).target === "number"
  );
}

function isScheduledCueArray(
  v: unknown,
): v is Array<{ at: number; text: string }> {
  return (
    Array.isArray(v) &&
    v.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { at: unknown }).at === "number" &&
        typeof (item as { text: unknown }).text === "string",
    )
  );
}

// ── Public entry point ───────────────────────────────────────────────

/**
 * Walk the markdown body, locate every `#### Module N — <Label> — Settings`
 * heading + the YAML fence beneath it, parse each block, validate each
 * field against `AuthoredModuleSettings`, and emit a map keyed by the
 * YAML's `moduleId:` value (NOT the heading text).
 *
 * Robustness contract:
 *   - Missing blocks: silent — empty map.
 *   - Malformed block (parser fails / no `moduleId`): warning + skip.
 *   - Unknown field (in YAML, not in schema): warning + skip; other
 *     fields in the same block still emit.
 *   - Field-shape mismatch (e.g. `cueCardPool` is a string not an array):
 *     warning + skip; other fields in the same block still emit.
 *
 * The map values are `Partial<AuthoredModuleSettings>` — the projector
 * merges them into each module's existing `settings` field.
 */
export function detectModuleSettings(
  bodyText: string,
  detectedModuleIds: ReadonlyArray<string> = [],
): DetectedModuleSettings {
  const result: DetectedModuleSettings = {
    byModuleId: new Map(),
    validationWarnings: [],
    blockCount: 0,
  };

  const lines = bodyText.split(/\r?\n/);
  const knownModuleIds = new Set(detectedModuleIds);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!SETTINGS_HEADING.test(line)) {
      i++;
      continue;
    }
    // Found a settings heading — search for the next fenced YAML block
    // within ~10 lines (per template convention there's one blank line
    // between the heading and the fence).
    let fenceAt = -1;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      if (YAML_FENCE_OPEN.test(lines[j])) {
        fenceAt = j;
        break;
      }
      // If we hit another heading first, abandon this match
      if (/^#{1,4}\s/.test(lines[j])) break;
    }
    if (fenceAt < 0) {
      result.validationWarnings.push({
        code: "MODULE_SETTINGS_FENCE_MISSING",
        message: `Module settings heading at line ${i + 1} has no YAML fence beneath it.`,
        severity: "warning",
      });
      i++;
      continue;
    }
    // Collect the block body
    let closeAt = -1;
    for (let j = fenceAt + 1; j < lines.length; j++) {
      if (YAML_FENCE_CLOSE.test(lines[j])) {
        closeAt = j;
        break;
      }
    }
    if (closeAt < 0) {
      result.validationWarnings.push({
        code: "MODULE_SETTINGS_FENCE_UNCLOSED",
        message: `YAML fence opened at line ${fenceAt + 1} but never closes.`,
        severity: "warning",
      });
      i = fenceAt + 1;
      continue;
    }
    const body = lines.slice(fenceAt + 1, closeAt).join("\n");
    result.blockCount++;

    const parsed = parseYamlBlock(body);
    if (parsed === null) {
      result.validationWarnings.push({
        code: "MODULE_SETTINGS_YAML_INVALID",
        message: `YAML block at line ${fenceAt + 1} could not be parsed.`,
        severity: "warning",
      });
      i = closeAt + 1;
      continue;
    }
    const moduleId = parsed.moduleId;
    if (typeof moduleId !== "string" || !moduleId) {
      result.validationWarnings.push({
        code: "MODULE_SETTINGS_NO_MODULE_ID",
        message: `YAML block at line ${fenceAt + 1} has no top-level "moduleId:" key.`,
        severity: "warning",
      });
      i = closeAt + 1;
      continue;
    }
    if (knownModuleIds.size > 0 && !knownModuleIds.has(moduleId)) {
      result.validationWarnings.push({
        code: "MODULE_SETTINGS_UNKNOWN_MODULE",
        message: `YAML block at line ${fenceAt + 1} declares moduleId="${moduleId}" which is not in the detected module catalogue.`,
        severity: "warning",
        path: `modules.${moduleId}.settings`,
      });
      i = closeAt + 1;
      continue;
    }

    const settings = parsed.settings;
    if (
      !settings ||
      typeof settings !== "object" ||
      Array.isArray(settings)
    ) {
      result.validationWarnings.push({
        code: "MODULE_SETTINGS_NO_SETTINGS_KEY",
        message: `YAML block for moduleId="${moduleId}" has no nested "settings:" object.`,
        severity: "warning",
        path: `modules.${moduleId}.settings`,
      });
      i = closeAt + 1;
      continue;
    }

    const out: Partial<AuthoredModuleSettings> = {};
    for (const [rawKey, value] of Object.entries(
      settings as Record<string, unknown>,
    )) {
      const normalisedKey = stripModulePrefix(rawKey);

      // Non-schema fields → skip silently (these are intentionally NOT in
      // AuthoredModuleSettings — `appliesTo` is a courseStyle gate, not a
      // module setting; the *-Pool fields use source-ref strings; etc.).
      if (NON_SCHEMA_FIELDS.has(normalisedKey)) {
        // Quiet skip for known-non-schema. Warn only if we actually wanted
        // a structured form here — those skip with their shape-mismatch
        // warnings via the field-by-field validators below.
        continue;
      }

      if (!KNOWN_FIELDS.has(normalisedKey as keyof AuthoredModuleSettings)) {
        result.validationWarnings.push({
          code: "MODULE_SETTINGS_UNKNOWN_FIELD",
          message: `Unknown field "${rawKey}" in moduleId="${moduleId}" settings.`,
          severity: "warning",
          path: `modules.${moduleId}.settings.${rawKey}`,
        });
        continue;
      }

      // Per-field shape validation
      switch (normalisedKey as keyof AuthoredModuleSettings) {
        case "minSpeakingSec": {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects a number, got ${typeof value}.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          out.minSpeakingSec = value;
          break;
        }
        case "questionTarget": {
          if (!isQuestionTarget(value)) {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects { min: number; target: number }.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          out.questionTarget = value;
          break;
        }
        case "closingLine": {
          if (typeof value !== "string") {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects a string.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          out.closingLine = value;
          break;
        }
        case "firstTimeOrientationLine": {
          if (typeof value !== "string") {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects a string.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          out.firstTimeOrientationLine = value;
          break;
        }
        case "scheduledCues": {
          // Empty array is fine
          if (Array.isArray(value) && value.length === 0) {
            out.scheduledCues = [];
            break;
          }
          if (!isScheduledCueArray(value)) {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects Array<{ at: number; text: string }>.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          out.scheduledCues = value;
          break;
        }
        case "scoreReadoutMode": {
          // #2162 — validate against the typed ScoreReadoutMode union.
          if (
            typeof value !== "string" ||
            !(SCORE_READOUT_MODE_VALUES as readonly string[]).includes(value)
          ) {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects one of ${SCORE_READOUT_MODE_VALUES.join(" | ")}, got ${JSON.stringify(value)}.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          out.scoreReadoutMode = value as ScoreReadoutMode;
          break;
        }
        case "pinFocusArea":
        case "silentMode":
        case "generateLessonPlan": {
          // Three booleans added on main (#1954 / #1955 / #1956). Same
          // shape — validate, assign to the same key.
          if (typeof value !== "boolean") {
            result.validationWarnings.push({
              code: "MODULE_SETTINGS_TYPE_MISMATCH",
              message: `Field "${rawKey}" in moduleId="${moduleId}" expects boolean, got ${JSON.stringify(value)}.`,
              severity: "warning",
              path: `modules.${moduleId}.settings.${rawKey}`,
            });
            break;
          }
          (out as Record<string, unknown>)[rawKey] = value;
          break;
        }
        default: {
          // Unreachable — KNOWN_FIELDS gates the entry above
          break;
        }
      }
    }

    if (Object.keys(out).length > 0) {
      result.byModuleId.set(moduleId, out);
    }

    i = closeAt + 1;
  }

  return result;
}

/**
 * resolve-module-source-refs.ts (#1850 P3f)
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §"Per-module YAML settings blocks"
 *
 * P3e (`detect-module-settings.ts`) parses per-module YAML blocks from a
 * course-ref body and emits a `Map<moduleId, Partial<AuthoredModuleSettings>>`.
 * It intentionally SKIPS three fields whose YAML values are source-ref
 * strings (`source:<id>`) instead of resolved structured values:
 *   - `cueCardPool`               (e.g. `source:cue-card-bank-v1`)
 *   - `scaffoldPool`              (e.g. `source:stall-scaffolds-monologue`)
 *   - `profileFieldsToCapture`    (e.g. `[reason, targetBand, …]` shortform —
 *      not a source-ref today; deferred to P3g, see below)
 *
 * This module IS the resolver stage. Given the per-module YAML output
 * (as it would appear pre-skip — the caller re-parses raw YAML and
 * keeps the `source:*` strings), the course-ref body (for the
 * `## Content Sources` index), and a file reader, it:
 *
 *   1. Builds the content-sources index via `parseContentSources`.
 *   2. For each module's `(moduleId, field)` pair, looks up the
 *      matching content-source entry (`moduleRef === moduleId`,
 *      `settingRef === field`).
 *   3. Reads the file at `entry.location`, parses it per `entry.format`,
 *      and substitutes the resolved structured value back into the
 *      settings object.
 *
 * Resilient on every failure path:
 *   - Missing content-source entry → leave the field unset + warn.
 *   - Missing file → leave the field unset + warn.
 *   - Unknown format → leave the field unset + warn.
 *   - Empty parse result → leave the field unset + warn (no empty arrays).
 *
 * Pure (no Prisma, no network); injectable file reader for tests.
 *
 * The `profileFieldsToCapture` field is intentionally NOT resolved here
 * — the v2.3 fixture supplies it as an inline shortlist
 * (`[reason, targetBand, timeline, selfLevel]`) without per-key prompt
 * + type metadata, and the source file doesn't exist on disk yet. P3g
 * will introduce a profile-fields-source markdown convention and the
 * matching parser. The resolver leaves the field unset on this PR.
 *
 * Issue #1850 P3f.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type {
  AuthoredModuleSettings,
  ValidationWarning,
} from "@/lib/types/json-fields";
import {
  parseContentSources,
  type ContentSourceEntry,
} from "./parse-content-sources";
import {
  parseCueCardBank,
  parseStallScaffolds,
  parseTopicPool,
} from "./parse-source-content";

// ── YAML-block source-ref extractor ──────────────────────────────────
//
// P3e (`detect-module-settings.ts`) strips source-ref strings out of its
// emit (they fail the field shape validators). We need them. Rather
// than weaken P3e's invariants, the resolver re-walks the body
// independently and harvests source-ref values per (moduleId, field).
//
// The regex pair below mirrors P3e's heading + fence detection
// verbatim — keep them in sync if P3e's surface changes.

const SETTINGS_HEADING_LINE = /^####\s+Module\s+\d+\s*[—–-]\s+.+?\s*[—–-]\s+Settings\s*$/i;
const FENCE_OPEN = /^```ya?ml\s*$/i;
const FENCE_CLOSE = /^```\s*$/;
const MODULE_ID_LINE = /^moduleId:\s*([A-Za-z0-9_-]+)\s*$/;
/**
 * Captures `  fieldName: source:value` at 2-space indent inside the
 * `settings:` body. `fieldName` is captured raw — we strip the optional
 * `module` prefix downstream to match `AuthoredModuleSettings` keys.
 */
const SOURCE_REF_LINE = /^\s\s([A-Za-z][A-Za-z0-9]*)\s*:\s*(source:[A-Za-z0-9_-]+)\s*(?:#.*)?$/;

function stripModulePrefix(key: string): string {
  if (key.startsWith("module") && key.length > 6) {
    return key.charAt(6).toLowerCase() + key.slice(7);
  }
  return key;
}

/**
 * Walk every per-module YAML block in `bodyText` and return a map of
 * `moduleId → { fieldName → sourceRefString }`. Only fields whose value
 * is a `source:<id>` string are captured — every other shape is left
 * for P3e to handle.
 *
 * Exported for unit tests.
 */
export function extractSourceRefsFromYamlBlocks(
  bodyText: string,
): Map<string, Map<keyof AuthoredModuleSettings, string>> {
  const lines = bodyText.split(/\r?\n/);
  const out = new Map<string, Map<keyof AuthoredModuleSettings, string>>();
  let i = 0;
  while (i < lines.length) {
    if (!SETTINGS_HEADING_LINE.test(lines[i])) {
      i++;
      continue;
    }
    // Find the next yaml fence within 12 lines (per P3e convention).
    let fenceAt = -1;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      if (FENCE_OPEN.test(lines[j])) {
        fenceAt = j;
        break;
      }
      if (/^#{1,4}\s/.test(lines[j])) break;
    }
    if (fenceAt < 0) {
      i++;
      continue;
    }
    let closeAt = -1;
    for (let j = fenceAt + 1; j < lines.length; j++) {
      if (FENCE_CLOSE.test(lines[j])) {
        closeAt = j;
        break;
      }
    }
    if (closeAt < 0) break;

    // Scan the block body for `moduleId:` + `  field: source:…` lines.
    let moduleId = "";
    const refs: Array<[keyof AuthoredModuleSettings, string]> = [];
    for (let k = fenceAt + 1; k < closeAt; k++) {
      const raw = lines[k];
      const idMatch = raw.match(MODULE_ID_LINE);
      if (idMatch) {
        moduleId = idMatch[1];
        continue;
      }
      const srcMatch = raw.match(SOURCE_REF_LINE);
      if (srcMatch) {
        const field = stripModulePrefix(srcMatch[1]) as keyof AuthoredModuleSettings;
        refs.push([field, srcMatch[2]]);
      }
    }
    if (moduleId && refs.length > 0) {
      const map = out.get(moduleId) ?? new Map<keyof AuthoredModuleSettings, string>();
      for (const [k, v] of refs) map.set(k, v);
      out.set(moduleId, map);
    }
    i = closeAt + 1;
  }
  return out;
}

// ── Public types ─────────────────────────────────────────────────────

/** Field names this resolver knows how to inline. */
const RESOLVABLE_FIELDS = new Set<keyof AuthoredModuleSettings>([
  "cueCardPool",
  "scaffoldPool",
  // #1932 (epic #1931 Template Authority) — Part 1 / Part 3 question
  // banks. Source format `topic-pool` (Part 1 `## Frame N — Topic`
  // shape) OR `theme-pool` (Part 3 `## Theme: X / ### Set N` shape).
  // Both formats normalise to `Array<{ topic, questions[] }>` via
  // `parseTopicPool` in `parse-source-content.ts`.
  "topicPool",
]);

/** Injectable file reader so the resolver is unit-testable without disk. */
export interface SourceFileReader {
  exists(absolutePath: string): boolean;
  read(absolutePath: string): string;
}

const DEFAULT_READER: SourceFileReader = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, "utf-8"),
};

export interface ResolveOptions {
  /** Repo-root path used to resolve relative source `location` values. */
  repoRoot: string;
  /** Injectable file reader (default: node:fs). */
  reader?: SourceFileReader;
}

export interface ResolveModuleSourceRefsResult {
  /** Updated per-module settings map with source-refs inlined where possible. */
  byModuleId: Map<string, Partial<AuthoredModuleSettings>>;
  /** Warnings — one per failed resolution; surfaced into the parser warning bag. */
  validationWarnings: ValidationWarning[];
  /**
   * Per-resolution log: which `(moduleId, field)` resolved to which source +
   * the resulting array length. Useful in the backfill script output.
   */
  resolutions: Array<{
    moduleId: string;
    field: keyof AuthoredModuleSettings;
    sourceHeader?: string;
    location?: string;
    format?: string;
    itemCount: number;
    status: "resolved" | "skipped";
    reason?: string;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** True when a setting value is the `source:<id>` string-form (P3e's known skip). */
function isSourceRefString(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("source:");
}

function pushSkip(
  result: ResolveModuleSourceRefsResult,
  moduleId: string,
  field: keyof AuthoredModuleSettings,
  reason: string,
  entry?: ContentSourceEntry,
): void {
  result.validationWarnings.push({
    code: "MODULE_SOURCE_REF_UNRESOLVED",
    message: `Module "${moduleId}" field "${field}" — ${reason}.`,
    severity: "warning",
    path: `modules.${moduleId}.settings.${field}`,
  });
  result.resolutions.push({
    moduleId,
    field,
    sourceHeader: entry?.header,
    location: entry?.location,
    format: entry?.format,
    itemCount: 0,
    status: "skipped",
    reason,
  });
}

function parseByFormat(
  format: string,
  fileText: string,
  field: keyof AuthoredModuleSettings,
): { ok: true; value: unknown; itemCount: number } | { ok: false; reason: string } {
  const normalisedFormat = format.toLowerCase().trim();
  if (field === "cueCardPool") {
    if (normalisedFormat !== "structured-md") {
      return { ok: false, reason: `unexpected format "${format}" for cueCardPool` };
    }
    const cards = parseCueCardBank(fileText);
    if (cards.length === 0) {
      return { ok: false, reason: "cue-card parser produced 0 cards" };
    }
    return { ok: true, value: cards, itemCount: cards.length };
  }
  if (field === "scaffoldPool") {
    if (normalisedFormat !== "structured-md") {
      return { ok: false, reason: `unexpected format "${format}" for scaffoldPool` };
    }
    const items = parseStallScaffolds(fileText);
    if (items.length === 0) {
      return { ok: false, reason: "stall-scaffold parser produced 0 items" };
    }
    return { ok: true, value: items, itemCount: items.length };
  }
  if (field === "topicPool") {
    // Accept "topic-pool" (Part 1 `## Frame N — Topic`) AND "theme-pool"
    // (Part 3 `## Theme: X / ### Set N — Title`). Both formats normalise
    // to `Array<{ topic, questions[] }>` inside `parseTopicPool`.
    if (normalisedFormat !== "topic-pool" && normalisedFormat !== "theme-pool") {
      return { ok: false, reason: `unexpected format "${format}" for topicPool` };
    }
    const topics = parseTopicPool(fileText);
    if (topics.length === 0) {
      return { ok: false, reason: "topic-pool parser produced 0 topics" };
    }
    return { ok: true, value: topics, itemCount: topics.length };
  }
  return { ok: false, reason: `no parser registered for field "${field}"` };
}

// ── Public entry point ───────────────────────────────────────────────

/**
 * Resolve `source:<id>` references inside per-module YAML blocks into
 * fully-inlined structured values, merged into `byModuleId`.
 *
 * Reads the course-ref body twice:
 *   1. To find `source:*` strings (these don't survive P3e's emit).
 *   2. To build the `## Content Sources` lookup index.
 *
 * `byModuleId` is consumed AND mutated; the same Map is returned for
 * caller convenience. On successful resolution the field is SET (added
 * if missing, or overwritten — P3e never emits a competing value); on
 * failure the field is left UNTOUCHED (so the schema-shape contract
 * holds), a warning is pushed, and the resolution row carries the
 * skip reason.
 */
export function resolveModuleSourceRefs(
  byModuleId: Map<string, Partial<AuthoredModuleSettings>>,
  courseRefBodyText: string,
  options: ResolveOptions,
): ResolveModuleSourceRefsResult {
  const reader = options.reader ?? DEFAULT_READER;
  const result: ResolveModuleSourceRefsResult = {
    byModuleId,
    validationWarnings: [],
    resolutions: [],
  };

  const sources = parseContentSources(courseRefBodyText);
  const sourceRefsByModule = extractSourceRefsFromYamlBlocks(courseRefBodyText);

  for (const [moduleId, fieldRefs] of sourceRefsByModule) {
    for (const [field, sourceRefValue] of fieldRefs) {
      if (!RESOLVABLE_FIELDS.has(field)) {
        // Field exists in YAML but isn't one we know how to inline
        // — leave it for a future resolver pass.
        continue;
      }
      // Affirm the value-shape is what we expect (defensive — the
      // walker already filtered, but isSourceRefString is the
      // canonical guard).
      if (!isSourceRefString(sourceRefValue)) continue;

      const key = `${moduleId}:${field}`;
      const entry = sources.byModuleAndSetting.get(key);
      const settings = byModuleId.get(moduleId) ?? {};
      // Lazily insert the module entry if P3e didn't emit one (a
      // settings block where every captured field was a source-ref).
      if (!byModuleId.has(moduleId)) byModuleId.set(moduleId, settings);

      if (!entry) {
        pushSkip(
          result,
          moduleId,
          field,
          `no Content Sources entry for (${moduleId}, ${field})`,
        );
        continue;
      }
      if (!entry.location || !entry.format) {
        pushSkip(
          result,
          moduleId,
          field,
          `Content Sources entry "${entry.header}" missing location or format`,
          entry,
        );
        continue;
      }

      const absolutePath = resolvePath(options.repoRoot, entry.location);
      if (!reader.exists(absolutePath)) {
        pushSkip(
          result,
          moduleId,
          field,
          `source file not found at ${entry.location}`,
          entry,
        );
        continue;
      }

      let fileText = "";
      try {
        fileText = reader.read(absolutePath);
      } catch (err) {
        pushSkip(
          result,
          moduleId,
          field,
          `read error: ${(err as Error).message}`,
          entry,
        );
        continue;
      }

      const parsed = parseByFormat(entry.format, fileText, field);
      if (!parsed.ok) {
        pushSkip(result, moduleId, field, parsed.reason, entry);
        continue;
      }

      // Success — inline the value.
      (settings as Record<string, unknown>)[field] = parsed.value;
      result.resolutions.push({
        moduleId,
        field,
        sourceHeader: entry.header,
        location: entry.location,
        format: entry.format,
        itemCount: parsed.itemCount,
        status: "resolved",
      });
    }
  }

  return result;
}

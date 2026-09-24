/**
 * Soft source-ref → ContentSource Coverage — Lattice 5th-pillar gate.
 *
 * **What this test pins (PR-time mirror of the DB Query 14 gate):**
 *  Every soft source-reference declared in a published course-reference
 *  fixture MUST resolve to a content source the fixture itself
 *  declares. Two ref shapes are walked per module:
 *
 *    1. **YAML-block refs** (per `lib/wizard/resolve-module-source-refs.ts`
 *       — fields `cueCardPool`, `topicPool`, `scaffoldPool`,
 *       `profileFieldsToCapture`) — values of shape `source:<slug>`.
 *       Each MUST appear as a `### Source N — …` entry in the fixture's
 *       `## Content Sources` index whose `moduleRef` + `settingRef`
 *       match the consuming module + field.
 *    2. **Catalogue contentSourceRef** (top-level on `AuthoredModule`,
 *       parsed from the "Content source" column of the catalogue table)
 *       — free-form labels like "Source 4 — Baseline topic pool". MUST
 *       appear as a `### Source N — …` header somewhere in the fixture's
 *       `## Content Sources` section. Substring match on the header text
 *       so authors can use the short-form label.
 *
 *  This is the build-time mirror of the DB-side Query 14 in
 *  `apps/admin/scripts/check-fk-consistency.ts` (Playbook.config-level
 *  refs against `ContentSource` rows). Both layers together close the
 *  soft-FK gap. PR-time catches authoring drift in fixtures BEFORE the
 *  wizard projects them into a Playbook. DB-time catches the post-
 *  projection drift on hosted DBs.
 *
 *  Catches the producer-only failure mode where a module declares
 *  `cueCardPool: source:foo-v1` (or `contentSourceRef: "Source 4 — …"`)
 *  but no matching content-source entry exists in the same fixture.
 *  At runtime `selectPinnedCardForModule` / `resolveModuleSourceRefs`
 *  silently return null; the learner gets an empty shell with no
 *  operator-visible signal.
 *
 *  Mirrors the shape of `tests/lib/sim-chat/mode-ui-coverage.test.ts`
 *  (PR #2144): enumerate → classify → exempt-with-reason → ratchet.
 *
 *  See `.claude/rules/source-ref-coverage.md` for the durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────
// Fixtures walked — every published-state course-reference fixture.
// New fixtures (course-reference-*-v*.md) are auto-discovered.
// ────────────────────────────────────────────────────────────

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = join(
  REPO_ADMIN,
  "lib",
  "wizard",
  "__tests__",
  "fixtures",
);

/**
 * Discover every course-reference fixture file. Files prefixed
 * `course-reference-` and ending `.md` are treated as course-ref fixtures.
 * Each fixture must carry a `## Content Sources` section to be walked.
 */
function discoverFixtures(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(FIXTURE_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.startsWith("course-reference-") && n.endsWith(".md"))
    .map((n) => join(FIXTURE_DIR, n))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

const FIXTURES = discoverFixtures();

// ────────────────────────────────────────────────────────────
// Canonical resolvable fields — kept in sync with
// `lib/wizard/resolve-module-source-refs.ts::RESOLVABLE_FIELDS`.
// The test asserts the constants match at runtime so a refactor that
// adds/removes a field forces a same-PR matrix update.
// ────────────────────────────────────────────────────────────

const RESOLVABLE_FIELD_NAMES = [
  "cueCardPool",
  "scaffoldPool",
  "topicPool",
  "profileFieldsToCapture",
] as const;
type ResolvableField = (typeof RESOLVABLE_FIELD_NAMES)[number];

// ────────────────────────────────────────────────────────────
// Lightweight fixture parsers — duplicated minimally rather than
// imported from the wizard codebase to keep this gate readable and to
// avoid a hard coupling on the resolver (if the resolver changes its
// regex, the gate should fire AND surface the divergence rather than
// silently follow).
// ────────────────────────────────────────────────────────────

const SETTINGS_HEADING_LINE = /^####\s+Module\s+\d+\s*[—–-]\s+.+?\s*[—–-]\s+Settings\s*$/i;
const FENCE_OPEN = /^```ya?ml\s*$/i;
const FENCE_CLOSE = /^```\s*$/;
const MODULE_ID_LINE = /^moduleId:\s*([A-Za-z0-9_-]+)\s*$/;
const SOURCE_REF_LINE =
  /^\s\s([A-Za-z][A-Za-z0-9]*)\s*:\s*(source:[A-Za-z0-9_-]+)\s*(?:#.*)?$/;

interface YamlBlockRef {
  moduleId: string;
  field: string;
  rawValue: string; // e.g. "source:cue-card-bank-v1"
  slug: string; // e.g. "cue-card-bank-v1"
}

function extractYamlBlockRefs(bodyText: string): YamlBlockRef[] {
  const lines = bodyText.split(/\r?\n/);
  const out: YamlBlockRef[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!SETTINGS_HEADING_LINE.test(lines[i])) {
      i++;
      continue;
    }
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
    let moduleId = "";
    for (let k = fenceAt + 1; k < closeAt; k++) {
      const idMatch = lines[k].match(MODULE_ID_LINE);
      if (idMatch) {
        moduleId = idMatch[1];
        break;
      }
    }
    if (moduleId) {
      for (let k = fenceAt + 1; k < closeAt; k++) {
        const m = lines[k].match(SOURCE_REF_LINE);
        if (!m) continue;
        const rawField = m[1];
        // Strip the `module` prefix to match AuthoredModuleSettings keys
        // (mirrors `stripModulePrefix` in `resolve-module-source-refs.ts`).
        const field =
          rawField.startsWith("module") && rawField.length > 6
            ? rawField.charAt(6).toLowerCase() + rawField.slice(7)
            : rawField;
        out.push({
          moduleId,
          field,
          rawValue: m[2],
          slug: m[2].slice("source:".length),
        });
      }
    }
    i = closeAt + 1;
  }
  return out;
}

/**
 * Parse `## Content Sources` into an index of `(moduleRef, settingRef) → header`.
 * Also returns the flat set of `### Source N — …` headers for free-form
 * `contentSourceRef` label matching.
 */
interface ContentSourcesIndex {
  byModuleAndSetting: Map<string, { header: string; format?: string }>;
  allHeaders: string[];
}

function stripDecorators(s: string): string {
  return s
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\*+/, "")
    .replace(/\*+\s*$/, "")
    .replace(/`/g, "")
    .trim();
}

function stripModulePrefix(k: string): string {
  return k.startsWith("module") && k.length > 6
    ? k.charAt(6).toLowerCase() + k.slice(7)
    : k;
}

function parseContentSourcesIndex(bodyText: string): ContentSourcesIndex {
  const out: ContentSourcesIndex = {
    byModuleAndSetting: new Map(),
    allHeaders: [],
  };
  const lines = bodyText.split(/\r?\n/);
  let inSection = false;
  let cur: { header: string; moduleRef?: string; settingRef?: string; format?: string } | null = null;
  const flush = () => {
    if (!cur) return;
    out.allHeaders.push(cur.header);
    if (cur.moduleRef && cur.settingRef) {
      const settingKey = stripModulePrefix(cur.settingRef);
      out.byModuleAndSetting.set(`${cur.moduleRef}:${settingKey}`, {
        header: cur.header,
        format: cur.format,
      });
    }
    cur = null;
  };
  for (const raw of lines) {
    if (/^##\s+Content\s+Sources\s*$/i.test(raw)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^##\s/.test(raw) && !/^###\s/.test(raw)) {
      flush();
      inSection = false;
      continue;
    }
    const srcM = raw.match(/^###\s+(Source\s+\d+[a-z]?\s*[—–-].+)$/i);
    if (srcM) {
      flush();
      cur = { header: srcM[1].trim() };
      continue;
    }
    if (!cur) continue;
    const line = stripDecorators(raw);
    const kv = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].replace(/^\s*[`*]?|[`*]?\s*$/g, "").trim();
    if (!value) continue;
    if (key === "moduleref") cur.moduleRef = value;
    else if (key === "settingref") cur.settingRef = value;
    else if (key === "format") cur.format = value;
  }
  flush();
  return out;
}

/**
 * Parse the catalogue table (machine-readable summary). Returns an array
 * of `{moduleId, contentSourceRef}` pairs for every learner-selectable
 * module. Header column index for "Content source" is auto-detected.
 */
interface CatalogueRow {
  moduleId: string;
  contentSourceRef: string;
}

function parseCatalogueRows(bodyText: string): CatalogueRow[] {
  const lines = bodyText.split(/\r?\n/);
  const out: CatalogueRow[] = [];
  let headerIdx = -1;
  let idCol = -1;
  let refCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // Header row detection
    if (headerIdx < 0) {
      const lower = cells.map((c) => c.toLowerCase());
      const idIdx = lower.findIndex((c) => c === "id");
      const refIdx = lower.findIndex(
        (c) => c === "content source" || c === "content sources" || c === "source",
      );
      if (idIdx > 0 && refIdx > 0) {
        headerIdx = i;
        idCol = idIdx;
        refCol = refIdx;
      }
      continue;
    }
    // Skip the markdown separator row `| --- | --- |`.
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
    const moduleId = (cells[idCol] ?? "").replace(/`/g, "").trim();
    const refRaw = (cells[refCol] ?? "").trim();
    if (!moduleId || !refRaw) continue;
    if (moduleId === "ID") continue;
    out.push({ moduleId, contentSourceRef: refRaw });
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Exempt list — (fixture, moduleId, field, value) cells where a missing
// content-source entry is intentional. Required: one-line reason >20 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

type ExemptKey = string; // `${fixtureBasename}:${moduleId}:${field}:${rawValue}`

const SOURCE_REF_EXEMPT: Record<ExemptKey, ExemptEntry> = {
  // No incumbent exemptions at land-time. Future fixtures may exempt
  // (e.g., a course-ref that legitimately references an external library
  // resolved at projection time rather than via the in-fixture index).
};

/** Ratchet — only goes DOWN as gaps close. Calibrated to incumbent
 *  count from the first RED test run.
 *
 *  Today's incumbent (2026-06-20, this PR): **0 gaps**.
 *
 *  Both v2.2 and v2.3 IELTS fixtures land with every soft source-ref
 *  resolving — module YAML refs match `### Source N — …` entries via
 *  `(moduleRef, settingRef)` lookup, and catalogue `contentSourceRef`
 *  labels match by `Source N` token (the structural invariant — the
 *  label and the header title may differ in wording).
 *
 *  The DB-side gaps (5 IELTS modules on hf_sandbox declaring
 *  `contentSourceRef: "Source N — …"` against zero matching
 *  `ContentSource` rows) are caught by `apps/admin/scripts/check-fk-
 *  consistency.ts` Query 14 — a separate, post-projection layer. This
 *  PR-time gate catches authoring drift in fixtures BEFORE they reach
 *  the wizard.
 *
 *  Bumping this number requires either (a) a fixture regression that
 *  needs immediate review or (b) a deliberate exempt-with-reason
 *  ratchet bump documented in the PR body. */
const EXPECTED_GAP_COUNT = 0;

/** Ratchet — exempt list size. 0 at launch; bumps only when an
 *  exemption is consciously added. */
const EXPECTED_EXEMPT_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Source-of-truth check — RESOLVABLE_FIELDS in the resolver must match
// our matrix. A refactor that adds a field there forces a same-PR
// matrix update here.
// ────────────────────────────────────────────────────────────

const RESOLVER_SOURCE_PATH = join(
  REPO_ADMIN,
  "lib",
  "wizard",
  "resolve-module-source-refs.ts",
);

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "covered" | "exempt" | "gap";

interface RefCell {
  fixtureBasename: string;
  moduleId: string;
  field: string;
  rawValue: string;
  origin: "yaml-block" | "catalogue";
  classification: Classification;
  reason?: string;
}

function classifyYamlRef(
  fixtureBasename: string,
  ref: YamlBlockRef,
  index: ContentSourcesIndex,
): RefCell {
  const key: ExemptKey = `${fixtureBasename}:${ref.moduleId}:${ref.field}:${ref.rawValue}`;
  const exempt = SOURCE_REF_EXEMPT[key];
  if (exempt) {
    return {
      fixtureBasename,
      moduleId: ref.moduleId,
      field: ref.field,
      rawValue: ref.rawValue,
      origin: "yaml-block",
      classification: "exempt",
      reason: exempt.reason,
    };
  }
  // Resolve via the (moduleRef, settingRef) index — the contract the
  // runtime resolver enforces. Header-substring is a weaker fallback
  // for cases where the source carries only `format` (no moduleRef pin).
  const idxEntry = index.byModuleAndSetting.get(`${ref.moduleId}:${ref.field}`);
  if (idxEntry) {
    return {
      fixtureBasename,
      moduleId: ref.moduleId,
      field: ref.field,
      rawValue: ref.rawValue,
      origin: "yaml-block",
      classification: "covered",
    };
  }
  return {
    fixtureBasename,
    moduleId: ref.moduleId,
    field: ref.field,
    rawValue: ref.rawValue,
    origin: "yaml-block",
    classification: "gap",
  };
}

function classifyCatalogueRef(
  fixtureBasename: string,
  row: CatalogueRow,
  index: ContentSourcesIndex,
): RefCell {
  const key: ExemptKey = `${fixtureBasename}:${row.moduleId}:contentSourceRef:${row.contentSourceRef}`;
  const exempt = SOURCE_REF_EXEMPT[key];
  if (exempt) {
    return {
      fixtureBasename,
      moduleId: row.moduleId,
      field: "contentSourceRef",
      rawValue: row.contentSourceRef,
      origin: "catalogue",
      classification: "exempt",
      reason: exempt.reason,
    };
  }
  // Match: the catalogue's free-form label (e.g. "Source 4 — Baseline
  // topic pool") must reference a `### Source N — …` header by its
  // `Source N` token. The catalogue label and the header title don't
  // always match byte-identically — authors abbreviate (e.g. catalogue
  // "Source 1 — Part 1 topic library" vs header "Source 1 — Part 1
  // topic set library"). The structural invariant is "the referenced
  // Source N exists"; title-text matching is too brittle to use as the
  // gate without manual exempt entries for every legitimate
  // abbreviation. Match on the `Source N[a-z]?` token only.
  const needleSourceTok = row.contentSourceRef.match(/Source\s+(\d+[a-z]?)/i);
  if (needleSourceTok) {
    const wantedTok = needleSourceTok[1].toLowerCase();
    for (const h of index.allHeaders) {
      const haySourceTok = h.match(/Source\s+(\d+[a-z]?)/i);
      if (haySourceTok && haySourceTok[1].toLowerCase() === wantedTok) {
        return {
          fixtureBasename,
          moduleId: row.moduleId,
          field: "contentSourceRef",
          rawValue: row.contentSourceRef,
          origin: "catalogue",
          classification: "covered",
        };
      }
    }
  }
  return {
    fixtureBasename,
    moduleId: row.moduleId,
    field: "contentSourceRef",
    rawValue: row.contentSourceRef,
    origin: "catalogue",
    classification: "gap",
  };
}

interface FixtureScan {
  basename: string;
  cells: RefCell[];
}

function scanFixture(absolutePath: string): FixtureScan {
  const body = readFileSync(absolutePath, "utf8");
  const basename = absolutePath.split("/").pop()!;
  const yamlRefs = extractYamlBlockRefs(body);
  const catalogueRows = parseCatalogueRows(body);
  const index = parseContentSourcesIndex(body);
  const cells: RefCell[] = [
    ...yamlRefs.map((r) => classifyYamlRef(basename, r, index)),
    ...catalogueRows.map((r) => classifyCatalogueRef(basename, r, index)),
  ];
  return { basename, cells };
}

const SCANS: FixtureScan[] = FIXTURES.map(scanFixture);
const ALL_CELLS: RefCell[] = SCANS.flatMap((s) => s.cells);

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Soft source-ref → ContentSource Coverage (Lattice)", () => {
  it("discovers at least one course-reference fixture", () => {
    expect(
      FIXTURES.length,
      `No course-reference fixtures found under ${FIXTURE_DIR}. ` +
        `Expected files matching course-reference-*.md.`,
    ).toBeGreaterThan(0);
  });

  it("matrix RESOLVABLE_FIELD_NAMES tracks the resolver's RESOLVABLE_FIELDS", () => {
    const src = readFileSync(RESOLVER_SOURCE_PATH, "utf8");
    // Extract the literal members of the `RESOLVABLE_FIELDS` Set declaration.
    // Match `Set<…>([ … ])` — the closing `])` is unambiguous (any `[]`
    // in interior comments doesn't follow `)`).
    const m = src.match(/RESOLVABLE_FIELDS\s*=\s*new\s+Set[^;]*?\(\s*\[([\s\S]*?)\]\s*\)/);
    expect(
      m,
      "RESOLVABLE_FIELDS Set declaration not found in resolve-module-source-refs.ts",
    ).toBeTruthy();
    // Strip line comments so `// Array<{ topic, questions[] }>` doesn't
    // leak inert literals.
    const body = m![1].replace(/\/\/.*$/gm, "");
    const sourceValues = (body.match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    const sourceSorted = [...sourceValues].sort();
    const localSorted = [...RESOLVABLE_FIELD_NAMES].sort();
    expect(
      sourceSorted,
      `Resolver's RESOLVABLE_FIELDS diverged from test matrix. ` +
        `Resolver: ${sourceSorted.join(", ")}; matrix: ${localSorted.join(", ")}. ` +
        `Update RESOLVABLE_FIELD_NAMES in this file and re-classify.`,
    ).toEqual(localSorted);
  });

  it("publishes per-fixture distribution (operator log)", () => {
    // Sanity — every fixture should produce at least one (moduleId, field)
    // cell. A fixture with zero refs is suspicious — likely a parser bug.
    for (const s of SCANS) {
      expect(
        s.cells.length,
        `Fixture ${s.basename} produced 0 source-ref cells — parser regression?`,
      ).toBeGreaterThan(0);
    }
  });

  it("no soft source-ref is an uncovered gap beyond the ratchet", () => {
    const gaps = ALL_CELLS.filter((c) => c.classification === "gap");
    expect(
      gaps.length,
      `Soft source-refs without a matching content-source entry:\n  ${gaps
        .map(
          (g) =>
            `${g.fixtureBasename} :: ${g.moduleId}.${g.field} = "${g.rawValue}" (${g.origin})`,
        )
        .join("\n  ")}\n\n` +
        `Fix: add a matching ### Source N — … entry to the fixture's ` +
        `## Content Sources section with moduleRef + settingRef matching ` +
        `the consuming module + field; OR add the (fixture, moduleId, ` +
        `field, value) tuple to SOURCE_REF_EXEMPT with a >20-char reason ` +
        `+ bump EXPECTED_EXEMPT_COUNT.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = ALL_CELLS.filter((c) => c.classification === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `Current gaps:\n  ${gaps
          .map(
            (g) =>
              `${g.fixtureBasename} :: ${g.moduleId}.${g.field} = "${g.rawValue}"`,
          )
          .join("\n  ")}\n\n` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT by 1. ` +
        `If you opened one, pause: wire the content source instead.`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(SOURCE_REF_EXEMPT);
    expect(
      ex.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. Current: ${ex.join(", ")}.`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(SOURCE_REF_EXEMPT)) {
      expect(
        entry.reason.trim().length,
        `${k}: reason too short (${entry.reason.length} chars) — write what makes this cell intentionally exempt`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is contradicted by an actual coverage match", () => {
    const contradicted: string[] = [];
    for (const [k] of Object.entries(SOURCE_REF_EXEMPT)) {
      const cell = ALL_CELLS.find((c) => {
        const ck: ExemptKey = `${c.fixtureBasename}:${c.moduleId}:${c.field}:${c.rawValue}`;
        return ck === k;
      });
      // A cell that's exempt AND would resolve via the index is a
      // contradiction — drop the exempt entry.
      if (!cell) continue;
      if (cell.classification === "exempt") {
        // Re-classify ignoring the exempt list to see what it would be.
        const refExists = SCANS.some((s) => {
          const idx = parseContentSourcesIndex(
            readFileSync(join(FIXTURE_DIR, s.basename), "utf8"),
          );
          if (cell.origin === "yaml-block") {
            return idx.byModuleAndSetting.has(`${cell.moduleId}:${cell.field}`);
          }
          return idx.allHeaders.some((h) => h.includes(cell.rawValue));
        });
        if (refExists) contradicted.push(k);
      }
    }
    expect(
      contradicted,
      `Exempt entries that now have a real content-source match — remove from SOURCE_REF_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry references a fixture that no longer exists (stale row)", () => {
    const known = new Set(SCANS.map((s) => s.basename));
    const stale: string[] = [];
    for (const k of Object.keys(SOURCE_REF_EXEMPT)) {
      const [fix] = k.split(":");
      if (!known.has(fix)) stale.push(k);
    }
    expect(stale, `Stale exempt entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("classification distribution sanity", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      exempt: 0,
      gap: 0,
    };
    for (const c of ALL_CELLS) counts[c.classification]++;
    const sum = counts.covered + counts.exempt + counts.gap;
    expect(sum).toBe(ALL_CELLS.length);
  });
});

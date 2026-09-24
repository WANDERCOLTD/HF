/**
 * Courses ↔ template-version coverage — Lattice Coverage-pillar member
 * (2026-06-18, story #1991 S5 of epic #1986).
 *
 * **What this test pins:**
 *  Every production course-reference doc walked by the gate MUST carry
 *  `hf-template-version: "X.Y"` in its YAML front-matter. A course-ref
 *  without the marker is a Lattice violation — the wizard parser /
 *  course-version checks can't disambiguate which template revision
 *  the doc was authored against.
 *
 *  Glob covers two surfaces:
 *    (a) `docs/courses/**\/*.course-ref.md` — first-party HF courses
 *    (b) `docs/external/**\/Upload Docs/{*.course-ref.md,course-ref.md}`
 *        — external partner course imports
 *
 *  Files in the wizard test-fixtures dir, seed-test fixtures, and
 *  template/sample docs are NOT walked — they're not production
 *  course-refs.
 *
 * **How matching works:**
 *  For each course-ref file:
 *    1. If in `COURSES_TEMPLATE_VERSION_EXEMPT` → `exempt`.
 *    2. Read the first 30 lines; require a YAML front-matter block
 *       (`---` on line 1, then a closing `---`).
 *    3. Inside the front-matter, regex-match
 *       `^hf-template-version:\s*["']?(\d+\.\d+)["']?\s*$`.
 *    4. Match → `compliant`. No match → `gap`.
 *
 * **How to fix a failure:**
 *  - "Course-ref(s) missing hf-template-version": add
 *    `hf-template-version: "5.1"` (or current) to the YAML front-matter
 *    block. If the file is a non-production fixture, narrow the
 *    walk glob to exclude it.
 *  - "Stale exempt entry": the file shipped with the marker; remove
 *    from `COURSES_TEMPLATE_VERSION_EXEMPT`, drop
 *    `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`.
 *  - "Ratchet drifted up": you exempted a file without bumping;
 *    force a conscious choice (wire the marker OR grow the gap pile).
 *
 *  See `.claude/rules/courses-template-version-coverage.md` for the
 *  durable rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Repo root is 4 levels up from this test file:
// apps/admin/tests/lib/courses/ → repo root
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const DOCS_COURSES = join(REPO_ROOT, "docs", "courses");
const DOCS_EXTERNAL = join(REPO_ROOT, "docs", "external");

// ────────────────────────────────────────────────────────────
// Exempt list — course-refs that legitimately don't carry the
// hf-template-version marker (e.g. retired courses kept for forensic
// reference). Each entry: one-line reason. Required: >10 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

/** Paths RELATIVE to REPO_ROOT (e.g. `docs/courses/foo/foo.course-ref.md`). */
const COURSES_TEMPLATE_VERSION_EXEMPT: Record<string, ExemptEntry> = {};

/** Ratchet — exempt count is allowed to GO DOWN (wire the marker, remove
 *  the entry) but never UP without bumping here. At land time (2026-06-18,
 *  #1991 S5) all 6 production course-refs carry `hf-template-version`
 *  v5.1 so the ratchet starts at 0. */
const EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET = 0;

// ────────────────────────────────────────────────────────────
// Walker — enumerate production course-refs
// ────────────────────────────────────────────────────────────

/** Walk `docs/courses/**` for `*.course-ref.md`. */
function walkDocsCourses(): string[] {
  const out: string[] = [];
  if (!existsSync(DOCS_COURSES)) return out;
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (e.endsWith(".course-ref.md")) {
        out.push(full);
      }
    }
  };
  walk(DOCS_COURSES);
  return out;
}

/** Walk `docs/external/**\/Upload Docs/` for `course-ref.md` and
 *  `*.course-ref.md`. */
function walkDocsExternal(): string[] {
  const out: string[] = [];
  if (!existsSync(DOCS_EXTERNAL)) return out;
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (e === "course-ref.md" || e.endsWith(".course-ref.md")) {
        // Only pick up files inside an `Upload Docs/` directory — that's
        // the partner-import convention. Anything else under
        // `docs/external/` is reference material, not a course doc.
        if (full.includes(`${join("docs", "external")}/`) && full.includes("/Upload Docs/")) {
          out.push(full);
        }
      }
    }
  };
  walk(DOCS_EXTERNAL);
  return out;
}

const courseRefFiles: string[] = [...walkDocsCourses(), ...walkDocsExternal()]
  .map((f) => relative(REPO_ROOT, f))
  .sort();

// ────────────────────────────────────────────────────────────
// Front-matter parser
// ────────────────────────────────────────────────────────────

/** Parse hf-template-version from a course-ref's front-matter.
 *  Returns the matched "X.Y" string or null. */
function extractTemplateVersion(relPath: string): string | null {
  const absolute = join(REPO_ROOT, relPath);
  let content: string;
  try {
    content = readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
  // Front-matter must open with `---` on line 1.
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return null;
  // Walk lines 2..30 looking for the closing `---` and the version key.
  let closingFound = false;
  let version: string | null = null;
  const maxScan = Math.min(lines.length, 30);
  for (let i = 1; i < maxScan; i++) {
    const line = lines[i].trim();
    if (line === "---") {
      closingFound = true;
      break;
    }
    // Match: hf-template-version: "5.1"  /  hf-template-version: 5.1  /  '5.1'
    const m = line.match(/^hf-template-version:\s*["']?(\d+\.\d+)["']?\s*$/);
    if (m) version = m[1];
  }
  if (!closingFound) return null;
  return version;
}

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "compliant" | "exempt" | "gap";

interface ClassResult {
  path: string;
  classification: Classification;
  templateVersion?: string;
  reason?: string;
}

function classify(relPath: string): ClassResult {
  if (COURSES_TEMPLATE_VERSION_EXEMPT[relPath]) {
    return {
      path: relPath,
      classification: "exempt",
      reason: COURSES_TEMPLATE_VERSION_EXEMPT[relPath].reason,
    };
  }
  const version = extractTemplateVersion(relPath);
  if (version) {
    return {
      path: relPath,
      classification: "compliant",
      templateVersion: version,
    };
  }
  return { path: relPath, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Courses template-version coverage (Lattice Coverage-pillar)", () => {
  const results = courseRefFiles.map(classify);

  it("no production course-ref lacks hf-template-version (gap check)", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps,
      `Course-ref(s) missing hf-template-version YAML front-matter:\n  ${gaps
        .map((g) => g.path)
        .join("\n  ")}\n\nFix: add \`hf-template-version: "5.1"\` (or current) inside the \`---\` front-matter block at the top of the file.`,
    ).toEqual([]);
  });

  it("exempt list ratchet — count matches EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET", () => {
    const exemptIds = Object.keys(COURSES_TEMPLATE_VERSION_EXEMPT);
    expect(
      exemptIds.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET}. ` +
        `If you wired hf-template-version into a file + removed an entry, drop ` +
        `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET by 1. If you added an entry, pause: ` +
        `was that intentional? Add the marker instead. ` +
        `Current entries: ${exemptIds.join(", ") || "(none)"}`,
    ).toBe(EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET);
  });

  it("every exempt entry has a non-empty reason (>10 chars)", () => {
    for (const [path, entry] of Object.entries(COURSES_TEMPLATE_VERSION_EXEMPT)) {
      expect(entry.reason.trim().length, `${path}: empty/short reason`).toBeGreaterThan(10);
    }
  });

  it("no exempt entry is stale (each path still exists on disk)", () => {
    const stale = Object.keys(COURSES_TEMPLATE_VERSION_EXEMPT).filter(
      (p) => !existsSync(join(REPO_ROOT, p)),
    );
    expect(
      stale,
      `Exempt entries with no matching file on disk — file deleted; remove the exempt row:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry is contradicted by a now-present hf-template-version", () => {
    const contradicted: string[] = [];
    for (const relPath of Object.keys(COURSES_TEMPLATE_VERSION_EXEMPT)) {
      if (!existsSync(join(REPO_ROOT, relPath))) continue;
      const version = extractTemplateVersion(relPath);
      if (version) contradicted.push(`${relPath} (now has v${version})`);
    }
    expect(
      contradicted,
      `Exempt entries that now have hf-template-version — remove from COURSES_TEMPLATE_VERSION_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("classification distribution sanity check (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      compliant: 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    // Sum must equal input size — sanity for the classifier.
    expect(counts.compliant + counts.exempt + counts.gap).toBe(courseRefFiles.length);
    // Walk must find at least 1 course-ref OR the glob is broken.
    expect(
      courseRefFiles.length,
      "Walk found ZERO course-refs — glob broke. Verify docs/courses/**/*.course-ref.md AND docs/external/**/Upload Docs/*.course-ref.md exist.",
    ).toBeGreaterThan(0);
  });
});

#!/usr/bin/env tsx
/**
 * KNOWLEDGE-MAP.md ratchet — keeps the repo-root translation layer in step
 * with the code, specs, and data it references.
 *
 * Sibling of check-doc-citations.ts. Same flag conventions.
 *
 * Checks against the doc as-is (no partner-facing markers required):
 *   1. Every cited path resolves (markdown links + backtick paths)
 *   2. Every cited spec slug (XXX-001 / XXX-YYY-001) resolves to either
 *      config.specs.* or a seed-spec filename in docs-archive/bdd-specs/
 *   3. Role count matches non-deprecated UserRole enum values
 *
 * Optional touch-coupling mode (--touch):
 *   Reads a list of changed files (from stdin or --diff-against=<ref>) and
 *   emits a passive warning if any "high-signal" source changed without
 *   KNOWLEDGE-MAP.md being touched in the same diff.
 *
 * Bootstrap-safe: exits 0 if KNOWLEDGE-MAP.md is absent (the doc may not
 * exist on every branch).
 *
 * Usage:
 *   npx tsx scripts/check-knowledge-map.ts            # full report
 *   npx tsx scripts/check-knowledge-map.ts --ci       # exit 1 on hard fails
 *   npx tsx scripts/check-knowledge-map.ts --warn     # always exit 0
 *   npx tsx scripts/check-knowledge-map.ts --json     # machine-readable
 *   npx tsx scripts/check-knowledge-map.ts --touch --diff-against=origin/main
 *
 * Issue: #601
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "../../..");
const ADMIN = path.resolve(ROOT, "apps/admin");
const DOC_PATH = path.resolve(ROOT, "KNOWLEDGE-MAP.md");

const FLAG_CI = process.argv.includes("--ci");
const FLAG_WARN = process.argv.includes("--warn");
const FLAG_JSON = process.argv.includes("--json");
const FLAG_TOUCH = process.argv.includes("--touch");
const DIFF_ARG = process.argv.find((a) => a.startsWith("--diff-against="));
const DIFF_REF = DIFF_ARG ? DIFF_ARG.split("=")[1] : "origin/main";

/** Sources whose change should typically be reflected in KNOWLEDGE-MAP.md. */
const HIGH_SIGNAL_GLOBS: RegExp[] = [
  /^apps\/admin\/prisma\/schema\.prisma$/,
  /^apps\/admin\/lib\/config\.ts$/,
  /^apps\/admin\/lib\/permissions\.ts$/,
  /^apps\/admin\/lib\/pipeline\//,
  /^apps\/admin\/app\/api\/.*\/route\.ts$/,
  /^apps\/admin\/docs-archive\/bdd-specs\//,
];

/** Slug shapes the doc may use that are illustrative, not concrete. */
const SLUG_WILDCARDS = new Set(["ADAPT-*"]);

interface PathRef {
  line: number;
  raw: string;
  resolved: string;
  exists: boolean;
}

interface SlugRef {
  line: number;
  slug: string;
  found: boolean;
}

interface NumericClaim {
  line: number;
  raw: string;
  expected: number;
  actual: number;
  withinTolerance: boolean;
}

interface TouchSignal {
  changedSource: string;
  docTouched: boolean;
}

interface Report {
  docExists: boolean;
  paths: { total: number; broken: PathRef[] };
  slugs: { total: number; broken: SlugRef[] };
  numerics: NumericClaim[];
  touch: TouchSignal | null;
}

function readDoc(): string | null {
  if (!fs.existsSync(DOC_PATH)) return null;
  return fs.readFileSync(DOC_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// 1. Path references
// ---------------------------------------------------------------------------

/**
 * Extract all path-like references from the doc — markdown links and
 * backtick-wrapped paths under known top-level dirs.
 */
function extractPaths(text: string): { line: number; raw: string }[] {
  const out: { line: number; raw: string }[] = [];
  const lines = text.split(/\r?\n/);
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  const tickRe = /`((?:apps|docs|bdd|scripts|prisma|lib|packages|cli|e2e|node_modules)\/[A-Za-z0-9._/*\[\]-]+|[A-Z][A-Za-z0-9._-]*\.md)`/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let m: RegExpExecArray | null;
    const lr = new RegExp(linkRe.source, "g");
    while ((m = lr.exec(line)) !== null) {
      const ref = m[1].split("#")[0]; // strip anchor
      if (!ref || ref.startsWith("http") || ref.startsWith("mailto:")) continue;
      out.push({ line: i + 1, raw: ref });
    }

    const tr = new RegExp(tickRe.source, "g");
    while ((m = tr.exec(line)) !== null) {
      out.push({ line: i + 1, raw: m[1] });
    }
  }
  return out;
}

function resolvePath(ref: string): { resolved: string; exists: boolean } {
  // Strip glob wildcards for existence check — directory must still resolve.
  const cleaned = ref.replace(/\*\*?[/]?$/, "").replace(/\/$/, "");
  const candidates = [
    path.resolve(ROOT, cleaned),
    path.resolve(ADMIN, cleaned),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { resolved: path.relative(ROOT, c), exists: true };
  }
  return { resolved: cleaned, exists: false };
}

function checkPaths(text: string): { total: number; broken: PathRef[] } {
  const refs = extractPaths(text);
  const broken: PathRef[] = [];
  for (const { line, raw } of refs) {
    const { resolved, exists } = resolvePath(raw);
    if (!exists) broken.push({ line, raw, resolved, exists });
  }
  return { total: refs.length, broken };
}

// ---------------------------------------------------------------------------
// 2. Spec slug references
// ---------------------------------------------------------------------------

function loadKnownSlugs(): Set<string> {
  const slugs = new Set<string>();

  // From lib/config.ts — specs map values
  const configPath = path.join(ADMIN, "lib/config.ts");
  if (fs.existsSync(configPath)) {
    const txt = fs.readFileSync(configPath, "utf8");
    const re = /"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) slugs.add(m[1]);
  }

  // From seed-spec filenames
  const specsDir = path.join(ADMIN, "docs-archive/bdd-specs");
  if (fs.existsSync(specsDir)) {
    for (const entry of fs.readdirSync(specsDir)) {
      const slugMatch = entry.match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)[-.]/);
      if (slugMatch) slugs.add(slugMatch[1]);
    }
  }

  // From concept-doc filenames under docs/ (e.g. RWD-001-reward-policy.md)
  const docDirs = [path.join(ROOT, "docs"), path.join(ADMIN, "docs")];
  for (const dir of docDirs) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          stack.push(path.join(d, e.name));
          continue;
        }
        const slugMatch = e.name.match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)[-.]/);
        if (slugMatch) slugs.add(slugMatch[1]);
      }
    }
  }

  return slugs;
}

function extractSlugs(text: string): { line: number; slug: string }[] {
  const out: { line: number; slug: string }[] = [];
  const lines = text.split(/\r?\n/);
  // SLUG shape: 2+ uppercase letters, then -SEGMENT repeated, ending in -NNN
  // or in *. Captures TUT-001, ADAPT-VARK-001, ADAPT-* etc.
  const re = /`([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]+-\*)`/g;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    const local = new RegExp(re.source, "g");
    while ((m = local.exec(lines[i])) !== null) {
      out.push({ line: i + 1, slug: m[1] });
    }
  }
  return out;
}

function checkSlugs(text: string): { total: number; broken: SlugRef[] } {
  const known = loadKnownSlugs();
  const refs = extractSlugs(text);
  const broken: SlugRef[] = [];
  for (const { line, slug } of refs) {
    if (SLUG_WILDCARDS.has(slug)) continue;
    if (known.has(slug)) continue;
    broken.push({ line, slug, found: false });
  }
  return { total: refs.length, broken };
}

// ---------------------------------------------------------------------------
// 3. Numeric claims (role count)
// ---------------------------------------------------------------------------

function countActiveRoles(): number {
  const schemaPath = path.join(ADMIN, "prisma/schema.prisma");
  if (!fs.existsSync(schemaPath)) return 0;
  const txt = fs.readFileSync(schemaPath, "utf8");
  const enumMatch = txt.match(/enum\s+UserRole\s*\{([\s\S]*?)\}/);
  if (!enumMatch) return 0;
  const body = enumMatch[1];
  let active = 0;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Z][A-Z0-9_]*\b/.test(trimmed) && !/@deprecated/i.test(trimmed)) {
      active++;
    }
  }
  return active;
}

const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function checkNumerics(text: string): NumericClaim[] {
  const out: NumericClaim[] = [];
  const lines = text.split(/\r?\n/);
  const activeRoles = countActiveRoles();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Eight roles", "8 roles", "Eight roles"
    const m = line.match(/\b(eight|nine|seven|six|ten|\d+)\s+roles?\b/i);
    if (m) {
      const tok = m[1].toLowerCase();
      const expected = ENGLISH_NUMBERS[tok] ?? parseInt(tok, 10);
      out.push({
        line: i + 1,
        raw: m[0],
        expected,
        actual: activeRoles,
        withinTolerance: expected === activeRoles,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Touch coupling (passive signal)
// ---------------------------------------------------------------------------

function getChangedFiles(ref: string): string[] {
  try {
    const out = execSync(`git diff --name-only ${ref}...HEAD`, {
      cwd: ROOT,
      encoding: "utf8",
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function checkTouchCoupling(ref: string): TouchSignal | null {
  const changed = getChangedFiles(ref);
  if (changed.length === 0) return null;
  const docTouched = changed.includes("KNOWLEDGE-MAP.md");
  const sourceHits = changed.filter((f) =>
    HIGH_SIGNAL_GLOBS.some((re) => re.test(f)),
  );
  if (sourceHits.length === 0) return null;
  return {
    changedSource: sourceHits.join(", "),
    docTouched,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const text = readDoc();
  if (text === null) {
    if (FLAG_JSON) {
      process.stdout.write(JSON.stringify({ docExists: false }, null, 2) + "\n");
    } else {
      console.log("[check-knowledge-map] KNOWLEDGE-MAP.md not present — skipping.");
    }
    process.exit(0);
  }

  const paths = checkPaths(text);
  const slugs = checkSlugs(text);
  const numerics = checkNumerics(text);
  const touch = FLAG_TOUCH ? checkTouchCoupling(DIFF_REF) : null;

  const report: Report = { docExists: true, paths, slugs, numerics, touch };

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    formatHuman(report);
  }

  const hardFail =
    paths.broken.length > 0 ||
    slugs.broken.length > 0 ||
    numerics.some((n) => !n.withinTolerance);

  if (FLAG_WARN) process.exit(0);
  if (FLAG_CI && hardFail) process.exit(1);
  process.exit(0);
}

function formatHuman(r: Report): void {
  console.log(
    `[check-knowledge-map] paths: ${r.paths.total - r.paths.broken.length}/${r.paths.total} ok, slugs: ${r.slugs.total - r.slugs.broken.length}/${r.slugs.total} ok, numerics: ${r.numerics.length} claim(s).`,
  );

  if (r.paths.broken.length > 0) {
    console.log(`\n  X  ${r.paths.broken.length} broken path ref(s):`);
    for (const p of r.paths.broken) {
      console.log(`    KNOWLEDGE-MAP.md:${p.line}  -> ${p.raw}`);
    }
  }
  if (r.slugs.broken.length > 0) {
    console.log(`\n  X  ${r.slugs.broken.length} unresolved slug(s):`);
    for (const s of r.slugs.broken) {
      console.log(`    KNOWLEDGE-MAP.md:${s.line}  -> ${s.slug}`);
    }
  }
  for (const n of r.numerics) {
    if (n.withinTolerance) {
      console.log(`  ok  numeric "${n.raw}" matches (${n.actual}).`);
    } else {
      console.log(
        `\n  X  numeric drift at line ${n.line}: doc says "${n.raw}" but actual is ${n.actual}.`,
      );
    }
  }
  if (r.touch) {
    if (r.touch.docTouched) {
      console.log(`  ok  touch-coupling: high-signal source changed AND KNOWLEDGE-MAP.md touched.`);
    } else {
      console.log(
        `\n  !  touch-coupling (advisory): high-signal source changed without touching KNOWLEDGE-MAP.md.`,
      );
      console.log(`     changed: ${r.touch.changedSource}`);
      console.log(`     consider reviewing whether the doc still reads true.`);
    }
  }
  const ok =
    r.paths.broken.length === 0 &&
    r.slugs.broken.length === 0 &&
    r.numerics.every((n) => n.withinTolerance);
  if (ok) console.log("  ok  all hard checks pass.");
}

main();

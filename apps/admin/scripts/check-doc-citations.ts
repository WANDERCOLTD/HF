#!/usr/bin/env tsx
/**
 * Canonical-doc citation drift checker.
 *
 * Walks every canonical doc, extracts `file::symbol` refs, verifies each
 * file exists and each symbol resolves. Sibling to `doc-health.ts`; same
 * flag conventions.
 *
 * Usage:
 *   npx tsx scripts/check-doc-citations.ts           # full report
 *   npx tsx scripts/check-doc-citations.ts --ci      # exit 1 on broken FILE refs
 *   npx tsx scripts/check-doc-citations.ts --warn    # always exit 0, used by pre-commit
 *   npx tsx scripts/check-doc-citations.ts --json    # machine-readable
 *
 * Issue: #329
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const ADMIN = path.resolve(ROOT, "apps/admin");

const CANONICAL_DOCS = [
  "docs/CONTENT-PIPELINE.md",
  "docs/ENTITIES.md",
  "docs/PROMPT-COMPOSITION.md",
  "docs/WIZARD-DATA-BAG.md",
  "docs/SPEC-SYSTEM.md",
  "docs/PIPELINE.md",
];

interface Ref {
  doc: string;
  line: number;
  file: string;
  symbol: string;
  raw: string;
}

interface Verdict {
  ref: Ref;
  fileExists: boolean;
  symbolFound: boolean;
  resolvedPath: string | null;
}

const FLAG_CI = process.argv.includes("--ci");
const FLAG_WARN = process.argv.includes("--warn");
const FLAG_JSON = process.argv.includes("--json");

/** Extract `file::symbol` refs from a markdown doc. */
function extractRefs(docPath: string): Ref[] {
  const text = fs.readFileSync(docPath, "utf8");
  const refs: Ref[] = [];
  // `path/to/file.{ts,tsx,prisma,json}::symbol-or-call-form`
  const regex = /([a-zA-Z0-9._/-]+\.(?:tsx?|prisma|json))::([\w"().[\]-]+)/g;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    const localRegex = new RegExp(regex.source, "g");
    while ((m = localRegex.exec(lines[i])) !== null) {
      refs.push({
        doc: path.relative(ROOT, docPath),
        line: i + 1,
        file: m[1],
        symbol: m[2],
        raw: m[0],
      });
    }
  }
  return refs;
}

// Cache of basename → absolute path for files under apps/admin
let basenameIndex: Map<string, string[]> | null = null;

function buildBasenameIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const ignoreDirs = new Set([
    "node_modules", ".next", ".git", "dist", "build", "coverage",
    ".turbo", "playwright-report", "test-results",
  ]);
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignoreDirs.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        const arr = index.get(e.name) ?? [];
        arr.push(full);
        index.set(e.name, arr);
      }
    }
  }
  walk(ADMIN);
  walk(path.join(ROOT, "prisma"));
  return index;
}

/** Resolve a file ref against repo root, apps/admin, and basename index. */
function resolveFile(file: string): string | null {
  // 1. Exact path lookups
  const cleaned = file.replace(/^\/+/, ""); // strip leading slash for `/path/to/file`
  const exactCandidates = [
    path.resolve(ROOT, cleaned),
    path.resolve(ADMIN, cleaned),
    path.resolve(ROOT, "apps/admin", cleaned),
  ];
  for (const c of exactCandidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }

  // 2. Build index lazily for fallback lookups
  if (basenameIndex === null) basenameIndex = buildBasenameIndex();

  const basename = path.basename(file);

  // 3. Bare filename → search index
  if (!file.includes("/")) {
    const hits = basenameIndex.get(basename);
    if (hits && hits.length === 1) return hits[0];
    if (hits && hits.length > 1) {
      const nonTest = hits.find((h) => !h.includes("/tests/") && !h.includes("__tests__"));
      return nonTest ?? hits[0];
    }
    return null;
  }

  // 4. Partial path (e.g. `transforms/pedagogy.ts`, `/compose-prompt/route.ts`)
  // Match any file whose absolute path ends with the cleaned partial path.
  const candidates = basenameIndex.get(basename);
  if (candidates && candidates.length > 0) {
    const suffix = path.sep + cleaned.replace(/\//g, path.sep);
    const exactSuffix = candidates.filter((c) => c.endsWith(suffix));
    if (exactSuffix.length === 1) return exactSuffix[0];
    if (exactSuffix.length > 1) {
      const nonTest = exactSuffix.find((h) => !h.includes("/tests/") && !h.includes("__tests__"));
      return nonTest ?? exactSuffix[0];
    }
  }
  return null;
}

/** Search a file for a symbol. Returns true if found. */
function findSymbol(filePath: string, symbol: string): boolean {
  const content = fs.readFileSync(filePath, "utf8");

  // 1. `::registerLoader("name")` form → look for the call site
  const callMatch = symbol.match(/^(\w+)\(["']([^"']+)["']\)$/);
  if (callMatch) {
    const [, fnName, arg] = callMatch;
    const re = new RegExp(`${escapeRegex(fnName)}\\s*\\(\\s*["']${escapeRegex(arg)}["']`);
    return re.test(content);
  }

  // 2. `::model X` (Prisma)
  const modelMatch = symbol.match(/^model\s+(\w+)$/);
  if (modelMatch) {
    return new RegExp(`^model\\s+${modelMatch[1]}\\s*\\{`, "m").test(content);
  }

  // 3. `::enum X` (Prisma)
  const enumMatch = symbol.match(/^enum\s+(\w+)$/);
  if (enumMatch) {
    return new RegExp(`^enum\\s+${enumMatch[1]}\\s*\\{`, "m").test(content);
  }

  // 4. Member access: `Foo.bar` → require `Foo` declaration + `bar` reference
  const memberMatch = symbol.match(/^([A-Z]\w*)\.(\w+)$/);
  if (memberMatch) {
    const [, ns, member] = memberMatch;
    const nsDecl = new RegExp(
      `(?:(?:export\\s+)?(?:const|let|var|class|function|interface|type|enum)\\s+${ns}\\b|${ns}\\s*=)`,
      "m",
    );
    return nsDecl.test(content) && new RegExp(`\\b${member}\\b`).test(content);
  }

  // 5. Plain identifier → declaration of function / const / class / interface / type / enum,
  //    OR a registered name passed as a string literal to registerLoader / registerTransform.
  const idMatch = symbol.match(/^[A-Za-z_]\w*$/);
  if (idMatch) {
    const patterns = [
      `^(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\b`,
      `^(?:export\\s+)?(?:const|let|var)\\s+${symbol}\\b`,
      `^(?:export\\s+)?class\\s+${symbol}\\b`,
      `^(?:export\\s+)?interface\\s+${symbol}\\b`,
      `^(?:export\\s+)?type\\s+${symbol}\\b`,
      `^(?:export\\s+)?enum\\s+${symbol}\\b`,
      `^(?:export\\s+default\\s+)?function\\s+${symbol}\\b`,
      // HTTP verb exports (route handlers): `export async function GET(`
      `^export\\s+(?:async\\s+)?function\\s+${symbol}\\s*\\(`,
      // Registered name pattern: registerLoader("x"), registerTransform("x")
      `register(?:Loader|Transform)\\s*\\(\\s*["']${symbol}["']`,
    ];
    return patterns.some((p) => new RegExp(p, "m").test(content));
  }

  // Unrecognised symbol shape → can't validate, treat as found (warn-noise reduction)
  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const allVerdicts: Verdict[] = [];
  const skipped: string[] = [];

  for (const docRel of CANONICAL_DOCS) {
    const docPath = path.resolve(ROOT, docRel);
    if (!fs.existsSync(docPath)) {
      skipped.push(docRel);
      continue;
    }
    const refs = extractRefs(docPath);
    for (const ref of refs) {
      const resolved = resolveFile(ref.file);
      const fileExists = resolved !== null;
      const symbolFound = fileExists ? findSymbol(resolved!, ref.symbol) : false;
      allVerdicts.push({ ref, fileExists, symbolFound, resolvedPath: resolved });
    }
  }

  const brokenFiles = allVerdicts.filter((v) => !v.fileExists);
  const brokenSymbols = allVerdicts.filter((v) => v.fileExists && !v.symbolFound);

  if (FLAG_JSON) {
    process.stdout.write(
      JSON.stringify(
        {
          checked: allVerdicts.length,
          docsScanned: CANONICAL_DOCS.length - skipped.length,
          skipped,
          brokenFiles: brokenFiles.map((v) => v.ref),
          brokenSymbols: brokenSymbols.map((v) => v.ref),
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    const docsScanned = CANONICAL_DOCS.length - skipped.length;
    console.log(
      `[check-doc-citations] ${allVerdicts.length} refs checked across ${docsScanned} canonical docs.`,
    );
    if (skipped.length > 0) {
      console.log(`  Skipped (not present on this branch): ${skipped.join(", ")}`);
    }
    if (brokenFiles.length > 0) {
      console.log(`\n  ❌ ${brokenFiles.length} BROKEN FILE refs:`);
      for (const v of brokenFiles) {
        console.log(`    ${v.ref.doc}:${v.ref.line}  → ${v.ref.raw}`);
      }
    }
    if (brokenSymbols.length > 0) {
      console.log(`\n  ⚠ ${brokenSymbols.length} BROKEN SYMBOL refs (warn-only — refactor renames are common):`);
      for (const v of brokenSymbols) {
        console.log(`    ${v.ref.doc}:${v.ref.line}  → ${v.ref.raw}  (file ${v.ref.file} found, symbol "${v.ref.symbol}" not resolved)`);
      }
    }
    if (brokenFiles.length === 0 && brokenSymbols.length === 0) {
      console.log("  ✓ All citations resolve.");
    }
  }

  if (FLAG_WARN) {
    process.exit(0);
  }
  if (FLAG_CI && brokenFiles.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();

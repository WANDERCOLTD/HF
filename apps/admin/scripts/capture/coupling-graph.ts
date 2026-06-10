/**
 * coupling-graph.ts — Structural-fact generator: import edges across apps/admin.
 *
 * The 3rd Tier-2 generated fact alongside model-map.ts + route-inventory.ts.
 * Emits docs/kb/generated/coupling-graph.json: per-file import edges (relative
 * + @/-alias only — external modules are stripped), plus in/out degree per
 * file and a top-N "highest coupling" list for Phase-3 strangulation hints.
 *
 * Heuristic, not AST-perfect:
 *   - Regex over `import` statements; type-only imports counted equally
 *     (couplings are couplings even if elided at build).
 *   - Resolves relative paths and `@/*` alias (per `tsconfig.json` `paths`).
 *   - Skips: node:*, react, react-dom, next/*, anything not resolving to a
 *     file inside `apps/admin/`.
 *   - Resolution policy: try `.ts`, `.tsx`, `.mjs`, `.js`, then dir/index.ts
 *     (mirrors Next.js + TS conventions). Unresolved → counted in
 *     `skippedEdges` so the graph stays honest.
 *
 * Run:  npx tsx scripts/capture/coupling-graph.ts        (from apps/admin)
 * CI:   re-run and `git diff --exit-code -I '"generatedAt":'` to gate drift.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const APP_ROOT = resolve(REPO_ROOT, "apps/admin");
const OUT_PATH = resolve(REPO_ROOT, "docs/kb/generated/coupling-graph.json");

const WALK_ROOTS = ["lib", "app", "scripts"].map((d) => resolve(APP_ROOT, d));
const SOURCE_EXTS = [".ts", ".tsx"];
const RESOLVE_EXTS = [".ts", ".tsx", ".mjs", ".js"];

// Skip generated / build dirs even if a walk root names them.
const SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", "_archived", "__snapshots__",
]);

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (SOURCE_EXTS.some((e) => name.endsWith(e))) acc.push(full);
  }
  return acc;
}

// Matches: import X from 'Y'  |  import 'Y'  |  import type { X } from 'Y'
//          import('Y')  (dynamic)
const IMPORT_RE = /(?:^|;|\n)\s*(?:import\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?|import\s*\(\s*)["']([^"']+)["']/g;

function resolveImport(specifier: string, fromFile: string): string | null {
  // Strip external modules — anything not relative and not alias-prefixed.
  let candidatePath: string;
  if (specifier.startsWith("@/")) {
    candidatePath = resolve(APP_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    candidatePath = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }

  // If the candidate exists as a file with a known extension, use it.
  for (const ext of [""].concat(RESOLVE_EXTS)) {
    const p = candidatePath + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  // Try as a directory with an index file.
  if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
    for (const ext of RESOLVE_EXTS) {
      const p = join(candidatePath, `index${ext}`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

type Edge = { from: string; to: string };
type FileStats = { path: string; inDegree: number; outDegree: number };

function main() {
  const files: string[] = [];
  for (const root of WALK_ROOTS) walk(root, files);
  files.sort();

  const edges: Edge[] = [];
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  let skippedEdges = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const relFrom = relative(APP_ROOT, file).split(sep).join("/");
    outDegree.set(relFrom, outDegree.get(relFrom) ?? 0);
    inDegree.set(relFrom, inDegree.get(relFrom) ?? 0);

    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolveImport(m[1], file);
      if (!target) {
        // External or unresolvable — count if it was a relative/alias attempt.
        if (m[1].startsWith(".") || m[1].startsWith("@/")) skippedEdges++;
        continue;
      }
      const relTo = relative(APP_ROOT, target).split(sep).join("/");
      if (relTo === relFrom) continue; // self-import noise
      edges.push({ from: relFrom, to: relTo });
      outDegree.set(relFrom, (outDegree.get(relFrom) ?? 0) + 1);
      inDegree.set(relTo, (inDegree.get(relTo) ?? 0) + 1);
    }
  }

  // Per-file stats, sorted by path for stable diffs.
  const fileSet = new Set<string>([...inDegree.keys(), ...outDegree.keys()]);
  const fileStats: FileStats[] = [...fileSet]
    .sort()
    .map((p) => ({
      path: p,
      inDegree: inDegree.get(p) ?? 0,
      outDegree: outDegree.get(p) ?? 0,
    }));

  const highCoupling = [...fileStats]
    .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree))
    .slice(0, 20);

  // Stable edge order: sort by (from, to).
  edges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

  const out = {
    $schema: "coupling-graph/v1",
    generatedAt: new Date().toISOString(),
    generator: "scripts/capture/coupling-graph.ts",
    note: "Tier-2 generated KB. Per-file import edges across apps/admin/{lib,app,scripts}. External modules stripped. Do not hand-edit — re-run the generator.",
    fileCount: fileStats.length,
    edgeCount: edges.length,
    skippedEdges,
    edges,
    files: fileStats,
    highCoupling,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

  console.log(`[coupling-graph] ${fileStats.length} files, ${edges.length} edges → ${OUT_PATH}`);
  console.log(`[coupling-graph] skipped (unresolved relative/alias): ${skippedEdges}`);
  console.log(`[coupling-graph] top-3 by in+out degree:`);
  for (const f of highCoupling.slice(0, 3)) {
    console.log(`    ${f.inDegree + f.outDegree}  (in ${f.inDegree} / out ${f.outDegree})  ${f.path}`);
  }
}

main();

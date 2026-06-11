/**
 * operator-surfaces.ts — Tier-2 KB generator for Epic #1442 Layer 3 Slice 2 (#1483).
 *
 * Emits `docs/kb/generated/operator-surfaces.json` — the operator-facing
 * catalogue of the ~20 API routes operators actually touch when preparing
 * or debugging a demo. Inclusion is opt-in via a JSDoc tag:
 *
 *   /**
 *    * @operator-surface yes
 *    *
 *    * @api POST /api/courses/:courseId/regenerate-curriculum
 *    * @description Regenerates a course's curriculum…
 *    *​/
 *   export async function POST(…)
 *
 * Unannotated routes are silently omitted. The ratchet is: operators (or
 * Slice 4 + later) add more annotations over time. The page at
 * `app/x/help/demos/page.tsx` reads the JSON at request time and groups by
 * URL prefix (`courses`, `callers`, `voice`, `playbooks`, `settings`, `other`).
 *
 * Cross-references `route-inventory.ts::routePath()` semantics for path
 * normalisation (same `app/api/**\/route.ts` → `/api/...` mapping, dynamic
 * `[param]` segments preserved verbatim).
 *
 * Pattern: regex-walk JSDoc — mirrors `scripts/generate-constants-manifest.ts`
 * and `scripts/capture/demo-knobs.ts`. Does NOT use `ts.createProgram` —
 * keeping it dependency-free is part of the contract for running under
 * `npx tsx` in CI / pre-commit.
 *
 * Run:  npx tsx scripts/capture/operator-surfaces.ts        (from apps/admin)
 * CI:   re-run and `git diff --exit-code -I '"generatedAt":'` to catch drift.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const API_ROOT = resolve(REPO_ROOT, "apps/admin/app/api");
const OUT_PATH = resolve(REPO_ROOT, "docs/kb/generated/operator-surfaces.json");

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

const OPERATOR_SURFACE_TAG = /@operator-surface\s+yes\b/;
const API_SUMMARY_RE = /@api\s+(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(.+?)\s*$/m;
const DESCRIPTION_RE = /@description\s+([^\n*][^\n]*)/;

/** Category derived from the URL prefix — keeps the page table groupable. */
type Category =
  | "courses"
  | "callers"
  | "voice"
  | "playbooks"
  | "settings"
  | "other";

interface OperatorSurface {
  route: string;
  file: string;
  methods: string[];
  authLevels: string[];
  description: string;
  category: Category;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name === "route.ts") acc.push(full);
  }
  return acc;
}

/**
 * Normalises a `route.ts` absolute path to its `/api/...` URL form.
 *
 * Mirrors `route-inventory.ts::routePath` deliberately — DO NOT hand-roll
 * a second normaliser. If the inventory generator's rules change (new
 * segment conventions, route groups, etc.), update both in lockstep.
 */
function routePath(file: string): string {
  const rel = relative(API_ROOT, dirname(file));
  return "/api" + (rel ? "/" + rel.split(sep).join("/") : "");
}

function categoryFor(route: string): Category {
  if (route.startsWith("/api/courses/")) return "courses";
  if (route.startsWith("/api/callers")) return "callers";
  if (route.startsWith("/api/voice") || route.startsWith("/api/voice-providers"))
    return "voice";
  if (route.startsWith("/api/playbooks") || route.startsWith("/api/subjects") ||
      route.startsWith("/api/curricula"))
    return "playbooks";
  if (
    route.startsWith("/api/settings") ||
    route.startsWith("/api/recompose") ||
    route.startsWith("/api/goals")
  )
    return "settings";
  return "other";
}

function extractMethods(src: string): string[] {
  return HTTP_METHODS.filter(
    (m) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src) ||
      new RegExp(`export\\s+const\\s+${m}\\b`).test(src),
  );
}

function extractAuthLevels(src: string): string[] {
  const hits = [...src.matchAll(/requireAuth\(\s*["'`](\w+)["'`]/g)].map(
    (m) => m[1],
  );
  return [...new Set(hits)];
}

/**
 * Pulls the first `@description` line out of any JSDoc block. Falls back to
 * the `@api` summary text when no description tag is present. Returns empty
 * string when neither is present — the page renders the empty state.
 */
function extractDescription(src: string): string {
  const desc = DESCRIPTION_RE.exec(src);
  if (desc) return desc[1].trim().replace(/\s+\*?\s*$/, "");
  const api = API_SUMMARY_RE.exec(src);
  if (api) return api[2].trim();
  return "";
}

function main(): void {
  const files = walk(API_ROOT).sort();
  const surfaces: OperatorSurface[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!OPERATOR_SURFACE_TAG.test(src)) continue;

    const route = routePath(file);
    const methods = extractMethods(src);
    const authLevels = extractAuthLevels(src);
    const description = extractDescription(src);

    surfaces.push({
      route,
      file: relative(REPO_ROOT, file),
      methods: methods.length ? methods : ["<none-detected>"],
      authLevels,
      description,
      category: categoryFor(route),
    });
  }

  // Stable sort by route for deterministic diffs.
  surfaces.sort((a, b) => a.route.localeCompare(b.route));

  const out = {
    $schema: "operator-surfaces/v1",
    generatedAt: new Date().toISOString(),
    generator: "scripts/capture/operator-surfaces.ts",
    note: "Tier-2 generated KB. Only routes tagged @operator-surface yes. Do not hand-edit — re-run the generator (npm run kb:operator-surfaces).",
    surfaces,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

  const byCategory = surfaces.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `[operator-surfaces] ${surfaces.length} surfaces → ${OUT_PATH}`,
  );
  console.log(`[operator-surfaces] by category:`, byCategory);
}

main();

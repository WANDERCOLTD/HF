/**
 * route-inventory.ts — Structural-fact generator: the API surface.
 *
 * Walks app/api/**\/route.ts and emits docs/kb/generated/route-inventory.json:
 * one entry per route with HTTP methods, the requireAuth level(s), and signal
 * flags that bear on tenant-safety. Tier-2 (generated) KB content.
 *
 *   - Auth level + methods are extracted reliably.
 *   - `tenantSignals` are HEURISTIC hints, NOT a verdict. Static analysis can't
 *     prove tenant-safety; ratify per-route during Phase 2 (multi-tenancy).
 *
 * Run:  npx tsx scripts/capture/route-inventory.ts        (from apps/admin)
 * CI:   re-run and `git diff --exit-code` the JSON to catch surface drift.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const API_ROOT = resolve(REPO_ROOT, "apps/admin/app/api");
const OUT_PATH = resolve(REPO_ROOT, "docs/kb/generated/route-inventory.json");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name === "route.ts") acc.push(full);
  }
  return acc;
}

function routePath(file: string): string {
  const rel = relative(API_ROOT, dirname(file));
  return "/api" + (rel ? "/" + rel.split(sep).join("/") : "");
}

function main() {
  const files = walk(API_ROOT).sort();
  const routes = files.map((file) => {
    const src = readFileSync(file, "utf8");

    const methods = HTTP_METHODS.filter(
      (m) =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src) ||
        new RegExp(`export\\s+const\\s+${m}\\b`).test(src),
    );

    const authLevels = [...src.matchAll(/requireAuth\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]);
    const hasRequireAuth = /requireAuth\s*\(/.test(src);
    const handlesInternalSecret = /x-internal-secret|INTERNAL_API_SECRET/.test(src);
    const acceptsCallerIdParam = /callerId/.test(src);
    const usesScopeHelper = /resolveCallerScopeForReading|resolvePlaybookId|learner-scope/.test(src);
    const rawPrisma = /prisma\.\w+\.(find|update|create|delete|upsert|aggregate|count)/.test(src);

    // Heuristic risk flag: admits a callerId param but no scope helper, or no auth at all.
    const tenantSignals = {
      acceptsCallerIdParam,
      usesScopeHelper,
      handlesInternalSecret,
      rawPrisma,
      possiblyUnscoped: acceptsCallerIdParam && !usesScopeHelper,
      noAuthGate: !hasRequireAuth && !handlesInternalSecret,
    };

    return {
      route: routePath(file),
      file: relative(REPO_ROOT, file),
      methods: methods.length ? methods : ["<none-detected>"],
      authLevels: [...new Set(authLevels)],
      hasRequireAuth,
      tenantSignals,
      reviewed: false,
    };
  });

  const summary = {
    routeCount: routes.length,
    byAuthLevel: {} as Record<string, number>,
    noAuthGate: 0,
    possiblyUnscoped: 0,
    internalSecret: 0,
  };
  for (const r of routes) {
    const key = r.authLevels.length ? r.authLevels.join("+") : r.hasRequireAuth ? "requireAuth(?)" : "<none>";
    summary.byAuthLevel[key] = (summary.byAuthLevel[key] ?? 0) + 1;
    if (r.tenantSignals.noAuthGate) summary.noAuthGate++;
    if (r.tenantSignals.possiblyUnscoped) summary.possiblyUnscoped++;
    if (r.tenantSignals.handlesInternalSecret) summary.internalSecret++;
  }

  const out = {
    $schema: "route-inventory/v1",
    generatedAt: new Date().toISOString(),
    generator: "scripts/capture/route-inventory.ts",
    note: "Tier-2 generated KB. tenantSignals are HEURISTIC hints, not a tenant-safety verdict. `possiblyUnscoped` = accepts a callerId param with no scope helper → review first in Phase 2. Do not hand-edit — re-run the generator.",
    summary,
    routes,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

  console.log(`[route-inventory] ${routes.length} routes → ${OUT_PATH}`);
  console.log(
    `[route-inventory] ${summary.noAuthGate} no-auth-gate · ${summary.possiblyUnscoped} possibly-unscoped (callerId, no scope helper) · ${summary.internalSecret} internal-secret`,
  );
  console.log(`[route-inventory] by auth level:`, summary.byAuthLevel);
}

main();

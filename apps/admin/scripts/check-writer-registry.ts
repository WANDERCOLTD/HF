/**
 * check-writer-registry.ts (#1619 / Epic #1618 Slice 2)
 *
 * CLI integrity check for the writer-completeness registry. Runs in
 * CI alongside the other guards. Three checks:
 *
 *   1. EXHAUSTIVENESS — every reader path mentioned in the registry's
 *      `reader` field exists on disk (catches reader removed without
 *      removing the registry row).
 *
 *   2. WRITER EXISTENCE — every writer symbol the registry names is
 *      grepable in the codebase (catches writer renamed/deleted
 *      without updating the row).
 *
 *   3. COVERAGE — the registry's `field` set covers the 4 known audit
 *      gaps. This is the floor; new gaps add new rows as they're
 *      found. (The fuller "every reader of a nullable Prisma field
 *      has an entry" reverse audit lands in Slice 3 — golden-snapshot
 *      territory.)
 *
 * Exit code 0 = clean. Non-zero = at least one check failed.
 *
 * Run via: `npx tsx apps/admin/scripts/check-writer-registry.ts`
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { WRITER_REGISTRY, REGISTERED_FIELDS } from "../lib/contracts/writer-registry";

const REPO_ROOT = resolve(__dirname, "../../..");
const APP_ROOT = resolve(__dirname, "..");

// Minimum bootstrap set — these are the four 2026-06-14 audit gaps
// the registry MUST cover. Slice 3 will extend the floor as the
// codebase grows.
const REQUIRED_FIELDS = new Set([
  "BehaviorMeasurement.evidence",
  "RewardScore.targetUpdatesApplied",
  "Goal.progressMetrics",
  "RewardScore.effectiveTargets",
]);

type Finding = { check: string; level: "error" | "warn"; message: string };
const findings: Finding[] = [];

// ── Check 1 — exhaustiveness of REQUIRED_FIELDS ─────────────────────
for (const field of REQUIRED_FIELDS) {
  if (!REGISTERED_FIELDS.includes(field)) {
    findings.push({
      check: "REQUIRED_FIELDS",
      level: "error",
      message: `Required field "${field}" is not registered in WRITER_REGISTRY. The audit on 2026-06-14 identified this as a silent-writer gap; add the row back.`,
    });
  }
}

// ── Check 2 — reader path existence ──────────────────────────────────
for (const entry of WRITER_REGISTRY) {
  // `reader` shape: `<relative-path>::<symbol>` OR `<relative-path>`
  const pathPart = entry.reader.split("::")[0];
  const fullPath = join(APP_ROOT, pathPart);
  if (!existsSync(fullPath)) {
    findings.push({
      check: "READER_EXISTS",
      level: "error",
      message: `Reader file does not exist on disk: ${pathPart} (field=${entry.field}). Either the reader was removed without removing this registry row, or the path drifted. Update or delete the row.`,
    });
  }
}

// ── Check 3 — writer symbol grepable ─────────────────────────────────
for (const entry of WRITER_REGISTRY) {
  // `writer` shape: `<relative-path>::<symbol-or-symbols>` — multiple
  // symbols separated by ` + ` or ` (invoked from ... )`.
  const writerPaths = entry.writer.split(/\s*\(invoked from\s*|\s*\+\s*/).map((s) => s.replace(/\)$/, ""));
  for (const segment of writerPaths) {
    const [pathPart, symbolPart] = segment.split("::");
    if (!pathPart) continue;
    const fullPath = join(APP_ROOT, pathPart);
    if (!existsSync(fullPath)) {
      findings.push({
        check: "WRITER_EXISTS",
        level: "error",
        message: `Writer file does not exist on disk: ${pathPart} (field=${entry.field}). Update the registry row to match the new file path.`,
      });
      continue;
    }
    if (symbolPart) {
      // Strip trailing ")" or chained dots so we grep the bare symbol.
      const symbolBase = symbolPart.split(/[(.]/)[0];
      const content = readFileSync(fullPath, "utf8");
      if (!content.includes(symbolBase)) {
        findings.push({
          check: "WRITER_SYMBOL_GREP",
          level: "warn",
          message: `Writer symbol "${symbolBase}" not grepable in ${pathPart} (field=${entry.field}). Possibly renamed; update the registry row.`,
        });
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (errors.length === 0 && warns.length === 0) {
  console.log(
    `✓ writer-registry: ${WRITER_REGISTRY.length} entries; all readers + writers resolve cleanly.`,
  );
  process.exit(0);
}

for (const f of [...errors, ...warns]) {
  const tag = f.level === "error" ? "✗" : "⚠";
  console.error(`${tag} [${f.check}] ${f.message}`);
}

console.error(
  `\n${errors.length} error(s), ${warns.length} warning(s) across ${WRITER_REGISTRY.length} registry entries.`,
);
if (errors.length > 0) process.exit(1);
process.exit(0);

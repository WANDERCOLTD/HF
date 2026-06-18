/**
 * backfill-module-settings-from-course-ref.ts (#1850)
 *
 * Backfill per-module G8 settings on an existing Playbook by parsing a
 * Course Reference document with the v2.3 YAML-block format.
 *
 * Usage (from apps/admin/):
 *   npx tsx scripts/backfill-module-settings-from-course-ref.ts \
 *     --course-ref lib/wizard/__tests__/fixtures/course-reference-ielts-v2.3.md \
 *     --playbook-id <id> \
 *     [--dry-run]
 *
 * Behaviour:
 *   - Parses the course-ref via `detectModuleSettings`.
 *   - Reads the target Playbook's `config.modules[]`.
 *   - For each module that matches a YAML block by id, merges the YAML
 *     settings into `module.settings`, PRESERVING anything already there
 *     (manual edits via the Module Inspector win over re-projection).
 *   - Calls `bumpPlaybookComposeTimestamp(playbookId)` after a successful
 *     write so the Preview lens flips stale + next call recomposes.
 *   - `--dry-run`: prints the diff and exits without writing.
 *
 * Exit codes:
 *   0 — success (or dry-run printed cleanly)
 *   1 — error (file missing, playbook missing, no module overlap, parser errors)
 */

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { prisma } from "@/lib/prisma";
import { detectModuleSettings } from "@/lib/wizard/detect-module-settings";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";
import type {
  AuthoredModule,
  AuthoredModuleSettings,
  PlaybookConfig,
} from "@/lib/types/json-fields";

interface CliArgs {
  courseRefPath: string;
  playbookId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let courseRefPath = "";
  let playbookId = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--course-ref") {
      courseRefPath = argv[++i] ?? "";
    } else if (arg === "--playbook-id") {
      playbookId = argv[++i] ?? "";
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  npx tsx scripts/backfill-module-settings-from-course-ref.ts \\",
          "    --course-ref <path> --playbook-id <id> [--dry-run]",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  if (!courseRefPath || !playbookId) {
    console.error("Missing required args: --course-ref <path> --playbook-id <id>");
    process.exit(1);
  }
  return { courseRefPath, playbookId, dryRun };
}

interface ModuleDiff {
  id: string;
  added: string[];
  preserved: string[];
  skipped: boolean;
  reason?: string;
}

/**
 * Merge new YAML settings into an existing AuthoredModule.settings shape,
 * preserving any keys that were already set (manual-edit-wins semantics).
 *
 * Returns the merged shape + a diff entry describing what landed.
 */
export function mergeModuleSettings(
  existing: AuthoredModuleSettings | undefined,
  fromYaml: Partial<AuthoredModuleSettings>,
): { merged: AuthoredModuleSettings; added: string[]; preserved: string[] } {
  const merged: AuthoredModuleSettings = { ...(existing ?? {}) };
  const added: string[] = [];
  const preserved: string[] = [];
  for (const [k, v] of Object.entries(fromYaml) as Array<
    [keyof AuthoredModuleSettings, unknown]
  >) {
    if (v === undefined) continue;
    if (existing && existing[k] !== undefined) {
      preserved.push(k);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (merged as any)[k] = v;
    added.push(k);
  }
  return { merged, added, preserved };
}

/**
 * Pure helper — compute the diff + next-config without touching the DB.
 * Exposed for unit tests (no Prisma dependency).
 */
export function computeBackfillPlan(
  config: PlaybookConfig,
  courseRefText: string,
): {
  diffs: ModuleDiff[];
  nextConfig: PlaybookConfig;
  parserWarnings: number;
  yamlBlockCount: number;
} {
  const modules = config.modules ?? [];
  const detectedIds = modules
    .map((m) => m.id)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  const parsed = detectModuleSettings(courseRefText, detectedIds);
  const diffs: ModuleDiff[] = [];

  const nextModules: AuthoredModule[] = modules.map((m) => {
    if (typeof m.id !== "string") {
      diffs.push({
        id: "(no-id)",
        added: [],
        preserved: [],
        skipped: true,
        reason: "module has no id",
      });
      return m;
    }
    const fromYaml = parsed.byModuleId.get(m.id);
    if (!fromYaml) {
      diffs.push({
        id: m.id,
        added: [],
        preserved: [],
        skipped: true,
        reason: "no YAML block for this module id",
      });
      return m;
    }
    const { merged, added, preserved } = mergeModuleSettings(m.settings, fromYaml);
    diffs.push({ id: m.id, added, preserved, skipped: false });
    return { ...m, settings: merged };
  });

  const nextConfig: PlaybookConfig = { ...config, modules: nextModules };
  return {
    diffs,
    nextConfig,
    parserWarnings: parsed.validationWarnings.length,
    yamlBlockCount: parsed.blockCount,
  };
}

function formatDiff(diffs: ModuleDiff[]): string {
  const lines: string[] = [];
  for (const d of diffs) {
    if (d.skipped) {
      lines.push(`  - ${d.id}: SKIPPED (${d.reason})`);
      continue;
    }
    const summary: string[] = [];
    if (d.added.length > 0) summary.push(`+${d.added.length} (${d.added.join(", ")})`);
    if (d.preserved.length > 0)
      summary.push(`preserved ${d.preserved.length} (${d.preserved.join(", ")})`);
    if (summary.length === 0) summary.push("no-op (already up-to-date)");
    lines.push(`  - ${d.id}: ${summary.join("; ")}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { courseRefPath, playbookId, dryRun } = parseArgs(process.argv.slice(2));
  const fullPath = resolvePath(courseRefPath);
  const courseRefText = readFileSync(fullPath, "utf-8");

  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, name: true, config: true },
  });
  if (!pb) {
    console.error(`Playbook ${playbookId} not found`);
    process.exit(1);
  }
  console.log(`Playbook: ${pb.name} (${pb.id})`);
  console.log(`Course-ref: ${fullPath}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "WRITE"}`);
  console.log("");

  const config = (pb.config ?? {}) as PlaybookConfig;
  const plan = computeBackfillPlan(config, courseRefText);

  console.log(
    `Parser: ${plan.yamlBlockCount} YAML block(s) found; ${plan.parserWarnings} warning(s).`,
  );
  console.log("Diff:");
  console.log(formatDiff(plan.diffs));

  const totalAdded = plan.diffs.reduce((acc, d) => acc + d.added.length, 0);
  if (totalAdded === 0) {
    console.log("\nNo new settings to add. Exiting cleanly.");
    return;
  }

  if (dryRun) {
    console.log(`\nDRY-RUN: would add ${totalAdded} setting(s). No write performed.`);
    return;
  }

  // Write
  await prisma.playbook.update({
    where: { id: pb.id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { config: plan.nextConfig as any },
  });
  await bumpPlaybookComposeTimestamp(pb.id);
  console.log(
    `\nWROTE: ${totalAdded} setting(s) added across ${plan.diffs.filter((d) => d.added.length > 0).length} module(s). composeInputsUpdatedAt bumped.`,
  );
}

// Only run when invoked directly, not when imported (e.g., from tests).
const isDirectInvocation =
  typeof require !== "undefined" && require.main === module;
if (isDirectInvocation) {
  main()
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

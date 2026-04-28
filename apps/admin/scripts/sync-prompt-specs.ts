/**
 * Sync prompt-spec JSONs to the database.
 *
 * Idempotent. Run after pulling code that changed any
 * apps/admin/docs-archive/bdd-specs/PROMPT-*.spec.json files.
 *
 * Usage:
 *   npx tsx scripts/sync-prompt-specs.ts            # syncs every PROMPT-*
 *   npx tsx scripts/sync-prompt-specs.ts WIZ-RULES  # syncs slugs containing "WIZ-RULES"
 *
 * Why this exists:
 * The DB-seeded prompt specs (PROMPT-WIZ-PROPOSAL-001 etc.) take priority
 * over the hardcoded TS fallbacks. After deploying TS changes that mirror
 * spec JSONs, the DB still holds the old content until this script runs.
 * Without it, prompt changes ship to the binary but never reach the AI.
 */

import * as fs from "fs";
import * as path from "path";
import { seedFromSpecs } from "../prisma/seed-from-specs";

async function main() {
  const filter = process.argv[2]?.toUpperCase() ?? null;
  const specsFolder = path.join(process.cwd(), "docs-archive", "bdd-specs");

  if (!fs.existsSync(specsFolder)) {
    console.error(`[sync-prompt-specs] specs folder not found at ${specsFolder}`);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(specsFolder).filter((f) => f.startsWith("PROMPT-") && f.endsWith(".spec.json"));
  const matched = filter ? allFiles.filter((f) => f.toUpperCase().includes(filter)) : allFiles;

  if (matched.length === 0) {
    console.log(`[sync-prompt-specs] no matching prompt specs (filter: ${filter ?? "<none>"})`);
    process.exit(0);
  }

  const specIds = matched.map((f) => {
    const json = JSON.parse(fs.readFileSync(path.join(specsFolder, f), "utf-8"));
    return json.id as string;
  });

  console.log(`[sync-prompt-specs] syncing ${specIds.length} spec(s):`);
  for (const id of specIds) console.log(`  - ${id}`);

  const results = await seedFromSpecs({ specIds });
  const failed = results.filter((r) => r.error);

  if (failed.length > 0) {
    console.error(`[sync-prompt-specs] ${failed.length} failed:`);
    for (const r of failed) console.error(`  - ${r.specId}: ${r.error}`);
    process.exit(1);
  }

  console.log(`[sync-prompt-specs] ✓ synced ${results.length} spec(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[sync-prompt-specs] unhandled error:", err);
  process.exit(1);
});

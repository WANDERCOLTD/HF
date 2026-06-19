/**
 * Cleanup Orphan Parameters
 *
 * This script identifies and removes orphaned Parameter records that are
 * actually config values from non-MEASURE specs (IDENTITY, CONTENT, VOICE, GUARDRAIL).
 *
 * These "parameters" were incorrectly created as Parameter records when they
 * should only exist as config values in AnalysisSpec.config.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-orphan-parameters.ts --dry-run  # Preview changes
 *   npx ts-node scripts/cleanup-orphan-parameters.ts            # Execute cleanup
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface OrphanAnalysis {
  parameterId: string;
  name: string;
  domainGroup: string | null;
  computedBy: string | null;
  actions: number;
  targets: number;
  slugs: number;
  anchors: number;
  isOrphan: boolean;
  category: "delete" | "review" | "link" | "keep";
  reason: string;
}

// Config specs that should NOT create Parameter records
const CONFIG_SPEC_PATTERNS = [
  "IDENTITY",
  "TUT-",
  "VOICE-",
  "GUARD-",
  "CONTENT",
  "COMP-001", // Prompt composition config
  "COMPANION-", // Companion identity/config specs
  "COMP-CP-", // Communication preferences (config)
  "COMP-LC-", // Life context extraction (config)
  "COMP-IX-", // Interests/expertise extraction (config)
];

// Duplicate pairs where one should be deleted
const DUPLICATE_DELETIONS = [
  { delete: "BEH-ADAPT-TO-QUESTION-FREQUENCY", keep: "question_frequency", reason: "Duplicate of active question_frequency" },
  { delete: "response_length", keep: "BEH-RESPONSE-LENGTH-PREFERENCE", reason: "Duplicate of active response_length_preference" },
  { delete: "adapt_to_pace_preference", keep: "pace_preference", reason: "Both orphans, keeping shorter name" },
  { delete: "BEH-ADAPT-TO-INTERACTION-STYLE", keep: "interaction_style", reason: "Both orphans, keeping shorter name" },
];

async function analyzeParameters(): Promise<OrphanAnalysis[]> {
  const params = await prisma.parameter.findMany({
    orderBy: { parameterId: "asc" },
  });

  const results: OrphanAnalysis[] = [];

  for (const p of params) {
    const [actions, targets, slugs, anchors] = await Promise.all([
      prisma.analysisAction.count({ where: { parameterId: p.parameterId } }),
      prisma.behaviorTarget.count({ where: { parameterId: p.parameterId, effectiveUntil: null } }),
      prisma.promptSlugParameter.count({ where: { parameterId: p.parameterId } }),
      prisma.parameterScoringAnchor.count({ where: { parameterId: p.parameterId } }),
    ]);

    const isOrphan = actions === 0 && targets === 0 && slugs === 0;
    const source = p.computedBy || "";
    const id = p.parameterId;

    let category: "delete" | "review" | "link" | "keep" = "keep";
    let reason = "Active parameter with relationships";

    if (!isOrphan) {
      category = "keep";
      reason = `Active: ${actions} actions, ${targets} targets, ${slugs} slugs`;
    } else {
      // Check if it's a config value from a non-MEASURE spec
      const isConfigSpec = CONFIG_SPEC_PATTERNS.some((pattern) => source.includes(pattern));

      if (isConfigSpec) {
        category = "delete";
        reason = `Config value from ${source}`;
      } else if (source.includes("ADAPT-") || id.includes("adapt_to")) {
        category = "link";
        reason = "Adaptation parameter needs action link";
      } else if (id.includes("extraction")) {
        category = "review";
        reason = "Memory extraction parameter";
      } else if (id.includes("preference")) {
        category = "review";
        reason = "Preference parameter - may be duplicate";
      } else {
        category = "review";
        reason = `Unknown orphan category (source: ${source})`;
      }
    }

    // Check for explicit duplicate deletions
    const dupDeletion = DUPLICATE_DELETIONS.find((d) => d.delete === id);
    if (dupDeletion) {
      category = "delete";
      reason = dupDeletion.reason;
    }

    results.push({
      parameterId: p.parameterId,
      name: p.name,
      domainGroup: p.domainGroup,
      computedBy: p.computedBy,
      actions,
      targets,
      slugs,
      anchors,
      isOrphan,
      category,
      reason,
    });
  }

  return results;
}

async function deleteParameter(parameterId: string): Promise<void> {
  // Delete in order of dependencies
  await prisma.parameterScoringAnchor.deleteMany({ where: { parameterId } });
  await prisma.promptSlugParameter.deleteMany({ where: { parameterId } });
  await prisma.behaviorTarget.deleteMany({ where: { parameterId } });
  await prisma.analysisAction.updateMany({
    where: { parameterId },
    data: { parameterId: null },
  });
  await prisma.parameterTag.deleteMany({
    where: { parameter: { parameterId } },
  });
  await prisma.parameter.delete({ where: { parameterId } });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  console.log("\n🧹 ORPHAN PARAMETER CLEANUP\n");
  console.log("━".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes will be made)" : "EXECUTE"}`);
  console.log("");

  // Analyze all parameters
  console.log("📊 Analyzing parameters...\n");
  const analysis = await analyzeParameters();

  // Group by category
  const toDelete = analysis.filter((a) => a.category === "delete");
  const toReview = analysis.filter((a) => a.category === "review");
  const toLink = analysis.filter((a) => a.category === "link");
  const toKeep = analysis.filter((a) => a.category === "keep");

  console.log("📋 ANALYSIS SUMMARY:\n");
  console.log(`   Total parameters: ${analysis.length}`);
  console.log(`   ├─ Keep (active): ${toKeep.length}`);
  console.log(`   ├─ Delete (config values): ${toDelete.length}`);
  console.log(`   ├─ Review (need decision): ${toReview.length}`);
  console.log(`   └─ Link (need action links): ${toLink.length}`);
  console.log("");

  // Show what will be deleted
  console.log("🗑️  TO DELETE:\n");
  const deleteByDomain: Record<string, typeof toDelete> = {};
  for (const p of toDelete) {
    const domain = p.domainGroup || "uncategorized";
    if (!deleteByDomain[domain]) deleteByDomain[domain] = [];
    deleteByDomain[domain].push(p);
  }

  for (const [domain, params] of Object.entries(deleteByDomain).sort()) {
    console.log(`   ${domain}/ (${params.length})`);
    for (const p of params) {
      console.log(`     - ${p.parameterId}`);
      if (verbose) console.log(`       Reason: ${p.reason}`);
    }
  }
  console.log("");

  // Show review items
  if (toReview.length > 0) {
    console.log("🔍 NEEDS REVIEW:\n");
    for (const p of toReview) {
      console.log(`   - ${p.parameterId} (${p.domainGroup})`);
      console.log(`     Reason: ${p.reason}`);
    }
    console.log("");
  }

  // Show link items
  if (toLink.length > 0) {
    console.log("🔗 NEEDS ACTION LINKS:\n");
    for (const p of toLink) {
      console.log(`   - ${p.parameterId} (${p.domainGroup})`);
      console.log(`     Source: ${p.computedBy}`);
    }
    console.log("");
  }

  // Execute deletion if not dry run
  if (!dryRun && toDelete.length > 0) {
    console.log("🚀 EXECUTING CLEANUP...\n");

    let deleted = 0;
    let failed = 0;

    for (const p of toDelete) {
      try {
        await deleteParameter(p.parameterId);
        deleted++;
        if (verbose) console.log(`   ✓ Deleted: ${p.parameterId}`);
      } catch (e: any) {
        failed++;
        console.log(`   ✗ Failed to delete ${p.parameterId}: ${e.message}`);
      }
    }

    console.log("");
    console.log(`   ✅ Deleted: ${deleted} parameters`);
    if (failed > 0) console.log(`   ❌ Failed: ${failed} parameters`);
  } else if (dryRun) {
    console.log("💡 Run without --dry-run to execute cleanup.\n");
  }

  // Final stats
  const finalCount = await prisma.parameter.count();
  console.log(`\n📈 Final parameter count: ${finalCount}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("Error:", e);
    prisma.$disconnect();
    process.exit(1);
  });

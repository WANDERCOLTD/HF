/**
 * Fresh Institution Seed
 *
 * Clears all business data (institutions, users, callers, domains, etc.)
 * while preserving specs, parameters, institution types, AI config.
 *
 * Then creates:
 *   1. Institution "Human First" (type: school)
 *   2. Superadmin user linked to it
 *
 * Usage:
 *   npx tsx prisma/seed-fresh-institution.ts
 *   npx tsx prisma/seed-fresh-institution.ts --confirm   # Skip prompt
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as readline from "readline";

const prisma = new PrismaClient();

// ─── Tables to clear (FK-safe order: children → parents) ────────────────────
// PRESERVES: AnalysisSpec, AnalysisTrigger, AnalysisAction, Parameter,
//            ParameterTag, ParameterScoringAnchor, ParameterMapping, Tag,
//            AnalysisProfile, AnalysisProfileParameter, CompiledAnalysisSet,
//            PromptTemplate, PromptBlock, PromptSlug*, InstitutionType,
//            AIConfig, AIModel, UsageCostRate, SystemSetting

const TABLES_TO_CLEAR = [
  // Content & knowledge
  "AssertionMedia",
  "SubjectMedia",
  "ContentVocabulary",
  "ContentQuestion",
  "ContentAssertion",
  "ContentSource",
  "SubjectDomain",
  "SubjectSource",
  "PlaybookSubject",
  "Subject",
  "VectorEmbedding",
  "KnowledgeChunk",
  "KnowledgeDoc",
  "ParameterKnowledgeLink",
  "ProcessedFile",
  "MediaAsset",

  // Conversation & calls
  "ConversationArtifact",
  "CallAction",
  "InboundMessage",
  "CallMessage",
  "CallScore",
  "RewardScore",
  "BehaviorMeasurement",
  "CallTarget",
  "PipelineStep",
  "PipelineRun",
  "FailedCall",
  "PersonalityObservation",
  "Call",

  // Caller data
  "CallerModuleProgress",
  "CallerPersonalityProfile",
  "CallerPersonality",
  "CallerMemorySummary",
  "CallerMemory",
  "CallerAttribute",
  "CallerTarget",
  "CallerIdentity",
  "CallerCohortMembership",
  "CallerPlaybook",
  "Goal",
  "OnboardingSession",
  "ExcludedCaller",
  "ComposedPrompt",
  "PromptSlugSelection",
  "PromptSlugReward",
  "PromptSlugStats",
  "Caller",

  // Playbooks & curriculum
  "PlaybookItem",
  "CohortPlaybook",
  "PlaybookGroupSubject",
  "PlaybookGroup",
  "Playbook",
  "LearningObjective",
  "CurriculumModule",
  "Curriculum",

  // Behavior targets
  "BehaviorTarget",

  // Segments & domains
  "Segment",
  "ChannelConfig",
  "Domain",

  // Cohorts
  "CohortGroup",

  // Agent runs
  "AgentRun",
  "AgentInstance",

  // BDD
  "BDDUpload",
  "BDDFeatureSet",

  // Usage & logs
  "UsageEvent",
  "UsageRollup",
  "AuditLog",
  "AppLog",

  // Messaging & tickets
  "TicketComment",
  "Ticket",
  "Message",
  "UserTask",

  // Auth
  "Invite",
  "Session",
  "Account",

  // Users & institutions (last — parents)
  "User",
  "Institution",
];

async function clearTable(tableName: string): Promise<number> {
  try {
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM "${tableName}"`
    );
    return result;
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === "P2021") return 0;
    // FK violation — skip, will be retried implicitly by ordering
    if (prismaErr.code === "P2003") {
      console.log(`  ⚠ ${tableName}: FK constraint, skipping`);
      return 0;
    }
    throw err;
  }
}

async function getCount(tableName: string): Promise<number> {
  try {
    const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "${tableName}"`
    );
    return Number(result[0]?.count || 0);
  } catch {
    return 0;
  }
}

async function promptConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(
      "\n⚠️  This will DELETE all business data (institutions, users, callers, etc.)\n" +
        "   Specs and parameters will be preserved.\n" +
        "   Type 'yes' to confirm: ",
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes");
      }
    );
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipConfirm = args.includes("--confirm") || args.includes("-y");

  if (!skipConfirm) {
    const confirmed = await promptConfirmation();
    if (!confirmed) {
      console.log("\n❌ Cancelled.\n");
      process.exit(0);
    }
  }

  // ─── Step 1: Clear business data ─────────────────────────────────────────
  console.log("\n🗑️  CLEARING BUSINESS DATA\n");

  let totalCleared = 0;
  for (const tableName of TABLES_TO_CLEAR) {
    const before = await getCount(tableName);
    if (before > 0) {
      await clearTable(tableName);
      console.log(`  ✓ ${tableName}: ${before} rows deleted`);
      totalCleared += before;
    }
  }
  console.log(`\n  Total: ${totalCleared} rows cleared\n`);

  // ─── Step 2: Look up "school" institution type ───────────────────────────
  const schoolType = await prisma.institutionType.findUnique({
    where: { slug: "school" },
  });

  if (!schoolType) {
    console.error("❌ InstitutionType 'school' not found. Run seed-institution-types.ts first.");
    process.exit(1);
  }

  // ─── Step 3: Create Institution ──────────────────────────────────────────
  const institution = await prisma.institution.create({
    data: {
      name: "Human First",
      slug: "human-first",
      typeId: schoolType.id,
      primaryColor: "#4f46e5",
      secondaryColor: "#7c3aed",
    },
  });
  console.log(`🏫 Institution created: ${institution.name} (${institution.id})`);

  // ─── Step 4: Create superadmin user ──────────────────────────────────────
  const passwordHash = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.create({
    data: {
      email: "admin@hff.com",
      name: "Paul",
      role: "SUPERADMIN",
      passwordHash,
      institutionId: institution.id,
      activeInstitutionId: institution.id,
    },
  });
  const user2 = await prisma.user.create({
    data: {
      email: "boaz@tal.biz",
      name: "Boaz",
      role: "SUPERADMIN",
      passwordHash,
      institutionId: institution.id,
      activeInstitutionId: institution.id,
    },
  });
  console.log(`👤 Users created: ${user.email}, ${user2.email} (${user.role})`);

  console.log("\n✅ FRESH INSTITUTION READY\n");
  console.log("  Institution: Human First (school)");
  console.log("  Users: admin@hff.com / admin123, boaz@tal.biz / admin123");
  console.log("\n  Next: log in → wizard → build a course\n");
}

main()
  .catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

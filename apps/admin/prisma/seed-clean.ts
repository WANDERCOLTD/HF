/**
 * CLEAN SEED - Single Source of Truth
 *
 * This seed script follows the principle: ALL DATA FROM FILES, NOTHING HARDCODED.
 *
 * Data sources:
 * 1. docs-archive/bdd-specs/*.spec.json  → Parameters, Specs, Anchors, Slugs
 * 2. transcripts/                        → Real caller/call data from VAPI exports
 *
 * Usage:
 *   npx tsx prisma/seed-clean.ts
 *   npx tsx prisma/seed-clean.ts --reset    # Clear DB first
 *
 * NO fabricated callers. NO inline specs. NO mock data.
 */

import * as fs from "fs";
import * as path from "path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { seedFromSpecs, loadSpecFiles, setPrismaClient } from "./seed-from-specs";
import { seedToleranceParameters } from "./seed-tolerance-parameters";
import { seedProsodyParameters } from "./seed-prosody-parameters";
import { seedCioCtoBehTargets } from "./seed-cio-cto-beh-targets";
import { config } from "../lib/config";

let prisma: PrismaClient;

// =============================================================================
// CONFIGURATION
// =============================================================================

const TRANSCRIPTS_DIR = path.join(__dirname, "../transcripts");
const BDD_SPECS_DIR = path.join(__dirname, "../docs-archive/bdd-specs");

// =============================================================================
// CLEAR DATABASE (optional)
// =============================================================================

async function clearDatabase() {
  console.log("\n🗑️  CLEARING DATABASE\n");

  // Clear in FK-safe order (children → parents).
  // The blank-ielts seed profile depends on these clears actually firing —
  // earlier the FK-dependent tables (Goal, OnboardingSession, etc.) were
  // missing, so caller/call/playbook deletes failed silently and left
  // stale partner data behind on deployed envs.
  const tables = [
    // Call children
    "callAction",
    "callMessage",
    "inboundMessage",
    "conversationArtifact",
    "pipelineStep",
    "pipelineRun",
    "failedCall",
    "callerAttribute",
    "callerTarget",
    "callTarget",
    "rewardScore",
    "behaviorMeasurement",
    "callScore",
    "composedPrompt",
    "call",
    // Caller children that block caller delete
    "goal",
    "onboardingSession",
    "callerCohortMembership",
    "callerPlaybook",
    "callerModuleProgress",
    "excludedCaller",
    "promptSlugReward",
    "promptSlugStats",
    "callerMemorySummary",
    "callerMemory",
    "personalityObservation",
    "callerPersonalityProfile",
    "callerPersonality",
    "promptSlugSelection",
    "callerIdentity",
    "caller",
    // Playbook + curriculum children
    "behaviorTarget",
    "playbookSpec",
    "playbookItem",
    "cohortPlaybook",
    "playbookGroupSubject",
    "playbookGroup",
    "playbookSubject",
    "learningObjective",
    "curriculumModule",
    "curriculum",
    "playbook",
    // Subject/content
    "assertionMedia",
    "subjectMedia",
    "contentVocabulary",
    "contentQuestion",
    "contentAssertion",
    "contentSource",
    "subjectDomain",
    "subjectSource",
    "subject",
    "vectorEmbedding",
    "knowledgeChunk",
    "knowledgeDoc",
    "parameterKnowledgeLink",
    "processedFile",
    "mediaAsset",
    // Cohort + domain
    "cohortGroup",
    "agentRun",
    "agentInstance",
    "segment",
    "channelConfig",
    "domain",
    // Specs + their children
    "analysisAction",
    "analysisTrigger",
    "analysisSpec",
    "bDDUpload",
    "bDDFeatureSet",
    "promptSlugRange",
    "promptSlugParameter",
    "promptSlug",
    "promptBlock",
    "promptTemplate",
    "parameterScoringAnchor",
    "parameter",
  ];

  for (const table of tables) {
    try {
      // @ts-ignore
      const count = await prisma[table].count();
      if (count > 0) {
        // @ts-ignore
        await prisma[table].deleteMany();
        console.log(`   ✓ ${table}: ${count} rows cleared`);
      }
    } catch {
      // Table might not exist
    }
  }

  console.log("\n   ✅ Database cleared\n");
}

// =============================================================================
// LOAD BDD SPECS
// =============================================================================

async function loadSpecs() {
  const isProd = config.seed.isProd;
  const excludeIds = isProd ? config.seed.excludedSpecs : undefined;

  console.log("\n📋 LOADING BDD SPECS\n");
  console.log(`   Source: ${BDD_SPECS_DIR}`);

  const specFiles = loadSpecFiles(excludeIds);
  console.log(`   Found: ${specFiles.length} spec files\n`);

  if (specFiles.length === 0) {
    console.log("   ⚠️  No spec files found. Add .spec.json files to docs-archive/bdd-specs/\n");
    return;
  }

  // List what we're loading
  for (const { filename } of specFiles) {
    console.log(`   • ${filename}`);
  }

  console.log("\n   Activating specs...\n");

  const results = await seedFromSpecs({ excludeFeatureIds: excludeIds });

  console.log("\n   ✅ Specs loaded and activated\n");
  console.log(`      Parameters: ${results.reduce((sum, r) => sum + r.parametersCreated, 0)} created`);
  console.log(`      Specs: ${results.reduce((sum, r) => sum + r.specsCreated, 0)} created`);
  console.log(`      Anchors: ${results.reduce((sum, r) => sum + r.anchorsCreated, 0)} created`);
  console.log(`      Slugs: ${results.reduce((sum, r) => sum + r.promptSlugsCreated, 0)} created`);
}

// =============================================================================
// LOAD TRANSCRIPTS
// =============================================================================

interface VAPICall {
  id: string;
  transcript: string;
  summary?: string;
  customer?: { name?: string; number?: string } | null;
  startedAt?: string | null;
  endedAt?: string | null;
  status?: string;
  messages?: Array<{ role: string; message: string; time?: number }>;
  createdAt?: string;
}

async function loadTranscripts() {
  console.log("\n📞 LOADING TRANSCRIPTS\n");
  console.log(`   Source: ${TRANSCRIPTS_DIR}`);

  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    console.log("   ⚠️  Transcripts directory not found. Skipping.\n");
    return;
  }

  // Get first available domain (must exist - run seed-domains.ts first)
  const domain = await prisma.domain.findFirst();
  if (!domain) {
    console.log("   ⚠️  No domain found. Run seed-domains.ts first to create domains.");
    console.log("   Skipping transcript import.\n");
    return;
  }
  console.log(`   Using domain: ${domain.name} (${domain.slug})\n`);

  // Find all JSON/TXT files (recursively, including subdirectories)
  function findTranscriptFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTranscriptFiles(fullPath));
      } else if (entry.name.endsWith(".json") || entry.name.endsWith(".txt")) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const filePaths = findTranscriptFiles(TRANSCRIPTS_DIR);

  console.log(`   Found: ${filePaths.length} transcript files\n`);

  let callersCreated = 0;
  let callsCreated = 0;
  const callersByPhone = new Map<string, string>(); // phone -> callerId

  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, "utf-8");

    try {
      let calls: VAPICall[] = [];

      if (filename.endsWith(".json")) {
        const data = JSON.parse(content);
        calls = Array.isArray(data) ? data : [data];
      } else if (filename.endsWith(".txt")) {
        // Parse text transcript format
        const call = parseTextTranscript(content, filename);
        if (call) calls = [call];
      }

      for (const call of calls) {
        if (!call.transcript || call.transcript.trim().length < 50) continue;

        // Get or create caller
        const phone = typeof call.customer === "object"
          ? call.customer?.number || "unknown"
          : call.customer || "unknown";

        let callerId = callersByPhone.get(phone);
        if (!callerId) {
          const caller = await prisma.caller.create({
            data: {
              name: typeof call.customer === "object"
                ? call.customer?.name || `Caller ${phone.slice(-4)}`
                : `Caller ${phone.slice(-4)}`,
              phone,
              domainId: domain.id,
            },
          });
          callerId = caller.id;
          callersByPhone.set(phone, callerId);
          callersCreated++;
        }

        // Create call
        await prisma.call.create({
          data: {
            source: "vapi-import",
            externalId: call.id || `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            callerId,
            transcript: call.transcript,
            // Note: startedAt/endedAt removed - not in current schema
          },
        });
        callsCreated++;
      }
    } catch (e: any) {
      console.log(`   ⚠️  Error processing ${filename}: ${e.message}`);
    }
  }

  console.log(`   ✅ Imported ${callsCreated} calls from ${callersCreated} callers\n`);
}

function parseTextTranscript(content: string, filename: string): VAPICall | null {
  try {
    const lines = content.split("\n");
    let transcript = "";
    let phone = "unknown";
    let callerName = "";
    let inTranscript = false;

    for (const line of lines) {
      if (line.startsWith("Phone Number:")) {
        phone = line.replace("Phone Number:", "").trim();
      } else if (line.startsWith("Caller:")) {
        callerName = line.replace("Caller:", "").trim();
      } else if (line.trim() === "Transcript") {
        inTranscript = true;
      } else if (inTranscript && line.trim()) {
        transcript += line + "\n";
      }
    }

    if (!transcript.trim()) return null;

    const idMatch = filename.match(/(?:log[_ ]?(?:id[_ ]?)?)([a-f0-9-]{36})/i);
    return {
      id: idMatch?.[1] || filename.replace(/\.[^.]+$/, ""),
      transcript: transcript.trim(),
      customer: { number: phone, name: callerName || undefined },
    };
  } catch {
    return null;
  }
}

// =============================================================================
// CREATE MINIMAL INFRASTRUCTURE
// =============================================================================

async function createInfrastructure() {
  console.log("\n🏗️  CREATING INFRASTRUCTURE\n");

  // Ensure admin user exists (needed for login, e2e tests, screenshot capture)
  // SEED_ADMIN_EMAIL: override login email per environment (default: admin@test.com)
  // SEED_ADMIN_PASSWORD: required in production, defaults to admin123 in dev
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@test.com";
  if (process.env.NODE_ENV === "production" && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be set in production. Refusing to seed with default password."
    );
  }
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(seedPassword, 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: adminEmail,
      name: "Admin",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash,
    },
  });
  console.log(`   ✓ Admin user ready: ${adminEmail} (SUPERADMIN)`);

  // Ensure Boaz superadmin exists
  await prisma.user.upsert({
    where: { email: "boaz@tal.biz" },
    update: { passwordHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: "boaz@tal.biz",
      name: "Boaz Tal",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash,
    },
  });
  console.log(`   ✓ Admin user ready: boaz@tal.biz (SUPERADMIN)`);

  // Ensure Eldar superadmin exists
  await prisma.user.upsert({
    where: { email: "eldar.gilad@gmail.com" },
    update: { passwordHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: "eldar.gilad@gmail.com",
      name: "Eldar Gilad",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash,
    },
  });
  console.log(`   ✓ Admin user ready: eldar.gilad@gmail.com (SUPERADMIN)`);

  // Partner test accounts (short-email aliases for easier login)
  await prisma.user.upsert({
    where: { email: "b@test.com" },
    update: { passwordHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: "b@test.com",
      name: "B Test",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash,
    },
  });
  console.log(`   ✓ Admin user ready: b@test.com (SUPERADMIN)`);

  await prisma.user.upsert({
    where: { email: "e@test.com" },
    update: { passwordHash, role: "SUPERADMIN", isActive: true },
    create: {
      email: "e@test.com",
      name: "E Test",
      role: "SUPERADMIN",
      isActive: true,
      passwordHash,
    },
  });
  console.log(`   ✓ Admin user ready: e@test.com (SUPERADMIN)`);

  // NOTE: Default domain and playbook creation removed
  // Use seed-domains.ts and BDD-based seeding for proper domain/playbook setup
  console.log("   ℹ️  Skipping default domain/playbook creation");
  console.log("   → Use seed-domains.ts for proper domain setup");
  console.log("   → Use BDD specs for playbook creation");

  console.log("\n   ✅ Infrastructure ready\n");
}

// =============================================================================
// MAIN
// =============================================================================

export async function main(externalPrisma?: PrismaClient, opts?: { reset?: boolean }) {
  prisma = externalPrisma || new PrismaClient();
  setPrismaClient(prisma);

  const args = process.argv.slice(2);
  const shouldReset = opts?.reset ?? (args.includes("--reset") || args.includes("-r"));
  const seedMode = config.seed.mode;
  const isProd = config.seed.isProd;

  console.log("\n" + "═".repeat(60));
  console.log(`  🌱 CLEAN SEED - ${isProd ? "PROD" : "FULL"} mode`);
  console.log("═".repeat(60));

  if (isProd) {
    console.log("\n  🔒 SEED_MODE=prod — infrastructure specs + domains only");
    console.log("  Skipping: demo fixtures, transcripts, dev-only specs");
    console.log(`  Excluded specs: ${config.seed.excludedSpecs.join(", ")}`);
  } else {
    console.log("\n  Data Sources:");
    console.log("  • docs-archive/bdd-specs/*.spec.json  → Specs, Parameters, Anchors");
    console.log("  • transcripts/           → Real caller/call data");
  }
  console.log("\n  NO hardcoded data. NO mock callers. NO inline specs.\n");

  if (shouldReset) {
    await clearDatabase();
  }

  // 1. Load BDD specs (prod mode excludes dev-only specs)
  await loadSpecs();

  // 1b. Seed tolerance parameter rows (#598 Slice 1). Idempotent; lives outside
  // the spec-driven flow because TOL-* parameters are system knobs, not
  // measurement parameters.
  const toleranceResult = await seedToleranceParameters(prisma);
  console.log(
    `   ✓ Tolerance parameters: ${toleranceResult.created} created, ${toleranceResult.updated} updated`,
  );

  // 1b'. Seed prosody parameter slots (2026-06-15 audit follow-on). Splits
  // vendor-derived voice signals into their own param IDs so they don't
  // overwrite EXTRACT's AI-judged CONV_PACE / pace_indicators. See the
  // seed file's header for the full rationale.
  const prosodyResult = await seedProsodyParameters(prisma);
  console.log(
    `   ✓ Prosody parameters: ${prosodyResult.created} created, ${prosodyResult.updated} updated`,
  );

  // 1c. Seed CIO/CTO variant-trio BEH-* BehaviorTarget overlays (G4 / #1145).
  // Idempotent; runs after the Parameter rows exist (Step 1b) but before
  // infrastructure (Step 2) so the CIO/CTO Playbooks pick them up on first
  // pipeline call. Skips gracefully when the CIO/CTO Playbooks don't exist
  // (fresh DB before the variant trio is created).
  const cioCtoResult = await seedCioCtoBehTargets(prisma);
  console.log(
    `   ✓ CIO/CTO BEH-* targets: ${cioCtoResult.targetsWritten} written across ${cioCtoResult.playbooksProcessed} playbook(s) (${cioCtoResult.playbooksSkipped} skipped — playbook not present)`,
  );

  // 2. Create minimal infrastructure (domain, playbook)
  await createInfrastructure();

  // 3. Load real transcripts (skip in prod — real data arrives via VAPI)
  if (isProd) {
    console.log("\n📞 SKIPPING TRANSCRIPTS (SEED_MODE=prod)\n");
    console.log("   Real caller data will arrive via VAPI webhook.\n");
  } else {
    await loadTranscripts();
  }

  // Summary
  const specCount = await prisma.analysisSpec.count();
  const paramCount = await prisma.parameter.count();
  const callerCount = await prisma.caller.count();
  const callCount = await prisma.call.count();

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ SEED COMPLETE");
  console.log("═".repeat(60));
  console.log(`\n  Specs:      ${specCount}`);
  console.log(`  Parameters: ${paramCount}`);
  console.log(`  Callers:    ${callerCount}`);
  console.log(`  Calls:      ${callCount}`);
  console.log("\n  Next: Go to /x to configure playbooks and generate prompts\n");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("❌ Seed failed:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

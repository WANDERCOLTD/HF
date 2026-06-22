import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { seedCompanionDomain } from "../../../../prisma/_archived/seed-companion";
import { seedFromSpecs } from "../../../../prisma/seed-from-specs";
import { PARAMS } from "@/lib/registry";
import { resolveCanonicalDomainGroup } from "@/lib/registry/canonical-domain-group";

/**
 * @api POST /api/x/seed-domains
 * @visibility internal
 * @scope dev:seed
 * @auth bearer
 * @tags dev-tools
 * @description Creates default domains (WNF TUTOR and COMPANION) with all required infrastructure: domains, playbooks, analysis specs, parameters, prompt templates, behavior targets, and playbook items. Syncs BDD specs first to ensure all specs exist before linking to playbooks.
 * @response 200 { ok: boolean, message: "...", details: { domainsCreated: [...], playbooksCreated: [...], specsCreated: number, specsSynced: number, parametersCreated: number, errors: [...] } }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST() {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const results = {
      domainsCreated: [] as string[],
      playbooksCreated: [] as string[],
      specsCreated: 0,
      specsSynced: 0,
      parametersCreated: 0,
      errors: [] as string[],
    };

    // ============================================
    // PREREQUISITE: SYNC BDD SPECS
    // ============================================
    // First ensure all BDD specs are synced from docs-archive/bdd-specs/ folder
    // This is critical because domain creation links specs to playbooks
    try {
      console.log("Syncing BDD specs first...");
      const specResults = await seedFromSpecs();
      results.specsSynced = specResults.length;
      const totalParams = specResults.reduce((acc, r) => acc + r.parametersCreated + r.parametersUpdated, 0);
      console.log(`   ✓ Synced ${specResults.length} specs (${totalParams} parameters)`);
    } catch (e: any) {
      console.error("Error syncing BDD specs:", e);
      results.errors.push(`BDD SPECS: ${e.message}`);
    }

    // ============================================
    // PREREQUISITE: BEHAVIOR PARAMETERS
    // ============================================
    // Create essential behavior parameters if they don't exist
    // These are needed by both COMPANION and WNF domains
    try {
      console.log("Ensuring behavior parameters exist...");
      const createdCount = await ensureBehaviorParameters(prisma);
      results.parametersCreated += createdCount;
      console.log(`   ✓ Ensured ${createdCount} behavior parameters`);
    } catch (e: any) {
      console.error("Error creating behavior parameters:", e);
      results.errors.push(`BEHAVIOR PARAMS: ${e.message}`);
    }

    // ============================================
    // COMPANION DOMAIN
    // ============================================
    try {
      console.log("Creating COMPANION domain...");
      await seedCompanionDomain(prisma);
      results.domainsCreated.push("companion");
      results.playbooksCreated.push("Companion Playbook v1");

      // Count what was created
      const companionSpecs = await prisma.analysisSpec.count({
        where: { slug: { startsWith: "companion-" } },
      });
      results.specsCreated += companionSpecs;
    } catch (e: any) {
      console.error("Error creating COMPANION domain:", e);
      results.errors.push(`COMPANION: ${e.message}`);
    }

    // ============================================
    // WNF TUTOR DOMAIN
    // ============================================
    try {
      console.log("Creating WNF TUTOR domain...");
      await createWNFTutorDomain(prisma, results);
      results.domainsCreated.push("wnf");
      results.playbooksCreated.push("WNF Tutor Playbook v1");
    } catch (e: any) {
      console.error("Error creating WNF TUTOR domain:", e);
      results.errors.push(`WNF TUTOR: ${e.message}`);
    }

    const message =
      results.errors.length === 0
        ? `Synced ${results.specsSynced} specs, created ${results.domainsCreated.length} domains with ${results.playbooksCreated.length} playbooks, ${results.specsCreated} linked specs, ${results.parametersCreated} parameters`
        : `Synced ${results.specsSynced} specs, created ${results.domainsCreated.length} domains with ${results.errors.length} errors`;

    return NextResponse.json({
      ok: results.errors.length === 0,
      message,
      details: results,
    });
  } catch (error: any) {
    console.error("POST /api/x/seed-domains error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to create domains",
      },
      { status: 500 }
    );
  }
}

/**
 * Creates the WNF (Why Nations Fail) TUTOR domain
 * This is a simplified version focused on tutoring/teaching
 */
async function createWNFTutorDomain(
  prisma: PrismaClient,
  results: { specsCreated: number; parametersCreated: number }
) {
  // Delete existing WNF domain if it exists
  const existingDomain = await prisma.domain.findUnique({
    where: { slug: "wnf" },
  });

  if (existingDomain) {
    const playbooks = await prisma.playbook.findMany({
      where: { domainId: existingDomain.id },
    });
    for (const pb of playbooks) {
      await prisma.behaviorTarget.deleteMany({ where: { playbookId: pb.id } });
      await prisma.playbookItem.deleteMany({ where: { playbookId: pb.id } });
      await prisma.playbook.delete({ where: { id: pb.id } });
    }
    await prisma.domain.delete({ where: { id: existingDomain.id } });
    console.log("   🗑️  Deleted existing WNF domain");
  }

  // Create WNF domain
  const domain = await prisma.domain.create({
    data: {
      slug: "wnf",
      name: "Why Nations Fail - Tutor",
      description:
        "Socratic tutoring for Why Nations Fail curriculum - intelligent questioning, engagement, and knowledge building",
      isDefault: false,
      isActive: true,
    },
  });
  console.log(`   ✓ Created domain: ${domain.name}`);

  // Create WNF playbook
  const playbook = await prisma.playbook.create({
    data: {
      name: "WNF Tutor Playbook v1",
      description: "Socratic tutoring optimized for Why Nations Fail content",
      domainId: domain.id,
      status: "PUBLISHED",
      version: "1.0",
    },
  });
  console.log(`   ✓ Created playbook: ${playbook.name}`);

  // Set behavior targets for tutoring style
  const tutorTargets = [
    { parameterId: PARAMS.BEH_WARMTH, targetValue: 0.7 },
    { parameterId: PARAMS.BEH_EMPATHY_RATE, targetValue: 0.6 },
    { parameterId: PARAMS.BEH_FORMALITY, targetValue: 0.5 },
    { parameterId: PARAMS.BEH_DIRECTNESS, targetValue: 0.6 },
    { parameterId: PARAMS.BEH_PROACTIVE, targetValue: 0.8 },
    { parameterId: PARAMS.BEH_QUESTION_RATE, targetValue: 0.75 }, // High questioning for Socratic method
    { parameterId: PARAMS.BEH_PACE_MATCH, targetValue: 0.8 },
  ];

  let targetCount = 0;
  for (const target of tutorTargets) {
    const param = await prisma.parameter.findUnique({
      where: { parameterId: target.parameterId },
    });

    if (param) {
      await prisma.behaviorTarget.create({
        data: {
          parameterId: target.parameterId,
          playbookId: playbook.id,
          scope: "PLAYBOOK",
          targetValue: target.targetValue,
          confidence: 1.0,
          source: "SEED",
        },
      });
      targetCount++;
    }
  }
  console.log(`   ✓ Created ${targetCount} behavior targets`);

  // Link any existing tutoring/WNF specs to playbook
  const educationSpecs = await prisma.analysisSpec.findMany({
    where: {
      OR: [
        { slug: { contains: "tut" } },
        { slug: { contains: "wnf" } },
        { slug: { contains: "curriculum" } },
        { domain: "identity" },
        { domain: "content" },
        { domain: "curriculum" },
        { domain: "session" },
        { domain: "engagement" },
        { domain: "memory" },
        { domain: "goals" },
      ],
      isActive: true,
    },
  });

  for (const spec of educationSpecs) {
    await prisma.playbookItem.create({
      data: {
        playbookId: playbook.id,
        itemType: "SPEC",
        specId: spec.id,
        isEnabled: true,
        sortOrder: 0,
      },
    });
  }
  console.log(`   ✓ Linked ${educationSpecs.length} specs to playbook`);

  results.specsCreated += educationSpecs.length;
}

/**
 * Ensures essential behavior parameters exist
 * These parameters are needed by domain playbooks for behavior targets
 */
async function ensureBehaviorParameters(prisma: PrismaClient): Promise<number> {
  const essentialBehaviorParams = [
    {
      parameterId: PARAMS.BEH_WARMTH,
      name: "Warmth Level",
      definition: "Overall warmth and friendliness in agent tone",
      sectionId: "behavior",
      domainGroup: "empathy",
      interpretationHigh: "Agent is warm, friendly, and approachable",
      interpretationLow: "Agent is neutral or distant in tone",
    },
    {
      parameterId: PARAMS.BEH_EMPATHY_RATE,
      name: "Empathy Expression Rate",
      definition: "Frequency of empathetic statements, acknowledgments, and emotional validation",
      sectionId: "behavior",
      domainGroup: "empathy",
      interpretationHigh: "Agent frequently expresses empathy and validates emotions",
      interpretationLow: "Agent maintains neutral, task-focused communication",
    },
    {
      parameterId: PARAMS.BEH_FORMALITY,
      name: "Formality Level",
      definition: "Degree of formal vs casual language in agent responses",
      sectionId: "behavior",
      domainGroup: "communication",
      interpretationHigh: "Agent uses formal, professional language",
      interpretationLow: "Agent uses casual, conversational language",
    },
    {
      parameterId: PARAMS.BEH_DIRECTNESS,
      name: "Directness Level",
      definition: "How direct vs indirect the agent is in communication",
      sectionId: "behavior",
      domainGroup: "communication",
      interpretationHigh: "Agent is direct and to-the-point",
      interpretationLow: "Agent is indirect and nuanced",
    },
    {
      parameterId: PARAMS.BEH_PROACTIVE,
      name: "Proactivity Level",
      definition: "How proactively the agent offers information, suggestions, or guidance",
      sectionId: "behavior",
      domainGroup: "engagement",
      interpretationHigh: "Agent proactively offers help and suggestions",
      interpretationLow: "Agent waits for caller to ask or lead",
    },
    {
      parameterId: PARAMS.BEH_QUESTION_RATE,
      name: "Question Asking Rate",
      definition: "Frequency of questions asked by the agent to engage the caller",
      sectionId: "behavior",
      domainGroup: "engagement",
      interpretationHigh: "Agent asks many questions to engage caller",
      interpretationLow: "Agent primarily provides information without questions",
    },
    {
      parameterId: PARAMS.BEH_PACE_MATCH,
      name: "Pace Matching",
      definition: "How well the agent matches the caller's conversational pace and energy",
      sectionId: "behavior",
      domainGroup: "adaptation",
      interpretationHigh: "Agent closely matches caller's pace and energy",
      interpretationLow: "Agent maintains own pace regardless of caller",
    },
  ];

  let createdCount = 0;

  for (const param of essentialBehaviorParams) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });

    if (!existing) {
      // #2031 follow-on — route every Parameter.domainGroup write
      // through the canonical resolver. The hardcoded values in this
      // file's seed table (`empathy`, `communication`, `engagement`,
      // `adaptation`) are mostly off-canonical (only `engagement` is
      // in the v1.0 12-tuple); the resolver rejects off-canonical
      // values and the fallback `"behavior-core"` is the catch-all
      // canonical default per Group A `style → behavior-core` in
      // docs/decisions/2026-06-19-parameter-domain-group-mapping.md.
      // Author MUST update the hardcoded `domainGroup` fields in
      // `essentialBehaviorParams` to canonical values to retain the
      // original pedagogical intent (e.g. `empathy` →
      // `behavior-core`, `communication` → `behavior-core`,
      // `adaptation` → `learning-adaptation`).
      const canonicalDomainGroup =
        resolveCanonicalDomainGroup({ domainGroup: param.domainGroup }) ??
        "behavior-core";
      await prisma.parameter.create({
        data: {
          parameterId: param.parameterId,
          name: param.name,
          definition: param.definition,
          sectionId: param.sectionId,
          domainGroup: canonicalDomainGroup,
          interpretationHigh: param.interpretationHigh,
          interpretationLow: param.interpretationLow,
          scaleType: "0-1",
          directionality: "neutral",
          computedBy: "measure_agent",
          parameterType: "BEHAVIOR",
          isAdjustable: true,
        },
      });
      createdCount++;
    }
  }

  return createdCount;
}

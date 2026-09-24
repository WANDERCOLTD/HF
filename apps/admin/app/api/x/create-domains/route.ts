import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCanonicalDomainGroup } from "@/lib/registry/canonical-domain-group";
import * as fs from "fs";
import * as path from "path";

interface PlaybookConfig {
  id: string;
  name: string;
  description: string;
  domain: {
    slug: string;
    name: string;
    description: string;
  };
  status: "DRAFT" | "PUBLISHED";
  version: string;
  identitySpecs?: string[];
  contentSpecs?: string[];
  goals?: Array<{
    type: "LEARN" | "ACHIEVE" | "CHANGE" | "CONNECT" | "SUPPORT" | "CREATE";
    name: string;
    description: string;
    contentSpecSlug?: string;
    isDefault?: boolean;
    priority?: number;
  }>;
  includeSpecs: {
    required: string[];
    optional: string[];
    systemDomains: string[];
  };
  behaviorTargets: Record<string, number>;
}

interface PlaybooksManifest {
  version: string;
  playbooks: PlaybookConfig[];
}

/**
 * @api POST /api/x/create-domains
 * @visibility internal
 * @scope dev:seed
 * @auth bearer
 * @tags dev-tools
 * @note INFRASTRUCTURE TOOL — intentionally reads from disk. This is a bootstrap/seeding endpoint, not runtime code. playbooks-config.json is the version-controlled template; the database Playbook table is the runtime source of truth.
 * @description Creates domains and playbooks from playbooks-config.json. Ensures behavior parameters exist, creates SYSTEM-level BehaviorTargets, then creates selected or all domains and playbooks with auto-linked specs. All created playbooks are set to PUBLISHED status.
 * @body playbookIds string[] - Specific playbook IDs to create (optional, creates all if omitted)
 * @response 200 { ok: boolean, message: "...", details: { domainsCreated: [...], playbooksCreated: [...], specsLinked: number, parametersCreated: number, systemTargetsCreated: number, errors: [...] } }
 * @response 400 { ok: false, error: "No playbooks found to create" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json().catch(() => ({}));
    const selectedPlaybookIds: string[] | undefined = body.playbookIds;

    const results = {
      domainsCreated: [] as string[],
      playbooksCreated: [] as string[],
      specsLinked: 0,
      parametersCreated: 0,
      systemTargetsCreated: 0,
      errors: [] as string[],
    };

    // Load playbooks config
    const configPath = path.join(process.cwd(), "docs-archive", "bdd-specs", "playbooks-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(`Playbooks config not found at ${configPath}`);
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    const manifest: PlaybooksManifest = JSON.parse(configContent);

    // Filter playbooks if specific IDs requested
    const playbooksToCreate = selectedPlaybookIds
      ? manifest.playbooks.filter(pb => selectedPlaybookIds.includes(pb.id))
      : manifest.playbooks;

    if (playbooksToCreate.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No playbooks found to create",
      }, { status: 400 });
    }

    console.log(`Creating ${playbooksToCreate.length} playbooks...`);

    // ============================================
    // STEP 1: ENSURE BEHAVIOR PARAMETERS
    // ============================================
    try {
      console.log("STEP 1/3: Ensuring behavior parameters exist...");
      const createdCount = await ensureBehaviorParameters(prisma);
      results.parametersCreated += createdCount;
      console.log(`   ✓ Ensured ${createdCount} behavior parameters`);
    } catch (e: any) {
      console.error("Error creating behavior parameters:", e);
      results.errors.push(`BEHAVIOR PARAMS: ${e.message}`);
    }

    // ============================================
    // STEP 2: ENSURE SYSTEM-LEVEL BEHAVIOR TARGETS
    // ============================================
    try {
      console.log("STEP 2/3: Ensuring SYSTEM-level BehaviorTargets...");
      const allBehaviorParams = await prisma.parameter.findMany({
        where: { parameterType: "BEHAVIOR" },
        select: { parameterId: true, name: true },
      });
      const existingTargets = await prisma.behaviorTarget.findMany({
        where: { scope: "SYSTEM", effectiveUntil: null },
        select: { parameterId: true },
      });
      const existingParamIds = new Set(existingTargets.map(t => t.parameterId));

      let targetsCreated = 0;
      for (const param of allBehaviorParams) {
        if (!existingParamIds.has(param.parameterId)) {
          await prisma.behaviorTarget.create({
            data: {
              parameterId: param.parameterId,
              scope: "SYSTEM",
              targetValue: 0.5,
              confidence: 0.5,
              source: "SEED",
            },
          });
          targetsCreated++;
        }
      }
      results.systemTargetsCreated = targetsCreated;
      console.log(`   ✓ Created ${targetsCreated} new SYSTEM-level BehaviorTargets`);
    } catch (e: any) {
      console.error("Error creating SYSTEM targets:", e);
      results.errors.push(`SYSTEM TARGETS: ${e.message}`);
    }

    // ============================================
    // STEP 3: CREATE PLAYBOOKS FROM CONFIG
    // ============================================
    try {
      console.log("STEP 3/3: Creating domains and playbooks...");

      for (const config of playbooksToCreate) {
        try {
          const specsLinked = await createPlaybookFromConfig(prisma, config);
          results.domainsCreated.push(config.domain.slug);
          results.playbooksCreated.push(config.name);
          results.specsLinked += specsLinked;
        } catch (e: any) {
          console.error(`Error creating playbook ${config.id}:`, e);
          results.errors.push(`${config.id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      console.error("Error creating playbooks from config:", e);
      results.errors.push(`PLAYBOOKS CONFIG: ${e.message}`);
    }

    const message =
      results.errors.length === 0
        ? `Successfully created ${results.domainsCreated.length} domains with ${results.playbooksCreated.length} playbooks (${results.specsLinked} specs linked)`
        : `Completed with ${results.errors.length} errors: ${results.domainsCreated.length} domains created`;

    return NextResponse.json({
      ok: results.errors.length === 0,
      message,
      details: results,
    });
  } catch (error: any) {
    console.error("POST /api/x/create-domains error:", error);
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
 * @api GET /api/x/create-domains
 * @visibility internal
 * @scope dev:read
 * @auth bearer
 * @tags dev-tools
 * @note INFRASTRUCTURE TOOL — intentionally reads from disk. playbooks-config.json is bootstrap template data.
 * @description Returns available playbooks from playbooks-config.json for selection UI, including spec counts and behavior target counts.
 * @response 200 { ok: true, playbooks: [{ id, name, description, domain, status, specCount, behaviorTargetCount, identitySpecs, contentSpecs, requiredSpecs, optionalSpecs, systemDomains }] }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET() {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const configPath = path.join(process.cwd(), "docs-archive", "bdd-specs", "playbooks-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(`Playbooks config not found at ${configPath}`);
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    const manifest: PlaybooksManifest = JSON.parse(configContent);

    const playbooks = manifest.playbooks.map(pb => ({
      id: pb.id,
      name: pb.name,
      description: pb.description,
      domain: pb.domain,
      status: pb.status,
      specCount:
        (pb.identitySpecs?.length || 0) +
        (pb.contentSpecs?.length || 0) +
        pb.includeSpecs.required.length +
        pb.includeSpecs.optional.length,
      behaviorTargetCount: Object.keys(pb.behaviorTargets).length,
      identitySpecs: pb.identitySpecs || [],
      contentSpecs: pb.contentSpecs || [],
      requiredSpecs: pb.includeSpecs.required,
      optionalSpecs: pb.includeSpecs.optional,
      systemDomains: pb.includeSpecs.systemDomains,
    }));

    return NextResponse.json({
      ok: true,
      playbooks,
    });
  } catch (error: any) {
    console.error("GET /api/x/create-domains error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to load playbooks config",
      },
      { status: 500 }
    );
  }
}

/**
 * Creates a domain and playbook from config.
 * Returns the number of specs linked.
 */
async function createPlaybookFromConfig(
  prisma: PrismaClient,
  config: PlaybookConfig
): Promise<number> {
  console.log(`   Creating ${config.domain.slug} domain...`);

  // Delete existing domain if it exists
  const existingDomain = await prisma.domain.findUnique({
    where: { slug: config.domain.slug },
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
    console.log(`   🗑️  Deleted existing ${config.domain.slug} domain`);
  }

  // Create domain
  const domain = await prisma.domain.create({
    data: {
      slug: config.domain.slug,
      name: config.domain.name,
      description: config.domain.description,
      isDefault: false,
      isActive: true,
    },
  });
  console.log(`   ✓ Created domain: ${domain.name}`);

  // Create playbook (PUBLISHED)
  const playbook = await prisma.playbook.create({
    data: {
      name: config.name,
      description: config.description,
      domainId: domain.id,
      status: "PUBLISHED", // Always publish
      version: config.version,
      config: {
        goals: config.goals || [],
      } as any,
    },
  });
  console.log(`   ✓ Created playbook: ${playbook.name} (PUBLISHED)`);

  // Set behavior targets
  let targetCount = 0;
  for (const [parameterId, targetValue] of Object.entries(config.behaviorTargets)) {
    const param = await prisma.parameter.findUnique({
      where: { parameterId },
    });

    if (param) {
      await prisma.behaviorTarget.create({
        data: {
          parameterId,
          playbookId: playbook.id,
          scope: "PLAYBOOK",
          targetValue,
          confidence: 1.0,
          source: "SEED",
        },
      });
      targetCount++;
    }
  }
  console.log(`   ✓ Created ${targetCount} behavior targets`);

  // Link specs to playbook
  const specsToLink = await findSpecsForPlaybook(prisma, config);

  for (const spec of specsToLink) {
    // Ensure spec is active and published
    await prisma.analysisSpec.update({
      where: { id: spec.id },
      data: {
        isActive: true,
        isDirty: false,
      },
    });

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
  console.log(`   ✓ Linked ${specsToLink.length} specs to playbook (all published)`);

  return specsToLink.length;
}

/**
 * Finds all specs that should be linked to a playbook based on config.
 * Auto-resolves dependencies from identity, content, required, optional, and system domains.
 */
async function findSpecsForPlaybook(
  prisma: PrismaClient,
  config: PlaybookConfig
) {
  const specIds = new Set<string>();

  // Collect all spec IDs from config
  const configSpecIds = [
    ...(config.identitySpecs || []),
    ...(config.contentSpecs || []),
    ...config.includeSpecs.required,
    ...config.includeSpecs.optional,
  ];

  // Find specs by their feature ID (from BDD spec files)
  for (const featureId of configSpecIds) {
    const spec = await prisma.analysisSpec.findFirst({
      where: {
        slug: {
          contains: featureId.toLowerCase().replace(/_/g, "-"),
        },
        isActive: true,
      },
      select: { id: true },
    });

    if (spec) {
      specIds.add(spec.id);
    }
  }

  // Auto-include system domain specs
  const systemSpecs = await prisma.analysisSpec.findMany({
    where: {
      domain: { in: config.includeSpecs.systemDomains },
      isActive: true,
    },
    select: { id: true },
  });

  for (const spec of systemSpecs) {
    specIds.add(spec.id);
  }

  // Fetch full spec objects
  return await prisma.analysisSpec.findMany({
    where: { id: { in: Array.from(specIds) } },
  });
}

/**
 * Ensures all behavior parameters from the canonical registry exist.
 */
async function ensureBehaviorParameters(prisma: PrismaClient): Promise<number> {
  const registryPath = path.join(process.cwd(), "docs-archive", "bdd-specs", "behavior-parameters.registry.json");
  if (!fs.existsSync(registryPath)) {
    console.warn("   ⚠️ behavior-parameters.registry.json not found — skipping");
    return 0;
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const registryParams: Array<{
    parameterId: string;
    name: string;
    definition: string;
    domainGroup: string;
    defaultTarget: number;
    interpretationHigh: string;
    interpretationLow: string;
  }> = registry.parameters;

  let createdCount = 0;

  for (const param of registryParams) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });

    if (!existing) {
      // #2031 follow-on — route every Parameter.domainGroup write
      // through the canonical resolver. Defence in depth against
      // registry-JSON edits introducing off-canonical values.
      const canonicalDomainGroup =
        resolveCanonicalDomainGroup({ domainGroup: param.domainGroup }) ??
        "behavior-core";
      await prisma.parameter.create({
        data: {
          parameterId: param.parameterId,
          name: param.name,
          definition: param.definition,
          sectionId: "behavior",
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

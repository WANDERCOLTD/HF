import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { seedFromSpecs } from "../../../../prisma/seed-from-specs";
import { clearAIConfigCache } from "@/lib/ai/config-loader";
import { clearSystemSettingsCache } from "@/lib/system-settings";
import { resolveCanonicalDomainGroup } from "@/lib/registry/canonical-domain-group";
import * as fs from "fs";
import * as path from "path";

interface GoalConfig {
  type: "LEARN" | "ACHIEVE" | "CHANGE" | "CONNECT" | "SUPPORT" | "CREATE";
  name: string;
  description: string;
  contentSpecSlug?: string; // For LEARN goals
  isDefault?: boolean;
  priority?: number;
}

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
  identitySpecs?: string[]; // Spec IDs for identity
  contentSpecs?: string[]; // Spec IDs for content
  goals?: GoalConfig[]; // Goals for this playbook
  includeSpecs: {
    required: string[]; // Required spec IDs
    optional: string[]; // Optional spec IDs
    systemDomains: string[]; // System domains to auto-include (e.g., "engagement", "memory")
  };
  behaviorTargets: Record<string, number>; // parameterId -> targetValue
}

interface PlaybooksManifest {
  version: string;
  playbooks: PlaybookConfig[];
}

/**
 * @api POST /api/x/seed-system
 * @visibility internal
 * @scope dev:seed
 * @auth bearer
 * @tags dev-tools
 * @note INFRASTRUCTURE TOOL — intentionally reads from disk. This is the full system bootstrap endpoint. Config files (playbooks-config.json, behavior-parameters.registry.json, *.spec.json) are version-controlled templates; the database is the runtime source of truth after seeding.
 * @description Full metadata-driven system initialization. Steps: 1) Syncs all BDD specs from docs-archive/bdd-specs/ directory, 2) Ensures behavior parameters from canonical registry, 3) Creates SYSTEM-level BehaviorTargets, 4) Creates domains and playbooks from playbooks-config.json, 5) Validates cross-references against registry.
 * @response 200 { ok: boolean, message: "...", validationWarnings?: [...], details: { domainsCreated: [...], playbooksCreated: [...], specsCreated: number, specsSynced: number, parametersCreated: number, errors: [...] } }
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
    // STEP 1: SYNC BDD SPECS
    // ============================================
    try {
      console.log("STEP 1/4: Syncing BDD specs from docs-archive/bdd-specs/ directory...");
      const specResults = await seedFromSpecs();
      results.specsSynced = specResults.length;
      const totalParams = specResults.reduce(
        (acc, r) => acc + r.parametersCreated + r.parametersUpdated,
        0
      );
      console.log(`   ✓ Synced ${specResults.length} specs (${totalParams} parameters)`);
    } catch (e: any) {
      console.error("Error syncing BDD specs:", e);
      results.errors.push(`BDD SPECS: ${e.message}`);
    }

    // ============================================
    // STEP 2: ENSURE BEHAVIOR PARAMETERS
    // ============================================
    try {
      console.log("STEP 2/4: Ensuring behavior parameters exist...");
      const createdCount = await ensureBehaviorParameters(prisma);
      results.parametersCreated += createdCount;
      console.log(`   ✓ Ensured ${createdCount} behavior parameters`);
    } catch (e: any) {
      console.error("Error creating behavior parameters:", e);
      results.errors.push(`BEHAVIOR PARAMS: ${e.message}`);
    }

    // ============================================
    // STEP 3: ENSURE SYSTEM-LEVEL BEHAVIOR TARGETS
    // ============================================
    try {
      console.log("STEP 3/4: Ensuring SYSTEM-level BehaviorTargets...");
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
          console.log(`   + SYSTEM target: ${param.parameterId} = 0.50`);
        }
      }
      console.log(`   ✓ Created ${targetsCreated} new SYSTEM-level BehaviorTargets (${existingTargets.length} already existed)`);
    } catch (e: any) {
      console.error("Error creating SYSTEM targets:", e);
      results.errors.push(`SYSTEM TARGETS: ${e.message}`);
    }

    // ============================================
    // STEP 4: CREATE DOMAINS FROM CONFIG
    // ============================================
    try {
      console.log("STEP 4/4: Creating domains and playbooks from config...");

      // Load playbooks config
      const configPath = path.join(process.cwd(), "docs-archive", "bdd-specs", "playbooks-config.json");
      if (!fs.existsSync(configPath)) {
        throw new Error(`Playbooks config not found at ${configPath}`);
      }

      const configContent = fs.readFileSync(configPath, "utf-8");
      const manifest: PlaybooksManifest = JSON.parse(configContent);

      console.log(`   Found ${manifest.playbooks.length} playbooks in config`);

      // Create each playbook from config
      for (const config of manifest.playbooks) {
        try {
          await createPlaybookFromConfig(prisma, config, results);
          results.domainsCreated.push(config.domain.slug);
          results.playbooksCreated.push(config.name);
        } catch (e: any) {
          console.error(`Error creating playbook ${config.id}:`, e);
          results.errors.push(`${config.id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      console.error("Error creating playbooks from config:", e);
      results.errors.push(`PLAYBOOKS CONFIG: ${e.message}`);
    }

    // ============================================
    // STEP 5: VALIDATE CROSS-REFERENCES
    // ============================================
    const validationWarnings: string[] = [];
    try {
      console.log("STEP 5: Validating cross-references against registry...");

      const registryPath = path.join(process.cwd(), "docs-archive", "bdd-specs", "behavior-parameters.registry.json");
      if (fs.existsSync(registryPath)) {
        const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
        const canonicalIds = new Set<string>(registry.parameters.map((p: any) => p.parameterId));
        const deprecatedMap = new Map<string, string>();
        for (const dep of registry.deprecated || []) {
          deprecatedMap.set(dep.id, dep.canonicalId);
        }

        // Check playbook config references
        const configPath = path.join(process.cwd(), "docs-archive", "bdd-specs", "playbooks-config.json");
        if (fs.existsSync(configPath)) {
          const manifest = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          for (const pb of manifest.playbooks) {
            for (const paramId of Object.keys(pb.behaviorTargets || {})) {
              if (!canonicalIds.has(paramId)) {
                const canonical = deprecatedMap.get(paramId);
                if (canonical) {
                  validationWarnings.push(`Playbook "${pb.id}" uses deprecated "${paramId}" → should be "${canonical}"`);
                } else {
                  validationWarnings.push(`Playbook "${pb.id}" references unknown parameter "${paramId}"`);
                }
              }
            }
          }
        }

        // Check spec files for parameterId references against registry
        const specsFolder = path.join(process.cwd(), "docs-archive", "bdd-specs");
        const specFiles = fs.readdirSync(specsFolder).filter(f => f.endsWith(".spec.json"));
        for (const file of specFiles) {
          const content = fs.readFileSync(path.join(specsFolder, file), "utf-8");
          const behRefs = content.match(/"(?:parameterId|targetParameter)":\s*"(BEH-[^"]+)"/g) || [];
          for (const ref of behRefs) {
            const paramId = ref.match(/"(BEH-[^"]+)"/)?.[1];
            if (paramId && !canonicalIds.has(paramId)) {
              const canonical = deprecatedMap.get(paramId);
              if (canonical) {
                validationWarnings.push(`${file}: uses deprecated "${paramId}" → should be "${canonical}"`);
              } else {
                validationWarnings.push(`${file}: references unknown parameter "${paramId}"`);
              }
            }
          }
        }

        if (validationWarnings.length > 0) {
          console.warn(`   ⚠️ ${validationWarnings.length} cross-reference warnings:`);
          for (const w of validationWarnings) {
            console.warn(`      - ${w}`);
          }
        } else {
          console.log("   ✓ All cross-references valid");
        }
      }
    } catch (e: any) {
      console.error("Error during validation:", e);
    }

    const message =
      results.errors.length === 0
        ? `System initialized: ${results.specsSynced} specs synced, ${results.domainsCreated.length} domains created with ${results.playbooksCreated.length} playbooks, ${results.specsCreated} linked specs, ${results.parametersCreated} parameters`
        : `System initialization completed with ${results.errors.length} errors: ${results.specsSynced} specs synced, ${results.domainsCreated.length} domains created`;

    // Invalidate all caches after seeding
    clearAIConfigCache();
    clearSystemSettingsCache();

    return NextResponse.json({
      ok: results.errors.length === 0,
      message,
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      details: results,
    });
  } catch (error: any) {
    console.error("POST /api/x/seed-system error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to initialize system",
      },
      { status: 500 }
    );
  }
}

/**
 * Creates a domain and playbook from config
 * Metadata-driven: reads spec IDs and domains from config instead of hardcoding
 */
async function createPlaybookFromConfig(
  prisma: PrismaClient,
  config: PlaybookConfig,
  results: { specsCreated: number; parametersCreated: number }
) {
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

  // Create playbook with goals in config
  const playbook = await prisma.playbook.create({
    data: {
      name: config.name,
      description: config.description,
      domainId: domain.id,
      status: config.status,
      version: config.version,
      config: {
        goals: config.goals || [], // Store goals from config
      } as any,
    },
  });
  console.log(`   ✓ Created playbook: ${playbook.name}`);

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
  console.log(`   ✓ Linked ${specsToLink.length} specs to playbook`);

  results.specsCreated += specsToLink.length;
}

/**
 * Finds all specs that should be linked to a playbook based on config
 * Uses spec IDs and system domains from config
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
      // Exclude domain-specific specs from other playbooks
      slug: { not: { contains: "companion" } },
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
 * Reads from docs-archive/bdd-specs/behavior-parameters.registry.json — the canonical registry.
 */
async function ensureBehaviorParameters(prisma: PrismaClient): Promise<number> {
  // Load canonical registry
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
    aliases?: string[];
  }> = registry.parameters;

  console.log(`   Loading ${registryParams.length} parameters from registry...`);

  let createdCount = 0;

  for (const param of registryParams) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });

    // #2031 follow-on — route every Parameter.domainGroup write through
    // the canonical resolver. The canonical registry JSON should already
    // carry canonical values, but the resolver provides structural
    // defence in depth against an edit that introduces an off-canonical
    // value.
    const canonicalDomainGroup =
      resolveCanonicalDomainGroup({ domainGroup: param.domainGroup }) ??
      "behavior-core";

    if (existing) {
      await prisma.parameter.update({
        where: { parameterId: param.parameterId },
        data: {
          parameterType: "BEHAVIOR",
          isAdjustable: true,
          name: param.name,
          definition: param.definition,
          sectionId: "behavior",
          domainGroup: canonicalDomainGroup,
          interpretationHigh: param.interpretationHigh,
          interpretationLow: param.interpretationLow,
          scaleType: "0-1",
          directionality: "neutral",
          computedBy: "measure_agent",
        },
      });
    } else {
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
      console.log(`   + Created: ${param.parameterId}`);
    }
  }

  // Validate: warn about deprecated aliases still in use
  const deprecated: Array<{ id: string; canonicalId: string; reason: string }> = registry.deprecated || [];
  for (const dep of deprecated) {
    const aliasExists = await prisma.parameter.findUnique({
      where: { parameterId: dep.id },
    });
    if (aliasExists) {
      console.warn(`   ⚠️ DEPRECATED parameter "${dep.id}" still exists — should be "${dep.canonicalId}" (${dep.reason})`);
    }
  }

  return createdCount;
}

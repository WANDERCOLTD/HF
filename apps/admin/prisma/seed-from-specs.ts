/**
 * Seed From Specs - Load and activate BDD spec files
 *
 * @note INFRASTRUCTURE TOOL — intentionally reads from disk.
 * This is a bootstrap/seeding script, not runtime code.
 *
 * Reads JSON spec files from docs-archive/bdd-specs/ folder,
 * creates BDDFeatureSet records, and activates them to derive
 * Parameters, ScoringAnchors, PromptSlugs, etc.
 *
 * After seeding, the database is the runtime source of truth.
 * The docs-archive/bdd-specs/ folder is only needed for initial import.
 *
 * Usage:
 *   import { seedFromSpecs } from "./seed-from-specs";
 *   await seedFromSpecs();
 */

import * as fs from "fs";
import * as path from "path";
import {
  PrismaClient,
  ParameterType,
  SpecificationScope,
  AnalysisOutputType,
  SpecType,
  SpecRole,
  MemoryCategory,
} from "@prisma/client";
import {
  parseJsonSpec,
  convertJsonSpecToHybrid,
  JsonFeatureSpec,
} from "../lib/bdd/ai-parser";
import { compileSpecToTemplate } from "../lib/bdd/compile-specs";
import { ContractRegistry, ensureContractsLoaded } from "../lib/contracts/registry";
import {
  DEFAULT_FALLBACK_PERSONAS,
  DEFAULT_IDENTITY_TEMPLATE,
  DEFAULT_FLOW_PHASES,
  DEFAULT_TRANSCRIPT_LIMITS,
  DEFAULT_AI_MODEL_CONFIGS,
} from "../lib/fallback-settings";
import { slimParameters, slimSummary } from "../lib/bdd/spec-slim";

let prisma = new PrismaClient();

/** Allow external callers (e.g. seed-full.ts) to share a single PrismaClient */
export function setPrismaClient(client: PrismaClient) {
  prisma = client;
}

// Path to spec files (archived — only used for initial import/seeding)
function getSpecsFolder(): string {
  // Try process.cwd() first (works in Next.js API routes)
  const cwdPath = path.join(process.cwd(), "docs-archive", "bdd-specs");
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  // Fallback to __dirname for CLI scripts
  return path.join(__dirname, "../docs-archive/bdd-specs");
}

export interface SeedSpecResult {
  specId: string;
  title: string;
  parametersCreated: number;
  parametersUpdated: number;
  anchorsCreated: number;
  specsCreated: number;
  triggersCreated: number;
  actionsCreated: number;
  promptSlugsCreated: number;
  agentCreated: boolean;
  curriculumCreated: boolean;
  error?: string;
}

/**
 * Load all .spec.json files from the bdd-specs folder
 */
export function loadSpecFiles(excludeFeatureIds?: string[]): { filename: string; content: JsonFeatureSpec; rawJson: any }[] {
  const specs: { filename: string; content: JsonFeatureSpec; rawJson: any }[] = [];
  const specsFolder = getSpecsFolder();

  if (!fs.existsSync(specsFolder)) {
    console.log(`   Warning: Specs folder not found at ${specsFolder}`);
    return specs;
  }

  const files = fs.readdirSync(specsFolder).filter(f =>
    f.endsWith(".spec.json") &&
    f !== "schema.spec.json" &&
    f !== "config.spec.json"
  );
  console.log(`   Found ${files.length} spec files in ${specsFolder}`);

  const excludeSet = new Set(excludeFeatureIds || []);

  for (const filename of files) {
    const filePath = path.join(specsFolder, filename);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const rawJson = JSON.parse(content); // Keep raw JSON for storage
      const parseResult = parseJsonSpec(content);

      if (parseResult.success) {
        const featureId = parseResult.data.id;
        if (excludeSet.has(featureId)) {
          console.log(`   ⊘ ${filename} (${featureId}) — excluded by SEED_MODE`);
          continue;
        }
        specs.push({ filename, content: parseResult.data, rawJson });
      } else {
        console.log(`   Warning: Failed to parse ${filename}: ${parseResult.errors.join(", ")}`);
      }
    } catch (e: any) {
      console.log(`   Warning: Error reading ${filename}: ${e.message}`);
    }
  }

  return specs;
}

/**
 * Create or update a BDDFeatureSet from a parsed spec
 * Now also stores the raw JSON for production runtime (no filesystem dependency)
 */
async function upsertFeatureSet(spec: JsonFeatureSpec, filename: string, rawJson?: any) {
  const hybrid = convertJsonSpecToHybrid(spec);

  // Extract data from hybrid result - note the nested structure
  const parameters = hybrid.parameterData?.parameters || [];
  const storyData = hybrid.storyData;

  // Build scoring spec metadata from raw JSON
  const scoringSpec = rawJson ? {
    domain: rawJson.domain || "general",
    outputType: rawJson.outputType || "MEASURE",
    specRole: rawJson.specRole || undefined,
  } : null;

  // Build the feature set data
  // Note: parameters is required, so we ensure it's always an array
  const featureSetData = {
    featureId: spec.id,
    name: spec.title,
    description: spec.story ? `As ${spec.story.asA}, I want ${spec.story.iWant} so that ${spec.story.soThat}` : undefined,
    version: spec.version || "1.0",
    specType: spec.specType || "DOMAIN",
    // Store the raw spec JSON for production runtime (removes filesystem dependency)
    rawSpec: rawJson || null,
    // Store scoring spec metadata for activation
    scoringSpec: scoringSpec as any,
    // Store the parsed data (ensure parameters is always an array, never undefined)
    parameters: parameters as any,
    constraints: (storyData?.constraints || []) as any,
    validations: [] as any, // Validations are extracted during activation
    definitions: {} as any, // Definitions are derived during activation
    thresholds: [] as any, // Thresholds are derived during activation
    promptGuidance: {} as any,
    // Stats
    parameterCount: parameters.length,
    constraintCount: storyData?.constraints?.length || 0,
    definitionCount: 0,
  };

  // Upsert the feature set
  const existing = await prisma.bDDFeatureSet.findFirst({
    where: { featureId: spec.id },
  });

  if (existing) {
    return prisma.bDDFeatureSet.update({
      where: { id: existing.id },
      data: featureSetData,
    });
  } else {
    return prisma.bDDFeatureSet.create({
      data: featureSetData,
    });
  }
}

/**
 * Activate a feature set - creates all derived records
 * (This is essentially the same logic as activate/route.ts but callable directly)
 */
async function activateFeatureSet(featureSetId: string): Promise<SeedSpecResult> {
  const featureSet = await prisma.bDDFeatureSet.findUnique({
    where: { id: featureSetId },
  });

  if (!featureSet) {
    throw new Error(`Feature set not found: ${featureSetId}`);
  }

  const compiledParams = (featureSet.parameters as any[]) || [];
  const compiledConstraints = (featureSet.constraints as any[]) || [];
  const compiledDefinitions = (featureSet.definitions as Record<string, any>) || {};
  const scoringSpec = featureSet.scoringSpec as any;
  const rawSpecData = featureSet.rawSpec as any;

  // Map specType string to valid SpecType enum (only SYSTEM and DOMAIN are valid)
  const rawSpecType = featureSet.specType || "DOMAIN";
  const specType = rawSpecType === "SYSTEM" ? SpecType.SYSTEM : SpecType.DOMAIN;

  const declaredOutputType = (scoringSpec?.outputType as AnalysisOutputType) || AnalysisOutputType.MEASURE;

  // Determine specRole (UI category) based on declared specRole or outputType
  let specRole: SpecRole;
  const declaredSpecRole = scoringSpec?.specRole as SpecRole | undefined;

  // NEW TAXONOMY (Feb 2026): ORCHESTRATE, EXTRACT, SYNTHESISE, CONSTRAIN, IDENTITY, CONTENT, VOICE
  if (declaredSpecRole === SpecRole.ORCHESTRATE) {
    specRole = SpecRole.ORCHESTRATE;
  } else if (declaredSpecRole === SpecRole.EXTRACT) {
    specRole = SpecRole.EXTRACT;
  } else if (declaredSpecRole === SpecRole.SYNTHESISE) {
    specRole = SpecRole.SYNTHESISE;
  } else if (declaredSpecRole === SpecRole.CONSTRAIN) {
    specRole = SpecRole.CONSTRAIN;
  } else if (declaredSpecRole === SpecRole.IDENTITY) {
    specRole = SpecRole.IDENTITY;
  } else if (declaredSpecRole === SpecRole.CONTENT) {
    specRole = SpecRole.CONTENT;
  } else if (declaredSpecRole === SpecRole.VOICE) {
    specRole = SpecRole.VOICE;
  } else if (declaredSpecRole === SpecRole.OBSERVE) {
    specRole = SpecRole.OBSERVE;
  } else if (declaredSpecRole === SpecRole.PROMPT) {
    specRole = SpecRole.PROMPT;
  // DEPRECATED VALUES (backward compatibility) - map to new taxonomy
  } else if (declaredSpecRole === SpecRole.MEASURE) {
    specRole = SpecRole.EXTRACT;
  } else if (declaredSpecRole === SpecRole.ADAPT) {
    specRole = SpecRole.SYNTHESISE;
  } else if (declaredSpecRole === SpecRole.REWARD) {
    specRole = SpecRole.SYNTHESISE;
  } else if (declaredSpecRole === SpecRole.GUARDRAIL) {
    specRole = SpecRole.CONSTRAIN;
  } else if (declaredSpecRole === SpecRole.BOOTSTRAP) {
    specRole = SpecRole.ORCHESTRATE;
  } else {
    // Map outputType to specRole for unspecified specs
    switch (declaredOutputType) {
      case AnalysisOutputType.MEASURE:
      case AnalysisOutputType.MEASURE_AGENT:
      case AnalysisOutputType.LEARN:
        specRole = SpecRole.EXTRACT; // Measurement/learning
        break;
      case AnalysisOutputType.ADAPT:
        specRole = SpecRole.SYNTHESISE; // Behavioral adaptation
        break;
      case AnalysisOutputType.REWARD:
        specRole = SpecRole.SYNTHESISE; // Reward computation
        break;
      case AnalysisOutputType.SUPERVISE:
        specRole = SpecRole.CONSTRAIN; // Guardrails
        break;
      default:
        specRole = SpecRole.EXTRACT; // Default for COMPOSE, AGGREGATE, etc.
    }
  }

  // Determine outputType: IDENTITY/CONTENT/VOICE specs use COMPOSE (they contribute to prompts)
  // CONSTRAIN specs use SUPERVISE (they enforce guardrails/bounds)
  // Other specs use their declared outputType
  let outputType: AnalysisOutputType;
  if (specRole === SpecRole.IDENTITY || specRole === SpecRole.CONTENT || specRole === SpecRole.VOICE || specRole === SpecRole.PROMPT) {
    outputType = AnalysisOutputType.COMPOSE; // Prompt contributors
  } else if (specRole === SpecRole.CONSTRAIN) {
    outputType = AnalysisOutputType.SUPERVISE; // Guardrails/bounds
  } else {
    outputType = declaredOutputType;
  }

  const results: SeedSpecResult = {
    specId: featureSet.featureId,
    title: featureSet.name,
    parametersCreated: 0,
    parametersUpdated: 0,
    anchorsCreated: 0,
    specsCreated: 0,
    triggersCreated: 0,
    actionsCreated: 0,
    promptSlugsCreated: 0,
    agentCreated: false,
    curriculumCreated: false,
  };

  // 1. Create/update Parameter records
  // IMPORTANT: Only create Parameters for specs that produce measurable values.
  // Config specs (IDENTITY, CONTENT, VOICE, GUARDRAIL) store their data in spec.config,
  // not as Parameter records. Creating Parameters for these specs causes orphans.
  //
  // Also skip for:
  // - LEARN specs: Extract memory data, not measured parameters
  // - COMPOSE specs: Define prompt assembly, not measurements
  const isConfigSpec =
    specRole === SpecRole.IDENTITY ||
    specRole === SpecRole.CONTENT ||
    specRole === SpecRole.VOICE ||
    specRole === SpecRole.CONSTRAIN ||
    outputType === AnalysisOutputType.LEARN ||
    outputType === AnalysisOutputType.COMPOSE;

  if (isConfigSpec) {
    const reason = outputType === AnalysisOutputType.LEARN
      ? "LEARN spec (memory extraction)"
      : outputType === AnalysisOutputType.COMPOSE
        ? "COMPOSE spec (prompt assembly)"
        : `${specRole} spec (data stored in spec.config)`;
    console.log(`      ℹ️ Skipping Parameter creation for ${reason}`);
  }

  for (const param of compiledParams) {
    const parameterId = param.id || param.parameterId;
    if (!parameterId) continue;

    // Skip Parameter creation for config specs - they don't need Parameter records
    if (isConfigSpec) {
      continue;
    }

    const existingParam = await prisma.parameter.findUnique({
      where: { parameterId },
    });

    // Determine parameter type based on spec
    let parameterType: ParameterType = ParameterType.STATE;
    if (scoringSpec?.domain === "personality") {
      parameterType = ParameterType.TRAIT;
    } else if (param.isAdjustable) {
      parameterType = ParameterType.BEHAVIOR;
    }

    // Extract interpretation from interpretationScale
    let interpretationHigh: string | null = null;
    let interpretationLow: string | null = null;
    if (param.interpretationScale && Array.isArray(param.interpretationScale)) {
      const highRange = param.interpretationScale.find((r: any) => r.max >= 0.9 || r.label?.toLowerCase().includes("high"));
      const lowRange = param.interpretationScale.find((r: any) => r.min <= 0.1 || r.label?.toLowerCase().includes("low") || r.label?.toLowerCase().includes("disengaged"));
      if (highRange) interpretationHigh = `${highRange.label}: ${highRange.implication || ""}`;
      if (lowRange) interpretationLow = `${lowRange.label}: ${lowRange.implication || ""}`;
    }

    const paramData = {
      parameterId,
      name: param.name || parameterId,
      definition: param.description || param.definition || null,
      sectionId: param.section || scoringSpec?.domain || "imported",
      domainGroup: scoringSpec?.domain || "general",
      scaleType: "0-1",
      directionality: "positive",
      computedBy: `spec:${featureSet.featureId}`,
      parameterType,
      isAdjustable: param.isAdjustable || false,
      interpretationHigh,
      interpretationLow,
    };

    if (existingParam) {
      await prisma.parameter.update({
        where: { parameterId },
        data: paramData,
      });
      results.parametersUpdated++;
    } else {
      await prisma.parameter.create({
        data: paramData,
      });
      results.parametersCreated++;
    }

    // 2. Create scoring anchors from param.scoringAnchors
    if (param.scoringAnchors && Array.isArray(param.scoringAnchors)) {
      for (const anchor of param.scoringAnchors) {
        const existing = await prisma.parameterScoringAnchor.findFirst({
          where: {
            parameterId,
            example: anchor.example,
          },
        });
        if (!existing && anchor.example) {
          await prisma.parameterScoringAnchor.create({
            data: {
              parameterId,
              example: anchor.example,
              score: anchor.score ?? 0.5,
              rationale: anchor.rationale || null,
              source: `spec:${featureSet.featureId}`,
              isGold: anchor.isGold ?? true,
            },
          });
          results.anchorsCreated++;
        }
      }
    }

    // 3. Create prompt slugs from param.promptGuidance
    // Handle both object and array formats (align with activation route behavior)
    if (param.promptGuidance) {
      const guidances = Array.isArray(param.promptGuidance)
        ? param.promptGuidance
        : [param.promptGuidance];

      for (const pg of guidances) {
        const slugId = `spec-${parameterId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-guidance`;

        const existingSlug = await prisma.promptSlug.findUnique({
          where: { slug: slugId },
        });

        if (!existingSlug && (pg.whenHigh || pg.whenLow)) {
          const promptSlugRecord = await prisma.promptSlug.create({
            data: {
              slug: slugId,
              name: `${param.name} Guidance`,
              description: param.description,
              sourceType: "PARAMETER",
              priority: 50,
              isActive: true,
              memorySummaryTemplate: pg.promptTemplate || null,
            },
          });

          // Create ranges
          const ranges: { minValue: number; maxValue: number; label: string; prompt: string }[] = [];

          if (pg.whenHigh) {
            ranges.push({ minValue: 0.7, maxValue: 1.0, label: "High", prompt: pg.whenHigh });
          }
          if (pg.whenLow) {
            ranges.push({ minValue: 0.0, maxValue: 0.3, label: "Low", prompt: pg.whenLow });
          }
          if (pg.whenMedium) {
            ranges.push({ minValue: 0.3, maxValue: 0.7, label: "Medium", prompt: pg.whenMedium });
          }

          for (let i = 0; i < ranges.length; i++) {
            await prisma.promptSlugRange.create({
              data: {
                slugId: promptSlugRecord.id,
                minValue: ranges[i].minValue,
                maxValue: ranges[i].maxValue,
                label: ranges[i].label,
                prompt: ranges[i].prompt,
                sortOrder: i,
              },
            });
          }

          // Link to parameter
          await prisma.promptSlugParameter.create({
            data: {
              slugId: promptSlugRecord.id,
              parameterId,
              weight: 1.0,
              mode: "ABSOLUTE",
              sortOrder: 0,
            },
          });

          results.promptSlugsCreated++;
        }
      }
    }
  }

  // 3b. For ADAPT specs: Auto-create behavior parameters from adaptation rules AND triggers
  if (outputType === AnalysisOutputType.ADAPT) {
    console.log(`      🔗 Processing ADAPT spec - extracting target parameters...`);

    // Extract all targetParameter values from:
    // 1. parameters[].config.adaptationRules[].actions[] (ADAPT-LEARN-001 style)
    // 2. triggers[].actions[].parameterId (ADAPT-PERS-001, ADAPT-VARK-001, ADAPT-CURR-001 style)
    // 3. triggers[].parameterId (legacy format)
    const targetParameterIds = new Set<string>();
    const targetParameterMetadata = new Map<string, { section?: string; rationale?: string }>();

    // Source 1: parameters[].config.adaptationRules[].actions[]
    for (const param of compiledParams) {
      if (param.config?.adaptationRules && Array.isArray(param.config.adaptationRules)) {
        for (const rule of param.config.adaptationRules) {
          if (rule.actions && Array.isArray(rule.actions)) {
            for (const action of rule.actions) {
              if (action.targetParameter) {
                targetParameterIds.add(action.targetParameter);

                // Store metadata for parameter creation
                if (!targetParameterMetadata.has(action.targetParameter)) {
                  targetParameterMetadata.set(action.targetParameter, {
                    section: param.section,
                    rationale: action.rationale,
                  });
                }
              }
            }
          }
        }
      }
    }

    // Source 2 & 3: triggers[].actions[].parameterId and triggers[].parameterId
    const specTriggers = rawSpecData?.triggers || [];
    for (const trigger of specTriggers) {
      // Source 2: triggers[].actions[].parameterId (new format)
      if (trigger.actions && Array.isArray(trigger.actions)) {
        for (const action of trigger.actions) {
          if (action.parameterId) {
            targetParameterIds.add(action.parameterId);

            if (!targetParameterMetadata.has(action.parameterId)) {
              targetParameterMetadata.set(action.parameterId, {
                section: scoringSpec?.domain || "behavior",
                rationale: action.rationale || trigger.then,
              });
            }
          }
        }
      }

      // Source 3: triggers[].parameterId (legacy format)
      if (trigger.parameterId) {
        targetParameterIds.add(trigger.parameterId);

        if (!targetParameterMetadata.has(trigger.parameterId)) {
          targetParameterMetadata.set(trigger.parameterId, {
            section: scoringSpec?.domain || "behavior",
            rationale: trigger.then,
          });
        }
      }
    }

    console.log(`      Found ${targetParameterIds.size} unique target parameters: ${Array.from(targetParameterIds).join(", ")}`);

    // Create missing behavior parameters
    for (const parameterId of targetParameterIds) {
      const existing = await prisma.parameter.findUnique({
        where: { parameterId },
      });

      if (!existing) {
        const metadata = targetParameterMetadata.get(parameterId);

        // Infer name from parameterId (convert kebab-case to Title Case)
        const name = parameterId
          .split("-")
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");

        // Infer domainGroup from section or use default
        const domainGroup = metadata?.section || scoringSpec?.domain || "teaching";

        // Create the parameter
        await prisma.parameter.create({
          data: {
            parameterId,
            name,
            definition: metadata?.rationale || `Behavior parameter auto-created from ${featureSet.featureId} adaptation rules`,
            sectionId: metadata?.section || "teaching",
            domainGroup,
            scaleType: "0-1",
            directionality: "positive",
            computedBy: `spec:${featureSet.featureId}`,
            parameterType: ParameterType.BEHAVIOR,
            isAdjustable: true,
            interpretationHigh: null,
            interpretationLow: null,
          },
        });

        results.parametersCreated++;
        console.log(`      ✓ Auto-created BEHAVIOR parameter: ${parameterId} (${domainGroup})`);
      }
    }
  }

  // 4. Create AnalysisSpec for the feature
  const specSlug = `spec-${featureSet.featureId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Build description from story
  const description = featureSet.description || `Analysis spec from ${featureSet.featureId}`;

  // Determine scope based on specType
  let scope: SpecificationScope = SpecificationScope.DOMAIN;
  if (specType === SpecType.SYSTEM) {
    scope = SpecificationScope.SYSTEM;
  }

  const existingSpec = await prisma.analysisSpec.findUnique({
    where: { slug: specSlug },
  });

  // Build config from parameters based on spec type
  // This makes the config available to compose-prompt and pipeline for reading spec-defined values
  let config: Record<string, any> | null = null;

  // For PROMPT specs: store config from rawSpec directly (templateVars, category, etc.)
  // PROMPT specs have no parameters — their config is metadata about the prompt template
  if (specRole === SpecRole.PROMPT) {
    config = rawSpecData?.config || {};
    console.log(`      Built PROMPT config with keys: ${Object.keys(config).join(", ")}`);
  }
  // For COMPOSE specs: preserve the full parameters array so code can look up by parameter ID
  // This is critical - specs define behavior, not hardcoded values in code
  // For CONTENT specs, we need the full parameter structure (section, name, description) for curriculum composer
  else if (outputType === AnalysisOutputType.COMPOSE) {
    // If this is a CONTENT spec, preserve full parameter structure from featureSet
    if (specRole === SpecRole.CONTENT && featureSet.parameters) {
      const slimmed = slimParameters(featureSet.parameters as any[]);
      config = {
        parameters: slimmed,
      };
      console.log(`      Built COMPOSE config with ${slimmed.length} parameters (${slimSummary(featureSet.parameters as any[])})`);
    } else {
      // For other COMPOSE specs, use compiled params
      config = {
        parameters: compiledParams.map(p => ({
          id: p.id || p.parameterId,
          config: p.config || {},
        })),
      };
      console.log(`      Built COMPOSE config with ${compiledParams.length} parameters`);
    }
    // Also flatten top-level for backward compatibility
    for (const param of compiledParams) {
      if (param.config) {
        Object.assign(config, param.config);
      }
    }
    // Copy metadata from rawSpec if present (required for contract-based specs)
    if (rawSpecData?.metadata) {
      config.metadata = rawSpecData.metadata;
      console.log(`      Copied metadata from rawSpec (sections: ${Object.keys(rawSpecData.metadata).join(", ")})`);
    }
    // Copy sections from rawSpec if present (for COMP-001 composition pipeline)
    if (rawSpecData?.sections) {
      config.sections = rawSpecData.sections;
      console.log(`      Copied ${rawSpecData.sections.length} composition sections from rawSpec`);
    }
    // Copy archetypes from rawSpec if present (#164 — retrieval practice config per archetype)
    if (rawSpecData?.archetypes) {
      config.archetypes = rawSpecData.archetypes;
      console.log(`      Copied ${Object.keys(rawSpecData.archetypes).length} archetype configs from rawSpec`);
    }
  }
  // For IDENTITY and CONTENT specs: preserve parameters array AND flatten for backward compat
  else if (specRole === SpecRole.IDENTITY || specRole === SpecRole.CONTENT) {
    // Preserve parameter structure but strip already-extracted fields (scoringAnchors, interpretationScale, etc.)
    const slimmed = slimParameters((featureSet.parameters as any[]) || []);
    config = {
      parameters: slimmed,
    };
    console.log(`      ${slimSummary((featureSet.parameters as any[]) || [])}`);

    // Also flatten top-level config properties for backward compatibility
    for (const param of compiledParams) {
      const paramId = param.id || param.parameterId;
      // Extract the config object from each parameter
      if (param.config) {
        // Flatten top-level config properties into the config object
        Object.assign(config, param.config);
      }
      // Also store by parameter ID for reference
      if (paramId && param.config) {
        config[paramId] = param.config;
      }
    }
    // Copy metadata from rawSpec if present (required for contract-based specs)
    if (rawSpecData?.metadata) {
      config.metadata = rawSpecData.metadata;
      console.log(`      Copied metadata from rawSpec (sections: ${Object.keys(rawSpecData.metadata).join(", ")})`);
    }

    // For module-based curricula: include curriculum-specific fields in config
    // This allows prompt composers to access modules, learningOutcomes, etc. directly
    if (rawSpecData?.modules) {
      config.modules = rawSpecData.modules;
      config.learningOutcomes = rawSpecData.learningOutcomes;
      config.qualification = rawSpecData.qualification;
      config.assessment = rawSpecData.assessment;
      config.misconceptionBank = rawSpecData.misconceptionBank;
      config.sessionStructure = rawSpecData.sessionStructure;
      config.assessmentStrategy = rawSpecData.assessmentStrategy;
      console.log(`      Built config for module-based curriculum with ${rawSpecData.modules.length} modules`);
    } else {
      console.log(`      Built config for ${specRole} spec with ${(config.parameters as any[]).length} parameters and keys: ${Object.keys(config).slice(0, 5).join(", ")}...`);
    }
  }
  // For ORCHESTRATE/BOOTSTRAP specs (like INIT-001, PIPELINE-001, QUICK-LAUNCH-001):
  // Preserve parameters AND copy top-level flow/template data from rawSpec
  else if (specRole === SpecRole.ORCHESTRATE || specRole as string === "BOOTSTRAP") {
    config = {
      parameters: compiledParams.map(p => ({
        id: p.id || p.parameterId,
        config: p.config || {},
      })),
    };
    // Flatten parameter configs for backward compat
    for (const param of compiledParams) {
      if (param.config) {
        Object.assign(config, param.config);
      }
    }
    // Copy top-level firstCallFlow from rawSpec (critical for INIT-001)
    if (rawSpecData?.firstCallFlow) {
      config.firstCallFlow = rawSpecData.firstCallFlow;
      console.log(`      Copied firstCallFlow with ${rawSpecData.firstCallFlow.phases?.length || 0} phases`);
    }
    // Copy outputs and constraints if present
    if (rawSpecData?.outputs) {
      config.outputs = rawSpecData.outputs;
    }
    if (rawSpecData?.constraints) {
      config.constraints = rawSpecData.constraints;
    }
    // Copy personas object for per-persona onboarding configs (INIT-001)
    if (rawSpecData?.personas) {
      config.personas = rawSpecData.personas;
      const personaKeys = Object.keys(rawSpecData.personas).filter(k => !k.startsWith("_") && k !== "defaultPersona");
      console.log(`      Copied personas config for: ${personaKeys.join(", ")}`);
    }
    // Copy promptSlugs definitions (will be created below)
    if (rawSpecData?.promptSlugs) {
      config.promptSlugs = rawSpecData.promptSlugs;
    }
    // For ORCHESTRATE specs: copy any remaining top-level data from rawSpec
    // that isn't already handled (e.g. implementation, story, etc.)
    const handledKeys = new Set([
      "id", "title", "name", "version", "status", "date", "domain",
      "specType", "specRole", "outputType", "isDeletable",
      "story", "context", "parameters", "acceptanceCriteria",
      "constraints", "related", "description",
      // Already handled above
      "firstCallFlow", "personas", "outputs", "promptSlugs", "config",
    ]);
    if (rawSpecData) {
      for (const [key, val] of Object.entries(rawSpecData)) {
        if (!handledKeys.has(key) && val !== undefined && val !== null) {
          config[key] = val;
        }
      }
    }
    console.log(`      Built ORCHESTRATE config with ${compiledParams.length} parameters and keys: ${Object.keys(config).slice(0, 8).join(", ")}...`);
  }
  // For ADAPT, AGGREGATE, etc.: preserve parameters array for pipeline to read configs
  else if (compiledParams.length > 0 && compiledParams.some(p => p.config)) {
    config = {
      parameters: compiledParams.map(p => ({
        id: p.id || p.parameterId,
        config: p.config || {},
      })),
    };
    // Copy root-level config from rawSpec (e.g., defaultAdaptConfidence for ADAPT specs)
    if (rawSpecData?.config && typeof rawSpecData.config === "object") {
      Object.assign(config, rawSpecData.config);
      console.log(`      Merged root-level config keys: ${Object.keys(rawSpecData.config).join(", ")}`);
    }
    // Copy metadata from rawSpec if present
    if (rawSpecData?.metadata) {
      config.metadata = rawSpecData.metadata;
    }
    console.log(`      Built config with ${compiledParams.length} parameters for ${outputType} spec`);
  }

  // Fallback: if no branch above built a config but the rawSpec declares one,
  // create config from rawSpecData.config so keys like `scoringGate` are preserved.
  if (!config && rawSpecData?.config && typeof rawSpecData.config === "object") {
    config = { ...rawSpecData.config };
    console.log(`      Fallback: created config from rawSpec.config keys: ${Object.keys(config!).join(", ")}`);
  }

  // Copy context.dependsOn into config for runtime dependency validation
  if (config && rawSpecData?.context?.dependsOn && Array.isArray(rawSpecData.context.dependsOn)) {
    config.dependsOn = rawSpecData.context.dependsOn;
  }

  // Copy profileCondition into config for teaching-profile-based spec filtering
  if (config && rawSpecData?.profileCondition && Array.isArray(rawSpecData.profileCondition)) {
    config.profileCondition = rawSpecData.profileCondition;
  }

  // Compile the spec to generate promptTemplate from rawSpec in database
  // rawSpec is required - filesystem is only used during seeding, not activation
  let promptTemplate: string | null = null;

  // PROMPT specs store their template directly in the JSON — no compilation needed
  if (specRole === SpecRole.PROMPT && rawSpecData?.promptTemplate) {
    promptTemplate = rawSpecData.promptTemplate;
    console.log(`      ✓ Direct promptTemplate from PROMPT spec (${promptTemplate.length} chars)`);
  } else if (featureSet.rawSpec) {
    // Use rawSpec from database (production-ready, no filesystem dependency)
    const parseResult = parseJsonSpec(JSON.stringify(featureSet.rawSpec));
    if (parseResult.success) {
      const compileResult = compileSpecToTemplate(parseResult.data);
      promptTemplate = compileResult.promptTemplate;
      if (compileResult.warnings.length > 0) {
        console.log(`      ⚠️ Compile warnings: ${compileResult.warnings.join(", ")}`);
      }
      console.log(`      ✓ Compiled promptTemplate (${compileResult.sections.length} sections, ${promptTemplate.length} chars)`);
    } else {
      console.log(`      ⚠️ Failed to parse rawSpec: ${parseResult.errors.join(", ")}`);
    }
  } else {
    console.log(`      ⚠️ No rawSpec in database - re-run seed to populate rawSpec`);
  }

  // Extract extendsAgent from rawSpec (for overlay identity specs like TUT-QM-001 → extends TUT-001)
  const extendsAgent = rawSpecData?.extendsAgent || null;

  const specData = {
    name: featureSet.name,
    description,
    scope,
    outputType,
    specRole,
    specType,
    domain: scoringSpec?.domain || "general",
    priority: specType === SpecType.SYSTEM ? 50 : 10,
    isActive: true,
    version: featureSet.version,
    compiledAt: new Date(),
    compiledSetId: featureSet.id,
    isDirty: false,
    ...(extendsAgent && { extendsAgent }),
    ...(config && { config }),
    ...(promptTemplate && { promptTemplate }),
  };

  let spec;
  if (existingSpec) {
    spec = await prisma.analysisSpec.update({
      where: { slug: specSlug },
      data: specData,
    });
  } else {
    spec = await prisma.analysisSpec.create({
      data: {
        slug: specSlug,
        ...specData,
      },
    });
    results.specsCreated++;
  }

  // Validate contract implementation if spec declares "implements"
  const implementedContracts = rawSpecData?.implements || [];
  if (implementedContracts.length > 0) {
    console.log(`      ℹ️ Spec declares implementation of: ${implementedContracts.join(", ")}`);

    for (const contractId of implementedContracts) {
      const validation = await ContractRegistry.validateSpec(
        featureSet.featureId,
        specData.config || {},
        {
          contractId,
          version: undefined, // Use any version
          role: "producer", // Specs produce data according to contracts
          produces: [],
          consumes: [],
        }
      );

      if (!validation.valid) {
        const errorMsg = `Contract validation failed for ${featureSet.featureId} implementing ${contractId}:\n` +
          validation.errors.map(e => `  - ${e}`).join("\n");
        console.error(`      ✗ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (validation.warnings.length > 0) {
        console.log(`      ⚠️ Contract warnings: ${validation.warnings.join(", ")}`);
      }

      console.log(`      ✓ Contract validation passed: ${contractId}`);
    }
  }

  // ⚠️ DEPRECATED: Agent creation from IDENTITY specs is disabled
  // The Agent model is being phased out - identity data should remain in AnalysisSpec.config
  // See prisma/schema.prisma for deprecation notes
  //
  // Original code preserved below for reference:
  // if (specRole === SpecRole.IDENTITY) {
  //   ... Agent creation code removed ...
  // }
  if (specRole === SpecRole.IDENTITY) {
    console.log(`      ⚠️ Agent creation skipped (deprecated) - identity data stored in spec.config`);
  }

  // 4c. Create PromptSlugs for BOOTSTRAP specs (INIT-001 onboarding)
  if ((specRole === SpecRole.ORCHESTRATE || specRole as string === "BOOTSTRAP") && rawSpecData?.personas) {
    const personaKeys = Object.keys(rawSpecData.personas).filter(k => !k.startsWith("_") && k !== "defaultPersona");
    let slugsCreated = 0;

    for (const personaSlug of personaKeys) {
      const personaConfig = rawSpecData.personas[personaSlug];

      // Create welcome message slug for each persona
      if (personaConfig.welcomeTemplate && personaConfig.welcomeSlug) {
        const existingSlug = await prisma.promptSlug.findUnique({
          where: { slug: personaConfig.welcomeSlug },
        });

        if (!existingSlug) {
          await prisma.promptSlug.create({
            data: {
              slug: personaConfig.welcomeSlug,
              name: `${personaConfig.name || personaSlug} Welcome Message`,
              description: `First-call welcome message for ${personaSlug} persona`,
              sourceType: "COMPOSITE", // Static text, not parameter-driven
              fallbackPrompt: personaConfig.welcomeTemplate,
              priority: 100,
              isActive: true,
              version: featureSet.version,
              sourceFeatureSetId: featureSet.id,
            },
          });
          slugsCreated++;
        } else {
          // Update the fallback prompt if the template changed
          await prisma.promptSlug.update({
            where: { slug: personaConfig.welcomeSlug },
            data: {
              fallbackPrompt: personaConfig.welcomeTemplate,
              version: featureSet.version,
            },
          });
        }
      }

      // Create phase instruction slugs for each phase in the persona's flow
      if (personaConfig.firstCallFlow?.phases) {
        for (const phase of personaConfig.firstCallFlow.phases) {
          if (phase.instructionSlug) {
            const existingPhaseSlug = await prisma.promptSlug.findUnique({
              where: { slug: phase.instructionSlug },
            });

            // Build instruction text from phase goals/avoid
            const instructionText = [
              `Phase: ${phase.phase.toUpperCase()} (${phase.duration})`,
              `Priority: ${phase.priority}`,
              "",
              "GOALS:",
              ...phase.goals.map((g: string) => `- ${g}`),
              "",
              "AVOID:",
              ...phase.avoid.map((a: string) => `- ${a}`),
            ].join("\n");

            if (!existingPhaseSlug) {
              await prisma.promptSlug.create({
                data: {
                  slug: phase.instructionSlug,
                  name: `${phase.phase} Phase - ${personaConfig.name || personaSlug}`,
                  description: `Instructions for ${phase.phase} phase of first call for ${personaSlug} persona`,
                  sourceType: "COMPOSITE",
                  fallbackPrompt: instructionText,
                  priority: 90,
                  isActive: true,
                  version: featureSet.version,
                  sourceFeatureSetId: featureSet.id,
                },
              });
              slugsCreated++;
            } else {
              await prisma.promptSlug.update({
                where: { slug: phase.instructionSlug },
                data: {
                  fallbackPrompt: instructionText,
                  version: featureSet.version,
                },
              });
            }
          }
        }
      }
    }

    if (slugsCreated > 0) {
      console.log(`      ✓ Created ${slugsCreated} onboarding PromptSlugs for ${personaKeys.length} personas`);
    } else {
      console.log(`      ℹ️ Onboarding PromptSlugs already exist (updated ${personaKeys.length} personas)`);
    }
  }

  // 4e. Create Curriculum record for CONTENT specs
  if (specRole === SpecRole.CONTENT) {
    // Create slug from spec ID (e.g., "WNF-CONTENT-001" -> "wnf-content-001")
    const curriculumSlug = featureSet.featureId.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Extract content config from parameters or rawSpec
    let authors: string[] = [];
    let sourceTitle: string | null = null;
    let sourceYear: number | null = null;
    let notableInfo: any = null;
    let deliveryConfig: any = null;

    // Check if this is a module-based curriculum (has modules array in rawSpec)
    const isModuleCurriculum = rawSpecData?.modules && Array.isArray(rawSpecData.modules);

    if (isModuleCurriculum) {
      // Module-based curriculum (e.g., Food Safety L2)
      console.log(`      📚 Detected module-based curriculum with ${rawSpecData.modules.length} modules`);

      // Extract qualification metadata as source info
      const qual = rawSpecData.qualification || {};
      sourceTitle = qual.name || rawSpecData.title;
      authors = qual.primaryReference ? [qual.primaryReference] : [];

      // Store learning outcomes and qualification in notableInfo
      notableInfo = {
        qualification: rawSpecData.qualification,
        learningOutcomes: rawSpecData.learningOutcomes,
        assessment: rawSpecData.assessment,
      };

      // Store session structure and assessment strategy in delivery config
      deliveryConfig = {
        sessionStructure: rawSpecData.sessionStructure,
        assessmentStrategy: rawSpecData.assessmentStrategy,
      };

      // #306: dropped fields — coreArgument (modules JSON), critiques
      // (misconceptionBank), discussionQuestions (examTopics) — were
      // written here but read by nothing. Module structure now lives in
      // first-class CurriculumModule rows via lib/curriculum/sync-modules.

    } else {
      // Book-based curriculum (e.g., Why Nations Fail)
      for (const param of compiledParams) {
        const cfg = param.config || {};
        if (param.id === "source_metadata" || param.name?.includes("Source")) {
          authors = cfg.authors || [];
          sourceTitle = cfg.title || null;
          sourceYear = cfg.year || null;
          notableInfo = cfg.notableInfo || null;
        }
        if (param.id === "delivery_config" || param.name?.includes("Delivery")) {
          deliveryConfig = cfg;
        }
        // #306: previously also captured core_argument / case_studies /
        // discussion_questions / critiques; the columns are dropped because
        // nothing in the prompt pipeline read them.
      }
    }

    // Upsert the curriculum
    const existingCurriculum = await prisma.curriculum.findUnique({
      where: { slug: curriculumSlug },
    });

    if (existingCurriculum) {
      await prisma.curriculum.update({
        where: { slug: curriculumSlug },
        data: {
          name: featureSet.name,
          description: featureSet.description,
          authors,
          sourceTitle,
          sourceYear,
          notableInfo,
          deliveryConfig,
          constraints: compiledConstraints,
          sourceSpecId: spec.id,
          version: featureSet.version,
        },
      });
      console.log(`      ✓ Updated Curriculum: ${curriculumSlug}${isModuleCurriculum ? ` (${rawSpecData.modules.length} modules)` : ""}`);
    } else {
      await prisma.curriculum.create({
        data: {
          slug: curriculumSlug,
          name: featureSet.name,
          description: featureSet.description,
          authors,
          sourceTitle,
          sourceYear,
          notableInfo,
          deliveryConfig,
          constraints: compiledConstraints,
          sourceSpecId: spec.id,
          version: featureSet.version,
        },
      });
      results.curriculumCreated = true;
      console.log(`      ✓ Created Curriculum: ${curriculumSlug}${isModuleCurriculum ? ` (${rawSpecData.modules.length} modules)` : ""}`);
    }
  }

  // 5. Create trigger and actions
  await prisma.analysisTrigger.deleteMany({
    where: { specId: spec.id },
  });

  // Check if spec has explicit triggers array (from rawSpec in database)
  const explicitTriggers = rawSpecData?.triggers || [];

  // If spec has explicit triggers, use those instead of auto-generating
  if (explicitTriggers.length > 0 && outputType !== AnalysisOutputType.ADAPT) {
    // ADAPT specs are handled separately below with special targetValue logic
    for (let i = 0; i < explicitTriggers.length; i++) {
      const t = explicitTriggers[i];
      const trigger = await prisma.analysisTrigger.create({
        data: {
          specId: spec.id,
          given: t.given || "A call transcript is available",
          when: t.when || "The analysis pipeline runs",
          then: t.then || "Process the trigger",
          name: t.name || `Trigger ${i + 1}`,
          sortOrder: i,
        },
      });
      results.triggersCreated++;

      // Create actions from the trigger's actions array
      const triggerActions = t.actions || [];
      for (let j = 0; j < triggerActions.length; j++) {
        const a = triggerActions[j];

        // Handle MEASURE/MEASURE_AGENT actions with parameterId
        if (a.parameterId) {
          const paramExists = await prisma.parameter.findUnique({
            where: { parameterId: a.parameterId },
          });

          await prisma.analysisAction.create({
            data: {
              triggerId: trigger.id,
              description: a.description || `Process ${a.parameterId}`,
              weight: a.weight ?? 1.0,
              parameterId: paramExists ? a.parameterId : null,
              sortOrder: j,
            },
          });
          results.actionsCreated++;
        }
        // Handle LEARN actions with learnCategory/learnKeyPrefix
        else if (a.learnCategory) {
          // Map string category to enum
          let memoryCategory: MemoryCategory = MemoryCategory.FACT;
          const cat = (a.learnCategory || "").toUpperCase();
          if (cat === "PREFERENCE") memoryCategory = MemoryCategory.PREFERENCE;
          else if (cat === "EVENT") memoryCategory = MemoryCategory.EVENT;
          else if (cat === "TOPIC") memoryCategory = MemoryCategory.TOPIC;
          else if (cat === "RELATIONSHIP") memoryCategory = MemoryCategory.RELATIONSHIP;
          else if (cat === "CONTEXT") memoryCategory = MemoryCategory.CONTEXT;
          else if (cat === "FACT") memoryCategory = MemoryCategory.FACT;

          await prisma.analysisAction.create({
            data: {
              triggerId: trigger.id,
              description: a.description || `Extract ${a.learnKeyPrefix || "memory"}`,
              weight: a.weight ?? 1.0,
              learnCategory: memoryCategory,
              learnKeyPrefix: a.learnKeyPrefix || null,
              learnKeyHint: a.learnKeyHint || null,
              sortOrder: j,
            },
          });
          results.actionsCreated++;
        }
        // Handle generic actions (COMPOSE, etc.)
        else {
          await prisma.analysisAction.create({
            data: {
              triggerId: trigger.id,
              description: a.description || "Process action",
              weight: a.weight ?? 1.0,
              sortOrder: j,
            },
          });
          results.actionsCreated++;
        }
      }
    }
  }
  // Fall back to auto-generating triggers from parameters for specs without explicit triggers
  else if (outputType === AnalysisOutputType.MEASURE && explicitTriggers.length === 0) {
    const trigger = await prisma.analysisTrigger.create({
      data: {
        specId: spec.id,
        given: "A call transcript is available for analysis",
        when: "The analysis pipeline processes the call",
        then: `Score the following parameters: ${compiledParams.map((p: any) => p.id || p.name).join(", ")}`,
        name: featureSet.name,
        sortOrder: 0,
      },
    });
    results.triggersCreated++;

    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];
      const parameterId = param.id || param.parameterId;

      const paramRecord = await prisma.parameter.findUnique({
        where: { parameterId },
      });

      if (paramRecord) {
        await prisma.analysisAction.create({
          data: {
            triggerId: trigger.id,
            description: param.description || `Score ${parameterId}`,
            weight: 1.0,
            parameterId,
            sortOrder: i,
          },
        });
        results.actionsCreated++;
      }
    }
  }

  // For LEARN specs, create triggers for memory extraction (only if no explicit triggers)
  if (outputType === AnalysisOutputType.LEARN && explicitTriggers.length === 0) {
    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];

      // Map parameter to memory category
      let memoryCategory: MemoryCategory = MemoryCategory.FACT;
      const name = (param.name || "").toLowerCase();
      if (name.includes("preference")) memoryCategory = MemoryCategory.PREFERENCE;
      else if (name.includes("event")) memoryCategory = MemoryCategory.EVENT;
      else if (name.includes("topic")) memoryCategory = MemoryCategory.TOPIC;
      else if (name.includes("relation")) memoryCategory = MemoryCategory.RELATIONSHIP;
      else if (name.includes("context")) memoryCategory = MemoryCategory.CONTEXT;

      const trigger = await prisma.analysisTrigger.create({
        data: {
          specId: spec.id,
          given: "A caller is sharing information during conversation",
          when: `The system identifies ${param.name || "information"}`,
          then: `Extract and store ${param.name || "memory"}`,
          name: param.name || `Extract ${param.id}`,
          sortOrder: i,
        },
      });
      results.triggersCreated++;

      await prisma.analysisAction.create({
        data: {
          triggerId: trigger.id,
          description: param.description || `Extract ${param.id}`,
          weight: 1.0,
          learnCategory: memoryCategory,
          sortOrder: 0,
        },
      });
      results.actionsCreated++;
    }
  }

  // For MEASURE_AGENT specs, create a trigger with actions for each behavior parameter (only if no explicit triggers)
  if (outputType === AnalysisOutputType.MEASURE_AGENT && explicitTriggers.length === 0) {
    const trigger = await prisma.analysisTrigger.create({
      data: {
        specId: spec.id,
        given: "Agent responses are available for analysis",
        when: "The analysis pipeline processes agent behavior",
        then: `Measure agent behavior: ${compiledParams.map((p: any) => p.name || p.id).join(", ")}`,
        name: featureSet.name,
        sortOrder: 0,
      },
    });
    results.triggersCreated++;

    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];
      const parameterId = param.id || param.parameterId;

      const paramRecord = await prisma.parameter.findUnique({
        where: { parameterId },
      });

      if (paramRecord) {
        await prisma.analysisAction.create({
          data: {
            triggerId: trigger.id,
            description: param.description || `Measure ${parameterId}`,
            weight: 1.0,
            parameterId,
            sortOrder: i,
          },
        });
        results.actionsCreated++;
      }
    }
  }

  // For REWARD specs, create a trigger with actions for each reward signal (only if no explicit triggers)
  if (outputType === AnalysisOutputType.REWARD && explicitTriggers.length === 0) {
    const trigger = await prisma.analysisTrigger.create({
      data: {
        specId: spec.id,
        given: "Call measurements and context are available",
        when: "The reward computation phase runs",
        then: `Compute reward signals: ${compiledParams.map((p: any) => p.name || p.id).join(", ")}`,
        name: featureSet.name,
        sortOrder: 0,
      },
    });
    results.triggersCreated++;

    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];
      const parameterId = param.id || param.parameterId;

      const paramRecord = await prisma.parameter.findUnique({
        where: { parameterId },
      });

      if (paramRecord) {
        await prisma.analysisAction.create({
          data: {
            triggerId: trigger.id,
            description: param.description || `Compute ${parameterId}`,
            weight: 1.0,
            parameterId,
            sortOrder: i,
          },
        });
        results.actionsCreated++;
      }
    }
  }

  // For ADAPT specs, auto-generate triggers from adaptationRules (single source of truth).
  // The adapt-runner reads config.parameters[].config.adaptationRules at runtime.
  // We generate AnalysisTrigger/AnalysisAction records for UI display and data dictionary.
  if (outputType === AnalysisOutputType.ADAPT) {
    let triggerIdx = 0;
    for (const param of compiledParams) {
      const rules = param.config?.adaptationRules || [];
      if (rules.length === 0) continue;

      for (const rule of rules) {
        const cond = rule.condition || {};
        const actions = rule.actions || [];
        if (actions.length === 0) continue;

        // Build human-readable BDD trigger from the rule
        const opLabel = cond.operator === "gte" ? ">=" : cond.operator === "gt" ? ">" : cond.operator === "lt" ? "<" : cond.operator === "lte" ? "<=" : cond.operator || "?";
        const targetNames = actions.map((a: any) => a.targetParameter).join(", ");
        const trigger = await prisma.analysisTrigger.create({
          data: {
            specId: spec.id,
            given: `${cond.profileKey} is ${opLabel} ${cond.threshold}`,
            when: "Computing behavior targets",
            then: `Set ${targetNames}`,
            name: `${param.id}: ${cond.profileKey} ${opLabel} ${cond.threshold}`,
            sortOrder: triggerIdx++,
          },
        });
        results.triggersCreated++;

        // Create an action for each behavior target in the rule
        for (let j = 0; j < actions.length; j++) {
          const action = actions[j];
          const paramExists = await prisma.parameter.findUnique({
            where: { parameterId: action.targetParameter },
          });

          await prisma.analysisAction.create({
            data: {
              triggerId: trigger.id,
              description: action.rationale || `Set ${action.targetParameter} to ${action.value}`,
              weight: action.value ?? 0.5,
              parameterId: paramExists ? action.targetParameter : null,
              sortOrder: j,
            },
          });
          results.actionsCreated++;
        }
      }
    }
  }

  // For COMPOSE specs, create a trigger for prompt composition (only if no explicit triggers)
  if (outputType === AnalysisOutputType.COMPOSE && explicitTriggers.length === 0) {
    const trigger = await prisma.analysisTrigger.create({
      data: {
        specId: spec.id,
        given: "All measurements and context have been gathered",
        when: "The compose phase runs",
        then: "Assemble the final prompt from gathered context",
        name: featureSet.name,
        sortOrder: 0,
      },
    });
    results.triggersCreated++;

    // For COMPOSE, actions represent context assembly steps
    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];
      await prisma.analysisAction.create({
        data: {
          triggerId: trigger.id,
          description: param.description || `Include ${param.name || param.id}`,
          weight: 1.0,
          sortOrder: i,
        },
      });
      results.actionsCreated++;
    }
  }

  // For IDENTITY specs (based on specRole), create a trigger for identity definition (only if no explicit triggers)
  if (specRole === SpecRole.IDENTITY && explicitTriggers.length === 0) {
    const trigger = await prisma.analysisTrigger.create({
      data: {
        specId: spec.id,
        given: "A playbook needs to define agent identity",
        when: "The identity is assembled",
        then: "Define who the agent is and how it behaves",
        name: featureSet.name,
        sortOrder: 0,
      },
    });
    results.triggersCreated++;

    // For IDENTITY, actions represent identity definition components
    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];
      await prisma.analysisAction.create({
        data: {
          triggerId: trigger.id,
          description: param.description || `Define ${param.name || param.id}`,
          weight: 1.0,
          sortOrder: i,
        },
      });
      results.actionsCreated++;
    }
  }

  // For CONTENT specs (based on specRole), create a trigger for content/curriculum definition (only if no explicit triggers)
  if (specRole === SpecRole.CONTENT && explicitTriggers.length === 0) {
    const trigger = await prisma.analysisTrigger.create({
      data: {
        specId: spec.id,
        given: "A playbook needs to define content/curriculum",
        when: "The content is assembled",
        then: "Define what the agent knows and teaches",
        name: featureSet.name,
        sortOrder: 0,
      },
    });
    results.triggersCreated++;

    // For CONTENT, actions represent content/curriculum components
    for (let i = 0; i < compiledParams.length; i++) {
      const param = compiledParams[i];
      await prisma.analysisAction.create({
        data: {
          triggerId: trigger.id,
          description: param.description || `Provide ${param.name || param.id}`,
          weight: 1.0,
          sortOrder: i,
        },
      });
      results.actionsCreated++;
    }
  }

  // Update feature set as active
  await prisma.bDDFeatureSet.update({
    where: { id: featureSetId },
    data: {
      isActive: true,
      activatedAt: new Date(),
    },
  });

  return results;
}

/**
 * Re-seed a single spec by featureId.
 * Reads the file from disk, parses it, upserts the BDDFeatureSet, and activates all derived records.
 */
export async function reseedSingleSpec(
  featureId: string
): Promise<SeedSpecResult> {
  await ensureContractsLoaded();

  const specsFolder = getSpecsFolder();
  const files = fs.readdirSync(specsFolder).filter(
    (f) => f.startsWith(featureId) && f.endsWith(".spec.json")
  );

  if (files.length === 0) {
    throw new Error(`No source file found for ${featureId} in ${specsFolder}`);
  }

  const filename = files[0];
  const filePath = path.join(specsFolder, filename);
  const content = fs.readFileSync(filePath, "utf-8");
  const rawJson = JSON.parse(content);
  const parseResult = parseJsonSpec(content);

  if (!parseResult.success) {
    throw new Error(`Failed to parse ${filename}: ${parseResult.errors.join(", ")}`);
  }

  const featureSet = await upsertFeatureSet(parseResult.data, filename, rawJson);
  return activateFeatureSet(featureSet.id);
}

/**
 * Seed contracts from docs-archive/bdd-specs/contracts/*.contract.json into SystemSettings.
 * This makes contracts available to the DB-backed ContractRegistry at runtime.
 */
export async function seedContracts(): Promise<{ seeded: number; errors: string[] }> {
  const specsFolder = getSpecsFolder();
  const contractsDir = path.join(specsFolder, "contracts");
  const errors: string[] = [];
  let seeded = 0;

  if (!fs.existsSync(contractsDir)) {
    console.log("   No contracts/ directory found, skipping contract seeding");
    return { seeded: 0, errors: [] };
  }

  const files = fs.readdirSync(contractsDir).filter(f => f.endsWith(".contract.json"));
  console.log(`   Found ${files.length} contract file(s)\n`);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(contractsDir, file), "utf-8");
      const contract = JSON.parse(content);

      if (!contract.contractId || !contract.version) {
        errors.push(`${file}: missing contractId or version`);
        continue;
      }

      const key = `contract:${contract.contractId}`;
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: content },
        create: { key, value: content },
      });

      console.log(`   ✓ Contract: ${contract.contractId} v${contract.version}`);
      seeded++;
    } catch (e: any) {
      errors.push(`${file}: ${e.message}`);
      console.error(`   ✗ Contract ${file}: ${e.message}`);
    }
  }

  return { seeded, errors };
}

/**
 * Seed fallback defaults into SystemSettings.
 * These are the last-resort values used when specs or AI are unavailable.
 * Uses upsert so re-running is safe (won't overwrite admin edits unless value is identical).
 */
export async function seedFallbacks(): Promise<{ seeded: number; skipped: number }> {
  const fallbacks: Array<{ key: string; value: unknown; label: string }> = [
    { key: "fallback:onboarding.personas", value: DEFAULT_FALLBACK_PERSONAS, label: "Onboarding Personas" },
    { key: "fallback:identity.template", value: DEFAULT_IDENTITY_TEMPLATE, label: "Identity Template" },
    { key: "fallback:onboarding.flow_phases", value: DEFAULT_FLOW_PHASES, label: "Onboarding Flow Phases" },
    { key: "fallback:pipeline.transcript_limits", value: DEFAULT_TRANSCRIPT_LIMITS, label: "Transcript Limits" },
    { key: "fallback:ai.default_models", value: DEFAULT_AI_MODEL_CONFIGS, label: "AI Model Defaults" },
  ];

  let seeded = 0;
  let skipped = 0;

  for (const { key, value, label } of fallbacks) {
    const jsonValue = JSON.stringify(value);
    const existing = await prisma.systemSetting.findUnique({ where: { key } });

    if (existing) {
      // Don't overwrite if admin has customized the value
      skipped++;
      continue;
    }

    await prisma.systemSetting.create({
      data: { key, value: jsonValue },
    });
    seeded++;
    console.log(`      ✓ ${label} (${key})`);
  }

  return { seeded, skipped };
}

/**
 * Main function - seed from all spec files
 */
export async function seedFromSpecs(options?: { specIds?: string[]; excludeFeatureIds?: string[] }): Promise<SeedSpecResult[]> {
  console.log("\n📋 SEEDING FROM BDD SPEC FILES\n");
  console.log("━".repeat(60));

  // Seed contracts into DB first, then load them for validation
  console.log("\n   📦 Seeding contracts into SystemSettings...\n");
  const contractResult = await seedContracts();
  console.log(`   ✅ ${contractResult.seeded} contracts seeded\n`);

  // Seed fallback defaults into SystemSettings
  console.log("   🛡️  Seeding fallback defaults...\n");
  const fallbackResult = await seedFallbacks();
  console.log(`   ✅ ${fallbackResult.seeded} fallbacks seeded, ${fallbackResult.skipped} already exist\n`);

  // Load contracts from DB for spec validation
  await ensureContractsLoaded();

  let specFiles = loadSpecFiles(options?.excludeFeatureIds);

  // Filter to specific specs if requested
  if (options?.specIds?.length) {
    const requestedIds = new Set(options.specIds.map(id => id.toUpperCase()));
    specFiles = specFiles.filter(f => requestedIds.has(f.content.id.toUpperCase()));
    console.log(`   Filtering to ${specFiles.length} requested spec(s): ${options.specIds.join(", ")}\n`);
  }

  if (specFiles.length === 0) {
    console.log("   No spec files found in docs-archive/bdd-specs/ folder");
    return [];
  }

  console.log(`   Found ${specFiles.length} spec file(s):\n`);

  const results: SeedSpecResult[] = [];

  for (const { filename, content, rawJson } of specFiles) {
    console.log(`   📄 Processing: ${filename}`);
    console.log(`      ID: ${content.id}, Type: ${content.specType || "DOMAIN"}, Role: ${content.specRole || "META"}, Output: ${content.outputType || "MEASURE"}`);

    try {
      // Create/update the feature set (now stores rawSpec for production runtime)
      const featureSet = await upsertFeatureSet(content, filename, rawJson);

      // Activate it to create all derived records
      const result = await activateFeatureSet(featureSet.id);
      results.push(result);

      console.log(`      ✓ Parameters: ${result.parametersCreated} created, ${result.parametersUpdated} updated`);
      console.log(`      ✓ Scoring Anchors: ${result.anchorsCreated} created`);
      console.log(`      ✓ Prompt Slugs: ${result.promptSlugsCreated} created`);
      console.log(`      ✓ Specs: ${result.specsCreated} created`);
      console.log(`      ✓ Triggers: ${result.triggersCreated}, Actions: ${result.actionsCreated}`);
      console.log("");
    } catch (e: any) {
      console.error(`      ✗ Error seeding ${content.id}: ${e.message}`);
      console.log("");
      results.push({
        specId: content.id,
        title: content.title || content.id,
        parametersCreated: 0,
        parametersUpdated: 0,
        anchorsCreated: 0,
        specsCreated: 0,
        triggersCreated: 0,
        actionsCreated: 0,
        promptSlugsCreated: 0,
        agentCreated: false,
        curriculumCreated: false,
        error: e.message,
      });
    }
  }

  // Summary
  const totals = results.reduce(
    (acc, r) => ({
      params: acc.params + r.parametersCreated + r.parametersUpdated,
      anchors: acc.anchors + r.anchorsCreated,
      slugs: acc.slugs + r.promptSlugsCreated,
      specs: acc.specs + r.specsCreated,
      agents: acc.agents + (r.agentCreated ? 1 : 0),
      curricula: acc.curricula + (r.curriculumCreated ? 1 : 0),
    }),
    { params: 0, anchors: 0, slugs: 0, specs: 0, agents: 0, curricula: 0 }
  );

  console.log(`   ✅ Loaded ${specFiles.length} specs → ${totals.params} params, ${totals.anchors} anchors, ${totals.slugs} slugs, ${totals.specs} specs`);
  console.log(`   ✅ First-class entities: ${totals.agents} agents, ${totals.curricula} curricula\n`);

  return results;
}

// Allow running directly
if (require.main === module) {
  seedFromSpecs()
    .then(() => {
      console.log("Done!");
      process.exit(0);
    })
    .catch((e) => {
      console.error("Error:", e);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

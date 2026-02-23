import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ParameterType,
  AnalysisOutputType,
  SpecificationScope,
  MemoryCategory,
  SpecType,
  SpecRole,
} from "@prisma/client";
import { parseJsonSpec } from "@/lib/bdd/ai-parser";
import { compileSpecToTemplate } from "@/lib/bdd/compile-specs";
import { clearAIConfigCache } from "@/lib/ai/config-loader";
import { clearSystemSettingsCache } from "@/lib/system-settings";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/lab/features/:id/activate
 * @visibility internal
 * @auth session
 * @tags lab, specs
 * @description Activate or deactivate a BDDFeatureSet by creating/updating all derived records (Parameters, Anchors, AnalysisSpecs, Triggers, Actions, PromptSlugs, Curriculum). Full parity with seed-from-specs.ts.
 * @pathParam id string - The BDDFeatureSet ID
 * @body activate boolean - True to activate, false to deactivate
 * @response 200 { ok: true, feature: object, spec: { id, slug, name, specRole, outputType }, results: { parametersCreated, parametersUpdated, anchorsCreated, specsCreated, triggersCreated, actionsCreated, promptSlugsCreated, curriculumCreated } }
 * @response 404 { ok: false, error: "Feature set not found" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;
    const body = await req.json();
    const { activate } = body;

    // If deactivating, just toggle the flag
    if (!activate) {
      const feature = await prisma.bDDFeatureSet.update({
        where: { id },
        data: {
          isActive: false,
          activatedAt: null,
        },
        select: {
          id: true,
          featureId: true,
          name: true,
          isActive: true,
          activatedAt: true,
        },
      });
      // Invalidate caches so deactivation takes effect immediately
      clearAIConfigCache();
      clearSystemSettingsCache();
      return NextResponse.json({ ok: true, feature, deactivated: true });
    }

    // Fetch the full feature set
    const featureSet = await prisma.bDDFeatureSet.findUnique({
      where: { id },
    });

    if (!featureSet) {
      return NextResponse.json(
        { ok: false, error: "Feature set not found" },
        { status: 404 }
      );
    }

    const compiledParams = (featureSet.parameters as any[]) || [];
    const compiledConstraints = (featureSet.constraints as any[]) || [];
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

    // Determine outputType: IDENTITY/CONTENT/VOICE specs use COMPOSE
    let outputType: AnalysisOutputType;
    if (specRole === SpecRole.IDENTITY || specRole === SpecRole.CONTENT || specRole === SpecRole.VOICE) {
      outputType = AnalysisOutputType.COMPOSE;
    } else {
      outputType = declaredOutputType;
    }

    const results = {
      parametersCreated: 0,
      parametersUpdated: 0,
      anchorsCreated: 0,
      specsCreated: 0,
      triggersCreated: 0,
      actionsCreated: 0,
      promptSlugsCreated: 0,
      curriculumCreated: false,
    };

    // Determine if this is a config spec (no Parameter records needed)
    const isConfigSpec =
      specRole === SpecRole.IDENTITY ||
      specRole === SpecRole.CONTENT ||
      specRole === SpecRole.VOICE ||
      (specRole as string) === "GUARDRAIL" ||
      outputType === AnalysisOutputType.LEARN ||
      outputType === AnalysisOutputType.COMPOSE;

    // 1. Create/update Parameter records (skip for config specs)
    if (!isConfigSpec) {
      for (const param of compiledParams) {
        const parameterId = param.id || param.parameterId;
        if (!parameterId) continue;

        const existingParam = await prisma.parameter.findUnique({
          where: { parameterId },
        });

        // Determine parameter type
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
          const lowRange = param.interpretationScale.find((r: any) => r.min <= 0.1 || r.label?.toLowerCase().includes("low"));
          if (highRange) interpretationHigh = `${highRange.label}: ${highRange.implication || ""}`;
          if (lowRange) interpretationLow = `${lowRange.label}: ${lowRange.implication || ""}`;
        }

        const paramData = {
          parameterId,
          name: param.name || parameterId,
          definition: param.description || param.definition || null,
          sectionId: param.section || "lab-imported",
          domainGroup: scoringSpec?.domain || "lab",
          scaleType: param.scaleType || "0-1",
          directionality: param.directionality || "positive",
          computedBy: `spec:${featureSet.featureId}`,
          parameterType,
          interpretationHigh,
          interpretationLow,
          sourceFeatureSetId: featureSet.id,
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

        // Create scoring anchors
        if (param.scoringAnchors && Array.isArray(param.scoringAnchors)) {
          for (const anchor of param.scoringAnchors) {
            const existing = await prisma.parameterScoringAnchor.findFirst({
              where: { parameterId, example: anchor.example },
            });
            if (!existing && anchor.example) {
              await prisma.parameterScoringAnchor.create({
                data: {
                  parameterId,
                  example: anchor.example,
                  score: anchor.score ?? 0.5,
                  rationale: anchor.rationale || null,
                  source: `lab:${featureSet.featureId}`,
                  sourceFeatureSetId: featureSet.id,
                  isGold: anchor.isGold ?? true,
                },
              });
              results.anchorsCreated++;
            }
          }
        }

        // Add interpretation scale as anchors
        if (param.interpretationScale && Array.isArray(param.interpretationScale)) {
          for (const range of param.interpretationScale) {
            const avgScore = ((range.min || 0) + (range.max || 1)) / 2;
            const existing = await prisma.parameterScoringAnchor.findFirst({
              where: { parameterId, example: { contains: range.label } },
            });
            if (!existing) {
              await prisma.parameterScoringAnchor.create({
                data: {
                  parameterId,
                  example: `${range.label}: ${range.implication || ""}`,
                  score: avgScore,
                  rationale: `Interpretation range ${range.min}-${range.max}`,
                  source: `lab:${featureSet.featureId}`,
                  sourceFeatureSetId: featureSet.id,
                  isGold: true,
                },
              });
              results.anchorsCreated++;
            }
          }
        }

        // Create PromptSlugs from promptGuidance
        if (param.promptGuidance) {
          const pg = param.promptGuidance;
          const slugId = `prompt-${parameterId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

          const existingSlug = await prisma.promptSlug.findUnique({
            where: { slug: slugId },
          });

          if (!existingSlug && (pg.whenHigh || pg.whenLow || pg.always)) {
            const promptSlugRecord = await prisma.promptSlug.create({
              data: {
                slug: slugId,
                name: param.name || parameterId,
                description: param.description,
                sourceType: "PARAMETER",
                fallbackPrompt: pg.always || null,
                priority: 0,
                isActive: true,
                version: featureSet.version,
                sourceFeatureSetId: featureSet.id,
              },
            });

            // Create ranges
            const ranges: any[] = [];
            if (pg.whenHigh) {
              ranges.push({ minValue: 0.7, maxValue: 1.0, label: "High", prompt: pg.whenHigh });
            }
            if (pg.whenLow) {
              ranges.push({ minValue: 0.0, maxValue: 0.3, label: "Low", prompt: pg.whenLow });
            }
            if (pg.whenMedium || (pg.whenHigh && pg.whenLow)) {
              ranges.push({ minValue: 0.3, maxValue: 0.7, label: "Medium", prompt: pg.whenMedium || pg.always || "" });
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

    // 2. For ADAPT specs: Auto-create behavior parameters from adaptation rules AND triggers
    if (outputType === AnalysisOutputType.ADAPT) {
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

      // Create missing behavior parameters
      for (const parameterId of targetParameterIds) {
        const existing = await prisma.parameter.findUnique({
          where: { parameterId },
        });

        if (!existing) {
          const metadata = targetParameterMetadata.get(parameterId);
          const name = parameterId
            .split("-")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
          const domainGroup = metadata?.section || scoringSpec?.domain || "teaching";

          await prisma.parameter.create({
            data: {
              parameterId,
              name,
              definition: metadata?.rationale || `Behavior parameter auto-created from ${featureSet.featureId}`,
              sectionId: metadata?.section || "teaching",
              domainGroup,
              scaleType: "0-1",
              directionality: "positive",
              computedBy: `spec:${featureSet.featureId}`,
              parameterType: ParameterType.BEHAVIOR,
              isAdjustable: true,
            },
          });
          results.parametersCreated++;
        }
      }
    }

    // 3. Build config based on specRole/outputType
    let config: Record<string, any> | null = null;

    if (outputType === AnalysisOutputType.COMPOSE) {
      if (specRole === SpecRole.CONTENT && featureSet.parameters) {
        config = { parameters: featureSet.parameters };
      } else {
        config = {
          parameters: compiledParams.map(p => ({
            id: p.id || p.parameterId,
            config: p.config || {},
          })),
        };
      }
      for (const param of compiledParams) {
        if (param.config) Object.assign(config, param.config);
      }
      if (rawSpecData?.metadata) config.metadata = rawSpecData.metadata;
      if (rawSpecData?.sections) config.sections = rawSpecData.sections;
    } else if (specRole === SpecRole.IDENTITY || specRole === SpecRole.CONTENT) {
      config = { parameters: featureSet.parameters || [] };
      for (const param of compiledParams) {
        const paramId = param.id || param.parameterId;
        if (param.config) {
          Object.assign(config, param.config);
          if (paramId) config[paramId] = param.config;
        }
      }
      if (rawSpecData?.metadata) config.metadata = rawSpecData.metadata;
      if (rawSpecData?.modules) {
        config.modules = rawSpecData.modules;
        config.learningOutcomes = rawSpecData.learningOutcomes;
        config.qualification = rawSpecData.qualification;
        config.assessment = rawSpecData.assessment;
        config.misconceptionBank = rawSpecData.misconceptionBank;
        config.sessionStructure = rawSpecData.sessionStructure;
        config.assessmentStrategy = rawSpecData.assessmentStrategy;
      }
    } else if ((specRole as string) === "BOOTSTRAP") {
      config = {
        parameters: compiledParams.map(p => ({
          id: p.id || p.parameterId,
          config: p.config || {},
        })),
      };
      for (const param of compiledParams) {
        if (param.config) Object.assign(config, param.config);
      }
      if (rawSpecData?.firstCallFlow) config.firstCallFlow = rawSpecData.firstCallFlow;
      if (rawSpecData?.outputs) config.outputs = rawSpecData.outputs;
      if (rawSpecData?.constraints) config.constraints = rawSpecData.constraints;
      if (rawSpecData?.personas) config.personas = rawSpecData.personas;
      if (rawSpecData?.promptSlugs) config.promptSlugs = rawSpecData.promptSlugs;
    } else if (compiledParams.length > 0 && compiledParams.some(p => p.config)) {
      config = {
        parameters: compiledParams.map(p => ({
          id: p.id || p.parameterId,
          config: p.config || {},
        })),
      };
    }

    // 4. Compile promptTemplate from rawSpec
    let promptTemplate: string | null = null;
    if (featureSet.rawSpec) {
      const parseResult = parseJsonSpec(JSON.stringify(featureSet.rawSpec));
      if (parseResult.success) {
        const compileResult = compileSpecToTemplate(parseResult.data);
        promptTemplate = compileResult.promptTemplate;
      }
    }

    // 5. Create/update AnalysisSpec
    const specSlug = `spec-${featureSet.featureId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const description = featureSet.description || `Analysis spec from ${featureSet.featureId}`;
    const scope = specType === SpecType.SYSTEM ? SpecificationScope.SYSTEM : SpecificationScope.DOMAIN;

    const existingSpec = await prisma.analysisSpec.findUnique({
      where: { slug: specSlug },
    });

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
        data: { slug: specSlug, ...specData },
      });
      results.specsCreated++;
    }

    // 6. Create PromptSlugs for BOOTSTRAP specs (personas, welcome messages, phase instructions)
    if ((specRole as string) === "BOOTSTRAP" && rawSpecData?.personas) {
      const personaKeys = Object.keys(rawSpecData.personas).filter(k => !k.startsWith("_") && k !== "defaultPersona");

      for (const personaSlug of personaKeys) {
        const personaConfig = rawSpecData.personas[personaSlug];

        // Create welcome message slug
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
                sourceType: "COMPOSITE",
                fallbackPrompt: personaConfig.welcomeTemplate,
                priority: 100,
                isActive: true,
                version: featureSet.version,
                sourceFeatureSetId: featureSet.id,
              },
            });
            results.promptSlugsCreated++;
          } else {
            await prisma.promptSlug.update({
              where: { slug: personaConfig.welcomeSlug },
              data: { fallbackPrompt: personaConfig.welcomeTemplate, version: featureSet.version },
            });
          }
        }

        // Create phase instruction slugs
        if (personaConfig.firstCallFlow?.phases) {
          for (const phase of personaConfig.firstCallFlow.phases) {
            if (phase.instructionSlug) {
              const existingPhaseSlug = await prisma.promptSlug.findUnique({
                where: { slug: phase.instructionSlug },
              });

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
                results.promptSlugsCreated++;
              } else {
                await prisma.promptSlug.update({
                  where: { slug: phase.instructionSlug },
                  data: { fallbackPrompt: instructionText, version: featureSet.version },
                });
              }
            }
          }
        }
      }
    }

    // 7. Create Curriculum record for CONTENT specs
    if (specRole === SpecRole.CONTENT) {
      const curriculumSlug = featureSet.featureId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const isModuleCurriculum = rawSpecData?.modules && Array.isArray(rawSpecData.modules);

      let authors: string[] = [];
      let sourceTitle: string | null = null;
      let sourceYear: number | null = null;
      let notableInfo: any = null;
      let coreArgument: any = null;
      let caseStudies: any = null;
      let discussionQuestions: any = null;
      let critiques: any = null;
      let deliveryConfig: any = null;

      if (isModuleCurriculum) {
        const qual = rawSpecData.qualification || {};
        sourceTitle = qual.name || rawSpecData.title;
        authors = qual.primaryReference ? [qual.primaryReference] : [];
        notableInfo = {
          qualification: rawSpecData.qualification,
          learningOutcomes: rawSpecData.learningOutcomes,
          assessment: rawSpecData.assessment,
        };
        coreArgument = {
          modules: rawSpecData.modules,
          totalModules: rawSpecData.modules.length,
          estimatedDuration: rawSpecData.modules.reduce((sum: number, m: any) => sum + (m.durationMinutes || 0), 0),
        };
        critiques = rawSpecData.misconceptionBank || null;
        deliveryConfig = {
          sessionStructure: rawSpecData.sessionStructure,
          assessmentStrategy: rawSpecData.assessmentStrategy,
        };
        const allExamTopics: string[] = [];
        for (const mod of rawSpecData.modules) {
          if (mod.examTopics) allExamTopics.push(...mod.examTopics);
        }
        if (allExamTopics.length > 0) {
          discussionQuestions = { examTopics: allExamTopics };
        }
      } else {
        for (const param of compiledParams) {
          const cfg = param.config || {};
          if (param.id === "source_metadata" || param.name?.includes("Source")) {
            authors = cfg.authors || [];
            sourceTitle = cfg.title || null;
            sourceYear = cfg.year || null;
            notableInfo = cfg.notableInfo || null;
          }
          if (param.id === "core_argument" || param.name?.includes("Core Argument") || param.name?.includes("Thesis")) {
            coreArgument = cfg;
          }
          if (param.id === "case_studies" || param.name?.includes("Case Studies")) {
            caseStudies = cfg.studies || cfg;
          }
          if (param.id === "discussion_questions" || param.name?.includes("Discussion")) {
            discussionQuestions = cfg.questions || cfg;
          }
          if (param.id === "critiques" || param.name?.includes("Critiques")) {
            critiques = cfg.critiques || cfg;
          }
          if (param.id === "delivery_config" || param.name?.includes("Delivery")) {
            deliveryConfig = cfg;
          }
        }
      }

      const existingCurriculum = await prisma.curriculum.findUnique({
        where: { slug: curriculumSlug },
      });

      const curriculumData = {
        name: featureSet.name,
        description: featureSet.description,
        authors,
        sourceTitle,
        sourceYear,
        notableInfo,
        coreArgument,
        caseStudies,
        discussionQuestions,
        critiques,
        deliveryConfig,
        constraints: compiledConstraints,
        sourceSpecId: spec.id,
        version: featureSet.version,
      };

      if (existingCurriculum) {
        await prisma.curriculum.update({
          where: { slug: curriculumSlug },
          data: curriculumData,
        });
      } else {
        await prisma.curriculum.create({
          data: { slug: curriculumSlug, ...curriculumData },
        });
        results.curriculumCreated = true;
      }
    }

    // 8. Create triggers and actions
    await prisma.analysisTrigger.deleteMany({
      where: { specId: spec.id },
    });

    const explicitTriggers = rawSpecData?.triggers || [];

    // Use explicit triggers if present (except for ADAPT which needs special handling)
    if (explicitTriggers.length > 0 && outputType !== AnalysisOutputType.ADAPT) {
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

        const triggerActions = t.actions || [];
        for (let j = 0; j < triggerActions.length; j++) {
          const a = triggerActions[j];

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
          } else if (a.learnCategory) {
            let memoryCategory: MemoryCategory = MemoryCategory.FACT;
            const cat = (a.learnCategory || "").toUpperCase();
            if (cat === "PREFERENCE") memoryCategory = MemoryCategory.PREFERENCE;
            else if (cat === "EVENT") memoryCategory = MemoryCategory.EVENT;
            else if (cat === "TOPIC") memoryCategory = MemoryCategory.TOPIC;
            else if (cat === "RELATIONSHIP") memoryCategory = MemoryCategory.RELATIONSHIP;
            else if (cat === "CONTEXT") memoryCategory = MemoryCategory.CONTEXT;

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
          } else {
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
    // Auto-generate triggers based on outputType/specRole
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
        const paramRecord = await prisma.parameter.findUnique({ where: { parameterId } });
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
    } else if (outputType === AnalysisOutputType.ADAPT) {
      for (let i = 0; i < explicitTriggers.length; i++) {
        const t = explicitTriggers[i];
        const trigger = await prisma.analysisTrigger.create({
          data: {
            specId: spec.id,
            given: t.given,
            when: t.when,
            then: t.then,
            name: t.name,
            sortOrder: i,
          },
        });
        results.triggersCreated++;

        const triggerActions = t.actions || [];
        for (let j = 0; j < triggerActions.length; j++) {
          const action = triggerActions[j];
          if (action.parameterId) {
            const paramExists = await prisma.parameter.findUnique({ where: { parameterId: action.parameterId } });
            await prisma.analysisAction.create({
              data: {
                triggerId: trigger.id,
                description: action.description || `Apply ${action.parameterId}`,
                weight: action.weight ?? 1.0,
                parameterId: paramExists ? action.parameterId : null,
                sortOrder: j,
              },
            });
            results.actionsCreated++;
          }
        }

        // Legacy format: parameterId on trigger directly
        if (t.parameterId && triggerActions.length === 0) {
          const paramExists = await prisma.parameter.findUnique({ where: { parameterId: t.parameterId } });
          await prisma.analysisAction.create({
            data: {
              triggerId: trigger.id,
              description: paramExists
                ? `${t.then} [targetValue=${t.targetValue ?? 0.5}]`
                : `${t.then} [targetValue=${t.targetValue ?? 0.5}] [parameterId=${t.parameterId}]`,
              weight: t.targetValue ?? 0.5,
              parameterId: paramExists ? t.parameterId : null,
              sortOrder: 0,
            },
          });
          results.actionsCreated++;
        }
      }
    } else if (specRole === SpecRole.IDENTITY && explicitTriggers.length === 0) {
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
    } else if (specRole === SpecRole.CONTENT && explicitTriggers.length === 0) {
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

    // 9. Update feature set as active
    const updatedFeature = await prisma.bDDFeatureSet.update({
      where: { id },
      data: {
        isActive: true,
        activatedAt: new Date(),
      },
      select: {
        id: true,
        featureId: true,
        name: true,
        isActive: true,
        activatedAt: true,
      },
    });

    // Invalidate caches so activation takes effect immediately
    clearAIConfigCache();
    clearSystemSettingsCache();

    return NextResponse.json({
      ok: true,
      feature: updatedFeature,
      spec: {
        id: spec.id,
        slug: spec.slug,
        name: spec.name,
        specRole,
        outputType,
      },
      results,
    });
  } catch (error: any) {
    console.error("Error activating feature set:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to activate feature set" },
      { status: 500 }
    );
  }
}

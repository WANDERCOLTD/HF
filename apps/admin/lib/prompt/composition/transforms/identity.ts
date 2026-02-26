/**
 * Identity & Content Spec Transforms
 * Extracted from route.ts lines 692-790, 2337-2414
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, PlaybookData, SystemSpecData, ResolvedSpecs, ResolvedSpec } from "../types";
import type { SpecConfig } from "@/lib/types/json-fields";

/**
 * Resolve identity, content, and voice specs from stacked playbooks + system specs.
 * Playbooks are ordered by sortOrder - first playbook's spec wins on conflicts.
 * Called once during executor setup (not a registered transform).
 */
export function resolveSpecs(
  playbooks: PlaybookData[],
  systemSpecs: SystemSpecData[],
): ResolvedSpecs {
  let identitySpec: ResolvedSpec | null = null;
  let contentSpec: ResolvedSpec | null = null;
  let voiceSpec: ResolvedSpec | null = null;

  // 1. Check PlaybookItems from ALL playbooks (first playbook wins on conflicts)
  for (const playbook of playbooks) {
    for (const item of playbook.items || []) {
      if (item.spec) {
        if (!identitySpec && item.spec.specRole === "IDENTITY" && item.spec.domain !== "voice") {
          identitySpec = {
            name: item.spec.name,
            slug: item.spec.slug,
            config: item.spec.config,
            description: item.spec.description,
            extendsAgent: item.spec.extendsAgent || null,
          };
        }
        if (!contentSpec && item.spec.specRole === "CONTENT") {
          contentSpec = {
            name: item.spec.name,
            slug: item.spec.slug,
            config: item.spec.config,
            description: item.spec.description,
          };
        }
        if (!voiceSpec && (item.spec.specRole === "VOICE" || (item.spec.specRole === "IDENTITY" && item.spec.domain === "voice"))) {
          voiceSpec = {
            name: item.spec.name,
            slug: item.spec.slug,
            config: item.spec.config,
            description: item.spec.description,
          };
        }
      }
    }
  }

  // 2. Check System Specs as fallback
  if (!identitySpec || !contentSpec || !voiceSpec) {
    for (const spec of systemSpecs) {
      const role = spec.specRole as string;

      if (!identitySpec && role === "IDENTITY" && spec.domain !== "voice") {
        identitySpec = { name: spec.name, slug: spec.slug, config: spec.config, description: spec.description, extendsAgent: spec.extendsAgent || null };
      }
      if (!contentSpec && role === "CONTENT") {
        contentSpec = { name: spec.name, slug: spec.slug, config: spec.config, description: spec.description };
      }
      if (!voiceSpec && (role === "VOICE" || (role === "IDENTITY" && spec.domain === "voice"))) {
        voiceSpec = { name: spec.name, slug: spec.slug, config: spec.config, description: spec.description };
      }
    }
  }

  return { identitySpec, contentSpec, voiceSpec };
}

/**
 * Load voice spec directly if not found in playbook or system specs.
 * Uses config.specs.voicePattern for slug matching (default: "voice").
 */
export async function resolveVoiceSpecFallback(
  current: ResolvedSpecs,
): Promise<ResolvedSpecs> {
  if (current.voiceSpec) return current;

  const voicePattern = config.specs.voicePattern;
  const systemVoiceSpec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: voicePattern, mode: "insensitive" },
      specRole: "IDENTITY",
      domain: "voice",
      isActive: true,
    },
  });

  if (systemVoiceSpec) {
    return {
      ...current,
      voiceSpec: {
        name: systemVoiceSpec.name,
        config: systemVoiceSpec.config,
        description: systemVoiceSpec.description,
      },
    };
  }

  return current;
}

/**
 * Merge an overlay identity spec with its base archetype.
 * Uses parameter-level replace: if overlay provides a parameter, it wins.
 * Base parameters not in overlay are inherited. Constraints stack.
 *
 * If no extendsAgent or base not found, returns the overlay unchanged.
 */
export async function mergeIdentitySpec(
  overlay: ResolvedSpec,
): Promise<ResolvedSpec> {
  if (!overlay.extendsAgent) return overlay;

  // Convert extendsAgent ID (e.g. "TUT-001") to DB slug (e.g. "spec-tut-001")
  const baseSlug = `spec-${overlay.extendsAgent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const baseSpec = await prisma.analysisSpec.findFirst({
    where: {
      slug: baseSlug,
      isActive: true,
    },
    select: {
      name: true,
      slug: true,
      config: true,
      description: true,
    },
  });

  if (!baseSpec) {
    console.warn(
      `[mergeIdentitySpec] Base spec "${overlay.extendsAgent}" (slug: ${baseSlug}) not found or inactive. Using overlay as-is.`
    );
    return overlay;
  }

  const baseConfig = (baseSpec.config as Record<string, any>) || {};
  const overlayConfig = (overlay.config as Record<string, any>) || {};

  // Get parameters arrays from both specs
  const baseParams: any[] = baseConfig.parameters || [];
  const overlayParams: any[] = overlayConfig.parameters || [];

  // Parameter-level merge: overlay replaces base by param id
  const mergedParamsMap = new Map<string, any>();
  for (const param of baseParams) {
    const id = param.id || param.parameterId;
    if (id) mergedParamsMap.set(id, param);
  }
  for (const param of overlayParams) {
    const id = param.id || param.parameterId;
    if (id) mergedParamsMap.set(id, param); // Replace or add
  }

  // Flatten merged params into a config object (same pattern as seed-from-specs)
  const mergedConfig: Record<string, any> = {};

  // Flatten base parameter configs first
  for (const param of baseParams) {
    if (param.config && typeof param.config === "object") {
      Object.assign(mergedConfig, param.config);
    }
  }

  // Overlay parameter configs replace base (parameter-level)
  for (const param of overlayParams) {
    if (param.config && typeof param.config === "object") {
      Object.assign(mergedConfig, param.config);
    }
  }

  // Also copy any top-level keys from both configs (non-parameters, non-constraints)
  for (const key of Object.keys(baseConfig)) {
    if (key !== "parameters" && key !== "constraints") {
      mergedConfig[key] = baseConfig[key];
    }
  }
  for (const key of Object.keys(overlayConfig)) {
    if (key !== "parameters" && key !== "constraints") {
      mergedConfig[key] = overlayConfig[key]; // Overlay wins
    }
  }

  // Store structured parameters for downstream use
  mergedConfig.parameters = Array.from(mergedParamsMap.values());

  // Constraints stack (base + overlay, never remove base constraints)
  const baseConstraints = baseConfig.constraints || [];
  const overlayConstraints = overlayConfig.constraints || [];
  if (baseConstraints.length > 0 || overlayConstraints.length > 0) {
    mergedConfig.constraints = [...baseConstraints, ...overlayConstraints];
  }

  console.log(
    `[mergeIdentitySpec] Merged "${overlay.extendsAgent}" (${baseParams.length} params) + overlay (${overlayParams.length} params) → ${mergedParamsMap.size} merged params`
  );

  return {
    name: overlay.name, // Keep overlay's name (domain-specific)
    slug: overlay.slug,
    config: mergedConfig,
    description: overlay.description || baseSpec.description,
    extendsAgent: overlay.extendsAgent,
  };
}

/**
 * Apply department/group tone override to a merged identity spec.
 * Sits between mergeIdentitySpec() and the final prompt in the cascade:
 *   Base archetype → Domain overlay → mergeIdentitySpec → applyGroupToneOverride → Final
 *
 * Reads `toneSliders` (non-neutral values only) and `styleNotes` from the
 * group's `identityOverride` JSON, converts them to style directives, and
 * appends them to the spec config's `styleGuidelines` array.
 *
 * Does NOT mutate the original spec — returns a new ResolvedSpec.
 */
export function applyGroupToneOverride(
  spec: ResolvedSpec,
  override: Record<string, any>,
): ResolvedSpec {
  const sliders: Record<string, number> | undefined = override.toneSliders;
  const styleNotes: string | undefined = override.styleNotes;

  // Nothing to apply
  if (!sliders && !styleNotes) return spec;

  const specConfig = { ...((spec.config as Record<string, any>) || {}) };
  const guidelines: string[] = [...(specConfig.styleGuidelines || [])];

  // Convert non-neutral slider values to style directives
  if (sliders) {
    const SLIDER_LABELS: Record<string, [string, string]> = {
      formality:  ["casual and conversational", "formal and professional"],
      warmth:     ["matter-of-fact and direct", "warm and empathetic"],
      pace:       ["quick and efficient", "patient and measured"],
      encourage:  ["objective and neutral", "encouraging and supportive"],
      precision:  ["broad and conceptual", "precise and detailed"],
    };

    for (const [key, value] of Object.entries(sliders)) {
      // Neutral (0.5) means no override — skip
      if (typeof value !== "number" || Math.abs(value - 0.5) < 0.05) continue;

      const labels = SLIDER_LABELS[key];
      if (!labels) continue;

      const [lowLabel, highLabel] = labels;
      if (value < 0.5) {
        const intensity = value < 0.25 ? "strongly" : "somewhat";
        guidelines.push(`Department tone: Be ${intensity} ${lowLabel}.`);
      } else {
        const intensity = value > 0.75 ? "strongly" : "somewhat";
        guidelines.push(`Department tone: Be ${intensity} ${highLabel}.`);
      }
    }
  }

  // Append freeform style notes
  if (styleNotes?.trim()) {
    guidelines.push(`Department teaching style: ${styleNotes.trim()}`);
  }

  if (guidelines.length === (specConfig.styleGuidelines || []).length) {
    // Nothing was actually added
    return spec;
  }

  specConfig.styleGuidelines = guidelines;

  return {
    ...spec,
    config: specConfig,
  };
}

/**
 * Extract identity spec into llmPrompt output.
 * Extracted from route.ts lines 2337-2373.
 */
registerTransform("extractIdentitySpec", (
  _rawData: any,
  context: AssembledContext,
) => {
  const identitySpec = context.resolvedSpecs.identitySpec;
  const callerDomain = context.loadedData.caller?.domain;

  if (!identitySpec) return null;

  const specConfig = identitySpec.config as SpecConfig;

  return {
    specName: (() => {
      const name = identitySpec.name;
      if (name.toLowerCase().includes("generic") && callerDomain?.name) {
        return `${callerDomain.name} Tutor Identity`;
      }
      return name;
    })(),
    domain: callerDomain?.name || null,
    description: identitySpec.description,
    role: specConfig?.roleStatement || specConfig?.tutor_role?.roleStatement || null,
    primaryGoal: specConfig?.primaryGoal || null,
    secondaryGoals: specConfig?.secondaryGoals || [],
    techniques: (specConfig?.techniques || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      when: t.when,
    })),
    styleDefaults: specConfig?.defaults || null,
    styleGuidelines: specConfig?.styleGuidelines || [],
    responsePatterns: specConfig?.patterns || null,
    boundaries: {
      does: specConfig?.does || [],
      doesNot: specConfig?.doesNot || [],
    },
    sessionStructure: specConfig?.opening || specConfig?.main || specConfig?.closing ? {
      opening: specConfig?.opening,
      main: specConfig?.main,
      closing: specConfig?.closing,
    } : null,
    assessmentApproach: specConfig?.principles || specConfig?.methods ? {
      principles: specConfig?.principles || [],
      methods: specConfig?.methods || [],
    } : null,
  };
});

/**
 * Extract content spec into llmPrompt output.
 * Extracted from route.ts lines 2376-2414.
 */
registerTransform("extractContentSpec", (
  _rawData: any,
  context: AssembledContext,
) => {
  const contentSpec = context.resolvedSpecs.contentSpec;
  if (!contentSpec) return null;

  const specConfig = contentSpec.config as SpecConfig;
  const modulesSource = specConfig?.modules || specConfig?.curriculum?.modules || [];

  return {
    specName: contentSpec.name,
    description: contentSpec.description,
    curriculumName: specConfig?.curriculum?.name || specConfig?.name || null,
    curriculumDescription: specConfig?.description || null,
    targetAudience: specConfig?.targetAudience || null,
    learningObjectives: specConfig?.learningObjectives || [],
    modules: modulesSource.map((m: any) => ({
      id: m.id,
      slug: m.slug || m.id,
      name: m.name,
      description: m.description,
      prerequisites: m.prerequisites || [],
      concepts: m.concepts || [],
      learningOutcomes: m.learningOutcomes || [],
      sortOrder: m.sortOrder,
      masteryThreshold: m.masteryThreshold,
    })),
    totalModules: modulesSource.length,
    conceptLibrary: specConfig?.concepts || null,
    deliveryRules: {
      pacing: specConfig?.pacing || null,
      sequencing: specConfig?.sequencing || null,
      personalization: specConfig?.personalization || null,
      practiceRatio: specConfig?.practiceRatio || null,
    },
    activityTypes: specConfig?.activityTypes || [],
    assessmentCriteria: {
      comprehension: specConfig?.comprehensionIndicators || [],
      application: specConfig?.applicationIndicators || [],
      mastery: specConfig?.masteryIndicators || [],
    },
  };
});

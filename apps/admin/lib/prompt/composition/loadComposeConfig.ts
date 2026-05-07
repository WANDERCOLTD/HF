/**
 * Load COMPOSE spec configuration from database.
 *
 * Reads COMP-001 (or equivalent) spec and builds the full config
 * needed by executeComposition(). Shared by both the compose-prompt
 * API route and the pipeline COMPOSE stage.
 *
 * NO HARDCODING — all values come from the spec. Structural defaults only.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { getDefaultSections } from "./CompositionExecutor";
import type { CompositionSectionDef } from "./types";
import type { SpecConfig } from "@/lib/types/json-fields";

export interface ComposeConfig {
  specSlug: string | null;
  fullSpecConfig: Record<string, any>;
  sections: CompositionSectionDef[];
}

/**
 * Load COMPOSE spec from DB and build the full config object.
 *
 * @param overrides - Optional preview overrides
 * @returns Config ready to pass to executeComposition()
 */
export async function loadComposeConfig(overrides?: {
  targetOverrides?: Record<string, number>;
  playbookIds?: string[];
  forceFirstCall?: boolean;
  /**
   * #274 Slice A: when set, the tutor's prompt is composed for a session
   * locked to a specific authored module. Bypasses scheduler in
   * computeSharedState; populates SharedComputedState.lockedModule.
   * Read by the picker → SimChat → compose-prompt flow.
   */
  requestedModuleId?: string;
}): Promise<ComposeConfig> {
  // Try exact slug first (from config), then fallback to any active COMPOSE/SYSTEM spec
  const composeSpec = await prisma.analysisSpec.findFirst({
    where: { slug: config.specs.compose, isActive: true },
  }) || await prisma.analysisSpec.findFirst({
    where: {
      outputType: "COMPOSE",
      isActive: true,
      scope: "SYSTEM",
      domain: { not: "prompt-slugs" },
    },
  });

  const specConfig = (composeSpec?.config as SpecConfig) || {};
  const specParameters = (specConfig.parameters as Array<{ id: string; config?: Record<string, any> }>) || [];

  const getParamConfig = (paramId: string): Record<string, any> => {
    const param = specParameters.find((p) => p.id === paramId);
    return param?.config || {};
  };

  // Extract spec-driven config values from parameter sections
  const personalityConfig = getParamConfig("personality_section");
  const memoryConfig = getParamConfig("memory_section");
  const sessionConfig = getParamConfig("session_context_section");
  const historyConfig = getParamConfig("recent_history_section");

  const thresholds = personalityConfig.thresholds || specConfig.thresholds || { high: 0.65, low: 0.35 };
  const memoriesLimit = memoryConfig.memoriesLimit || specConfig.memoriesLimit || 50;
  const memoriesPerCategory = memoryConfig.memoriesPerCategory || specConfig.memoriesPerCategory || 5;
  const recentCallsLimit = sessionConfig.recentCallsLimit || specConfig.recentCallsLimit || 5;
  const maxTokens = historyConfig.maxTokens || specConfig.maxTokens || 1500;
  const temperature = historyConfig.temperature || specConfig.temperature || 0.7;

  // Require COMPOSE spec to exist (same pattern as PIPELINE-001)
  if (!composeSpec) {
    throw new Error(
      `COMPOSE spec not found. Expected slug "${config.specs.compose}" or any active COMPOSE/SYSTEM spec. ` +
      `Run db:seed to create the spec.`
    );
  }

  // Warn loudly if spec has no sections[] — using hardcoded defaults
  const sections = specConfig.sections as CompositionSectionDef[] | undefined;
  if (!sections || sections.length === 0) {
    console.warn(
      `[loadComposeConfig] COMPOSE spec "${composeSpec.slug}" has no sections[] in config. ` +
      `Using hardcoded defaults — add sections to the spec to remove this warning.`
    );
  }

  return {
    specSlug: composeSpec.slug,
    fullSpecConfig: {
      ...specConfig,
      thresholds,
      memoriesLimit,
      memoriesPerCategory,
      recentCallsLimit,
      maxTokens,
      temperature,
      targetOverrides: overrides?.targetOverrides || {},
      playbookIds: overrides?.playbookIds || undefined,
      forceFirstCall: overrides?.forceFirstCall || false,
      requestedModuleId: overrides?.requestedModuleId || undefined,
    },
    sections: sections && sections.length > 0 ? sections : getDefaultSections(),
  };
}

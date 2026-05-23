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
  // Resolve the COMPOSE spec.
  //
  // Robust-fix (2026-05-23): the prior fallback was too permissive — it
  // matched ANY active SYSTEM-scope spec with `outputType=COMPOSE` and
  // `domain != prompt-slugs`. On DEV that pool included identity-domain
  // archetype + overlay specs (ADVISOR-001, COACH-001, spec-advisor-001,
  // spec-coach-001, …) because every IDENTITY spec is seeded with
  // `outputType="COMPOSE"` (see prisma/seed-identity-archetypes.ts).
  // `findFirst()` without `orderBy` is non-deterministic in Postgres, so
  // some calls landed on `spec-comp-001` (correct) and others on
  // `spec-advisor-001` / `ADVISOR-001` (wrong) — which then surfaced as
  // `inputs.specUsed = "spec-advisor-001"` on ComposedPrompt rows and
  // tripped the `advisorInInputsSnapshot` audit counter. This was the
  // root cause of the 28 historical leaks investigated as #608 follow-ups.
  //
  // Tightened to require `domain="prompt-composition"` — the canonical
  // domain for COMP-* specs in seed-from-specs / seed-prompts. Identity
  // and archetype specs use `domain="identity"`, never `prompt-composition`,
  // so this filter excludes them by design. `orderBy: slug asc` then
  // makes the choice deterministic when multiple compose-domain specs
  // are active (rare; today there is only `spec-comp-001`).
  //
  // If the exact-slug match fails AND the fallback fires, log a warning
  // so the env misconfiguration is visible. The 28 historical leaks were
  // silent because no log was emitted on fallback.
  const exactMatch = await prisma.analysisSpec.findFirst({
    where: { slug: config.specs.compose, isActive: true },
  });
  const composeSpec = exactMatch || await prisma.analysisSpec.findFirst({
    where: {
      outputType: "COMPOSE",
      isActive: true,
      scope: "SYSTEM",
      domain: "prompt-composition",
    },
    orderBy: { slug: "asc" },
  });
  if (!exactMatch && composeSpec) {
    console.warn(
      `[loadComposeConfig] env COMPOSE_SPEC_SLUG="${config.specs.compose}" has no exact match in DB. ` +
        `Fell back to "${composeSpec.slug}" (first SYSTEM/COMPOSE spec in domain=prompt-composition by slug asc). ` +
        `Set COMPOSE_SPEC_SLUG to the correct slug to suppress this warning.`,
    );
  }

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

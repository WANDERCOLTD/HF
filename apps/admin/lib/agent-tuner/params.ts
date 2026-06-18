/**
 * Agent Tuner — Parameter Loading & Context Building
 *
 * Shared helpers for loading adjustable BEHAVIOR parameters and formatting
 * them as grounding context for AI prompts. Used by both:
 * - lib/agent-tuner/interpret.ts
 * - app/api/playbooks/[playbookId]/targets/suggest/route.ts (potential future refactor)
 */

import { prisma } from "@/lib/prisma";

// ── Types ─────────────────────────────────────────────

export interface ParameterContext {
  id: string;
  name: string;
  group: string;
  currentValue: number;
  high: string;
  low: string;
}

export interface LoadedParameters {
  params: ParameterContext[];
  validParamIds: Set<string>;
}

// ── Loaders ───────────────────────────────────────────

/**
 * Load all adjustable BEHAVIOR parameters with their grounding context.
 * Merges SYSTEM-level defaults. Optionally overlays additional target values.
 */
export async function loadAdjustableParameters(
  overrideTargets?: Map<string, number>,
): Promise<LoadedParameters> {
  const allParams = await prisma.parameter.findMany({
    // #1949 — also filter `deprecatedAt: null`. Pre-#1949 the Tune
    // sidebar continued to render parameters whose Parameter row was
    // marked deprecated (operator-set via S1 dedup), surfacing a
    // sibling slider for an already-merged concept. TL Finding CC-1.
    where: {
      parameterType: "BEHAVIOR",
      isAdjustable: true,
      deprecatedAt: null,
    },
    select: {
      parameterId: true,
      name: true,
      domainGroup: true,
      interpretationHigh: true,
      interpretationLow: true,
    },
    orderBy: [{ domainGroup: "asc" }, { name: "asc" }],
  });

  const systemTargets = await prisma.behaviorTarget.findMany({
    where: {
      scope: "SYSTEM",
      parameterId: { in: allParams.map((p) => p.parameterId) },
      effectiveUntil: null,
    },
  });

  const systemMap = new Map(systemTargets.map((t) => [t.parameterId, t.targetValue]));

  const params: ParameterContext[] = allParams.map((p) => ({
    id: p.parameterId,
    name: p.name,
    group: p.domainGroup,
    currentValue:
      overrideTargets?.get(p.parameterId) ??
      systemMap.get(p.parameterId) ??
      0.5,
    high: p.interpretationHigh || "High",
    low: p.interpretationLow || "Low",
  }));

  const validParamIds = new Set(allParams.map((p) => p.parameterId));

  return { params, validParamIds };
}

// ── Formatting ────────────────────────────────────────

/**
 * Format parameter context as a compact text block for AI prompt grounding.
 */
export function formatParameterList(params: ParameterContext[]): string {
  return params
    .map(
      (p) =>
        `${p.id} (${p.name}, group: ${p.group}, current: ${p.currentValue.toFixed(2)}, high="${p.high}", low="${p.low}")`,
    )
    .join("\n");
}

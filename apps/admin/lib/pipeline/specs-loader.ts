/**
 * Pipeline spec loading — unified functions for loading and filtering
 * AnalysisSpecs by type, scope, and playbook configuration.
 */

import { AnalysisOutputType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTranscriptLimitsFallback } from "@/lib/fallback-settings";
import type { PipelineLogger } from "./logger";
import type { AIConfigExtended, PlaybookConfig } from "@/lib/types/json-fields";

/**
 * Get transcript limit for a call point from AIConfig, with fallback to defaults.
 */
export async function getTranscriptLimit(callPoint: string): Promise<number> {
  try {
    const aiCfg = await prisma.aIConfig.findUnique({
      where: { callPoint },
    });
    const limit = (aiCfg as unknown as AIConfigExtended)?.transcriptLimit;
    if (limit && typeof limit === "number") {
      return limit;
    }
  } catch {
    // Fallback to default on error
  }
  const limits = await getTranscriptLimitsFallback();
  return limits[callPoint] ?? 4000;
}

/**
 * Get SYSTEM specs filtered by playbook toggle settings.
 * System specs can be toggled ON/OFF per playbook via PlaybookSystemSpec.isEnabled.
 * Defaults to enabled if no PlaybookSystemSpec record exists.
 */
export async function getSystemSpecs(
  outputTypes: string[],
  playbookId: string | null,
  log: PipelineLogger
): Promise<Array<{ id: string; slug: string; outputType: string }>> {
  const allSystemSpecs = await prisma.analysisSpec.findMany({
    where: {
      scope: "SYSTEM",
      outputType: { in: outputTypes as AnalysisOutputType[] },
      isActive: true,
      isDirty: false,
    },
    select: { id: true, slug: true, outputType: true },
    orderBy: { priority: "desc" },
  });

  if (!playbookId) {
    log.info(`Loaded ${allSystemSpecs.length} SYSTEM specs (no playbook)`, { outputTypes });
    return allSystemSpecs;
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });

  const playbookConfig = (playbook?.config as PlaybookConfig) || {};
  const toggles = playbookConfig.systemSpecToggles || {};

  if (Object.keys(toggles).length === 0) {
    log.info(`Loaded ${allSystemSpecs.length} SYSTEM specs (no toggles configured)`, { outputTypes, playbookId });
    return allSystemSpecs;
  }

  const filtered = allSystemSpecs.filter(spec => {
    const toggle = toggles[spec.id] || toggles[spec.slug];
    if (toggle && toggle.isEnabled === false) {
      log.info(`SYSTEM spec "${spec.slug}" disabled by playbook toggle`);
      return false;
    }
    return true;
  });

  log.info(`Loaded ${filtered.length}/${allSystemSpecs.length} SYSTEM specs (${allSystemSpecs.length - filtered.length} disabled by playbook)`, {
    outputTypes,
    playbookId,
  });

  return filtered;
}

/**
 * Get specs by outputType for a specific pipeline stage.
 */
export async function getSpecsByOutputType(
  outputType: string,
  log: PipelineLogger
): Promise<Array<{ id: string; slug: string; outputType: string }>> {
  const specs = await prisma.analysisSpec.findMany({
    where: {
      outputType: outputType as AnalysisOutputType,
      isActive: true,
      isDirty: false,
    },
    select: { id: true, slug: true, outputType: true },
    orderBy: { priority: "desc" },
  });

  log.info(`Loaded ${specs.length} ${outputType} specs`);
  return specs;
}

/**
 * Get DOMAIN specs from the caller's enrolled playbooks (or domain fallback).
 *
 * Resolution order:
 * 1. CallerPlaybook enrollments (ACTIVE) → use enrolled PUBLISHED playbooks
 * 2. Domain-based fallback → first PUBLISHED playbook in caller's domain
 * 3. Global fallback → all active DOMAIN specs
 */
export async function getPlaybookSpecs(
  callerId: string,
  outputTypes: string[],
  log: PipelineLogger
): Promise<{
  specs: Array<{ id: string; slug: string; outputType: string }>;
  playbookId: string | null;
  playbookName: string | null;
  fallback: boolean;
}> {
  // 1. Check CallerPlaybook enrollments first
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    select: { playbookId: true },
  });

  if (enrollments.length > 0) {
    const enrolledIds = enrollments.map((e) => e.playbookId);
    const playbooks = await prisma.playbook.findMany({
      where: {
        id: { in: enrolledIds },
        status: "PUBLISHED",
      },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        items: {
          where: {
            itemType: "SPEC",
            isEnabled: true,
            spec: {
              scope: "DOMAIN",
              outputType: { in: outputTypes as AnalysisOutputType[] },
              isActive: true,
              isDirty: false,
            },
          },
          select: {
            spec: {
              select: { id: true, slug: true, outputType: true },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    if (playbooks.length > 0) {
      // Collect specs from all enrolled playbooks, deduplicate by spec ID
      const seenIds = new Set<string>();
      const specs: Array<{ id: string; slug: string; outputType: string }> = [];
      for (const pb of playbooks) {
        for (const item of pb.items) {
          if (item.spec && !seenIds.has(item.spec.id)) {
            seenIds.add(item.spec.id);
            specs.push(item.spec);
          }
        }
      }

      const primary = playbooks[0];
      log.info(`Using ${playbooks.length} enrolled playbook(s), primary: "${primary.name}"`, {
        playbookId: primary.id,
        enrolledCount: playbooks.length,
        specCount: specs.length,
        outputTypes,
      });

      return {
        specs,
        playbookId: primary.id,
        playbookName: primary.name,
        fallback: false,
      };
    }
  }

  // 2. Fallback — caller has no ACTIVE enrolment in a PUBLISHED playbook.
  //
  // Historically we picked "a" published playbook from the caller's domain via
  // findFirst. That was non-deterministic in multi-course domains and silently
  // ran pipeline analysis against the wrong course's specs. See #domain-lookup
  // audit — the fix is to NEVER bind to a random playbook. Instead we return
  // the universal set of active DOMAIN-scoped specs (same as the no-domain
  // path) and surface a loud warning so the bug cannot hide.
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true, domain: { select: { slug: true, name: true } } },
  });

  log.warn(
    `[specs-loader] Caller ${callerId} has no ACTIVE enrolment in a PUBLISHED playbook — loading universal DOMAIN specs as safe fallback (domain=${caller?.domain?.slug ?? "none"})`,
  );

  const allSpecs = await prisma.analysisSpec.findMany({
    where: {
      scope: "DOMAIN",
      outputType: { in: outputTypes as AnalysisOutputType[] },
      isActive: true,
      isDirty: false,
    },
    select: { id: true, slug: true, outputType: true },
  });

  return {
    specs: allSpecs,
    playbookId: null,
    playbookName: null,
    fallback: true,
  };
}

/**
 * Resolve the teaching profile for a caller's enrolled course.
 * Uses a single query: caller → enrollment → playbook → subject.
 * Returns null if no profile is set (knowledge courses typically have one).
 */
export async function resolveCallerTeachingProfile(
  callerId: string,
  log: PipelineLogger,
): Promise<string | null> {
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    select: {
      playbook: {
        select: {
          subjects: {
            select: {
              subject: { select: { teachingProfile: true } },
            },
            take: 1,
          },
        },
      },
    },
  });

  const profile = enrollment?.playbook?.subjects?.[0]?.subject?.teachingProfile ?? null;
  if (profile) {
    log.info(`Caller teaching profile: ${profile}`);
  }
  return profile;
}

/**
 * Filter specs by teaching profile condition.
 * Specs with no `profileCondition` in their config run unconditionally (e.g. PERS-001).
 * Specs with `profileCondition: ["comprehension-led"]` only run for that profile.
 */
export async function filterByTeachingProfile(
  specIds: string[],
  callerProfile: string | null,
  log: PipelineLogger,
): Promise<string[]> {
  if (specIds.length === 0) return specIds;

  // Load configs for specs that might have profileCondition
  const specs = await prisma.analysisSpec.findMany({
    where: { id: { in: specIds } },
    select: { id: true, slug: true, config: true },
  });

  return specs
    .filter((spec) => {
      const specConfig = spec.config as Record<string, unknown> | null;
      const condition = specConfig?.profileCondition as string[] | undefined;
      if (!condition || !Array.isArray(condition)) return true; // no condition = always run
      if (!callerProfile) {
        log.info(`Skipping "${spec.slug}" — requires profile ${condition.join("/")} but caller has none`);
        return false;
      }
      if (!condition.includes(callerProfile)) {
        log.info(`Skipping "${spec.slug}" — requires ${condition.join("/")} but caller is ${callerProfile}`);
        return false;
      }
      return true;
    })
    .map((s) => s.id);
}

/**
 * Filter specs by BehaviorTarget parameter presence on the playbook.
 *
 * **Why this gate exists** (#2137, S2 of epic #2135):
 *
 * Some MEASURE specs only fire when the playbook has explicit operator
 * intent to score the spec's parameters — captured as `BehaviorTarget`
 * rows scoped to `PLAYBOOK`. Per the operator's revised gating signal
 * (#2137 live-state correction 2026-06-21):
 *
 * > Detect by parameter presence: the spec fires if the playbook has
 * > any of the spec's declared parameters in its `BehaviorTarget` rows.
 *
 * This tracks actual scoring intent rather than declarative metadata
 * (e.g. `Subject.teachingProfile`) that may drift. Opted in per-spec
 * via `config.requiresBehaviorTargetParams: true` — generic across
 * future course-specific scoring specs (CEFR / TOEFL / Spanish DELE).
 *
 * Specs without the opt-in flag run unconditionally (preserves the
 * existing `filterByTeachingProfile` semantics for the system-wide
 * specs like PERS-001).
 *
 * Filter logic:
 * - If a spec's config lacks `requiresBehaviorTargetParams: true` → pass through.
 * - If `playbookId` is null → drop (no playbook-scope BehaviorTargets to check).
 * - Else collect the spec's `parameters[].id` from its `triggers[].actions[].parameterId`
 *   (the seeded shape from `seed-from-specs.ts`); if ANY are present on the
 *   playbook's BehaviorTarget rows, the spec runs. Otherwise, drop.
 */
export async function filterByBehaviorTargetParams(
  specIds: string[],
  playbookId: string | null,
  log: PipelineLogger,
): Promise<string[]> {
  if (specIds.length === 0) return specIds;

  // Load configs + parameters (via triggers/actions) for the candidate specs.
  const specs = await prisma.analysisSpec.findMany({
    where: { id: { in: specIds } },
    select: {
      id: true,
      slug: true,
      config: true,
      triggers: {
        select: {
          actions: {
            select: { parameterId: true },
          },
        },
      },
    },
  });

  // Identify which specs opted in to this gate.
  const optedIn = specs.filter((spec) => {
    const cfg = spec.config as Record<string, unknown> | null;
    return cfg?.requiresBehaviorTargetParams === true;
  });

  if (optedIn.length === 0) {
    // Nothing opted in; pass through unchanged.
    return specIds;
  }

  if (!playbookId) {
    // Opted-in specs require a playbook to check; without one we cannot
    // satisfy the gate. Drop them all and pass non-opted-in through.
    const droppedSlugs = optedIn.map((s) => s.slug);
    log.info(
      `[behavior-target-gate] Dropping ${optedIn.length} opted-in spec(s) — no playbookId in scope: ${droppedSlugs.join(", ")}`,
    );
    const droppedIds = new Set(optedIn.map((s) => s.id));
    return specIds.filter((id) => !droppedIds.has(id));
  }

  // Load the playbook's PLAYBOOK-scope BehaviorTarget parameterIds in one shot.
  const playbookTargets = await prisma.behaviorTarget.findMany({
    where: { scope: "PLAYBOOK", playbookId },
    select: { parameterId: true },
  });
  const playbookParamSet = new Set(playbookTargets.map((t) => t.parameterId));

  // For each opted-in spec, check whether any declared parameter is in the playbook set.
  const passingIds = new Set<string>();
  for (const spec of specs) {
    const cfg = spec.config as Record<string, unknown> | null;
    const requiresGate = cfg?.requiresBehaviorTargetParams === true;
    if (!requiresGate) {
      passingIds.add(spec.id);
      continue;
    }

    // Collect spec's declared parameter ids from triggers/actions.
    const declaredParamIds = new Set<string>();
    for (const trigger of spec.triggers) {
      for (const action of trigger.actions) {
        if (action.parameterId) declaredParamIds.add(action.parameterId);
      }
    }

    const matchedParam = Array.from(declaredParamIds).find((p) => playbookParamSet.has(p));
    if (matchedParam) {
      log.info(
        `[behavior-target-gate] Spec "${spec.slug}" opted in and matched playbook BehaviorTarget "${matchedParam}" — running.`,
      );
      passingIds.add(spec.id);
    } else {
      log.info(
        `[behavior-target-gate] Spec "${spec.slug}" opted in but no declared parameter is a BehaviorTarget on playbook ${playbookId} — dropping.`,
      );
    }
  }

  // Preserve specs not loaded by this helper (defensive — shouldn't happen).
  for (const id of specIds) {
    if (!specs.find((s) => s.id === id)) {
      passingIds.add(id);
    }
  }

  return Array.from(passingIds);
}

/**
 * Batch-load parameters by IDs in a single query instead of N queries.
 * Reduces DB round-trips from O(N) to O(1).
 */
export async function batchLoadParameters(
  specs: Array<{ triggers: Array<{ actions: Array<{ parameterId: string | null }> }> }>
): Promise<Map<string, { parameterId: string; name: string; definition: string | null }>> {
  const paramIds = new Set<string>();
  for (const spec of specs) {
    for (const trigger of spec.triggers) {
      for (const action of trigger.actions) {
        if (action.parameterId) {
          paramIds.add(action.parameterId);
        }
      }
    }
  }

  if (paramIds.size === 0) {
    return new Map();
  }

  const params = await prisma.parameter.findMany({
    where: { parameterId: { in: Array.from(paramIds) } },
    select: { parameterId: true, name: true, definition: true },
  });

  const paramMap = new Map<string, { parameterId: string; name: string; definition: string | null }>();
  for (const param of params) {
    paramMap.set(param.parameterId, param);
  }

  return paramMap;
}

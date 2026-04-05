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

  // 2. Domain-based fallback (no enrollments or no published enrolled playbooks)
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true, domain: { select: { slug: true, name: true } } },
  });

  if (!caller?.domainId) {
    log.warn("Caller has no domain assigned, using fallback (all active DOMAIN specs)");
    const allSpecs = await prisma.analysisSpec.findMany({
      where: {
        scope: "DOMAIN",
        outputType: { in: outputTypes as AnalysisOutputType[] },
        isActive: true,
        isDirty: false,
      },
      select: { id: true, slug: true, outputType: true },
    });
    return { specs: allSpecs, playbookId: null, playbookName: null, fallback: true };
  }

  const playbook = await prisma.playbook.findFirst({
    where: {
      domainId: caller.domainId,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      name: true,
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
  });

  if (!playbook) {
    log.warn(`No published playbook for domain "${caller.domain?.slug}", using fallback (all active DOMAIN specs)`);
    const allSpecs = await prisma.analysisSpec.findMany({
      where: {
        scope: "DOMAIN",
        outputType: { in: outputTypes as AnalysisOutputType[] },
        isActive: true,
        isDirty: false,
      },
      select: { id: true, slug: true, outputType: true },
    });
    return { specs: allSpecs, playbookId: null, playbookName: null, fallback: true };
  }

  const specs = playbook.items
    .filter((item) => item.spec)
    .map((item) => item.spec!);

  log.info(`Using playbook "${playbook.name}" for domain "${caller.domain?.slug}" (domain fallback)`, {
    playbookId: playbook.id,
    specCount: specs.length,
    outputTypes,
  });

  return {
    specs,
    playbookId: playbook.id,
    playbookName: playbook.name,
    fallback: false,
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

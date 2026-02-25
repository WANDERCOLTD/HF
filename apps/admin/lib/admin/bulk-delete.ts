/**
 * Bulk delete core logic — preview + execute for 4 entity types.
 *
 * Two modes:
 * 1. Synchronous (small batches) — called directly from API route
 * 2. Background job (large cascades) — called from backgroundRun() in job route
 *
 * Preview always runs first to show the user what will be affected.
 */

import { prisma } from "@/lib/prisma";
import { deleteCallerData } from "@/lib/gdpr/delete-caller-data";
import { deletePlaybookData } from "@/lib/gdpr/delete-playbook-data";
import { deleteSubjectData, findOrphanedSources } from "@/lib/gdpr/delete-subject-data";

// ── Thresholds ──

/** @system-constant bulk-delete — Max callers for synchronous delete */
export const SYNC_CALLER_LIMIT = 5;
/** @system-constant bulk-delete — Max playbooks for synchronous delete */
export const SYNC_PLAYBOOK_LIMIT = 10;
/** @system-constant bulk-delete — Max subjects for synchronous delete */
export const SYNC_SUBJECT_LIMIT = 10;
/** @system-constant bulk-delete — Max domains for synchronous deactivate */
export const SYNC_DOMAIN_LIMIT = 20;
/** @system-constant bulk-delete — Total affected records threshold for background */
export const TOTAL_RECORDS_THRESHOLD = 500;

// ── Types ──

export type EntityType = "caller" | "playbook" | "domain" | "subject";

export interface BulkDeletePreviewItem {
  id: string;
  name: string;
  /** Table name → count of records that will be affected */
  counts: Record<string, number>;
  canDelete: boolean;
  blockReason?: string;
}

export interface BulkDeletePreview {
  entityType: EntityType;
  entityIds: string[];
  items: BulkDeletePreviewItem[];
  totals: Record<string, number>;
  recommendBackground: boolean;
  blocked: Array<{ id: string; name: string; reason: string }>;
}

export interface BulkDeleteResultItem {
  id: string;
  name: string;
  counts: Record<string, number>;
}

export interface BulkDeleteResult {
  entityType: EntityType;
  succeeded: BulkDeleteResultItem[];
  failed: Array<{ id: string; name: string; error: string }>;
  totalDeleted: number;
  totalFailed: number;
}

export type ProgressCallback = (completed: number, total: number, current: string) => void | Promise<void>;

// ── Helpers ──

function sumCounts(items: BulkDeletePreviewItem[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    if (!item.canDelete) continue;
    for (const [key, val] of Object.entries(item.counts)) {
      totals[key] = (totals[key] || 0) + val;
    }
  }
  return totals;
}

function totalAffected(totals: Record<string, number>): number {
  return Object.values(totals).reduce((a, b) => a + b, 0);
}

// ── Preview: Callers ──

export async function previewCallerDelete(callerIds: string[]): Promise<BulkDeletePreview> {
  const items: BulkDeletePreviewItem[] = [];

  const callers = await prisma.caller.findMany({
    where: { id: { in: callerIds } },
    select: {
      id: true, name: true, email: true, phone: true,
      _count: {
        select: {
          calls: true,
          memories: true,
          personalityObservations: true,
          goals: true,
          artifacts: true,
          composedPrompts: true,
          enrollments: true,
          callerTargets: true,
          callerAttributes: true,
          actions: true,
          inboundMessages: true,
          onboardingSessions: true,
          cohortMemberships: true,
        },
      },
    },
  });

  const foundIds = new Set(callers.map((c) => c.id));

  for (const callerId of callerIds) {
    if (!foundIds.has(callerId)) {
      items.push({ id: callerId, name: "Unknown", counts: {}, canDelete: false, blockReason: "Not found" });
      continue;
    }
    const c = callers.find((x) => x.id === callerId)!;
    items.push({
      id: c.id,
      name: c.name || c.email || c.phone || c.id.slice(0, 8),
      counts: {
        calls: c._count.calls,
        memories: c._count.memories,
        observations: c._count.personalityObservations,
        goals: c._count.goals,
        artifacts: c._count.artifacts,
        prompts: c._count.composedPrompts,
        enrollments: c._count.enrollments,
        targets: c._count.callerTargets,
        attributes: c._count.callerAttributes,
        actions: c._count.actions,
        messages: c._count.inboundMessages,
        onboarding: c._count.onboardingSessions,
        cohorts: c._count.cohortMemberships,
      },
      canDelete: true,
    });
  }

  const totals = sumCounts(items);
  const deletableCount = items.filter((i) => i.canDelete).length;

  return {
    entityType: "caller",
    entityIds: callerIds,
    items,
    totals,
    recommendBackground: deletableCount > SYNC_CALLER_LIMIT || totalAffected(totals) > TOTAL_RECORDS_THRESHOLD,
    blocked: items.filter((i) => !i.canDelete).map((i) => ({ id: i.id, name: i.name, reason: i.blockReason! })),
  };
}

// ── Preview: Playbooks ──

export async function previewPlaybookDelete(playbookIds: string[]): Promise<BulkDeletePreview> {
  const items: BulkDeletePreviewItem[] = [];

  const playbooks = await prisma.playbook.findMany({
    where: { id: { in: playbookIds } },
    select: {
      id: true, name: true, status: true,
      _count: {
        select: {
          items: true,
          enrollments: true,
          cohortAssignments: true,
          subjects: true,
          goals: true,
          calls: true,
          composedPrompts: true,
          behaviorTargets: true,
          invites: true,
        },
      },
    },
  });

  const foundIds = new Set(playbooks.map((p) => p.id));

  for (const playbookId of playbookIds) {
    if (!foundIds.has(playbookId)) {
      items.push({ id: playbookId, name: "Unknown", counts: {}, canDelete: false, blockReason: "Not found" });
      continue;
    }
    const p = playbooks.find((x) => x.id === playbookId)!;

    if (p.status === "PUBLISHED") {
      items.push({
        id: p.id, name: p.name,
        counts: { items: p._count.items, enrollments: p._count.enrollments },
        canDelete: false,
        blockReason: "Cannot delete a published course. Archive it first.",
      });
      continue;
    }

    // Count child versions that would be nullified
    const childVersions = await prisma.playbook.count({ where: { parentVersionId: playbookId } });

    items.push({
      id: p.id,
      name: p.name,
      counts: {
        items: p._count.items,
        enrollments: p._count.enrollments,
        cohortAssignments: p._count.cohortAssignments,
        subjects: p._count.subjects,
        goalsNullified: p._count.goals,
        callsNullified: p._count.calls,
        promptsNullified: p._count.composedPrompts,
        targetsNullified: p._count.behaviorTargets,
        invitesNullified: p._count.invites,
        childVersionsNullified: childVersions,
      },
      canDelete: true,
    });
  }

  const totals = sumCounts(items);
  const deletableCount = items.filter((i) => i.canDelete).length;

  return {
    entityType: "playbook",
    entityIds: playbookIds,
    items,
    totals,
    recommendBackground: deletableCount > SYNC_PLAYBOOK_LIMIT || totalAffected(totals) > TOTAL_RECORDS_THRESHOLD,
    blocked: items.filter((i) => !i.canDelete).map((i) => ({ id: i.id, name: i.name, reason: i.blockReason! })),
  };
}

// ── Preview: Domains (soft-delete / deactivate) ──

export async function previewDomainDeactivate(domainIds: string[]): Promise<BulkDeletePreview> {
  const items: BulkDeletePreviewItem[] = [];

  const domains = await prisma.domain.findMany({
    where: { id: { in: domainIds } },
    select: {
      id: true, name: true, isDefault: true, isActive: true,
      _count: {
        select: {
          callers: true,
          playbooks: true,
          cohortGroups: true,
          onboardingSessions: true,
          subjects: true,
          invites: true,
        },
      },
    },
  });

  const foundIds = new Set(domains.map((d) => d.id));

  for (const domainId of domainIds) {
    if (!foundIds.has(domainId)) {
      items.push({ id: domainId, name: "Unknown", counts: {}, canDelete: false, blockReason: "Not found" });
      continue;
    }
    const d = domains.find((x) => x.id === domainId)!;

    if (d.isDefault) {
      items.push({ id: d.id, name: d.name, counts: {}, canDelete: false, blockReason: "Cannot deactivate the default domain" });
      continue;
    }
    if (!d.isActive) {
      items.push({ id: d.id, name: d.name, counts: {}, canDelete: false, blockReason: "Already inactive" });
      continue;
    }

    items.push({
      id: d.id,
      name: d.name,
      counts: {
        callers: d._count.callers,
        playbooks: d._count.playbooks,
        cohorts: d._count.cohortGroups,
        onboarding: d._count.onboardingSessions,
        subjects: d._count.subjects,
        invites: d._count.invites,
      },
      canDelete: true,
    });
  }

  const totals = sumCounts(items);

  return {
    entityType: "domain",
    entityIds: domainIds,
    items,
    totals,
    recommendBackground: false, // Soft-delete is always fast
    blocked: items.filter((i) => !i.canDelete).map((i) => ({ id: i.id, name: i.name, reason: i.blockReason! })),
  };
}

// ── Preview: Subjects ──

export async function previewSubjectDelete(subjectIds: string[]): Promise<BulkDeletePreview> {
  const items: BulkDeletePreviewItem[] = [];

  const subjects = await prisma.subject.findMany({
    where: { id: { in: subjectIds } },
    select: {
      id: true, name: true,
      _count: {
        select: {
          sources: true,
          domains: true,
          playbooks: true,
          media: true,
          curricula: true,
        },
      },
    },
  });

  const foundIds = new Set(subjects.map((s) => s.id));

  // Find orphaned sources across all subjects being deleted
  const orphanedSourceIds = await findOrphanedSources(subjectIds);

  for (const subjectId of subjectIds) {
    if (!foundIds.has(subjectId)) {
      items.push({ id: subjectId, name: "Unknown", counts: {}, canDelete: false, blockReason: "Not found" });
      continue;
    }
    const s = subjects.find((x) => x.id === subjectId)!;

    items.push({
      id: s.id,
      name: s.name,
      counts: {
        sources: s._count.sources,
        domains: s._count.domains,
        playbooks: s._count.playbooks,
        media: s._count.media,
        curriculaNullified: s._count.curricula,
      },
      canDelete: true,
    });
  }

  const totals = sumCounts(items);
  totals.orphanedSources = orphanedSourceIds.length;

  const deletableCount = items.filter((i) => i.canDelete).length;

  return {
    entityType: "subject",
    entityIds: subjectIds,
    items,
    totals,
    recommendBackground: deletableCount > SYNC_SUBJECT_LIMIT || totalAffected(totals) > TOTAL_RECORDS_THRESHOLD,
    blocked: items.filter((i) => !i.canDelete).map((i) => ({ id: i.id, name: i.name, reason: i.blockReason! })),
  };
}

// ── Execute: Callers ──

export async function executeCallerBulkDelete(
  callerIds: string[],
  onProgress?: ProgressCallback
): Promise<BulkDeleteResult> {
  const succeeded: BulkDeleteResultItem[] = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];

  for (let i = 0; i < callerIds.length; i++) {
    const callerId = callerIds[i];
    try {
      // Fetch name before deletion
      const caller = await prisma.caller.findUnique({
        where: { id: callerId },
        select: { name: true, email: true, phone: true },
      });
      const name = caller?.name || caller?.email || caller?.phone || callerId.slice(0, 8);

      const counts = await deleteCallerData(callerId);
      succeeded.push({ id: callerId, name, counts: counts as unknown as Record<string, number> });

      if (onProgress) await onProgress(i + 1, callerIds.length, name);
    } catch (err: any) {
      failed.push({ id: callerId, name: callerId.slice(0, 8), error: err?.message || "Unknown error" });
      if (onProgress) await onProgress(i + 1, callerIds.length, `FAILED: ${callerId.slice(0, 8)}`);
    }
  }

  return {
    entityType: "caller",
    succeeded,
    failed,
    totalDeleted: succeeded.length,
    totalFailed: failed.length,
  };
}

// ── Execute: Playbooks ──

export async function executePlaybookBulkDelete(
  playbookIds: string[],
  onProgress?: ProgressCallback
): Promise<BulkDeleteResult> {
  const succeeded: BulkDeleteResultItem[] = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];

  for (let i = 0; i < playbookIds.length; i++) {
    const playbookId = playbookIds[i];
    try {
      const playbook = await prisma.playbook.findUnique({
        where: { id: playbookId },
        select: { name: true, status: true },
      });

      if (!playbook) {
        failed.push({ id: playbookId, name: playbookId.slice(0, 8), error: "Not found" });
        continue;
      }
      if (playbook.status === "PUBLISHED") {
        failed.push({ id: playbookId, name: playbook.name, error: "Cannot delete published course" });
        continue;
      }

      const counts = await deletePlaybookData(playbookId);
      succeeded.push({ id: playbookId, name: playbook.name, counts: counts as unknown as Record<string, number> });

      if (onProgress) await onProgress(i + 1, playbookIds.length, playbook.name);
    } catch (err: any) {
      failed.push({ id: playbookId, name: playbookId.slice(0, 8), error: err?.message || "Unknown error" });
      if (onProgress) await onProgress(i + 1, playbookIds.length, `FAILED: ${playbookId.slice(0, 8)}`);
    }
  }

  return {
    entityType: "playbook",
    succeeded,
    failed,
    totalDeleted: succeeded.length,
    totalFailed: failed.length,
  };
}

// ── Execute: Domains (soft-delete) ──

export async function executeDomainBulkDeactivate(
  domainIds: string[]
): Promise<BulkDeleteResult> {
  const succeeded: BulkDeleteResultItem[] = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];

  // Fetch all domains first
  const domains = await prisma.domain.findMany({
    where: { id: { in: domainIds } },
    select: { id: true, name: true, isDefault: true, isActive: true,
      _count: { select: { callers: true, playbooks: true } },
    },
  });

  const foundMap = new Map(domains.map((d) => [d.id, d]));

  for (const domainId of domainIds) {
    const d = foundMap.get(domainId);
    if (!d) {
      failed.push({ id: domainId, name: domainId.slice(0, 8), error: "Not found" });
      continue;
    }
    if (d.isDefault) {
      failed.push({ id: d.id, name: d.name, error: "Cannot deactivate default domain" });
      continue;
    }
    if (!d.isActive) {
      failed.push({ id: d.id, name: d.name, error: "Already inactive" });
      continue;
    }

    try {
      await prisma.domain.update({
        where: { id: domainId },
        data: { isActive: false },
      });
      succeeded.push({
        id: d.id,
        name: d.name,
        counts: { callers: d._count.callers, playbooks: d._count.playbooks },
      });
    } catch (err: any) {
      failed.push({ id: d.id, name: d.name, error: err?.message || "Unknown error" });
    }
  }

  return {
    entityType: "domain",
    succeeded,
    failed,
    totalDeleted: succeeded.length,
    totalFailed: failed.length,
  };
}

// ── Execute: Subjects ──

export async function executeSubjectBulkDelete(
  subjectIds: string[],
  onProgress?: ProgressCallback
): Promise<BulkDeleteResult> {
  const succeeded: BulkDeleteResultItem[] = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];

  for (let i = 0; i < subjectIds.length; i++) {
    const subjectId = subjectIds[i];
    try {
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId },
        select: { name: true },
      });

      if (!subject) {
        failed.push({ id: subjectId, name: subjectId.slice(0, 8), error: "Not found" });
        continue;
      }

      const counts = await deleteSubjectData(subjectId);
      succeeded.push({ id: subjectId, name: subject.name, counts: counts as unknown as Record<string, number> });

      if (onProgress) await onProgress(i + 1, subjectIds.length, subject.name);
    } catch (err: any) {
      failed.push({ id: subjectId, name: subjectId.slice(0, 8), error: err?.message || "Unknown error" });
      if (onProgress) await onProgress(i + 1, subjectIds.length, `FAILED: ${subjectId.slice(0, 8)}`);
    }
  }

  return {
    entityType: "subject",
    succeeded,
    failed,
    totalDeleted: succeeded.length,
    totalFailed: failed.length,
  };
}

// ── Dispatch helpers ──

export function getPreviewFn(entityType: EntityType) {
  switch (entityType) {
    case "caller": return previewCallerDelete;
    case "playbook": return previewPlaybookDelete;
    case "domain": return previewDomainDeactivate;
    case "subject": return previewSubjectDelete;
  }
}

export function getExecuteFn(entityType: EntityType) {
  switch (entityType) {
    case "caller": return executeCallerBulkDelete;
    case "playbook": return executePlaybookBulkDelete;
    case "domain": return (ids: string[]) => executeDomainBulkDeactivate(ids);
    case "subject": return executeSubjectBulkDelete;
  }
}

export function getSyncLimit(entityType: EntityType): number {
  switch (entityType) {
    case "caller": return SYNC_CALLER_LIMIT;
    case "playbook": return SYNC_PLAYBOOK_LIMIT;
    case "domain": return SYNC_DOMAIN_LIMIT;
    case "subject": return SYNC_SUBJECT_LIMIT;
  }
}

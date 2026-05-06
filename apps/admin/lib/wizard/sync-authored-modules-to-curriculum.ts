/**
 * sync-authored-modules-to-curriculum.ts
 *
 * Closes the #245 gap: authored modules (PlaybookConfig.modules[]) had no
 * corresponding CurriculumModule rows, so the pipeline's `updateModuleMastery`
 * (lib/curriculum/track-progress.ts) silently dropped writes for them. The
 * #242 picker rendered correctly but never showed in-progress / completed
 * state in production.
 *
 * This helper upserts a CurriculumModule per authored module, keyed by
 * (curriculumId, slug) where slug = AuthoredModule.id. It runs alongside
 * `applyAuthoredModules` from the import-modules POST route.
 *
 * Idempotency / preservation contract:
 *   - Re-importing the same markdown is a no-op (upsert; no duplicates).
 *   - Renaming an authored module's label updates `title`, does NOT clobber
 *     mastery / completedAt / callCount on existing CallerModuleProgress rows.
 *   - Removing an authored module from the markdown leaves the
 *     CurriculumModule row in place — orphaned history is preserved, not
 *     destructively wiped.
 *   - Position / prerequisites updates are forwarded.
 *   - When the playbook has no curricula yet, a default one is created so
 *     authored-only courses still get a teaching-unit container.
 *
 * Issue #245.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthoredModule } from "@/lib/types/json-fields";

type Tx = PrismaClient | Prisma.TransactionClient;

export interface SyncResult {
  curriculumId: string;
  created: number;
  updated: number;
  /** Modules in DB but no longer in the import — preserved, never deleted. */
  orphaned: number;
}

export async function syncAuthoredModulesToCurriculum(
  tx: Tx,
  playbookId: string,
  modules: AuthoredModule[],
): Promise<SyncResult> {
  // Pick or create the primary curriculum for this course. "Primary" =
  // earliest by createdAt; explicit primary-curriculum support is a
  // separate ticket per #245's out-of-scope list.
  const playbook = await tx.playbook.findUnique({
    where: { id: playbookId },
    select: {
      id: true,
      name: true,
      curricula: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!playbook) {
    throw new Error(`Playbook ${playbookId} not found`);
  }

  let curriculumId = playbook.curricula[0]?.id ?? null;
  if (!curriculumId) {
    const created = await tx.curriculum.create({
      data: {
        name: `${playbook.name} — Modules`,
        slug: `playbook-${playbookId.slice(0, 8)}-modules`,
        playbookId,
      },
      select: { id: true },
    });
    curriculumId = created.id;
  }

  // Track existing module slugs so we can count orphans (modules in DB but
  // not in the new import). Never delete — preserves CallerModuleProgress
  // history.
  const existing = await tx.curriculumModule.findMany({
    where: { curriculumId },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((m) => m.slug));
  const incomingSlugs = new Set(modules.map((m) => m.id));
  const orphaned = [...existingSlugs].filter((s) => !incomingSlugs.has(s)).length;

  let created = 0;
  let updated = 0;

  for (const m of modules) {
    const result = await tx.curriculumModule.upsert({
      where: {
        curriculumId_slug: { curriculumId, slug: m.id },
      },
      create: {
        curriculumId,
        slug: m.id,
        title: m.label,
        sortOrder: m.position ?? 0,
        prerequisites: m.prerequisites,
      },
      update: {
        // Only forward fields the author authoritatively set in the markdown.
        // Do NOT update masteryThreshold, estimatedDurationMinutes, keyTerms —
        // those may have been set elsewhere and aren't part of the authored
        // shape today.
        title: m.label,
        sortOrder: m.position ?? 0,
        prerequisites: m.prerequisites,
      },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    // Heuristic: createdAt === updatedAt → freshly created; else updated.
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
    else updated++;
  }

  return { curriculumId, created, updated, orphaned };
}

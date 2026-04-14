/**
 * sync-modules.ts
 *
 * Shared utility for dual-writing curriculum modules to both JSON (notableInfo)
 * and first-class CurriculumModule + LearningObjective records.
 *
 * Used by:
 * - POST /api/subjects/:subjectId/curriculum (save mode)
 * - POST /api/courses/generate-plan
 * - PATCH /api/subjects/:subjectId/curriculum
 */

import { prisma } from "@/lib/prisma";
import type { LegacyCurriculumModuleJSON } from "@/lib/types/json-fields";
import { parseLoLine } from "@/lib/content-trust/validate-lo-linkage";
import { reconcileAssertionLOs, type ReconcileResult } from "@/lib/content-trust/reconcile-lo-linkage";
import { sanitizeModuleTitle } from "@/lib/content-trust/sanitize-module";

export type SyncModulesMode = "merge" | "replace";

export interface SyncModulesOptions {
  /**
   * `merge` (default): upsert incoming modules, leave untouched any existing
   *   modules not present in this run. Protects against AI non-determinism
   *   clobbering previously-valid modules.
   * `replace`: deactivate modules whose slugs are not in the incoming set.
   *   Use only for explicit user-triggered regeneration.
   */
  mode?: SyncModulesMode;
}

// ---------------------------------------------------------------------------
// syncModulesToDB — upserts CurriculumModule + LO records from JSON modules
// ---------------------------------------------------------------------------

/**
 * Upsert CurriculumModule and LearningObjective records from legacy JSON modules.
 * Runs in a transaction. Idempotent — safe to call on every save.
 *
 * @param curriculumId - The curriculum these modules belong to
 * @param modules - Legacy JSON module array (from AI generation or user edits)
 * @returns Count of modules synced
 */
export async function syncModulesToDB(
  curriculumId: string,
  modules: LegacyCurriculumModuleJSON[],
  options?: SyncModulesOptions,
): Promise<{ count: number; reconcile: ReconcileResult | null; warnings: string[] }> {
  if (!modules || modules.length === 0) return { count: 0, reconcile: null, warnings: [] };

  const mode: SyncModulesMode = options?.mode ?? "merge";
  const warnings: string[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const synced: string[] = [];

    // Curriculum-wide LO ref dedup. The curriculum-extraction prompt promises
    // global uniqueness across modules, but the AI ignores it and restarts
    // numbering per module. Without this guard, duplicate refs land in
    // LearningObjective and crash any UI that uses ref as a React key
    // (e.g. GenomeBrowser). Rename collisions with a letter suffix so no
    // content is silently dropped. Per .claude/rules/ai-to-db-guard.md.
    const globalSeenRefs = new Set<string>();
    function uniquifyRef(ref: string): string {
      if (!globalSeenRefs.has(ref)) {
        globalSeenRefs.add(ref);
        return ref;
      }
      for (const suffix of "bcdefghijklmnopqrstuvwxyz") {
        const candidate = `${ref}${suffix}`;
        if (!globalSeenRefs.has(candidate)) {
          globalSeenRefs.add(candidate);
          return candidate;
        }
      }
      // 26 collisions on the same ref is absurd — fall back to a counter.
      let n = 2;
      while (globalSeenRefs.has(`${ref}-${n}`)) n += 1;
      const fallback = `${ref}-${n}`;
      globalSeenRefs.add(fallback);
      return fallback;
    }

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const slug = mod.id || `MOD-${i + 1}`;
      const cleanTitle = sanitizeModuleTitle(mod.title, slug);

      // Surface modules with no learning outcomes so the caller can warn the
      // educator rather than silently shipping empty teaching units. Consolidation
      // / review modules are sometimes legitimate, so this is advisory not fatal.
      const loCount = Array.isArray(mod.learningOutcomes) ? mod.learningOutcomes.length : 0;
      if (loCount === 0) {
        warnings.push(`Module "${cleanTitle}" (${slug}) has no learning outcomes`);
      }

      const upserted = await tx.curriculumModule.upsert({
        where: { curriculumId_slug: { curriculumId, slug } },
        create: {
          curriculumId,
          slug,
          title: cleanTitle,
          description: mod.description || null,
          sortOrder: mod.sortOrder ?? i,
          estimatedDurationMinutes: mod.estimatedDurationMinutes || null,
          keyTerms: mod.keyTerms || [],
          assessmentCriteria: mod.assessmentCriteria || [],
        },
        update: {
          title: cleanTitle,
          description: mod.description || null,
          sortOrder: mod.sortOrder ?? i,
          estimatedDurationMinutes: mod.estimatedDurationMinutes || null,
          keyTerms: mod.keyTerms || [],
          assessmentCriteria: mod.assessmentCriteria || [],
          isActive: true, // reactivate in case a prior 'replace' run archived it
        },
      });

      // Sync learning objectives if provided.
      //
      // GUARD (epic #131 A1): reject malformed lines rather than fabricating
      // synthetic `LO-${index+1}` refs with garbage descriptions. parseLoLine
      // returns null when the AI failed to produce a `LOn: description` pair,
      // and we skip + log so the caller can surface a data-quality warning.
      // This is the structural fix per .claude/rules/ai-to-db-guard.md.
      if (mod.learningOutcomes && mod.learningOutcomes.length > 0) {
        const parsed: { ref: string; description: string; sortOrder: number }[] = [];
        const skipped: { raw: string; reason: string }[] = [];
        const seenRefs = new Set<string>();

        for (let j = 0; j < mod.learningOutcomes.length; j++) {
          const raw = mod.learningOutcomes[j];
          const line = parseLoLine(raw);
          if (!line) {
            skipped.push({ raw, reason: "not a valid `LOn: description` pair" });
            continue;
          }
          if (seenRefs.has(line.ref)) {
            skipped.push({ raw, reason: `duplicate ref within module: ${line.ref}` });
            continue;
          }
          seenRefs.add(line.ref);
          const uniqueRef = uniquifyRef(line.ref);
          if (uniqueRef !== line.ref) {
            warnings.push(`Module "${cleanTitle}" (${slug}): renamed duplicate LO ref ${line.ref} → ${uniqueRef}`);
          }
          parsed.push({ ref: uniqueRef, description: line.description, sortOrder: j });
        }

        if (skipped.length > 0) {
          console.warn(
            `[sync-modules] Module ${upserted.slug}: skipped ${skipped.length}/${mod.learningOutcomes.length} LOs — ` +
              skipped.map((s) => `"${s.raw}" (${s.reason})`).join("; "),
          );
        }

        await tx.learningObjective.deleteMany({ where: { moduleId: upserted.id } });

        for (const lo of parsed) {
          await tx.learningObjective.create({
            data: {
              moduleId: upserted.id,
              ref: lo.ref,
              description: lo.description,
              sortOrder: lo.sortOrder,
            },
          });
        }
      }

      synced.push(upserted.id);
    }

    // Destructive replace: deactivate modules whose slugs are NOT in this run.
    // Default mode is 'merge' — we never deactivate silently, because AI
    // non-determinism can produce a shorter module list on re-run and clobber
    // previously valid modules (see #143 follow-up).
    if (mode === "replace") {
      const currentSlugs = modules.map((m, i) => m.id || `MOD-${i + 1}`);
      const deactivated = await tx.curriculumModule.updateMany({
        where: {
          curriculumId,
          slug: { notIn: currentSlugs },
          isActive: true,
        },
        data: { isActive: false },
      });
      if (deactivated.count > 0) {
        warnings.push(`Deactivated ${deactivated.count} module(s) not present in this run (replace mode)`);
      }
    }

    return synced;
  });

  // Epic #131 A4 — after LOs are written, reconcile existing assertions'
  // learningObjectiveId FK by matching learningOutcomeRef strings against the
  // newly-persisted LO rows. This closes the temporal dependency: assertions
  // extracted before the curriculum existed (and tagged with string refs by
  // the curriculum-aware extractor A2) now get their FK populated without a
  // manual backfill. Idempotent — already-linked assertions are skipped.
  let reconcile: ReconcileResult | null = null;
  try {
    reconcile = await reconcileAssertionLOs(curriculumId);
  } catch (err) {
    console.error(`[sync-modules] reconcileAssertionLOs failed for curriculum ${curriculumId}:`, err);
    // Non-fatal — curriculum save itself succeeded.
  }

  if (warnings.length > 0) {
    console.warn(`[sync-modules] curriculum ${curriculumId} warnings:\n  - ${warnings.join("\n  - ")}`);
  }

  return { count: result.length, reconcile, warnings };
}

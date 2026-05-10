/**
 * Reclassify Learning Objectives — the orchestrator (#317)
 *
 * Loads all LOs for a curriculum, runs them through the classifier
 * (heuristic → LLM), validates each proposal through the AI-to-DB guard,
 * and writes LO updates + LoClassification history rows in batched
 * transactions.
 *
 * Used by:
 *   - syncModulesToDB success path (NEW courses, AI extraction route)
 *   - syncAuthoredModulesToCurriculum success path (NEW courses, authored markdown)
 *   - POST /api/curricula/:id/reclassify-los (manual re-runs from the
 *     Curriculum tab's RegenerateBar button)
 *   - npm run ctl reclassify-los <curriculumId> (one-off batch from CLI)
 *
 * Idempotent — re-running on the same curriculum:
 *   - Skips humanOverriddenAt rows (the guard handles this).
 *   - Writes a NEW history row per run (classifierVersion changes when
 *     the heuristic / model / prompt changes, so re-runs aren't deduped).
 *   - Backfills originalText on rows where it's still null (NULL is
 *     treated as "captured during this run") — see capture step below.
 *
 * The function NEVER throws on a single-LO classifier failure. Each LO
 * gets a result and the failures are surfaced in the return value so
 * the caller can decide whether to alert.
 */

import { prisma } from "@/lib/prisma";
import { classifyLoBatch, type ClassifyLoResult } from "@/lib/content-trust/classify-lo";
import {
  validateLoClassification,
  type LoClassificationDecision,
} from "@/lib/content-trust/validate-lo-classification";

// ── Types ──────────────────────────────────────────────

export interface ReclassifyLosOptions {
  /**
   * Limit concurrency of the LLM batch. Defaults to 3 — a 104-LO bulk run
   * on IELTS Speaking dropped from 17/104 LOs queued at confidence=0 down
   * to 2/104 when concurrency moved from 6 → 3, suggesting the LLM
   * provider returns truncated/malformed responses under provider-side
   * pressure. Stick to ≤3 unless you know the rate limits headroom.
   */
  concurrency?: number;
  /**
   * When true, also re-classify rows where humanOverriddenAt IS NOT NULL.
   * The guard still won't let the proposal overwrite the LO row — but
   * the history row will record what the classifier WOULD have done,
   * useful when an admin wants to see whether a human override is
   * still aligned with current classifier behaviour.
   *
   * Default false: human overrides are sticky and we save the AI cost.
   */
  includeHumanOverridden?: boolean;
  /**
   * Optional cap on how many LOs to process. Useful for smoke-testing
   * a subset before bulk runs. Default: no cap.
   */
  maxLOs?: number;
}

export interface ReclassifyLosResult {
  curriculumId: string;
  total: number;
  applied: number;
  queued: number;
  skipped: number; // human-overridden + (when !includeHumanOverridden) skipped at load
  failed: number;
  byOutcome: {
    apply: { ref: string; systemRole: string; confidence: number }[];
    queue: { ref: string; reason: string; confidence: number }[];
    skipOverridden: { ref: string }[];
  };
}

// ── Orchestrator ───────────────────────────────────────

export async function reclassifyLearningObjectives(
  curriculumId: string,
  options: ReclassifyLosOptions = {},
): Promise<ReclassifyLosResult> {
  const { concurrency = 3, includeHumanOverridden = false, maxLOs } = options;

  // 1. Load LOs scoped to the curriculum, with module + course context for the LLM.
  const curriculum = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: {
      id: true,
      name: true,
      modules: {
        select: {
          id: true,
          title: true,
          description: true,
          learningObjectives: {
            select: {
              id: true,
              ref: true,
              description: true,
              originalText: true,
              humanOverriddenAt: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  if (!curriculum) {
    throw new Error(`Curriculum not found: ${curriculumId}`);
  }

  // 2. Build the classifier inputs. Skip humanOverridden when not forced.
  const inputs = curriculum.modules.flatMap((m) =>
    m.learningObjectives
      .filter((lo) => includeHumanOverridden || lo.humanOverriddenAt === null)
      .map((lo) => ({
        loId: lo.id,
        ref: lo.ref,
        // Prefer originalText (immutable verbatim) for classification.
        // Fall back to current description on rows that pre-date #317.
        description: lo.originalText ?? lo.description,
        moduleTitle: m.title,
        moduleDescription: m.description,
        courseTitle: curriculum.name,
      })),
  );

  const cappedInputs = typeof maxLOs === "number" ? inputs.slice(0, maxLOs) : inputs;

  // 3. Pre-build the targets map so the guard sees the freshest row state
  //    (humanOverriddenAt was checked at load, but the row could have been
  //    overridden between then and the write — re-fetch isn't needed in
  //    practice because admins serialise these actions, but we keep the
  //    state from load and trust it).
  const targetById = new Map<string, { id: string; ref: string; description: string; humanOverriddenAt: Date | null }>();
  for (const m of curriculum.modules) {
    for (const lo of m.learningObjectives) {
      targetById.set(lo.id, {
        id: lo.id,
        ref: lo.ref,
        description: lo.description,
        humanOverriddenAt: lo.humanOverriddenAt,
      });
    }
  }

  // 4. Classify the batch (heuristic + LLM, parallelised).
  const classifierResults = await classifyLoBatch(cappedInputs, { concurrency });

  // 5. Validate each result through the guard, collecting decisions.
  const decisions: { input: typeof cappedInputs[number]; classifier: ClassifyLoResult; decision: LoClassificationDecision }[] = [];
  for (let i = 0; i < cappedInputs.length; i++) {
    const input = cappedInputs[i];
    const classifier = classifierResults[i];
    const target = targetById.get(input.loId);
    if (!target) continue; // Should never happen — guard against race.
    const decision = validateLoClassification(classifier.proposal, target);
    decisions.push({ input, classifier, decision });
  }

  // 6. Write in chunked transactions to avoid one giant tx for large curricula.
  const CHUNK_SIZE = 25;
  let appliedCount = 0;
  let queuedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const byOutcome: ReclassifyLosResult["byOutcome"] = {
    apply: [],
    queue: [],
    skipOverridden: [],
  };

  for (let chunkStart = 0; chunkStart < decisions.length; chunkStart += CHUNK_SIZE) {
    const chunk = decisions.slice(chunkStart, chunkStart + CHUNK_SIZE);
    try {
      await prisma.$transaction(async (tx) => {
        for (const { input, classifier, decision } of chunk) {
          // Always write a history row.
          await tx.loClassification.create({
            data: {
              loId: decision.classificationRow.loId,
              classifierVersion: decision.classificationRow.classifierVersion,
              proposedLearnerVisible: decision.classificationRow.proposedLearnerVisible,
              proposedPerformanceStatement: decision.classificationRow.proposedPerformanceStatement,
              proposedSystemRole: decision.classificationRow.proposedSystemRole,
              confidence: decision.classificationRow.confidence,
              rationale: decision.classificationRow.rationale,
              applied: decision.classificationRow.applied,
              appliedAt: decision.classificationRow.applied ? new Date() : null,
            },
          });

          if (decision.outcome === "apply") {
            // Apply LO row update. originalText backfill (if null) happens
            // in a single bulk UPDATE at the end of the chunk so we don't
            // need a per-row conditional read.
            await tx.learningObjective.update({
              where: { id: input.loId },
              data: {
                learnerVisible: decision.loRowUpdates!.learnerVisible,
                performanceStatement: decision.loRowUpdates!.performanceStatement,
                systemRole: decision.loRowUpdates!.systemRole,
              },
            });
            appliedCount++;
            byOutcome.apply.push({
              ref: input.ref,
              systemRole: decision.loRowUpdates!.systemRole,
              confidence: decision.classificationRow.confidence,
            });
          } else if (decision.outcome === "queue") {
            queuedCount++;
            byOutcome.queue.push({
              ref: input.ref,
              reason: decision.fixes.find((f) => f.action === "queued-low-confidence")?.reason ?? "",
              confidence: decision.classificationRow.confidence,
            });
          } else {
            skippedCount++;
            byOutcome.skipOverridden.push({ ref: input.ref });
          }
        }

        // Backfill originalText for any LO in this chunk where it's null.
        // Idempotent — only touches rows that have never had originalText.
        const refsInChunk = chunk.map((c) => c.input.loId);
        await tx.$executeRaw`UPDATE "LearningObjective" SET "originalText" = "description" WHERE "id" = ANY(${refsInChunk}::text[]) AND "originalText" IS NULL`;
      });
    } catch (err: any) {
      console.error(`[reclassify-los] chunk ${chunkStart}-${chunkStart + chunk.length} failed:`, err?.message);
      failedCount += chunk.length;
    }
  }

  return {
    curriculumId,
    total: decisions.length,
    applied: appliedCount,
    queued: queuedCount,
    skipped: skippedCount,
    failed: failedCount,
    byOutcome,
  };
}

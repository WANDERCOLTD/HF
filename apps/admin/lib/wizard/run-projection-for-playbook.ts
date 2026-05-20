/**
 * run-projection-for-playbook.ts
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §4 Phase 2.5
 *
 * Orchestrator that finds the COURSE_REFERENCE source(s) attached to a
 * playbook, loads each source's full text via the storage adapter, runs
 * the pure projection, and applies it. Race-safe: skips a source whose
 * media asset hasn't finished uploading yet, and logs the skip.
 *
 * Called by the wizard's `create_course` tool handler after
 * `PlaybookSource` rows are written. Can also be called by a manual
 * "re-process" admin button on a source page (Phase 6 / follow-up).
 *
 * Issue #338 Phase 5.
 */

import { prisma } from "@/lib/prisma";
import { getStorageAdapter } from "@/lib/storage";
import { extractTextFromBuffer } from "@/lib/content-trust/extract-assertions";
import {
  applyProjection,
  writeBandThresholds,
  type ApplyProjectionResult,
  type RubricBandMap,
} from "./apply-projection";
import { projectCourseReference } from "./project-course-reference";
import { parseRubricBands } from "./parse-rubric-bands";

export interface RunProjectionResult {
  playbookId: string;
  /** Sources that contributed a non-empty projection. */
  appliedSources: Array<{ sourceContentId: string; sourceName: string; result: ApplyProjectionResult }>;
  /** Sources skipped because their media asset isn't ready or text was empty. */
  skippedSources: Array<{ sourceContentId: string; sourceName: string; reason: string }>;
  /** True when no COURSE_REFERENCE source is linked at all — course is degenerate. */
  degenerate: boolean;
  /**
   * #564 — Rubric-only second pass results. Tracks which
   * COURSE_REFERENCE_ASSESSOR_RUBRIC sources contributed band thresholds and
   * how many Parameter.config.bandThresholds writes landed.
   */
  rubricBandsApplied: Array<{
    sourceContentId: string;
    sourceName: string;
    parametersUpdated: number;
    unmatchedCodes: string[];
  }>;
}

/**
 * Find COURSE_REFERENCE sources linked to a playbook, load each one's
 * text, and run project + apply. Always returns a result object — never
 * throws on load failures (degraded behaviour is logged, not raised).
 *
 * Throws only on truly unexpected DB errors.
 */
export async function runProjectionForPlaybook(playbookId: string): Promise<RunProjectionResult> {
  // #447 — exclude COURSE_REFERENCE_ASSESSOR_RUBRIC: rubric docs are
  // scoring calibration material, consumed by the MEASURE spec via
  // ContentAssertion (category=assessment_approach + skill_framework).
  // Feeding them to projection turned band-descriptor lines into rogue
  // LEARN/ACHIEVE goal templates.
  const links = await prisma.playbookSource.findMany({
    where: {
      playbookId,
      source: {
        documentType: {
          in: ["COURSE_REFERENCE", "COURSE_REFERENCE_CANONICAL", "COURSE_REFERENCE_TUTOR_BRIEFING"],
        },
      },
    },
    select: {
      source: {
        select: {
          id: true,
          name: true,
          mediaAssets: {
            select: { storageKey: true, fileName: true },
            take: 1,
          },
        },
      },
    },
  });

  if (links.length === 0) {
    console.warn(
      `[projection] no COURSE_REFERENCE source linked to playbook=${playbookId} — course is degenerate (no Goals/BehaviorTargets/CurriculumModule derived). See docs/CONTENT-PIPELINE.md §4 Phase 2.5.`,
    );
    return { playbookId, appliedSources: [], skippedSources: [], degenerate: true, rubricBandsApplied: [] };
  }

  const appliedSources: RunProjectionResult["appliedSources"] = [];
  const skippedSources: RunProjectionResult["skippedSources"] = [];
  const storage = getStorageAdapter();

  for (const link of links) {
    const source = link.source;
    const media = source.mediaAssets[0];
    if (!media) {
      console.warn(
        `[projection] skipping source=${source.id} (${source.name}) — no MediaAsset (race with extraction or URL-type source)`,
      );
      skippedSources.push({
        sourceContentId: source.id,
        sourceName: source.name,
        reason: "no-media-asset",
      });
      continue;
    }

    let text = "";
    try {
      const buffer = await storage.download(media.storageKey);
      const extracted = await extractTextFromBuffer(buffer, media.fileName);
      text = extracted.text ?? "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[projection] skipping source=${source.id} (${source.name}) — failed to load text: ${msg}`,
      );
      skippedSources.push({
        sourceContentId: source.id,
        sourceName: source.name,
        reason: `load-failed: ${msg}`,
      });
      continue;
    }

    if (!text.trim()) {
      console.warn(
        `[projection] skipping source=${source.id} (${source.name}) — empty text after extraction`,
      );
      skippedSources.push({
        sourceContentId: source.id,
        sourceName: source.name,
        reason: "empty-text",
      });
      continue;
    }

    const projection = projectCourseReference(text, { sourceContentId: source.id });
    const result = await applyProjection(projection, {
      playbookId,
      sourceContentId: source.id,
    });

    console.log(
      `[projection] applied source=${source.id} (${source.name}) to playbook=${playbookId}: ` +
        `params=+${result.parametersUpserted} ` +
        `bt=+${result.behaviorTargetsCreated}/~${result.behaviorTargetsUpdated}/-${result.behaviorTargetsRemoved} ` +
        `cm=+${result.curriculumModulesCreated}/~${result.curriculumModulesUpdated}/-${result.curriculumModulesRemoved} ` +
        `lo=+${result.learningObjectivesCreated}/~${result.learningObjectivesUpdated}/-${result.learningObjectivesRemoved} ` +
        `goals=${result.goalTemplatesWritten} ` +
        `noop=${result.noop}`,
    );

    appliedSources.push({
      sourceContentId: source.id,
      sourceName: source.name,
      result,
    });
  }

  // ── #564 — Rubric-only second pass ───────────────────────────────────────
  //
  // Load COURSE_REFERENCE_ASSESSOR_RUBRIC sources and feed their band
  // descriptor tables into Parameter.config.bandThresholds via the writer
  // helper. Goal templates / curriculum / behavior targets are NOT touched
  // by this pass — those exclusions from the main loop above remain
  // intentional (see #447 fix-chain).
  const rubricBandsApplied: RunProjectionResult["rubricBandsApplied"] = [];
  const rubricLinks = await prisma.playbookSource.findMany({
    where: {
      playbookId,
      source: { documentType: "COURSE_REFERENCE_ASSESSOR_RUBRIC" },
    },
    select: {
      source: {
        select: {
          id: true,
          name: true,
          mediaAssets: { select: { storageKey: true, fileName: true }, take: 1 },
        },
      },
    },
  });

  for (const link of rubricLinks) {
    const source = link.source;
    const media = source.mediaAssets[0];
    if (!media) {
      console.warn(
        `[projection] rubric pass: skipping source=${source.id} (${source.name}) — no MediaAsset`,
      );
      skippedSources.push({
        sourceContentId: source.id,
        sourceName: source.name,
        reason: "rubric-no-media-asset",
      });
      continue;
    }
    let text = "";
    try {
      const buffer = await storage.download(media.storageKey);
      const extracted = await extractTextFromBuffer(buffer, media.fileName);
      text = extracted.text ?? "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[projection] rubric pass: failed to load text for source=${source.id}: ${msg}`,
      );
      skippedSources.push({
        sourceContentId: source.id,
        sourceName: source.name,
        reason: `rubric-load-failed: ${msg}`,
      });
      continue;
    }
    if (!text.trim()) continue;

    const parsed = parseRubricBands(text);
    if (parsed.warnings.length > 0) {
      for (const w of parsed.warnings) {
        console.warn(`[projection] rubric pass (${source.id}): ${w}`);
      }
    }
    if (parsed.criteria.length === 0) {
      console.log(
        `[projection] rubric pass: no RUB-* sections found in source=${source.id} (${source.name})`,
      );
      continue;
    }

    const bandMap: RubricBandMap = new Map(
      parsed.criteria.map((c) => [c.code, c.bands]),
    );
    const writeResult = await writeBandThresholds(
      { playbookId, sourceContentId: source.id },
      bandMap,
    );

    console.log(
      `[projection] rubric pass: source=${source.id} (${source.name}) ` +
        `wrote bandThresholds to ${writeResult.parametersUpdated}/${bandMap.size} parameter(s) ` +
        (writeResult.unmatchedCodes.length > 0
          ? `(unmatched: ${writeResult.unmatchedCodes.join(", ")})`
          : ""),
    );

    rubricBandsApplied.push({
      sourceContentId: source.id,
      sourceName: source.name,
      parametersUpdated: writeResult.parametersUpdated,
      unmatchedCodes: writeResult.unmatchedCodes,
    });
  }

  return {
    playbookId,
    appliedSources,
    skippedSources,
    degenerate: false,
    rubricBandsApplied,
  };
}

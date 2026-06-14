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
import { projectCourseReference, type ParsedSkill } from "./project-course-reference";
import { parseRubricBands } from "./parse-rubric-bands";
import { deriveSkillTierMappingFromSkills } from "@/lib/banding/derive-skill-tier-mapping-from-source";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { resolveMasteryPolicyKnob } from "@/lib/cascade/resolvers/mastery-policy";

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
  /**
   * Launch-blocking issues found at projection time. The wizard's publish
   * gate MUST refuse to mark a Playbook PUBLISHED while any blocker is
   * present. Today the only blocker is `PROJECTION_NO_SKILLS_FRAMEWORK`
   * (no parseable skill in any linked COURSE_REFERENCE source).
   *
   * The set MAY grow over time — keep the consumer treating any entry as
   * a hard refusal, not just this specific code.
   */
  launchBlockers: Array<{
    code: string;
    sourceContentId?: string;
    sourceName?: string;
    message: string;
  }>;
  /**
   * #1630 — Source-derived `Playbook.config.skillTierMapping` outcome.
   * Populated AFTER both projection passes run, on the union of parsed
   * skills. `derivedScheme: null` means no write fired (no skills, skills
   * disagreed, or scheme unrecognised). `reason` carries the operator-
   * facing rationale when a derived candidate was suppressed by the
   * cascade gate (Domain or Playbook layer already pinned the mapping).
   */
  skillTierMappingDerived: {
    derivedScheme: "cto" | "cefr" | null;
    written: boolean;
    reason?: string;
  };
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
    return {
      playbookId,
      appliedSources: [],
      skippedSources: [],
      degenerate: true,
      rubricBandsApplied: [],
      launchBlockers: [
        {
          code: "NO_COURSE_REFERENCE_SOURCE",
          message:
            "No COURSE_REFERENCE source linked. Upload at least one course-ref doc before launching.",
        },
      ],
      skillTierMappingDerived: { derivedScheme: null, written: false },
    };
  }

  const appliedSources: RunProjectionResult["appliedSources"] = [];
  const skippedSources: RunProjectionResult["skippedSources"] = [];
  const launchBlockers: RunProjectionResult["launchBlockers"] = [];
  const allParsedSkills: ParsedSkill[] = [];
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

    // (3) Promote PROJECTION_NO_SKILLS_FRAMEWORK from a soft warning to a
    // launch blocker. Without skills no `skill_*` Parameters or BehaviorTargets
    // are minted, no MEASURE spec is created, no CallerTarget rows can be
    // populated. The educator dashboard sits flat-zero on every learner
    // forever. The publish gate consumes `launchBlockers` and refuses to mark
    // the Playbook PUBLISHED until at least one source resolves the blocker.
    const noSkillsWarning = projection.validationWarnings.find(
      (w) => w.code === "PROJECTION_NO_SKILLS_FRAMEWORK",
    );
    if (noSkillsWarning) {
      launchBlockers.push({
        code: "PROJECTION_NO_SKILLS_FRAMEWORK",
        sourceContentId: source.id,
        sourceName: source.name,
        message: noSkillsWarning.message,
      });
    }

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
    allParsedSkills.push(...projection.skills);
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
    // #UI-followup Gap 2 — also pass the criterion name per code so the
    // matcher can fall back to name-derived parameter lookup for fresh
    // courses whose projection produced unsuffixed parameter IDs.
    const criterionByCode = Object.fromEntries(
      parsed.criteria.map((c) => [c.code, c.criterionName.replace(/\s*—.*$/, "").trim()]),
    );
    const writeResult = await writeBandThresholds(
      { playbookId, sourceContentId: source.id, criterionByCode },
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

  // Collapse PROJECTION_NO_SKILLS_FRAMEWORK across multiple sources: if ANY
  // source produced skills, the blocker is cleared (the educator only needs
  // one parseable Skills Framework, not one per doc). Done last so the order
  // of `links` doesn't matter.
  const someSourceProducedSkills = appliedSources.some(
    (s) => (s.result.parametersUpserted ?? 0) > 0,
  );
  const filteredBlockers = someSourceProducedSkills
    ? launchBlockers.filter((b) => b.code !== "PROJECTION_NO_SKILLS_FRAMEWORK")
    : launchBlockers;

  // ── #1630 — Source-derived skill banding ────────────────────────────────
  //
  // Bridge per-skill `tierScheme` (parsed by `project-course-reference.ts`,
  // persisted to `Parameter.config.tierScheme` by the applier) up to the
  // course-level `Playbook.config.skillTierMapping` shape consumed by
  // `BandingPicker.tsx` and `scoreToTier()`. The picker defaults to IELTS
  // when `skillTierMapping` is null, so non-IELTS courses (e.g. CIO/CTO)
  // silently show "IELTS Speaking" as the selected preset until an operator
  // intervenes. This block seeds the picker when the cascade is SYSTEM-only.
  //
  // Cascade gate: respects Domain governance. If an institution has pinned
  // `Domain.config.skillTierMapping` (e.g. "all our language courses use
  // CEFR"), the derivation is suppressed — institutional policy beats
  // document signal. See TL ruling on #1630 (Q3).
  const skillTierMappingDerived: RunProjectionResult["skillTierMappingDerived"] =
    { derivedScheme: null, written: false };
  const derived = deriveSkillTierMappingFromSkills(allParsedSkills);
  if (derived) {
    skillTierMappingDerived.derivedScheme = derived.derivedFromScheme;
    try {
      const effective = await resolveMasteryPolicyKnob(
        { playbookId },
        "skillTierMapping",
      );
      if (effective.source === "SYSTEM") {
        await updatePlaybookConfig(
          playbookId,
          (cfg) => ({
            ...cfg,
            skillTierMapping: {
              thresholds: derived.mapping.thresholds,
              tierBands: derived.mapping.tierBands,
              tierLabels: derived.tierLabels,
            },
          }),
          { reason: `source-derived (${derived.derivedFromScheme})` },
        );
        skillTierMappingDerived.written = true;
        console.log(
          `[projection] #1630 seeded source-derived skillTierMapping (${derived.derivedFromScheme}) on playbook=${playbookId}`,
        );
      } else {
        skillTierMappingDerived.reason = `skillTierMapping already set at ${effective.source} layer`;
        console.log(
          `[projection] #1630 derivation skipped on playbook=${playbookId}: ${skillTierMappingDerived.reason}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skillTierMappingDerived.reason = `cascade-read-failed: ${msg}`;
      console.warn(
        `[projection] #1630 derivation skipped on playbook=${playbookId}: ${msg}`,
      );
    }
  }

  return {
    playbookId,
    appliedSources,
    skippedSources,
    degenerate: false,
    rubricBandsApplied,
    launchBlockers: filteredBlockers,
    skillTierMappingDerived,
  };
}

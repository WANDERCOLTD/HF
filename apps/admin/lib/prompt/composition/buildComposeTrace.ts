/**
 * Compose Trace
 *
 * Lightweight observability block produced during prompt composition.
 * Captures loader decisions, exclusion reasons, onboarding-flow override
 * source, and the final media palette so the user can answer
 * "why does my prompt look like this?" without re-reading code.
 *
 * Surfaced in:
 *   - Server logs (live composition runs — `[compose-trace]` block)
 *   - Dry-run API response (`/api/courses/:id/dry-run-prompt`)
 *   - ComposedPrompt viewer at /x/composed-prompts/:id (read from inputs.composition)
 */

import { prisma } from "@/lib/prisma";
import type { ComposeTrace, LoadedDataContext, ResolvedSpecs } from "./types";

interface BuildTraceInput {
  loadedData: LoadedDataContext;
  resolvedSpecs: ResolvedSpecs;
  sectionsActivated: string[];
  sectionsSkipped: string[];
}

/**
 * Build the trace from already-loaded data + composition metadata.
 *
 * Pure function except for the optional media-source lookup (one Prisma
 * query) used to enrich the media palette with documentType — most callers
 * pass `lookupMediaSources=true`.
 */
export async function buildComposeTrace(
  input: BuildTraceInput,
  options: { lookupMediaSources?: boolean } = {},
): Promise<ComposeTrace> {
  const { loadedData, sectionsActivated, sectionsSkipped } = input;
  const { lookupMediaSources = true } = options;

  // --- Loaders fired vs empty ------------------------------------------------
  const loadersFired: Record<string, number> = {};
  const loadersEmpty: Record<string, string> = {};

  const noteLoader = (name: string, arr: any, emptyReason?: string) => {
    const count = Array.isArray(arr) ? arr.length : arr ? 1 : 0;
    if (count > 0) {
      loadersFired[name] = count;
    } else {
      loadersEmpty[name] = emptyReason ?? "no rows";
    }
  };

  noteLoader("memories", loadedData.memories);
  noteLoader("personality", loadedData.personality, "no PERS-001 measurement yet");
  noteLoader("learnerProfile", loadedData.learnerProfile, "no learner profile yet");
  noteLoader("recentCalls", loadedData.recentCalls, "first call (no history)");
  noteLoader("behaviorTargets", loadedData.behaviorTargets);
  noteLoader("callerTargets", loadedData.callerTargets);
  noteLoader("callerAttributes", loadedData.callerAttributes);
  noteLoader("goals", loadedData.goals, "no goals instantiated");
  noteLoader("playbooks", loadedData.playbooks, "no playbook enrollment");
  noteLoader("systemSpecs", loadedData.systemSpecs);
  noteLoader("subjectSources", (loadedData.subjectSources as any)?.subjects ?? [], "no content sources");
  noteLoader("curriculumAssertions", loadedData.curriculumAssertions ?? [], "no learner-facing TPs");
  noteLoader("curriculumQuestions", loadedData.curriculumQuestions ?? [], "no extracted MCQs");
  noteLoader("curriculumVocabulary", loadedData.curriculumVocabulary ?? [], "no vocabulary extracted");
  noteLoader("courseInstructions", loadedData.courseInstructions ?? [], "no tutor-only instructions");
  noteLoader("openActions", loadedData.openActions ?? [], "no open actions");
  noteLoader("visualAids", loadedData.visualAids ?? [], "no media linked");

  // --- Assertions excluded ---------------------------------------------------
  // We can't reconstruct the exact exclusion list cheaply (the loader doesn't
  // return excluded rows), so we approximate by counting INSTRUCTION_CATEGORIES
  // assertions that DID make it into courseInstructions vs the totals available
  // — the gap tells the user "X assertions in your sources never reach the
  // tutor". Cheap proxy: courseInstructions row count.
  const ciCount = loadedData.courseInstructions?.length ?? 0;
  const caCount = loadedData.curriculumAssertions?.length ?? 0;
  const totalAssertions = ciCount + caCount;
  const firstReasons: string[] = [];
  if (ciCount === 0 && (loadedData.subjectSources as any)?.subjects?.length) {
    firstReasons.push("0 tutor-only instructions extracted — check that COURSE_REFERENCE doc imported cleanly");
  }
  if (caCount === 0 && (loadedData.subjectSources as any)?.subjects?.length) {
    firstReasons.push("0 learner-facing teaching points — curriculum extraction may not have run yet");
  }
  if ((loadedData.visualAids ?? []).length === 0 && (loadedData.subjectSources as any)?.subjects?.length) {
    firstReasons.push("0 visual aids — no image media linked to subjects in this course");
  }

  // --- Onboarding flow source ------------------------------------------------
  // pedagogy.ts logs which source it picked but we re-derive here for the
  // trace block. Mirrors the order in transforms/pedagogy.ts L90-94.
  let onboardingFlowSource: string | null = null;
  let onboardingOverriddenByPlaybook = false;
  const primaryPlaybook = loadedData.playbooks?.[0];
  const playbookFlow = (primaryPlaybook?.config as any)?.onboardingFlowPhases;
  const domainFlow = (loadedData.caller?.domain as any)?.onboardingFlowPhases;
  if (playbookFlow) {
    onboardingFlowSource = `Playbook ${primaryPlaybook?.name}`;
    onboardingOverriddenByPlaybook = !!domainFlow; // playbook beat the domain
  } else if (domainFlow) {
    onboardingFlowSource = `Domain ${(loadedData.caller as any)?.domain?.slug ?? "(unknown)"}`;
  } else if (loadedData.onboardingSpec) {
    onboardingFlowSource = `Spec ${(loadedData.onboardingSpec as any)?.slug ?? "INIT-001"}`;
  } else {
    onboardingFlowSource = null;
  }

  // --- Media palette ---------------------------------------------------------
  const aids = loadedData.visualAids ?? [];
  const mediaPalette: ComposeTrace["mediaPalette"] = [];
  if (aids.length > 0 && lookupMediaSources) {
    const mediaIds = aids.map((a: any) => a.mediaId).filter(Boolean);
    const mediaWithSource = mediaIds.length
      ? await prisma.mediaAsset.findMany({
          where: { id: { in: mediaIds } },
          select: {
            id: true,
            source: { select: { name: true, documentType: true } },
          },
        })
      : [];
    const byId = new Map(mediaWithSource.map((m) => [m.id, m]));
    for (const a of aids) {
      const m = byId.get((a as any).mediaId);
      const src = m?.source;
      mediaPalette.push({
        fileName: (a as any).fileName ?? "(unnamed)",
        documentType: src?.documentType ?? null,
        sourceName: src?.name ?? null,
      });
    }
  } else {
    for (const a of aids) {
      mediaPalette.push({
        fileName: (a as any).fileName ?? "(unnamed)",
        documentType: null,
        sourceName: null,
      });
    }
  }

  return {
    loadersFired,
    loadersEmpty,
    assertionsExcluded: {
      count: Math.max(0, totalAssertions - ciCount - caCount),
      firstReasons: firstReasons.slice(0, 3),
    },
    onboardingFlowSource,
    onboardingOverriddenByPlaybook,
    mediaPalette,
    sectionsActivatedCount: sectionsActivated.length,
    sectionsSkippedCount: sectionsSkipped.length,
  };
}

/**
 * Render the trace as a multi-line `[compose-trace]` log block, useful for
 * grepping server logs when something looks off.
 */
export function renderComposeTraceLog(trace: ComposeTrace): string {
  const lines: string[] = ["[compose-trace]"];
  lines.push(
    `  loaders: ${Object.keys(trace.loadersFired).length} fired, ${Object.keys(trace.loadersEmpty).length} empty`,
  );
  lines.push(
    `  sections: ${trace.sectionsActivatedCount} activated, ${trace.sectionsSkippedCount} skipped`,
  );
  lines.push(`  onboarding-flow: ${trace.onboardingFlowSource ?? "(none)"}`);
  if (trace.onboardingOverriddenByPlaybook) {
    lines.push(`  onboarding-override: playbook beat domain`);
  }
  lines.push(`  media-palette: ${trace.mediaPalette.length} items`);
  if (trace.mediaPalette.length > 0) {
    for (const m of trace.mediaPalette.slice(0, 5)) {
      lines.push(`    - ${m.fileName} [${m.documentType ?? "?"}]`);
    }
    if (trace.mediaPalette.length > 5) {
      lines.push(`    … +${trace.mediaPalette.length - 5} more`);
    }
  }
  if (trace.assertionsExcluded.firstReasons.length > 0) {
    lines.push(`  assertion-warnings:`);
    for (const r of trace.assertionsExcluded.firstReasons) {
      lines.push(`    - ${r}`);
    }
  }
  return lines.join("\n");
}

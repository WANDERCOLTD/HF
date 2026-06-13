/**
 * Stage 8 of `create_course` — backfill + sync + pedagogy assertions +
 * background curriculum kickoff + return payload assembly.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. Owns the
 * post-enrollment tail: teachMethod backfill (#1029), instruction → spec
 * sync, pedagogy assertions from setupData.skillsFramework / phases /
 * etc. (#1545), the fire-and-forget `generateInstantCurriculum` kickoff,
 * the first-call preview payload assembly, and the final WizardToolExec
 * response.
 *
 * The name "lesson-plan" is a holdover from the original sequencing — the
 * actual generateLessonPlan call was removed in an earlier change ("Lesson
 * plan generation removed — scheduler handles pacing"). Kept as the file
 * name for traceability with the brief and to mark this as the
 * return-payload assembly stage.
 *
 * Behaviour-preserving relative to the pre-#1544 inline block at
 * create_course.ts L715-872 (post-Stage-5 L83-240).
 */

import type { WizardToolExec } from "../../_shared/types";
import type { ResolvedCreateCourseContext } from "./_context";
import type { EnrollState } from "./_enroll";
import type { LaunchBlocker } from "./_new-path";

export interface LessonPlanArgs {
  ctx: ResolvedCreateCourseContext;
  playbookId: string;
  subject: { id: string; name: string; slug: string };
  subjectIdsToLink: string[];
  resolvedWelcome: string | null;
  mediaLookup: Map<string, { fileName: string; title: string | null }>;
  enrollState: EnrollState;
  /**
   * Launch blockers from projection (#3 — 2026-06-13). Surfaced in the
   * tool response under `launchBlockers`. When non-empty, the chat
   * assistant MUST refuse the "Ready to launch" affirmation and tell
   * the educator what to fix (typically: the uploaded course-ref has
   * no parseable Skills Framework).
   */
  launchBlockers: LaunchBlocker[];
}

export async function generateLessonPlanAndReturn(
  args: LessonPlanArgs,
): Promise<WizardToolExec> {
  const { ctx, playbookId, subject, subjectIdsToLink, resolvedWelcome, mediaLookup, enrollState, launchBlockers } = args;
  const { input, setupData, domainId, subjectDiscipline, courseName, interactionPattern, packSubjectIds } = ctx;
  const { caller, callerName, demoCaller, demoName, cohort, joinToken } = enrollState;
  const { prisma } = await import("@/lib/prisma");

  // 10. Backfill teachMethod on assertions extracted before teachingMode was set
  const resolvedTeachingModeNew = (input.teachingMode as string) || (setupData?.teachingMode as string);
  if (resolvedTeachingModeNew) {
    const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
    backfillTeachMethods(playbookId).catch((err) =>
      console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
  }

  // 10b. Sync instruction assertions into course identity spec overlay
  const { syncInstructionsToIdentitySpec } = await import("@/lib/content-trust/sync-instructions-to-spec");

  // 10c. Create assertions from pedagogy data (if user filled any pedagogy nodes).
  //      Skip if a pedagogy source already exists for this subject (re-run guard).
  const hasPedagogy = setupData?.skillsFramework || setupData?.teachingPrinciples
    || setupData?.coursePhases || setupData?.edgeCases || setupData?.assessmentBoundaries;
  if (hasPedagogy) {
    const existingPedSource = await prisma.contentSource.findFirst({
      where: {
        documentType: "COURSE_REFERENCE",
        name: `${courseName} — Course Reference`,
        subjects: { some: { subjectId: subject.id } },
      },
    });
    if (!existingPedSource) {
      try {
        const { convertCourseRefToAssertions } = await import("@/lib/content-trust/course-ref-to-assertions");
        const { renderCourseRefMarkdown } = await import("@/lib/content-trust/course-ref-to-markdown");
        const refData = {
          courseOverview: {
            subject: subjectDiscipline,
            studentAge: (setupData?.audience as string) || undefined,
          },
          skillsFramework: setupData?.skillsFramework as any,
          teachingApproach: setupData?.teachingPrinciples as any,
          coursePhases: setupData?.coursePhases as any,
          edgeCases: setupData?.edgeCases as any,
          assessmentBoundaries: setupData?.assessmentBoundaries as string[],
          learnerModel: setupData?.learnerModel as any,
          sessionOverrides: setupData?.sessionOverrides as any,
          contentStrategy: setupData?.contentStrategy as any,
          communicationRules: setupData?.communicationRules as any,
        };
        const assertionRows = convertCourseRefToAssertions(refData);
        if (assertionRows.length > 0) {
          // #1545 — route through the shared pedagogy helper (mirror of
          // the reuse-path block). Pre-fix this branch carried the same
          // three drifted field names and missed `slug` — Prisma threw
          // on every wizard run.
          const { createPedagogyAssertionsFromCourseRef } = await import("../_pedagogy-assertions");
          const result = await createPedagogyAssertionsFromCourseRef({
            courseName,
            playbookId,
            subjectId: subject.id,
            textSample: renderCourseRefMarkdown(refData),
            assertionRows,
          });
          console.log(`[wizard] Created ${result.assertionCount} pedagogy assertions from course reference data`);
        }
      } catch (err) {
        console.error("[wizard] Pedagogy assertion creation failed (non-fatal):", (err as Error).message);
      }
    }
  }

  syncInstructionsToIdentitySpec(playbookId).catch((err) =>
    console.error("[wizard] instruction spec sync failed (non-fatal):", err.message));

  // 11. Auto-generate curriculum (background, fire-and-forget). Lesson plan
  // generation removed in an earlier change — scheduler now handles pacing.
  // Always include the primary subject (after bridging in Stage 5 step 7b
  // sources live on subject.id, not just packSubjectIds).
  const curriculumSubjectIds = [
    subject.id,
    ...(subjectIdsToLink.length > 0 ? subjectIdsToLink : (packSubjectIds ?? [])),
  ];
  const { generateInstantCurriculum } = await import("@/lib/domain/instant-curriculum");
  (async () => {
    try {
      await generateInstantCurriculum({
        domainId,
        playbookId,
        subjectName: subjectDiscipline,
        persona: interactionPattern,
        subjectIds: curriculumSubjectIds,
        intents: {
          sessionCount: input.sessionCount ? Number(input.sessionCount) : undefined,
          durationMins: input.durationMins ? Number(input.durationMins) : undefined,
          emphasis: input.planEmphasis as string | undefined,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[wizard] Instant curriculum failed (non-fatal):", message);
    }
  })();

  // Build first-call preview data (phases + resolved media filenames)
  const previewDomain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { onboardingWelcome: true, onboardingFlowPhases: true },
  });
  const previewPhases = (previewDomain?.onboardingFlowPhases as { phases?: Array<Record<string, unknown>> } | null)?.phases || [];
  const firstCallPreview = {
    domainId,
    playbookId,
    welcomeMessage: previewDomain?.onboardingWelcome || resolvedWelcome || null,
    phases: previewPhases.map((p) => ({
      phase: p.phase,
      duration: p.duration,
      goals: (p.goals as string[]) || [],
      content: ((p.content as Array<{ mediaId: string; instruction?: string }>) || []).map((c) => {
        const info = mediaLookup.get(c.mediaId);
        return {
          mediaId: c.mediaId,
          fileName: info?.fileName || "Unknown file",
          title: info?.title || null,
          instruction: c.instruction,
        };
      }),
    })),
  };

  // Post-creation summary — surfaces entity counts so the AI can report them.
  const linkedSubjects = await prisma.playbookSubject.findMany({
    where: { playbookId },
    include: { subject: { select: { id: true, name: true } } },
  });
  const linkedSources = await prisma.subjectSource.findMany({
    where: { subjectId: { in: linkedSubjects.map((ls) => ls.subject.id) } },
    select: { sourceId: true },
    distinct: ["sourceId"],
  });

  // (#3 2026-06-13) Publish-time launch blockers. When non-empty the
  // playbook has been demoted back to DRAFT inside _new-path.ts and the
  // course is NOT available to learners. The chat assistant reads this
  // field and tells the educator what to fix.
  //
  // `playbookStatus` is computed deterministically here so the chat does
  // not need a second DB lookup to render "DRAFT — fix course-ref first"
  // vs "PUBLISHED — ready to test" banners.
  const playbookStatus = launchBlockers.length > 0 ? "DRAFT" : "PUBLISHED";

  return {
    content: JSON.stringify({
      ok: true,
      domainId,
      playbookId,
      playbookStatus,
      subjectId: subject.id,
      callerId: caller.id,
      callerName,
      ...(demoCaller ? { demoCallerId: demoCaller.id, demoCallerName: demoName } : {}),
      cohortId: cohort.id,
      joinToken,
      firstCallPreview,
      creationSummary: {
        subjectCount: linkedSubjects.length,
        subjectNames: linkedSubjects.map((ls) => ls.subject.name),
        documentCount: linkedSources.length,
      },
      // (#3) Empty array when the course is publishable; non-empty when
      // the educator needs to fix the course-ref before learners can use it.
      launchBlockers,
    }),
  };
}

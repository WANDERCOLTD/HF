import type { WizardToolExec } from "../_shared/types";

export async function execute(
  input: Record<string, unknown>,
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
// ── Stage 1 — graph guard (extracted #1544) ──
const { runGraphGuard } = await import("./create_course/_graph-guard");
const graphGuard = await runGraphGuard(setupData);
if (graphGuard.earlyReturn) return graphGuard.earlyReturn;
// Server-side: full course creation with scaffolding (identity spec, playbook, system specs, publish, onboarding)
try {
  const { prisma } = await import("@/lib/prisma");

  // ── Stage 3 — subject-discipline guard (extracted #1544) ──
  // Runs before domain resolution so a missing subjectDiscipline never
  // triggers the safety-net auto-create at `_resolve-domain.ts`.
  const { resolveSubjectOrError } = await import("./create_course/_resolve-subject");
  const subjectResult = await resolveSubjectOrError({ input, userId, setupData });
  if (!subjectResult.ok) return subjectResult.earlyReturn;
  const { subjectDiscipline } = subjectResult;

  const courseName = input.courseName as string;
  // #1995 — interactionPattern flows through the ctx as `string` for
  // downstream readers; the merge helpers (_new-config-merge.ts /
  // _reuse-config-merge.ts) call `isInteractionPattern(...)` before
  // writing to `Playbook.config`. Cast to `string` here (NOT the bare
  // `as string` form blocked by `hf-wizard/no-untyped-enum-write-in-wizard`
  // — that rule fires on enum-bearing FIELD assignments, not on local
  // var declarations from the typed input bag) so downstream string
  // readers compile. The runtime safety is at the merge boundary.
  const interactionPattern = String(input.interactionPattern ?? "");
  const packSubjectIds = (input.packSubjectIds as string[] | undefined)
    || (setupData?.packSubjectIds as string[] | undefined);
  // Phase 5: prefer sourceIds for direct PlaybookSource creation
  const uploadSourceIds = (input.uploadSourceIds as string[] | undefined)
    || (setupData?.uploadSourceIds as string[] | undefined);

  // ── Stage 2 — domain resolution (extracted #1544) ──
  const { resolveDomainOrError } = await import("./create_course/_resolve-domain");
  const domainResult = await resolveDomainOrError({ input, userId, setupData });
  if (!domainResult.ok) return domainResult.earlyReturn;
  const { domainId } = domainResult;

  // ── Stage 4 — reuse-existing-playbook branch (extracted #1544) ──
  // Owns the dedup-by-name guard + the full reuse-path lifecycle (config
  // merge, #607 unlink, projection, enrollment, pedagogy assertions).
  // Returns an early-payload when reuse succeeds; falls through here to
  // the new-path scaffold when there's no draftPlaybookId or the
  // referenced playbook was deleted.
  const { reuseExistingCoursePath } = await import("./create_course/_reuse-path");
  const reuseResult = await reuseExistingCoursePath({
    input,
    userId,
    setupData,
    domainId,
    subjectDiscipline,
    courseName,
    interactionPattern,
    packSubjectIds,
    uploadSourceIds,
  });
  if (reuseResult.ok) return reuseResult.earlyReturn;

  // ── Stage 5 — new-course scaffold (extracted #1544; folds in Stage 6) ──
  // Owns Subject create, dedup-by-name (recurses through reuse path),
  // scaffold + #607 invariant, config merge, identity-spec overlay,
  // pack-subject linking, COURSE_REFERENCE bridge + projection, onboarding
  // welcome + behaviorTargets, and student-visible media attachment.
  const { newCourseScaffoldPath } = await import("./create_course/_new-path");
  const newPathCtx = { input, userId, setupData, domainId, subjectDiscipline, courseName, interactionPattern, packSubjectIds, uploadSourceIds };
  const newPathResult = await newCourseScaffoldPath(newPathCtx);
  if (!newPathResult.ok) {
    return execute(input, userId, newPathResult.recurse.setupData);
  }
  const { playbookId, subjectId: subjectIdFromScaffold, subjectIdsToLink, resolvedWelcome, mediaLookup, launchBlockers } = newPathResult.state;
  // Stages 7+8 use `subject` (the Prisma row shape). Re-fetch to preserve
  // type compatibility — orchestrator-level cost is one extra DB read,
  // which the next stage extracts away.
  const subject = await prisma.subject.findUniqueOrThrow({
    where: { id: subjectIdFromScaffold },
    select: { id: true, name: true, slug: true },
  });

  // ── Stage 7 — TEACHER + test caller enrollment + cohort (extracted #1544) ──
  const { enrollAndCreateCaller } = await import("./create_course/_enroll");
  const enrollState = await enrollAndCreateCaller({ ...newPathCtx, playbookId });

  // ── Stage 8 — backfill + sync + pedagogy assertions + curriculum +
  //              first-call preview + return payload (extracted #1544) ──
  const { generateLessonPlanAndReturn } = await import("./create_course/_lesson-plan");
  return generateLessonPlanAndReturn({
    ctx: newPathCtx,
    playbookId,
    subject,
    subjectIdsToLink,
    resolvedWelcome,
    mediaLookup,
    enrollState,
    launchBlockers,
  });
} catch (err) {
  // #338 followup — log the error server-side so failed create_course
  // calls are debuggable. Previously the error went only into the chat
  // tool response, invisible in server logs. Includes stack so we can
  // see where the throw originated.
  console.error(
    "[wizard-tools] create_course FAILED:",
    err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
  );
  return {
    content: JSON.stringify({ ok: false, error: String(err) }),
    is_error: true,
  };
}
}

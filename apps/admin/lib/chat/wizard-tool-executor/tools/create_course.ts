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
  const { enrollCaller } = await import("@/lib/enrollment");
  const { randomFakeName } = await import("@/lib/fake-names");

  // ── Stage 3 — subject-discipline guard (extracted #1544) ──
  // Runs before domain resolution so a missing subjectDiscipline never
  // triggers the safety-net auto-create at `_resolve-domain.ts`.
  const { resolveSubjectOrError } = await import("./create_course/_resolve-subject");
  const subjectResult = await resolveSubjectOrError({ input, userId, setupData });
  if (!subjectResult.ok) return subjectResult.earlyReturn;
  const { subjectDiscipline } = subjectResult;

  const courseName = input.courseName as string;
  const interactionPattern = input.interactionPattern as string;
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
  const { playbookId, subjectId: subjectIdFromScaffold, subjectIdsToLink, resolvedWelcome, mediaLookup } = newPathResult.state;
  // Stages 7+8 use `subject` (the Prisma row shape). Re-fetch to preserve
  // type compatibility — orchestrator-level cost is one extra DB read,
  // which the next stage extracts away.
  const subject = await prisma.subject.findUniqueOrThrow({
    where: { id: subjectIdFromScaffold },
    select: { id: true, name: true, slug: true },
  });

  // 9a. Ensure the wizard user has a TEACHER Caller (needed for educator dashboard + cohort ownership)
  let teacherCaller = await prisma.caller.findFirst({
    where: { userId, domainId, role: "TEACHER" },
    select: { id: true },
  });
  if (!teacherCaller) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    teacherCaller = await prisma.caller.create({
      data: {
        name: user?.name || "Educator",
        email: user?.email || undefined,
        role: "TEACHER",
        userId,
        domainId,
      },
      select: { id: true },
    });
  }

  // 9b. Create TWO test callers: demo (skips onboarding) + full (normal journey)
  const { instantiatePlaybookGoals } = await import("@/lib/enrollment/instantiate-goals");
  const { instantiatePlaybookTargets } = await import("@/lib/enrollment/instantiate-targets");

  async function createTestCaller(callerName: string, skipOnboarding: boolean) {
    const c = await prisma.caller.create({
      data: { name: callerName, domainId },
    });
    await enrollCaller(c.id, playbookId, "wizard-v2", undefined,
      { skipAutoCompose: skipOnboarding });

    // Instantiate Goal rows from playbook.config.goals. Shared helper keeps
    // v5 wizard (course-setup) and chat wizard in lockstep. Re-throw on failure
    // so the wizard reports the broken state instead of pretending success.
    await instantiatePlaybookGoals(c.id, domainId);

    // Pre-create CallerTarget placeholders. Non-fatal — see instantiate-targets.ts.
    await instantiatePlaybookTargets(c.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[wizard] Target instantiation failed for ${c.id}: ${message}`);
    });

    // Skip onboarding: mark complete, mark surveys submitted, then compose
    if (skipOnboarding) {
      const { applySkipOnboarding } = await import("@/lib/enrollment/skip-onboarding");
      // domainId is narrowed at L107 guard; the re-broadening from L104
      // assignment loses through this deep nested closure. Non-null
      // assertion is safe — control flow can't reach here without it.
      await applySkipOnboarding(c.id, domainId!);

      const { autoComposeForCaller } = await import("@/lib/enrollment/auto-compose");
      autoComposeForCaller(c.id, playbookId).catch(err =>
        console.error(`[wizard] Auto-compose failed for demo caller ${c.id}:`, err.message));
    }

    return c;
  }

  const demoName = randomFakeName();
  const callerName = randomFakeName();
  // Demo caller (skip-onboarding) is best-effort — don't block course creation if it fails
  let demoCaller: { id: string } | null = null;
  try {
    demoCaller = await createTestCaller(demoName, true);
  } catch (err) {
    console.error("[wizard] Demo caller creation failed (non-fatal):", (err as Error).message);
  }
  const caller = await createTestCaller(callerName, false);

  // 9d. Create or reuse "Test Learners" cohort so the course has a join link.
  //
  // SCOPE BY PLAYBOOK, NOT BY NAME. Previously this looked up the cohort
  // by (domainId, name) so a brand-new playbook would silently reuse the
  // cohort of an earlier same-named playbook in the same domain — and
  // inherit its entire member list. Live repro on hf-dev 2026-05-19:
  // "IELTS Speaking Practice" was the 13th playbook of that name in
  // the IELTS Prep Lab domain; the cohort created on 2026-05-10 had
  // accumulated 4 leaked members across the prior runs.
  //
  // Scoping by playbook means: brand-new playbookId has no
  // CohortPlaybook link yet → findFirst returns null → fresh cohort
  // gets created. Re-runs of create_course on the SAME playbookId
  // find the prior cohort and reuse it (the legitimate case the
  // findFirst was added for).
  const cohortName = `${courseName} — Test Learners`;
  let cohort = await prisma.cohortGroup.findFirst({
    where: { playbooks: { some: { playbookId } } },
  });
  let joinToken = cohort?.joinToken || "";
  if (!cohort) {
    joinToken = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    cohort = await prisma.cohortGroup.create({
      data: {
        name: cohortName,
        domainId,
        ownerId: teacherCaller.id,
        joinToken,
        isActive: true,
      },
    });
  }
  await prisma.cohortPlaybook.upsert({
    where: { cohortGroupId_playbookId: { cohortGroupId: cohort.id, playbookId } },
    update: {},
    create: {
      cohortGroupId: cohort.id,
      playbookId,
      assignedBy: "wizard-v5",
    },
  });
  // Add test callers to the cohort (skip if already a member)
  for (const cId of [demoCaller?.id, caller.id].filter(Boolean) as string[]) {
    const existingMembership = await prisma.callerCohortMembership.findFirst({
      where: { callerId: cId, cohortGroupId: cohort.id },
    });
    if (!existingMembership) {
      await prisma.callerCohortMembership.create({
        data: { callerId: cId, cohortGroupId: cohort.id },
      });
    }
  }

  // 10. Backfill teachMethod on assertions extracted before teachingMode was set
  const resolvedTeachingModeNew = (input.teachingMode as string) || (setupData?.teachingMode as string);
  if (resolvedTeachingModeNew) {
    const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
    backfillTeachMethods(playbookId).catch(err =>
      console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
  }

  // 10b. Sync instruction assertions into course identity spec overlay
  const { syncInstructionsToIdentitySpec } = await import("@/lib/content-trust/sync-instructions-to-spec");

  // 10c. Create assertions from pedagogy data (if user filled any pedagogy nodes)
  //      Skip if pedagogy source already exists for this subject (re-run guard)
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
          // the reuse-path block above). Pre-fix this branch carried the
          // same three drifted field names and missed the required
          // `slug` — Prisma threw on every wizard run.
          const { createPedagogyAssertionsFromCourseRef } = await import("./_pedagogy-assertions");
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

  syncInstructionsToIdentitySpec(playbookId).catch(err =>
    console.error("[wizard] instruction spec sync failed (non-fatal):", err.message));

  // 11. Auto-generate curriculum + lesson plan (background, chained)
  //
  // Both steps run in the background so the wizard response returns fast, but
  // they are chained sequentially: curriculum first (which waits for extractions
  // to finish), then lesson plan (which uses the freshly-built curriculum).
  //
  // Running in parallel used to produce placeholder modules ("M00-1", "4MD-2")
  // because curriculum gen fired before extractions completed, got zero assertions,
  // and fell through to goals-based generation.
  // Always include the primary subject — after bridging (step 7b),
  // content sources live on subject.id, not just packSubjectIds.
  const curriculumSubjectIds = [subject.id, ...(subjectIdsToLink.length > 0 ? subjectIdsToLink : (packSubjectIds ?? []))];
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
    } catch (err: any) {
      console.error("[wizard] Instant curriculum failed (non-fatal):", err.message);
    }

    // Lesson plan generation removed — scheduler handles pacing
  })();

  // Build first call preview data (phases + resolved media filenames)
  const previewDomain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { onboardingWelcome: true, onboardingFlowPhases: true },
  });
  const previewPhases = (previewDomain?.onboardingFlowPhases as { phases?: any[] } | null)?.phases || [];
  const firstCallPreview = {
    domainId,
    playbookId,
    welcomeMessage: previewDomain?.onboardingWelcome || resolvedWelcome || null,
    phases: previewPhases.map((p: any) => ({
      phase: p.phase,
      duration: p.duration,
      goals: p.goals || [],
      content: (p.content || []).map((c: any) => {
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

  // Post-creation summary — surfaces entity counts so the AI can report them
  const linkedSubjects = await prisma.playbookSubject.findMany({
    where: { playbookId },
    include: { subject: { select: { id: true, name: true } } },
  });
  const linkedSources = await prisma.subjectSource.findMany({
    where: { subjectId: { in: linkedSubjects.map(ls => ls.subject.id) } },
    select: { sourceId: true },
    distinct: ["sourceId"],
  });

  return {
    content: JSON.stringify({
      ok: true,
      domainId,
      playbookId,
      subjectId: subject.id,
      callerId: caller.id,
      callerName,
      ...(demoCaller ? { demoCallerId: demoCaller.id, demoCallerName: demoName } : {}),
      cohortId: cohort.id,
      joinToken,
      firstCallPreview,
      creationSummary: {
        subjectCount: linkedSubjects.length,
        subjectNames: linkedSubjects.map(ls => ls.subject.name),
        documentCount: linkedSources.length,
      },
    }),
  };
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

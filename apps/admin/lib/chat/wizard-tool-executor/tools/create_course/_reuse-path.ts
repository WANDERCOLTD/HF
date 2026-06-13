/**
 * Stage 4 of `create_course` — reuse-existing-playbook branch.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. Owns the
 * full ~380-LOC path that fires when `setupData.draftPlaybookId` points
 * at a live Playbook: dedup-by-name guard, config merge + persistence,
 * #607 PlaybookSubject unlink invariant, PlaybookSource link (#352),
 * COURSE_REFERENCE projection (#338), domain welcome message,
 * test-caller enrollment, instant-curriculum kickoff, and pedagogy
 * assertions (#1545). Returns either a `WizardToolExec` early-return
 * payload when the reuse path succeeds, or `{ fallThrough: true }` when
 * the orchestrator should continue to the new-path scaffold (no
 * draftPlaybookId, or the referenced playbook was deleted).
 *
 * Behaviour-preserving relative to the pre-#1544 inline block at
 * create_course.ts L98-449. The dispatcher pin
 * `tests/lib/chat/wizard-tool-executor-dispatcher.test.ts` "create_course
 * (reuse path — #607 invariant)" exercises this helper end-to-end via the
 * dispatcher and asserts both the #607 unlink call shape and the
 * `updatePlaybookConfig` reason string — must stay green.
 */

import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import { applyStudentExperienceConfig } from "../../_shared/apply-student-experience";
import type { WizardToolExec } from "../../_shared/types";
import type { ResolvedCreateCourseContext } from "./_context";
import { buildReuseConfigUpdate } from "./_reuse-config-merge";

export type ReusePathResult =
  | { ok: true; earlyReturn: WizardToolExec }
  | { ok: false; fallThrough: true };

export async function reuseExistingCoursePath(
  ctx: ResolvedCreateCourseContext,
): Promise<ReusePathResult> {
  const {
    input,
    userId,
    setupData,
    domainId,
    subjectDiscipline,
    courseName,
    interactionPattern,
    packSubjectIds,
    uploadSourceIds,
  } = ctx;
  const { prisma } = await import("@/lib/prisma");

  // ── Guard: existing course resolved via entity resolution ──
  // If draftPlaybookId is already set, skip scaffolding — just apply config tweaks
  // and create a test caller enrolled in the existing course.
  // BUT: if the user explicitly named a different course, ignore the draftPlaybookId
  // and create a brand new course with their chosen name.
  let existingPlaybookId = setupData?.draftPlaybookId as string | undefined;
  if (existingPlaybookId && courseName) {
    const existingPbName = await prisma.playbook.findUnique({
      where: { id: existingPlaybookId },
      select: { name: true },
    });
    if (existingPbName && existingPbName.name.toLowerCase() !== courseName.toLowerCase()) {
      console.log(`[wizard-tools] create_course: user named course "${courseName}" but draftPlaybookId points to "${existingPbName.name}" — creating new course instead`);
      existingPlaybookId = undefined;
    }
  }
  if (!existingPlaybookId) return { ok: false, fallThrough: true };

  const existingPb = await prisma.playbook.findUnique({
    where: { id: existingPlaybookId },
    select: { id: true, domainId: true, config: true },
  });
  if (!existingPb) {
    // Playbook was deleted — fall through to normal creation
    return { ok: false, fallThrough: true };
  }

  // Build merged config (input → setupData fallback, plus #253 progression
  // and #167 pedagogy carryover). Pure function — see _reuse-config-merge.ts.
  const existingConfig = (existingPb.config as Record<string, unknown>) || {};
  const configUpdate = buildReuseConfigUpdate(existingConfig, ctx);

  // Student experience config — welcome + sessionFlow.intake mirror + nps
  applyStudentExperienceConfig(
    setupData as Record<string, unknown> | undefined,
    configUpdate,
    "create_course (existing path)",
    existingPlaybookId,
  );

  // #826 — central helper. create_course reuse-existing path
  // hits a playbook that MAY already have enrolled callers, so
  // the timestamp bump (when compose-affecting keys change)
  // marks downstream prompts as stale.
  await updatePlaybookConfig(
    existingPlaybookId,
    () => configUpdate,
    { reason: "wizard create_course (existing path)" },
  );

  // #607 follow-on (2026-05-23) — enforces invariant I9 ("exactly one
  // PlaybookSubject per playbook") on the reuse branch too. Look up the
  // course-scoped Subject (slug = {domain.slug}-{slug(courseName)}-{disciplineSlug})
  // and unlink every other PlaybookSubject row. Skip safely when the
  // course-scoped Subject doesn't exist yet — better to leave a
  // possibly-wrong subject linked than orphan the prompt composer.
  if (subjectDiscipline) {
    const domainRow = await prisma.domain.findUnique({
      where: { id: existingPb.domainId! },
      select: { slug: true },
    });
    if (domainRow) {
      const slugify = (await import("slugify")).default;
      const courseSlug = slugify(courseName, { lower: true, strict: true });
      const disciplineSlug = slugify(subjectDiscipline, { lower: true, strict: true });
      const expectedSubjectSlug = `${domainRow.slug}-${courseSlug}-${disciplineSlug}`;
      const courseScopedSubject = await prisma.subject.findUnique({
        where: { slug: expectedSubjectSlug },
        select: { id: true },
      });
      if (courseScopedSubject) {
        const { unlinkNonPrimaryPlaybookSubjects } = await import(
          "@/lib/knowledge/cleanup-placeholder-subjects"
        );
        const unlink = await unlinkNonPrimaryPlaybookSubjects(
          existingPlaybookId,
          courseScopedSubject.id,
        );
        if (unlink.removed > 0) {
          console.log(
            `[wizard-tools] create_course (existing path): displaced ${unlink.removed} non-primary PlaybookSubject(s) on playbook ${existingPlaybookId}: ${unlink.displaced
              .map((d) => `"${d.subjectName}"`)
              .join(", ")}`,
          );
        }
      } else {
        console.warn(
          `[wizard-tools] create_course (existing path): no course-scoped Subject "${expectedSubjectSlug}" found on reuse — skipping #607 unlink to avoid orphaning the playbook. Investigate if this playbook shows duplicate CONTENT AUTHORITY sections in composed prompts.`,
        );
      }
    }
  }

  // Apply behavior targets if provided
  const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
  if (behaviorTargets && Object.keys(behaviorTargets).length > 0) {
    const { applyBehaviorTargets } = await import("@/lib/domain/agent-tuning");
    await applyBehaviorTargets(existingPlaybookId, behaviorTargets);
  }

  // PlaybookSource link (#352) — mirror step 7c from the new-course
  // branch. Without this, fresh ContentSources uploaded during a
  // wizard run that lands on the existing-path (duplicate-name reuse
  // or explicit draftPlaybookId) never get linked to the reused
  // playbook, so the projection below has no COURSE_REFERENCE to
  // derive Goals / BehaviorTargets / CurriculumModule from and the
  // course shows up as "degenerate". `upsertPlaybookSource` is
  // idempotent so this is safe to call on already-linked sources.
  if (uploadSourceIds?.length) {
    // Pre-flight FK race guard (see new-course branch step 7c).
    const { preflightPlaybookSourceIds, upsertPlaybookSource } =
      await import("@/lib/knowledge/domain-sources");
    await preflightPlaybookSourceIds(uploadSourceIds);
    for (const srcId of uploadSourceIds) {
      await upsertPlaybookSource(existingPlaybookId, srcId);
    }
  }

  // COURSE_REFERENCE projection (#338) — same as the new-course
  // branch (step 7d below). Re-applying the projection on an
  // already-set-up playbook is idempotent, so this is safe even
  // when the user is just tweaking config on an existing course.
  try {
    const { runProjectionForPlaybook } = await import("@/lib/wizard/run-projection-for-playbook");
    await runProjectionForPlaybook(existingPlaybookId);
  } catch (err) {
    console.error(
      `[projection] create_course (existing path): projection failed for playbook=${existingPlaybookId} — config update still applied. Error:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Apply welcome message to domain
  // #828 — central helper bumps Domain.composeInputsUpdatedAt;
  // fans out staleness to all playbooks-in-domain.
  const resolvedDomainId = existingPb.domainId || domainId;
  if (input.welcomeMessage && resolvedDomainId) {
    await updateDomainConfig(
      resolvedDomainId,
      (d) => ({ ...d, onboardingWelcome: input.welcomeMessage as string }),
      { reason: "wizard create_course (existing) — welcome message" },
    );
  }

  // If test caller already exists, return it (no duplicates)
  const existingCallerId = setupData?.draftCallerId as string | undefined;
  if (existingCallerId) {
    return {
      ok: true,
      earlyReturn: {
        content: JSON.stringify({
          ok: true,
          playbookId: existingPlaybookId,
          callerId: existingCallerId,
          existingCourse: true,
        }),
      },
    };
  }

  // Ensure the wizard user has a TEACHER Caller (needed for educator dashboard)
  const existingTeacher = await prisma.caller.findFirst({
    where: { userId, domainId: resolvedDomainId, role: "TEACHER" },
    select: { id: true },
  });
  if (!existingTeacher) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    await prisma.caller.create({
      data: {
        name: user?.name || "Educator",
        email: user?.email || undefined,
        role: "TEACHER",
        userId,
        domainId: resolvedDomainId,
      },
    });
  }

  // Create test caller enrolled in existing course
  const { randomFakeName } = await import("@/lib/fake-names");
  const { enrollCaller } = await import("@/lib/enrollment");
  const callerName = randomFakeName();
  const caller = await prisma.caller.create({
    data: { name: callerName, domainId: resolvedDomainId },
  });
  await enrollCaller(caller.id, existingPlaybookId, "wizard-v2");

  // Instantiate Goal records for the test caller from config.goals (shared helper).
  // No try/catch — if this fails, the wizard's "course ready" claim is a lie and the
  // educator will see "No goals yet" with no warning. Surface the failure instead.
  const { instantiatePlaybookGoals: instantiateGoalsExisting } = await import("@/lib/enrollment/instantiate-goals");
  await instantiateGoalsExisting(caller.id, resolvedDomainId);

  // Pre-create CallerTarget placeholders. Non-fatal — see instantiate-targets.ts.
  const { instantiatePlaybookTargets: instantiateTargetsExisting } = await import("@/lib/enrollment/instantiate-targets");
  await instantiateTargetsExisting(caller.id).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[wizard] Target instantiation failed for ${caller.id}: ${message}`);
  });

  // Resolve primary subject for the existing playbook
  const existingPbSubject = await prisma.playbookSubject.findFirst({
    where: { playbookId: existingPlaybookId },
    select: { subjectId: true },
  });

  // Auto-generate curriculum if existing playbook has none (non-blocking)
  // Include primary subject — after bridging, sources live there.
  const existingCurrSubjectIds = [
    ...(existingPbSubject ? [existingPbSubject.subjectId] : []),
    ...(packSubjectIds ?? []),
  ];
  const { generateInstantCurriculum: genCurriculum } = await import("@/lib/domain/instant-curriculum");
  genCurriculum({
    domainId: resolvedDomainId,
    playbookId: existingPlaybookId,
    subjectName: subjectDiscipline,
    persona: interactionPattern,
    subjectIds: existingCurrSubjectIds,
    intents: {
      sessionCount: input.sessionCount ? Number(input.sessionCount) : undefined,
      durationMins: input.durationMins ? Number(input.durationMins) : undefined,
      emphasis: input.planEmphasis as string | undefined,
    },
  }).catch(err => console.error("[wizard] Instant curriculum (existing) failed (non-fatal):", err.message));

  // Bridge COURSE_REFERENCE sources to the primary subject (existing course path)
  if (existingPbSubject && packSubjectIds?.length) {
    for (const packSubId of packSubjectIds) {
      // Bridge COURSE_REFERENCE sources — skip when uploadSourceIds handles it
      if (!uploadSourceIds?.length) {
        const packSources = await prisma.subjectSource.findMany({
          where: { subjectId: packSubId },
          select: { sourceId: true, source: { select: { documentType: true } } },
        });
        for (const ps of packSources) {
          // #385 Slice 1 Phase 3 — bridge all four COURSE_REFERENCE* values.
          if (
            ps.source.documentType === "COURSE_REFERENCE" ||
            ps.source.documentType === "COURSE_REFERENCE_CANONICAL" ||
            ps.source.documentType === "COURSE_REFERENCE_TUTOR_BRIEFING" ||
            ps.source.documentType === "COURSE_REFERENCE_ASSESSOR_RUBRIC" ||
            ps.source.documentType === "POLICY_DOCUMENT"
          ) {
            const existingLink = await prisma.subjectSource.findFirst({
              where: { subjectId: existingPbSubject.subjectId, sourceId: ps.sourceId },
            });
            if (!existingLink) {
              await prisma.subjectSource.create({
                data: { subjectId: existingPbSubject.subjectId, sourceId: ps.sourceId },
              });
            }
            // Dual-write: PlaybookSource for bridged source
            const { upsertPlaybookSource: upsertBridge } = await import("@/lib/knowledge/domain-sources");
            await upsertBridge(existingPlaybookId, ps.sourceId);
          }
        }
      }
    }
  }

  // Backfill teachMethod on assertions extracted before teachingMode was set
  const resolvedTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
  if (resolvedTeachingMode) {
    const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
    backfillTeachMethods(existingPlaybookId).catch(err =>
      console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
  }

  // Create assertions from pedagogy data (if user filled any pedagogy nodes)
  // Skip if pedagogy source already exists for this subject (re-run guard)
  const hasPedagogyExisting = setupData?.skillsFramework || setupData?.teachingPrinciples
    || setupData?.coursePhases || setupData?.edgeCases || setupData?.assessmentBoundaries;
  if (hasPedagogyExisting && existingPbSubject?.subjectId) {
    const existingPedSource = await prisma.contentSource.findFirst({
      where: {
        documentType: "COURSE_REFERENCE",
        subjects: { some: { subjectId: existingPbSubject.subjectId } },
      },
    });
    if (!existingPedSource) {
      try {
        const { convertCourseRefToAssertions } = await import("@/lib/content-trust/course-ref-to-assertions");
        const { renderCourseRefMarkdown } = await import("@/lib/content-trust/course-ref-to-markdown");
        const refData = {
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
          // #1545 — route through the shared pedagogy helper. Pre-fix
          // this branch hand-rolled a write block that named three
          // non-existent fields (`status` on ContentSource;
          // `confidence` + `isActive` on ContentAssertion) plus
          // missed the required `slug` — Prisma threw on every run
          // and the outer try/catch logged "non-fatal".
          const { createPedagogyAssertionsFromCourseRef } = await import("../_pedagogy-assertions");
          const result = await createPedagogyAssertionsFromCourseRef({
            courseName: courseName || "Course",
            playbookId: existingPlaybookId,
            subjectId: existingPbSubject.subjectId,
            textSample: renderCourseRefMarkdown(refData),
            assertionRows,
          });
          console.log(`[wizard] Created ${result.assertionCount} pedagogy assertions for existing course`);
        }
      } catch (err) {
        console.error("[wizard] Pedagogy assertion creation (existing) failed (non-fatal):", (err as Error).message);
      }
    } else {
      console.log(`[wizard] Skipping pedagogy source creation — already exists (source ${existingPedSource.id})`);
    }
  }

  // Sync instruction assertions into course identity spec overlay
  const { syncInstructionsToIdentitySpec } = await import("@/lib/content-trust/sync-instructions-to-spec");
  syncInstructionsToIdentitySpec(existingPlaybookId).catch(err =>
    console.error("[wizard] instruction spec sync failed (non-fatal):", err.message));

  // Lesson plan generation removed — scheduler handles pacing

  return {
    ok: true,
    earlyReturn: {
      content: JSON.stringify({
        ok: true,
        playbookId: existingPlaybookId,
        callerId: caller.id,
        callerName,
        existingCourse: true,
      }),
    },
  };
}

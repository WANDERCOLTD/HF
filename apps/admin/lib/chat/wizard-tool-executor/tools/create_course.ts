import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import type { WizardToolExec } from "../_shared/types";
import { applyStudentExperienceConfig } from "../_shared/apply-student-experience";

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
  const { scaffoldDomain } = await import("@/lib/domain/scaffold");
  const { loadPersonaFlowPhases, loadPersonaArchetype, loadPersonaWelcomeTemplate } = await import("@/lib/domain/persona-loaders");
  const { applyBehaviorTargets, behaviorTargetsFromPresets } = await import("@/lib/domain/agent-tuning");
  const { enrollCaller } = await import("@/lib/enrollment");
  const { randomFakeName } = await import("@/lib/fake-names");
  const slugify = (await import("slugify")).default;
  const { generateLessonPlan } = await import("@/lib/content-trust/lesson-planner");

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
  if (existingPlaybookId) {
    const existingPb = await prisma.playbook.findUnique({
      where: { id: existingPlaybookId },
      select: { id: true, domainId: true, config: true },
    });

    if (existingPb) {
      // Apply any config updates the user changed during the wizard
      // Fall back to setupData (wizard data bag) for fields the AI may not repeat in create_course
      const existingConfig = (existingPb.config as Record<string, unknown>) || {};
      const configUpdate: Record<string, unknown> = { ...existingConfig };
      if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
      const teachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
      if (teachingMode) configUpdate.teachingMode = teachingMode;
      if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
      const welcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
      if (welcomeMessage) configUpdate.welcomeMessage = welcomeMessage;
      const sessionCount = input.sessionCount ?? setupData?.sessionCount;
      if (sessionCount) configUpdate.sessionCount = Number(sessionCount);
      const durationMins = input.durationMins ?? setupData?.durationMins;
      if (durationMins) configUpdate.durationMins = Number(durationMins);
      const planEmphasis = (input.planEmphasis as string) || (setupData?.planEmphasis as string);
      if (planEmphasis) configUpdate.planEmphasis = planEmphasis;
      const audience = (input.audience as string) || (setupData?.audience as string);
      if (audience) configUpdate.audience = audience;
      const lessonPlanModel = (input.lessonPlanModel as string) || (setupData?.lessonPlanModel as string);
      if (lessonPlanModel) configUpdate.lessonPlanModel = lessonPlanModel;
      const physicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
      if (physicalMaterials) configUpdate.physicalMaterials = physicalMaterials;
      const courseContext = (input.courseContext as string) || (setupData?.courseContext as string);
      if (courseContext) configUpdate.courseContext = courseContext;
      const constraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
      if (constraints) configUpdate.constraints = constraints;

      // #253: progressionMode — wizard's mandatory choice between
      // AI-led teaching (scheduler picks each call) and learner-picks
      // (picker shows authored modules). Maps to PlaybookConfig.modulesAuthored.
      const progressionMode =
        (input.progressionMode as string) || (setupData?.progressionMode as string);
      if (progressionMode === "learner-picks") {
        configUpdate.modulesAuthored = true;
      } else if (progressionMode === "ai-led") {
        configUpdate.modulesAuthored = false;
      }

      // #167 — Carry through pedagogy detected from an uploaded course
      // reference. These values override the system defaults:
      //   - lessonPlanMode: "continuous" means the scheduler decides
      //     per call and we skip carving fixed sessions.
      //   - cadenceMinutesPerCall: overrides durationMins.
      //   - suggestedSessionCount: overrides sessionCount when set.
      const pedagogy = setupData?.coursePedagogy as {
        lessonPlanMode?: "structured" | "continuous" | null;
        cadenceMinutesPerCall?: number | null;
        suggestedSessionCount?: number | null;
      } | undefined;
      if (pedagogy?.lessonPlanMode) {
        configUpdate.lessonPlanMode = pedagogy.lessonPlanMode;
      }
      if (pedagogy?.cadenceMinutesPerCall && !durationMins) {
        configUpdate.durationMins = pedagogy.cadenceMinutesPerCall;
      }
      if (pedagogy?.suggestedSessionCount && !sessionCount) {
        configUpdate.sessionCount = pedagogy.suggestedSessionCount;
      }

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

      // #607 follow-on (2026-05-23) — the new-course branch's step 4b
      // calls `unlinkNonPrimaryPlaybookSubjects()` to enforce "exactly
      // one PlaybookSubject per playbook" (invariant I9 in
      // docs/ENTITIES.md). The reuse branch above NEVER touched
      // PlaybookSubject, so if a prior partial create_course (or a
      // quick-launch/analyze run that crashed before reaching step 4b)
      // left a non-primary Subject linked, the cleanup never fired.
      //
      // The IELTS V1.0 case (2026-05-23): the playbook had two
      // PlaybookSubjects after a pre-flight-aborted retry —
      // "<courseName>" (from quick-launch/analyze) plus "ESOL" (the
      // course-scoped one). Audit caught it; this branch now unlinks
      // the non-primary subject(s) on every reuse so the invariant
      // holds end-to-end.
      //
      // Look up the course-scoped Subject (slug =
      // {domain.slug}-{slug(courseName)}-{disciplineSlug}) and unlink
      // every other PlaybookSubject row for this playbook. Skip the
      // cleanup safely when the course-scoped Subject doesn't exist
      // yet — better to leave the playbook with a possibly-wrong
      // subject than to unlink everything and orphan the prompt
      // composer.
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
          content: JSON.stringify({
            ok: true,
            playbookId: existingPlaybookId,
            callerId: existingCallerId,
            existingCourse: true,
          }),
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
              const { createPedagogyAssertionsFromCourseRef } = await import("./_pedagogy-assertions");
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
        content: JSON.stringify({
          ok: true,
          playbookId: existingPlaybookId,
          callerId: caller.id,
          callerName,
          existingCourse: true,
        }),
      };
    }
    // Playbook was deleted — fall through to normal creation
  }

  // 1. Create or find Subject (course-scoped slug to prevent content bleeding)
  //    Each course gets its own subject even if the discipline name is the same.
  //    e.g. "abacus-academy-pw-secret-garden-1005-english-language"
  const domainRow = await prisma.domain.findUnique({ where: { id: domainId }, select: { slug: true } });
  const courseSlug = slugify(courseName, { lower: true, strict: true });
  const disciplineSlug = slugify(subjectDiscipline, { lower: true, strict: true });
  const subjectSlug = `${domainRow!.slug}-${courseSlug}-${disciplineSlug}`;
  // Subject.slug is @unique — findUnique reflects the schema invariant.
  let subject = await prisma.subject.findUnique({ where: { slug: subjectSlug } });
  if (!subject) {
    const { suggestTeachingProfile } = await import("@/lib/content-trust/teaching-profiles");
    subject = await prisma.subject.create({
      data: {
        slug: subjectSlug,
        name: subjectDiscipline,
        isActive: true,
        teachingProfile: suggestTeachingProfile(subjectDiscipline),
      },
    });
  }

  // 2. Link Subject → Domain
  const existingSubjectLink = await prisma.subjectDomain.findFirst({
    where: { subjectId: subject.id, domainId },
  });
  if (!existingSubjectLink) {
    await prisma.subjectDomain.create({
      data: { subjectId: subject.id, domainId },
    });
  }

  // 3. Dedup guard: if a playbook with the same name already exists in this domain,
  //    treat it as the existing course (prevents duplicates from AI retries)
  const existingDupe = await prisma.playbook.findFirst({
    where: {
      domainId,
      name: { equals: courseName, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existingDupe) {
    console.log(`[wizard-tools] create_course: playbook "${courseName}" already exists in domain ${domainId} — reusing ${existingDupe.id}`);
    // Re-enter the existing-course path by setting existingPlaybookId
    // and recursing through the same tool (setupData is immutable here,
    // so we call ourselves with the draftPlaybookId patched in).
    return execute(
      input,
      userId,
      { ...setupData, draftPlaybookId: existingDupe.id },
    );
  }

  // 4. Resolve archetype + flow phases from interaction pattern
  const archetypeSlug = await loadPersonaArchetype(interactionPattern);
  const flowPhases = await loadPersonaFlowPhases(interactionPattern);

  // 5. Scaffold domain (identity spec + playbook + system specs + publish + onboarding)
  const groupId = (input.groupId as string) || (setupData?.groupId as string) || undefined;
  const scaffoldResult = await scaffoldDomain(domainId, {
    extendsAgent: archetypeSlug || undefined,
    flowPhases: flowPhases || undefined,
    forceNewPlaybook: true,
    playbookName: courseName,
    groupId,
  });

  if (!scaffoldResult.playbook) {
    throw new Error("Scaffold failed to create playbook");
  }

  const playbookId = scaffoldResult.playbook.id;

  // 4b. Link primary subject to playbook (step 7 only links pack subjects)
  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId, subjectId: subject.id } },
    update: {},
    create: { playbookId, subjectId: subject.id },
  });

  // Remove any placeholder PlaybookSubjects accumulated on this playbook
  // from earlier wizard turns (e.g. a Subject named "Course" created when
  // subjectDiscipline fell back to courseName). See #207.
  //
  // Then enforce the single-primary-subject invariant — quick-launch/analyze
  // (or any other upstream caller) may have linked a domain-level Subject
  // with a different (non-placeholder) name that we must displace so the
  // composed prompt doesn't render two CONTENT AUTHORITY sections. See #607.
  const { removePlaceholderPlaybookSubjects, unlinkNonPrimaryPlaybookSubjects } = await import(
    "@/lib/knowledge/cleanup-placeholder-subjects"
  );
  await removePlaceholderPlaybookSubjects(playbookId, subject.id);
  const unlink = await unlinkNonPrimaryPlaybookSubjects(playbookId, subject.id);
  if (unlink.removed > 0) {
    console.log(
      `[wizard-tools] create_course: displaced ${unlink.removed} non-primary PlaybookSubject(s) on playbook ${playbookId}: ${unlink.displaced
        .map((d) => `"${d.subjectName}"`)
        .join(", ")}`,
    );
  }

  // Dual-write: sync PlaybookSource from primary subject
  // Skip when uploadSourceIds provided — Phase 5 (step 7c) creates PlaybookSource
  // directly, and syncPlaybookSources would pull in ALL sources for this subject.
  if (!uploadSourceIds?.length) {
    const { syncPlaybookSources } = await import("@/lib/knowledge/domain-sources");
    await syncPlaybookSources(playbookId, subject.id);
  }

  // 5. Store config in playbook
  // Fall back to setupData (wizard data bag) for fields the AI may not repeat in create_course
  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  const existingConfig = (pb?.config as Record<string, unknown>) || {};
  const configUpdate: Record<string, unknown> = { ...existingConfig };
  if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
  const newTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
  if (newTeachingMode) configUpdate.teachingMode = newTeachingMode;
  if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
  const newWelcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
  if (newWelcomeMessage) configUpdate.welcomeMessage = newWelcomeMessage;
  const newSessionCount = input.sessionCount ?? setupData?.sessionCount;
  if (newSessionCount) configUpdate.sessionCount = Number(newSessionCount);
  const newDurationMins = input.durationMins ?? setupData?.durationMins;
  if (newDurationMins) configUpdate.durationMins = Number(newDurationMins);
  const newPlanEmphasis = (input.planEmphasis as string) || (setupData?.planEmphasis as string);
  if (newPlanEmphasis) configUpdate.planEmphasis = newPlanEmphasis;
  const newAudience = (input.audience as string) || (setupData?.audience as string);
  if (newAudience) configUpdate.audience = newAudience;
  const newLessonPlanModel = (input.lessonPlanModel as string) || (setupData?.lessonPlanModel as string);
  if (newLessonPlanModel) configUpdate.lessonPlanModel = newLessonPlanModel;

  // #253 follow-up: progressionMode → modulesAuthored mirror.
  // The existing-path branch above (line ~796) already does this, but
  // the new-path branch was missing it — net effect: brand-new courses
  // landed with modulesAuthored=null, surfacing a "Mode not set" pill on
  // the course page even when the wizard had collected a clear answer.
  const newProgressionMode =
    (input.progressionMode as string) || (setupData?.progressionMode as string);
  if (newProgressionMode === "learner-picks") {
    configUpdate.modulesAuthored = true;
  } else if (newProgressionMode === "ai-led") {
    configUpdate.modulesAuthored = false;
  }
  const newPhysicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
  if (newPhysicalMaterials) configUpdate.physicalMaterials = newPhysicalMaterials;
  const newCourseContext = (input.courseContext as string) || (setupData?.courseContext as string);
  if (newCourseContext) configUpdate.courseContext = newCourseContext;
  const newConstraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
  if (newConstraints) configUpdate.constraints = newConstraints;
  // #167 — Carry through pedagogy detected from an uploaded course
  // reference. Mirrors the existing-playbook path above.
  const newPedagogy = setupData?.coursePedagogy as {
    lessonPlanMode?: "structured" | "continuous" | null;
    cadenceMinutesPerCall?: number | null;
    suggestedSessionCount?: number | null;
  } | undefined;
  if (newPedagogy?.lessonPlanMode) {
    configUpdate.lessonPlanMode = newPedagogy.lessonPlanMode;
  }
  if (newPedagogy?.cadenceMinutesPerCall && !newDurationMins) {
    configUpdate.durationMins = newPedagogy.cadenceMinutesPerCall;
  }
  if (newPedagogy?.suggestedSessionCount && !newSessionCount) {
    configUpdate.sessionCount = newPedagogy.suggestedSessionCount;
  }

  // Map assessment targets into goal templates
  if (input.assessmentTargets) {
    const existingGoals = (configUpdate.goals as any[]) || [];
    const newAssessmentGoals = (input.assessmentTargets as string[]).map((t: string) => ({
      type: "ACHIEVE",
      name: t,
      isAssessmentTarget: true,
      isDefault: true,
      priority: 8,
    }));
    configUpdate.goals = [
      ...existingGoals.filter((g: any) => !g.isAssessmentTarget),
      ...newAssessmentGoals,
    ];
  }
  // Map learning outcomes into LEARN goals (from wizard or setupData).
  // #447 — guarded against AI returning rubric calibration prose (band
  // descriptors, tier-name lines) as "learning outcomes". The wizard's
  // bare LEARN templates carry no `ref` and no `sourceContentId`, so
  // applyProjection() can't diff them away. The guard runs the AI list
  // through a regex filter + a soft gate that defers entirely to
  // projection when OUT-NN templates already exist on the playbook.
  const learningOutcomes = (input.learningOutcomes as string[])
    || (setupData?.learningOutcomes as string[]);
  if (learningOutcomes && learningOutcomes.length > 0) {
    const existingGoals = (configUpdate.goals as any[]) || [];
    const { guardAILearningOutcomes } = await import("@/lib/chat/wizard-ai-output-guard");
    const guard = guardAILearningOutcomes(learningOutcomes, existingGoals);

    for (const dropped of guard.filtered) {
      console.warn(
        `[wizard:guard] dropped LO "${dropped.value.slice(0, 80)}" — matches rubric pattern ${dropped.pattern}`,
      );
    }
    if (guard.skippedByGate) {
      console.log(
        `[wizard:guard] skipped AI learning-outcome extraction — ${guard.gateReason}`,
      );
    }

    if (guard.accepted.length > 0) {
      const existingNames = new Set(existingGoals.map((g: any) => g.name?.toLowerCase().trim()));
      const newLOGoals = guard.accepted
        .filter((lo: string) => !existingNames.has(lo.toLowerCase().trim()))
        .map((lo: string) => ({
          type: "LEARN",
          name: lo,
          isDefault: true,
          priority: 5,
        }));
      if (newLOGoals.length > 0) {
        configUpdate.goals = [...existingGoals, ...newLOGoals];
      }
    }
  }

  // Student experience config — welcome + sessionFlow.intake mirror + nps
  applyStudentExperienceConfig(
    setupData as Record<string, unknown> | undefined,
    configUpdate,
    "create_course (new path)",
    playbookId,
  );

  // #826 — central helper, skipTimestamp: true because this is
  // create_course NEW path — the playbook was created in the same
  // wizard step and has no enrolled callers yet, so no downstream
  // staleness to mark.
  await updatePlaybookConfig(
    playbookId,
    () => configUpdate,
    { skipTimestamp: true, reason: "wizard create_course (new path)" },
  );

  // 6. Link Subject → Playbook
  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId, subjectId: subject.id } },
    update: {},
    create: { playbookId, subjectId: subject.id },
  });

  // Dual-write: sync PlaybookSource from primary subject (idempotent if already done at 4b)
  // Skip when uploadSourceIds provided — Phase 5 (step 7c) handles it.
  if (!uploadSourceIds?.length) {
    const { syncPlaybookSources: syncStep6 } = await import("@/lib/knowledge/domain-sources");
    await syncStep6(playbookId, subject.id);
  }

  // 6b. Create per-course identity spec overlay
  //     Extends the domain identity spec so course-specific teaching rules
  //     are scoped to this course and don't bleed into other courses.
  const domainForSpec = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { onboardingIdentitySpecId: true },
  });
  if (domainForSpec?.onboardingIdentitySpecId) {
    const domainSpec = await prisma.analysisSpec.findUnique({
      where: { id: domainForSpec.onboardingIdentitySpecId },
      select: { slug: true },
    });
    if (domainSpec) {
      const courseIdentitySlug = `${slugify(courseName, { lower: true, strict: true })}-identity`;
      // #829 — CREATE-only upsert. `update: {}` is a no-op so no
      // compose-affecting mutation can land here, and the brand-
      // new spec has no enrolled callers. The linking Playbook
      // write that happens in the same wizard step is what marks
      // downstream callers stale once they exist. No helper bump
      // required at this site.
      const courseIdentity = await prisma.analysisSpec.upsert({
        where: { slug: courseIdentitySlug },
        update: {},
        create: {
          slug: courseIdentitySlug,
          name: `${courseName} Identity`,
          description: `Course overlay for ${courseName} — extends domain identity with course-specific teaching rules.`,
          outputType: "COMPOSE",
          specRole: "IDENTITY",
          specType: "DOMAIN",
          scope: "DOMAIN",
          domain: "identity",
          isActive: true,
          isDirty: false,
          isDeletable: true,
          extendsAgent: domainSpec.slug,
          config: { parameters: [] },
        },
      });
      // Link at sortOrder -1 so resolveSpecs picks it before domain overlay (sortOrder 0)
      const existingLink = await prisma.playbookItem.findFirst({
        where: { playbookId, specId: courseIdentity.id },
      });
      if (!existingLink) {
        await prisma.playbookItem.create({
          data: {
            playbookId,
            itemType: "SPEC",
            specId: courseIdentity.id,
            sortOrder: -1,
            isEnabled: true,
          },
        });
      }
    }
  }

  // 7. Link content-upload subjects from PackUploadStep (if any)
  //    Only link subjects explicitly passed via packSubjectIds (from the upload step).
  //    No domain-wide fallback — that caused content from other courses on the
  //    same domain to bleed into new courses.
  const subjectIdsToLink = (packSubjectIds ?? [])
    .filter(id => id !== subject.id); // primary subject already linked at step 4b
  for (const packSubId of subjectIdsToLink) {
    await prisma.playbookSubject.upsert({
      where: { playbookId_subjectId: { playbookId, subjectId: packSubId } },
      update: {},
      create: { playbookId, subjectId: packSubId },
    });
    // Dual-write: sync PlaybookSource from pack subject
    // Skip when uploadSourceIds provided — Phase 5 (step 7c) handles it.
    if (!uploadSourceIds?.length) {
      const { syncPlaybookSources: syncPackSub } = await import("@/lib/knowledge/domain-sources");
      await syncPackSub(playbookId, packSubId);
    }

    const domainLink = await prisma.subjectDomain.findFirst({
      where: { subjectId: packSubId, domainId },
    });
    if (!domainLink) {
      await prisma.subjectDomain.create({
        data: { subjectId: packSubId, domainId },
      });
    }
  }

  // 7b. Bridge COURSE_REFERENCE sources to the primary subject.
  //     LEGACY: Ingest now puts all docs (including pedagogy) on the primary subject.
  //     Kept for backward compatibility with courses that have fragmented subjects.
  //     Skip when uploadSourceIds provided — Phase 5 (step 7c) handles all sources directly.
  if (!uploadSourceIds?.length) {
    for (const packSubId of subjectIdsToLink) {
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
            where: { subjectId: subject.id, sourceId: ps.sourceId },
          });
          if (!existingLink) {
            await prisma.subjectSource.create({
              data: { subjectId: subject.id, sourceId: ps.sourceId },
            });
          }
          // Dual-write: PlaybookSource for bridged source
          const { upsertPlaybookSource: upsertBridgeNew } = await import("@/lib/knowledge/domain-sources");
          await upsertBridgeNew(playbookId, ps.sourceId);
        }
      }
    }
  }

  // 7c. Direct PlaybookSource creation from uploadSourceIds (Phase 5)
  //     When ingest provides sourceIds directly, create PlaybookSource without
  //     needing the Subject → SubjectSource chain.
  if (uploadSourceIds?.length) {
    // Pre-flight FK race guard (incident 2026-05-19, course e5f379ed).
    const { preflightPlaybookSourceIds, upsertPlaybookSource } =
      await import("@/lib/knowledge/domain-sources");
    await preflightPlaybookSourceIds(uploadSourceIds);
    for (const srcId of uploadSourceIds) {
      await upsertPlaybookSource(playbookId, srcId);
    }
  }

  // 7d. COURSE_REFERENCE projection (#338) — derive CurriculumModule,
  //     BehaviorTargets, Parameters, and Goal templates from any linked
  //     COURSE_REFERENCE source. Race-safe (skips sources whose
  //     extraction isn't ready), best-effort (does not fail
  //     create_course on projection errors — the projection can be
  //     re-run later from a re-process button). See
  //     docs/CONTENT-PIPELINE.md §4 Phase 2.5.
  try {
    const { runProjectionForPlaybook } = await import("@/lib/wizard/run-projection-for-playbook");
    await runProjectionForPlaybook(playbookId);
  } catch (err) {
    console.error(
      `[projection] create_course: projection failed for playbook=${playbookId} — course still created. Error:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 8. Configure onboarding (welcome message + behavior targets)
  const resolvedWelcome = (input.welcomeMessage as string)
    || await loadPersonaWelcomeTemplate(interactionPattern)
    || null;

  const domainUpdate: Record<string, unknown> = {};
  if (resolvedWelcome) domainUpdate.onboardingWelcome = resolvedWelcome;

  const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
  const personalityPreset = input.personalityPreset as string | undefined;
  const resolvedTargets =
    (behaviorTargets && Object.keys(behaviorTargets).length > 0)
      ? behaviorTargets
      : personalityPreset
        ? behaviorTargetsFromPresets(personalityPreset)
        : undefined;
  if (resolvedTargets && Object.keys(resolvedTargets).length > 0) {
    const wrapped: Record<string, { value: number; confidence: number }> = {};
    for (const [paramId, value] of Object.entries(resolvedTargets)) {
      wrapped[paramId] = { value, confidence: 0.5 };
    }
    domainUpdate.onboardingDefaultTargets = wrapped;
    await applyBehaviorTargets(playbookId, resolvedTargets);
  }

  if (Object.keys(domainUpdate).length > 0) {
    await prisma.domain.update({ where: { id: domainId }, data: domainUpdate });
  }

  // 8b. Wire student-visible media into onboarding flow phases
  //     So the AI proactively shares materials during the first call,
  //     and the educator can see/edit attachments in the First Call Preview.
  const allSubjectIds = [subject.id, ...subjectIdsToLink];
  const { isStudentVisibleDefault } = await import("@/lib/doc-type-icons");
  const studentMedia = await prisma.subjectMedia.findMany({
    where: { subjectId: { in: allSubjectIds } },
    include: {
      media: {
        select: {
          id: true, fileName: true, title: true, mimeType: true,
          source: { select: { documentType: true } },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
    take: 20,
  });
  const visibleMedia = studentMedia.filter(
    (sm) => sm.media.source?.documentType && isStudentVisibleDefault(sm.media.source.documentType),
  );

  // Build a lookup for filenames (used later in result)
  const mediaLookup = new Map<string, { fileName: string; title: string | null }>();
  for (const sm of visibleMedia) {
    mediaLookup.set(sm.media.id, { fileName: sm.media.fileName, title: sm.media.title });
  }

  let finalFlowPhases: any = null;
  if (visibleMedia.length > 0) {
    const domainRow = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { onboardingFlowPhases: true },
    });
    const flowConfig = domainRow?.onboardingFlowPhases as { phases?: Array<{ phase: string; duration: string; goals: string[]; content?: Array<{ mediaId: string; instruction?: string }> }> } | null;
    if (flowConfig?.phases?.length) {
      // Find the first content-bearing phase by name. Widened from the
      // previous regex (topic|teach|content|practice|reading) which
      // failed for domains whose phase names use other vocabulary
      // (welcome / orient / discover / sample / close — the IELTS
      // domain), causing the fallback to dump all media into
      // phase[0] (welcome) with identical placeholder instructions.
      const contentIdx = flowConfig.phases.findIndex(
        (p) =>
          /topic|teach|content|practice|reading|discover|sample|share|present|introduce|explore/i.test(
            p.phase,
          ),
      );

      if (contentIdx < 0) {
        // No content-bearing phase. Skip media attachment rather than
        // dumping into phase[0] (typically "welcome" — a greeting,
        // not a content slot). The operator can attach manually if
        // they want, and the warning surfaces the missing phase
        // pattern in production traces.
        console.warn(
          `[wizard-tools] create_course: no content phase found in onboarding flow ` +
            `(phases: ${flowConfig.phases.map((p) => p.phase).join(", ")}); ` +
            `skipping media attachment for ${visibleMedia.length} item(s).`,
        );
      } else {
        const updatedPhases = flowConfig.phases.map((phase, i) => {
          if (i !== contentIdx) return phase;
          return {
            ...phase,
            content: visibleMedia.map((sm) => ({
              mediaId: sm.media.id,
              // Empty instruction — operator fills in something
              // specific per media. Previously hardcoded
              // "Share this with the learner when introducing the topic"
              // for every row, which produced visually-duplicate UI
              // rows that confused educators.
              instruction: "",
            })),
          };
        });
        finalFlowPhases = { phases: updatedPhases };
        // #828 — central helper; fans staleness to all playbooks in domain.
        await updateDomainConfig(
          domainId,
          (d) => ({ ...d, onboardingFlowPhases: finalFlowPhases }),
          { reason: "wizard create_course — onboardingFlowPhases" },
        );
      }
    }
  }

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

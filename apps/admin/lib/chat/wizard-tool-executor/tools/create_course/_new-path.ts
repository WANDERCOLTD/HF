/**
 * Stage 5 (+ folded Stage 6) of `create_course` — fresh-scaffold branch.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. Owns Subject
 * create, dedup-by-name (recurses through reuse path), `scaffoldDomain`,
 * #207 placeholder unlink + #607 single-primary-subject invariant, config
 * persistence (`_new-config-merge.ts`), course identity spec overlay,
 * pack-subject linking + #385 COURSE_REFERENCE bridge + #492 Phase 5,
 * #338 projection, onboarding welcome + behavior targets (Stage 6 fold),
 * and student-visible media attachment to onboarding flow phases.
 *
 * Returns `{ ok: true, state }` on success or `{ ok: false, recurse }`
 * when dedup hits and the orchestrator must re-enter `execute` with
 * `draftPlaybookId` so Stage 4 takes over. Dispatcher pin "create_course
 * (new path — #607 invariant)" added in this PR per #1544 AC.
 */

import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { updateDomainConfig } from "@/lib/domain/update-domain-config";
import { applyStudentExperienceConfig } from "../../_shared/apply-student-experience";
import type { ResolvedCreateCourseContext } from "./_context";
import { buildNewConfigUpdate } from "./_new-config-merge";

export interface NewPathState {
  playbookId: string;
  subjectId: string;
  subjectIdsToLink: string[];
  resolvedWelcome: string | null;
  mediaLookup: Map<string, { fileName: string; title: string | null }>;
  /** Resolved onboarding flow phases (after media attachment, if any). */
  finalFlowPhases: { phases: Array<Record<string, unknown>> } | null;
}

export type NewPathResult =
  | { ok: true; state: NewPathState }
  | { ok: false; recurse: { setupData: Record<string, unknown> } };

export async function newCourseScaffoldPath(
  ctx: ResolvedCreateCourseContext,
): Promise<NewPathResult> {
  const {
    input,
    setupData,
    domainId,
    subjectDiscipline,
    courseName,
    interactionPattern,
    packSubjectIds,
    uploadSourceIds,
  } = ctx;
  const { prisma } = await import("@/lib/prisma");
  const slugify = (await import("slugify")).default;

  // 1. Create or find Subject (course-scoped slug to prevent content bleeding)
  //    Each course gets its own subject even if the discipline name is the same.
  //    e.g. "abacus-academy-pw-secret-garden-1005-english-language"
  const domainRow = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { slug: true },
  });
  const courseSlug = slugify(courseName, { lower: true, strict: true });
  const disciplineSlug = slugify(subjectDiscipline, { lower: true, strict: true });
  const subjectSlug = `${domainRow!.slug}-${courseSlug}-${disciplineSlug}`;
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
    await prisma.subjectDomain.create({ data: { subjectId: subject.id, domainId } });
  }

  // 3. Dedup guard — if a playbook with the same name already exists in this
  // domain, signal the orchestrator to re-enter `execute` with draftPlaybookId
  // patched so the reuse-path branch (Stage 4) takes over.
  const existingDupe = await prisma.playbook.findFirst({
    where: { domainId, name: { equals: courseName, mode: "insensitive" } },
    select: { id: true },
  });
  if (existingDupe) {
    console.log(`[wizard-tools] create_course: playbook "${courseName}" already exists in domain ${domainId} — reusing ${existingDupe.id}`);
    return {
      ok: false,
      recurse: { setupData: { ...setupData, draftPlaybookId: existingDupe.id } },
    };
  }

  // 4. Resolve archetype + flow phases from interaction pattern
  const { loadPersonaFlowPhases, loadPersonaArchetype, loadPersonaWelcomeTemplate } =
    await import("@/lib/domain/persona-loaders");
  const { scaffoldDomain } = await import("@/lib/domain/scaffold");
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
  if (!scaffoldResult.playbook) throw new Error("Scaffold failed to create playbook");
  const playbookId = scaffoldResult.playbook.id;

  // 4b. Link primary subject to playbook, then enforce #207 + #607 invariants.
  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId, subjectId: subject.id } },
    update: {},
    create: { playbookId, subjectId: subject.id },
  });
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

  // Dual-write: sync PlaybookSource from primary subject. Skip when
  // uploadSourceIds provided — Phase 5 (step 7c) handles it directly.
  if (!uploadSourceIds?.length) {
    const { syncPlaybookSources } = await import("@/lib/knowledge/domain-sources");
    await syncPlaybookSources(playbookId, subject.id);
  }

  // 5. Build merged config (see _new-config-merge.ts) and persist.
  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  const existingConfig = (pb?.config as Record<string, unknown>) || {};
  const { configUpdate } = await buildNewConfigUpdate({ existingConfig, ctx });

  // Student experience config — welcome + sessionFlow.intake mirror + nps
  applyStudentExperienceConfig(
    setupData as Record<string, unknown> | undefined,
    configUpdate,
    "create_course (new path)",
    playbookId,
  );

  // #826 — central helper, skipTimestamp: true because the playbook was
  // created in the same wizard step and has no enrolled callers yet.
  await updatePlaybookConfig(
    playbookId,
    () => configUpdate,
    { skipTimestamp: true, reason: "wizard create_course (new path)" },
  );

  // 6. Link Subject → Playbook (idempotent re-call of 4b).
  await prisma.playbookSubject.upsert({
    where: { playbookId_subjectId: { playbookId, subjectId: subject.id } },
    update: {},
    create: { playbookId, subjectId: subject.id },
  });
  if (!uploadSourceIds?.length) {
    const { syncPlaybookSources: syncStep6 } = await import("@/lib/knowledge/domain-sources");
    await syncStep6(playbookId, subject.id);
  }

  // 6b. Per-course identity spec overlay (extends domain identity).
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
      // #829 — CREATE-only upsert. No compose-affecting mutation can land here.
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
          data: { playbookId, itemType: "SPEC", specId: courseIdentity.id, sortOrder: -1, isEnabled: true },
        });
      }
    }
  }

  // 7. Link content-upload subjects from PackUploadStep.
  const subjectIdsToLink = (packSubjectIds ?? []).filter((id) => id !== subject!.id);
  for (const packSubId of subjectIdsToLink) {
    await prisma.playbookSubject.upsert({
      where: { playbookId_subjectId: { playbookId, subjectId: packSubId } },
      update: {},
      create: { playbookId, subjectId: packSubId },
    });
    if (!uploadSourceIds?.length) {
      const { syncPlaybookSources: syncPackSub } = await import("@/lib/knowledge/domain-sources");
      await syncPackSub(playbookId, packSubId);
    }
    const domainLink = await prisma.subjectDomain.findFirst({
      where: { subjectId: packSubId, domainId },
    });
    if (!domainLink) {
      await prisma.subjectDomain.create({ data: { subjectId: packSubId, domainId } });
    }
  }

  // 7b. Bridge COURSE_REFERENCE sources to the primary subject (legacy path).
  //     Skip when uploadSourceIds provided — Phase 5 (step 7c) handles it.
  if (!uploadSourceIds?.length) {
    for (const packSubId of subjectIdsToLink) {
      const packSources = await prisma.subjectSource.findMany({
        where: { subjectId: packSubId },
        select: { sourceId: true, source: { select: { documentType: true } } },
      });
      for (const ps of packSources) {
        // #385 Slice 1 Phase 3 — bridge all four COURSE_REFERENCE* values + POLICY_DOCUMENT.
        if (
          ps.source.documentType === "COURSE_REFERENCE" ||
          ps.source.documentType === "COURSE_REFERENCE_CANONICAL" ||
          ps.source.documentType === "COURSE_REFERENCE_TUTOR_BRIEFING" ||
          ps.source.documentType === "COURSE_REFERENCE_ASSESSOR_RUBRIC" ||
          ps.source.documentType === "POLICY_DOCUMENT"
        ) {
          const existingBridgeLink = await prisma.subjectSource.findFirst({
            where: { subjectId: subject!.id, sourceId: ps.sourceId },
          });
          if (!existingBridgeLink) {
            await prisma.subjectSource.create({
              data: { subjectId: subject!.id, sourceId: ps.sourceId },
            });
          }
          const { upsertPlaybookSource: upsertBridgeNew } = await import("@/lib/knowledge/domain-sources");
          await upsertBridgeNew(playbookId, ps.sourceId);
        }
      }
    }
  }

  // 7c. Direct PlaybookSource creation from uploadSourceIds (#492 Phase 5).
  if (uploadSourceIds?.length) {
    const { preflightPlaybookSourceIds, upsertPlaybookSource } =
      await import("@/lib/knowledge/domain-sources");
    await preflightPlaybookSourceIds(uploadSourceIds);
    for (const srcId of uploadSourceIds) {
      await upsertPlaybookSource(playbookId, srcId);
    }
  }

  // 7d. COURSE_REFERENCE projection (#338) — derive CurriculumModule,
  //     BehaviorTargets, Parameters, Goal templates. Race-safe + best-effort.
  try {
    const { runProjectionForPlaybook } = await import("@/lib/wizard/run-projection-for-playbook");
    await runProjectionForPlaybook(playbookId);
  } catch (err) {
    console.error(
      `[projection] create_course: projection failed for playbook=${playbookId} — course still created. Error:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 8. Configure onboarding (welcome + behavior targets — Stage 6 folded in)
  const resolvedWelcome = (input.welcomeMessage as string)
    || await loadPersonaWelcomeTemplate(interactionPattern)
    || null;
  const domainUpdate: Record<string, unknown> = {};
  if (resolvedWelcome) domainUpdate.onboardingWelcome = resolvedWelcome;

  const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
  const personalityPreset = input.personalityPreset as string | undefined;
  const { applyBehaviorTargets, behaviorTargetsFromPresets } =
    await import("@/lib/domain/agent-tuning");
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

  // 8b. Wire student-visible media into onboarding flow phases.
  const allSubjectIds = [subject!.id, ...subjectIdsToLink];
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
  const mediaLookup = new Map<string, { fileName: string; title: string | null }>();
  for (const sm of visibleMedia) {
    mediaLookup.set(sm.media.id, { fileName: sm.media.fileName, title: sm.media.title });
  }

  let finalFlowPhases: NewPathState["finalFlowPhases"] = null;
  if (visibleMedia.length > 0) {
    const domainRowForPhases = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { onboardingFlowPhases: true },
    });
    const flowConfig = domainRowForPhases?.onboardingFlowPhases as {
      phases?: Array<{ phase: string; duration: string; goals: string[]; content?: Array<{ mediaId: string; instruction?: string }> }>;
    } | null;
    if (flowConfig?.phases?.length) {
      // Widened regex for content-bearing phase names (IELTS uses welcome / orient / discover / sample / close).
      const contentIdx = flowConfig.phases.findIndex(
        (p) => /topic|teach|content|practice|reading|discover|sample|share|present|introduce|explore/i.test(p.phase),
      );
      if (contentIdx < 0) {
        console.warn(
          `[wizard-tools] create_course: no content phase found in onboarding flow ` +
            `(phases: ${flowConfig.phases.map((p) => p.phase).join(", ")}); ` +
            `skipping media attachment for ${visibleMedia.length} item(s).`,
        );
      } else {
        const updatedPhases = flowConfig.phases.map((phase, i) =>
          i !== contentIdx ? phase : {
            ...phase,
            content: visibleMedia.map((sm) => ({ mediaId: sm.media.id, instruction: "" })),
          },
        );
        finalFlowPhases = { phases: updatedPhases as Array<Record<string, unknown>> };
        await updateDomainConfig(
          domainId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (d) => ({ ...d, onboardingFlowPhases: finalFlowPhases as any }),
          { reason: "wizard create_course — onboardingFlowPhases" },
        );
      }
    }
  }

  return {
    ok: true,
    state: {
      playbookId,
      subjectId: subject.id,
      subjectIdsToLink,
      resolvedWelcome,
      mediaLookup,
      finalFlowPhases,
    },
  };
}

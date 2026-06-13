/**
 * Stage 7 of `create_course` — TEACHER + test caller enrollment + cohort.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. Owns the
 * post-scaffold enrollment block: (1) ensure a TEACHER Caller exists for
 * the wizard user (needed for the educator dashboard + cohort ownership),
 * (2) create two test callers — `demo` (skips onboarding) and `caller`
 * (full journey) — both enrolled in the new playbook with their Goals
 * + CallerTarget placeholders instantiated, and (3) create or reuse the
 * "{course} — Test Learners" cohort scoped by playbookId (not name) and
 * link the test callers to it.
 *
 * Behaviour-preserving relative to the pre-#1544 inline block at
 * create_course.ts L591-713 (post-Stage-5 line numbers L80-202). The
 * cohort-by-playbook scoping is the live fix from 2026-05-19 (#1.f) —
 * preserved verbatim here.
 */

import type { ResolvedCreateCourseContext } from "./_context";

export interface EnrollState {
  teacherCallerId: string;
  caller: { id: string };
  callerName: string;
  demoCaller: { id: string } | null;
  demoName: string;
  cohort: { id: string };
  joinToken: string;
}

export async function enrollAndCreateCaller(
  ctx: ResolvedCreateCourseContext & { playbookId: string },
): Promise<EnrollState> {
  const { userId, domainId, courseName, playbookId } = ctx;
  const { prisma } = await import("@/lib/prisma");
  const { enrollCaller } = await import("@/lib/enrollment");
  const { randomFakeName } = await import("@/lib/fake-names");
  const { instantiatePlaybookGoals } = await import("@/lib/enrollment/instantiate-goals");
  const { instantiatePlaybookTargets } = await import("@/lib/enrollment/instantiate-targets");

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
  async function createTestCaller(callerName: string, skipOnboarding: boolean) {
    const c = await prisma.caller.create({
      data: { name: callerName, domainId },
    });
    await enrollCaller(c.id, playbookId, "wizard-v2", undefined,
      { skipAutoCompose: skipOnboarding });

    // Instantiate Goal rows from playbook.config.goals. Re-throw on failure
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
      await applySkipOnboarding(c.id, domainId);

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

  // 9d. Create or reuse "Test Learners" cohort scoped by playbookId (NOT by
  // name). The live fix from 2026-05-19: previously findFirst by
  // (domainId, name) silently reused a sibling course's cohort and
  // inherited its member list. Brand-new playbookId has no CohortPlaybook
  // link yet → findFirst returns null → fresh cohort. Re-runs on the same
  // playbookId find the prior cohort and reuse it.
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

  return {
    teacherCallerId: teacherCaller.id,
    caller,
    callerName,
    demoCaller,
    demoName,
    cohort,
    joinToken,
  };
}

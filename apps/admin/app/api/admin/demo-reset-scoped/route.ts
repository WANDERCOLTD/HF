import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * @api POST /api/admin/demo-reset-scoped
 * @visibility internal
 * @scope admin:write
 * @auth session (SUPERADMIN)
 * @tags admin, data-management, demo
 * @description Scoped demo reset for Abacus Academy. Removes demo-created courses,
 *   callers, and cohorts — leaving seed data (golden-* tagged) intact.
 *   Safe to call between demo runs; institution settings are never touched.
 * @response 200 { ok: true, deleted: { callers: number, playbooks: number, cohorts: number } }
 * @response 403 { ok: false, error: "SUPERADMIN required" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST() {
  try {
    const authResult = await requireAuth("SUPERADMIN");
    if (isAuthError(authResult)) return authResult.error;

    // Find Abacus Academy and its domain
    const institution = await prisma.institution.findUnique({
      where: { slug: "abacus-academy" },
      select: {
        id: true,
        domains: { select: { id: true } },
      },
    });

    if (!institution) {
      return NextResponse.json(
        { ok: false, error: "Abacus Academy not found — run the golden seed first" },
        { status: 404 }
      );
    }

    const domainIds = institution.domains.map((d) => d.id);

    if (domainIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: { callers: 0, playbooks: 0, cohorts: 0 } });
    }

    // ── Delete demo callers (non-golden) in FK-safe order ──────────────
    // Find all demo callers first (externalId not prefixed 'golden-')
    const demoCallers = await prisma.caller.findMany({
      where: {
        domainId: { in: domainIds },
        NOT: { externalId: { startsWith: "golden-" } },
      },
      select: { id: true },
    });
    const demoCallerIds = demoCallers.map((c) => c.id);

    if (demoCallerIds.length > 0) {
      // Delete in FK-safe order (children first)
      await prisma.callerTarget.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerModuleProgress.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerPersonalityProfile.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerMemorySummary.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerMemory.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerPersonality.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.personalityObservation.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.goal.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.onboardingSession.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerCohortMembership.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerPlaybook.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerAttribute.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      await prisma.callerIdentity.deleteMany({ where: { callerId: { in: demoCallerIds } } });
      // Calls and their children
      const demoCalls = await prisma.call.findMany({
        where: { callerId: { in: demoCallerIds } },
        select: { id: true },
      });
      const demoCallIds = demoCalls.map((c) => c.id);
      if (demoCallIds.length > 0) {
        await prisma.callMessage.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.callScore.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.callAction.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.callTarget.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.rewardScore.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.behaviorMeasurement.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.conversationArtifact.deleteMany({ where: { callId: { in: demoCallIds } } });
        await prisma.call.deleteMany({ where: { id: { in: demoCallIds } } });
      }
      await prisma.caller.deleteMany({ where: { id: { in: demoCallerIds } } });
    }

    // ── Delete demo playbooks (keep Year 5 Maths — the only golden one) ──
    const demoPlaybooks = await prisma.playbook.findMany({
      where: {
        domainId: { in: domainIds },
        NOT: { name: "Year 5 Maths" },
      },
      select: { id: true },
    });
    const demoPlaybookIds = demoPlaybooks.map((p) => p.id);

    if (demoPlaybookIds.length > 0) {
      await prisma.cohortPlaybook.deleteMany({ where: { playbookId: { in: demoPlaybookIds } } });
      await prisma.callerPlaybook.deleteMany({ where: { playbookId: { in: demoPlaybookIds } } });
      await prisma.composedPrompt.deleteMany({ where: { playbookId: { in: demoPlaybookIds } } });
      await prisma.playbook.deleteMany({ where: { id: { in: demoPlaybookIds } } });
    }

    // ── Delete demo cohort groups (keep Class 5B — the only golden one) ──
    const demoCohorts = await prisma.cohortGroup.findMany({
      where: {
        domainId: { in: domainIds },
        NOT: { name: "Class 5B" },
      },
      select: { id: true },
    });
    const demoCohortIds = demoCohorts.map((c) => c.id);

    if (demoCohortIds.length > 0) {
      await prisma.callerCohortMembership.deleteMany({ where: { cohortGroupId: { in: demoCohortIds } } });
      await prisma.cohortPlaybook.deleteMany({ where: { cohortGroupId: { in: demoCohortIds } } });
      await prisma.cohortGroup.deleteMany({ where: { id: { in: demoCohortIds } } });
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        callers: demoCallerIds.length,
        playbooks: demoPlaybookIds.length,
        cohorts: demoCohortIds.length,
      },
    });
  } catch (error: any) {
    console.error("Demo scoped reset error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Reset failed" },
      { status: 500 }
    );
  }
}

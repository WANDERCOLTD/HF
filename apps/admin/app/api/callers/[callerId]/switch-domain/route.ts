import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { dropAllActiveEnrollments, resolveAndEnrollSingle } from "@/lib/enrollment";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/**
 * @api POST /api/callers/:callerId/switch-domain
 * @visibility internal
 * @auth session
 * @tags callers, domains
 * @description Switch a caller to a new domain. Archives old goals, creates new goals from the new domain's playbook, and optionally triggers re-onboarding.
 * @pathParam callerId string - The caller ID
 * @body domainId string - The target domain ID (required)
 * @body skipOnboarding boolean - Skip re-onboarding flow (default: false)
 * @response 200 { ok: true, message: string, caller: object, previousDomain: object, newDomain: object, archivedGoalsCount: number, newGoals: string[], onboardingRequired: boolean, onboardingSession: object }
 * @response 400 { ok: false, error: "domainId is required" | "Caller is already in this domain" }
 * @response 404 { ok: false, error: "Caller not found" | "Domain not found" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const body = await req.json();
    const { domainId, skipOnboarding = false } = body;

    if (!domainId) {
      return NextResponse.json(
        { ok: false, error: "domainId is required" },
        { status: 400 }
      );
    }

    // Get current caller state
    const currentCaller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: {
        id: true,
        name: true,
        domainId: true,
        domainSwitchCount: true,
        domain: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    if (!currentCaller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Check if domain is actually changing
    if (currentCaller.domainId === domainId) {
      return NextResponse.json(
        { ok: false, error: "Caller is already in this domain" },
        { status: 400 }
      );
    }

    // Verify new domain exists
    const newDomain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        id: true,
        slug: true,
        name: true,
        onboardingWelcome: true,
        onboardingIdentitySpec: {
          select: { name: true },
        },
      },
    });

    if (!newDomain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // Perform domain switch in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Archive old goals (preserve history)
      const archivedGoals = await tx.goal.updateMany({
        where: {
          callerId,
          status: { in: ["ACTIVE", "PAUSED"] },
        },
        data: { status: "ARCHIVED" },
      });

      // 2. Drop old playbook enrollments
      await dropAllActiveEnrollments(callerId, tx);

      // 3. Update caller with domain switch tracking
      const updatedCaller = await tx.caller.update({
        where: { id: callerId },
        data: {
          domainId,
          previousDomainId: currentCaller.domainId,
          domainSwitchCount: (currentCaller.domainSwitchCount || 0) + 1,
        },
        select: {
          id: true,
          name: true,
          domainId: true,
          previousDomainId: true,
          domainSwitchCount: true,
          domain: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      });

      // 3. Create or reset OnboardingSession for new domain
      const onboardingSession = await tx.onboardingSession.upsert({
        where: {
          callerId_domainId: {
            callerId,
            domainId,
          },
        },
        create: {
          callerId,
          domainId,
          isComplete: skipOnboarding,
          wasSkipped: skipOnboarding,
          discoveredGoals: 0,
          completedAt: skipOnboarding ? new Date() : null,
        },
        update: {
          isComplete: skipOnboarding,
          wasSkipped: skipOnboarding,
          currentPhase: null,
          completedAt: skipOnboarding ? new Date() : null,
        },
      });

      // 4. Find published playbook for new domain
      const playbook = await tx.playbook.findFirst({
        where: {
          domainId,
          status: "PUBLISHED",
        },
        select: {
          id: true,
          name: true,
          config: true,
        },
      });

      // 5. Create new goals from playbook
      const newGoals: string[] = [];
      if (playbook?.config) {
        const config = playbook.config as PlaybookConfig;
        const goals = config.goals || [];

        for (const goalConfig of goals) {
          // Find contentSpec if it's a LEARN goal
          let contentSpecId = null;
          if (goalConfig.type === "LEARN" && goalConfig.contentSpecSlug) {
            const contentSpec = await tx.analysisSpec.findFirst({
              where: {
                slug: {
                  contains: goalConfig.contentSpecSlug
                    .toLowerCase()
                    .replace(/_/g, "-"),
                },
                isActive: true,
              },
              select: { id: true },
            });
            contentSpecId = contentSpec?.id || null;
          }

          // Create goal
          const goal = await tx.goal.create({
            data: {
              callerId,
              playbookId: playbook.id,
              type: goalConfig.type,
              name: goalConfig.name,
              description: goalConfig.description || null,
              contentSpecId,
              status: "ACTIVE",
              priority: goalConfig.priority || 5,
              startedAt: new Date(),
            },
          });

          newGoals.push(goal.name);
        }
      }

      // Enroll in new domain's playbook (auto-selects if single, skips if multiple)
      await resolveAndEnrollSingle(callerId, domainId, "switch-domain", null, tx);

      return {
        caller: updatedCaller,
        archivedGoalsCount: archivedGoals.count,
        newGoalsCount: newGoals.length,
        newGoals,
        onboardingSession,
      };
    });

    console.log(
      `[domain-switch] ${currentCaller.name || callerId} switched from ${currentCaller.domain?.slug} to ${newDomain.slug} (switch #${result.caller.domainSwitchCount})`
    );

    return NextResponse.json({
      ok: true,
      message: `Domain switched from ${currentCaller.domain?.name} to ${newDomain.name}`,
      caller: result.caller,
      previousDomain: currentCaller.domain,
      newDomain: {
        id: newDomain.id,
        slug: newDomain.slug,
        name: newDomain.name,
      },
      archivedGoalsCount: result.archivedGoalsCount,
      newGoals: result.newGoals,
      onboardingRequired: !skipOnboarding,
      onboardingSession: result.onboardingSession,
    });
  } catch (error: any) {
    console.error("Error switching domain:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to switch domain" },
      { status: 500 }
    );
  }
}

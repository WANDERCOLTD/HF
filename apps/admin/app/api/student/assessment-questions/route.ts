/**
 * @api GET /api/student/assessment-questions
 * @visibility internal
 * @scope student:read
 * @auth session (STUDENT | OPERATOR+)
 * @tags student, assessment
 * @description Returns pre-test or post-test questions for the authenticated student.
 *   Pre-test sources MCQ questions from the enrolled curriculum's content. When
 *   the learner has picked a specific authored module via the picker (#302), the
 *   pre-test pool is restricted to MCQs whose `learningOutcomeRef` is in that
 *   module's `outcomesPrimary`. The lock is read from `Call.requestedModuleId`
 *   on the caller's most recent call. Falls back to the full course pool with a
 *   warning when no MCQ matches the lock.
 *   Post-test mirrors the exact pre-test questions (knowledge courses) or queries
 *   POST_TEST-tagged comprehension MCQs directly (comprehension courses).
 * @query type — "pre_test" | "post_test"
 * @query callerId — required for OPERATOR+ (admin viewing student)
 * @response 200 { ok, questions: SurveyStepConfig[], questionIds: string[], skipped: boolean, skipReason?: string }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { buildPreTest, buildPreTestForPlaybook, buildPostTest, buildComprehensionPostTest } from "@/lib/assessment/pre-test-builder";
import type { AuthoredModule } from "@/lib/types/json-fields";
import { PlaybookCurriculumRole } from "@prisma/client";

const VALID_TYPES = new Set(["pre_test", "post_test"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const type = request.nextUrl.searchParams.get("type");
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing type parameter. Must be 'pre_test' or 'post_test'." },
      { status: 400 },
    );
  }

  const { callerId } = auth;

  // Resolve enrollment + teaching profile for post-test comprehension detection
  if (type === "post_test") {
    // #1167 — pick the learner's PRIMARY enrollment when they have multiple
    // ACTIVE Playbooks. Without orderBy, Prisma returns whichever row hits
    // the natural index first — for Emma Richardson (enrolled in CIO/CTO
    // Standard as default + Psychology as legacy), this was Psychology,
    // routing the post-test through the wrong course's content.
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { enrolledAt: "desc" }],
      select: {
        playbookId: true,
        playbook: {
          select: {
            subjects: {
              select: {
                subject: {
                  select: { teachingProfile: true },
                },
              },
              take: 1,
            },
          },
        },
      },
    });

    const teachingProfile = enrollment?.playbook?.subjects?.[0]?.subject?.teachingProfile;
    const isComprehension = teachingProfile === "comprehension-led";

    // Post-test: comprehension → direct query; others → mirror pre-test
    if (isComprehension && enrollment?.playbookId) {
      // #1067 — pass callerId as the shuffle seed.
      const result = await buildComprehensionPostTest(enrollment.playbookId, {
        callerSeed: callerId,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    // Non-comprehension post-test: mirror pre-test question IDs
    const result = await buildPostTest(callerId);
    return NextResponse.json({ ok: true, ...result });
  }

  // pre_test — resolve enrolled playbook and curriculum.
  // #1167 — see the post_test comment above. Same isDefault / enrolledAt
  // ordering must be applied here so the pre-test routes through the
  // learner's primary enrollment when they have multiple active courses.
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { enrolledAt: "desc" }],
    include: {
      playbook: {
        select: {
          config: true,
          // #1205 — canonical PlaybookCurriculum primary join (variant-aware).
          playbookCurricula: {
            where: {
              role: PlaybookCurriculumRole.primary,
              curriculum: { deliveryConfig: { not: Prisma.JsonNull } },
            },
            select: { curriculum: { select: { id: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const curriculumId = enrollment?.playbook?.playbookCurricula?.[0]?.curriculum.id;

  // #302: When the learner picked a module via the picker, restrict the pre-test
  // pool to that module's outcomesPrimary. The picker writes requestedModuleId
  // onto the Call row at session-init, so the most recent call is the lock.
  const lockedOutcomeRefs = await resolveLockedOutcomeRefs(
    callerId,
    enrollment?.playbook?.config,
  );

  // Try curriculum-scoped first, then fall back to playbook-wide search.
  // #1067 — pass callerId as the shuffle seed so option order is
  // deterministic per (caller, question).
  if (curriculumId) {
    const result = await buildPreTest(curriculumId, {
      lockedOutcomeRefs,
      callerSeed: callerId,
    });
    if (!result.skipped) {
      return NextResponse.json({ ok: true, ...result });
    }
  }

  // Playbook-wide fallback — searches all subjects' content sources
  if (enrollment?.playbookId) {
    const result = await buildPreTestForPlaybook(enrollment.playbookId, {
      lockedOutcomeRefs,
      callerSeed: callerId,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json(
    { ok: true, questions: [], questionIds: [], skipped: true, skipReason: "no_curriculum" },
  );
}

/**
 * Resolve the locked module's outcomesPrimary for the most recent call by the
 * caller, if any. Returns undefined when no module is locked or the id is stale.
 */
async function resolveLockedOutcomeRefs(
  callerId: string,
  playbookConfig: unknown,
): Promise<string[] | undefined> {
  const recentCall = await prisma.call.findFirst({
    where: { callerId, requestedModuleId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { requestedModuleId: true },
  });
  const lockedId = recentCall?.requestedModuleId;
  if (!lockedId) return undefined;

  const cfg = playbookConfig as { modules?: AuthoredModule[] } | null | undefined;
  const modules = Array.isArray(cfg?.modules) ? cfg!.modules : [];
  const match = modules.find((m) => m?.id === lockedId);
  const refs = Array.isArray(match?.outcomesPrimary) ? (match!.outcomesPrimary as string[]) : [];

  if (!match) {
    console.warn(
      `[assessment-questions] requestedModuleId="${lockedId}" not found in Playbook.config.modules — pre-test will use full pool.`,
    );
    return undefined;
  }
  return refs.length > 0 ? refs : undefined;
}

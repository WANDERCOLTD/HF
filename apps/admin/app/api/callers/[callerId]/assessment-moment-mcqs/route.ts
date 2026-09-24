/**
 * @api GET /api/callers/:callerId/assessment-moment-mcqs?moduleSlug=…
 * @visibility public
 * @scope callers:read
 * @auth session (VIEWER+ — STUDENT scoped to own caller)
 * @tags callers, assessment
 * @description W4 of `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md` —
 *   resolves the `MCQRoundsShell` data feed for a quiz-mode session.
 *
 *   Reads the caller's active Playbook → `config.assessmentPlan` →
 *   locates the `AssessmentMoment` whose `moduleSlug` matches the
 *   supplied `moduleSlug` (upfront / midpoints[] / end). If a matching
 *   moment exists, materialises it via the canonical sampling engine
 *   at `lib/assessment/sample-questions.ts::sampleQuestionsForMoment`
 *   (PR #2180 — epic #2176 S2).
 *
 *   Course-agnostic by construction — the route does NOT branch on
 *   course, mode literal, or playbook id. The engine reads the
 *   declarative plan; this route is the HTTP boundary.
 *
 *   **NO FAKE FALLBACKS** (operator-pinned, per
 *   `feedback_no_hardcoded_score_backfill.md`):
 *   - No matching `AssessmentMoment` → `{ ok: true, result: null, reason: "no-moment" }`
 *   - Engine returns `empty-pool` / `missing-content` / `policy-unsatisfied`
 *     → `{ ok: true, result: null, reason: "<engine-reason>" }`
 *   - The shell consumes the null-result + reason and renders the
 *     empty-state — never synthesises MCQs.
 *
 *   The engine fires its own AppLog subjects (`assessment.sample.empty_pool`,
 *   `assessment.sample.missing_content`, `assessment.sample.policy_unsatisfied`)
 *   on failure paths — the route adds an `assessment.moment.no_match`
 *   subject when the plan is absent OR no moment cites the supplied slug.
 *
 *   **STUDENT scoping** — gated by `requireAuth("VIEWER")` +
 *   `studentAllowedToReadCaller` so a STUDENT can ONLY read their own
 *   caller's assessment feed (per `lib/learner-scope.ts`).
 *
 * @pathParam callerId string - Caller.id
 * @queryParam moduleSlug string - AuthoredModule.id (the module currently rendering)
 * @response 200 {ok: true, result: AssessmentMomentMCQsPayload | null, reason?: string}
 * @response 400 {ok: false, error: string}
 * @response 403 {ok: false, error: string}
 * @response 500 {ok: false, error: string}
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { log } from "@/lib/logger";
import { sampleQuestionsForMoment } from "@/lib/assessment/sample-questions";
import type {
  AssessmentMoment,
  CourseAssessmentPlan,
  PlaybookConfig,
} from "@/lib/types/json-fields";

const QuerySchema = z.object({
  moduleSlug: z.string().min(1, "moduleSlug query param is required"),
});

/**
 * Public response shape consumed by `useAssessmentMomentMCQs` +
 * `MCQRoundsShell`. Narrow projection — only fields the learner UI
 * renders or the host needs for round progression.
 */
export interface AssessmentMomentMCQsPayload {
  /** The kind of assessment moment that resolved (drives shell copy / pill). */
  momentKind: AssessmentMoment["kind"];
  /** The slug of the module hosting this moment (echoed for sanity). */
  moduleSlug: string;
  /** Whether per-question feedback should be shown after each answer
   *  vs. held to round-end. Today we default to immediate; future:
   *  drive from `AssessmentMoment.feedbackMode` once the type carries
   *  that field. */
  feedbackMode: "immediate" | "round-end";
  /** Ordered, sampled MCQs to present this round. */
  mcqs: ReadonlyArray<{
    id: string;
    questionText: string;
    /** Operator-authored options. Engine returns `unknown`; we narrow
     *  here when shape matches `{ label, text }[]`. */
    options: Array<{ label: string; text: string }> | null;
  }>;
}

export type AssessmentMomentNullReason =
  | "no-moment"
  | "empty-pool"
  | "missing-content"
  | "policy-unsatisfied";

function narrowOptions(
  raw: unknown,
): Array<{ label: string; text: string }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ label: string; text: string }> = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "label" in entry &&
      "text" in entry &&
      typeof (entry as { label: unknown }).label === "string" &&
      typeof (entry as { text: unknown }).text === "string"
    ) {
      out.push({
        label: (entry as { label: string }).label,
        text: (entry as { text: string }).text,
      });
    }
  }
  return out.length > 0 ? out : null;
}

function findMomentByModuleSlug(
  plan: CourseAssessmentPlan,
  moduleSlug: string,
): AssessmentMoment | null {
  if (plan.upfront?.moduleSlug === moduleSlug) return plan.upfront;
  if (plan.end?.moduleSlug === moduleSlug) return plan.end;
  for (const mid of plan.midpoints ?? []) {
    if (mid.moduleSlug === moduleSlug) return mid;
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }

    const rawSlug = req.nextUrl.searchParams.get("moduleSlug") ?? undefined;
    const parsed = QuerySchema.safeParse({ moduleSlug: rawSlug });
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "moduleSlug query param is required" },
        { status: 400 },
      );
    }
    const { moduleSlug } = parsed.data;

    // Resolve caller's active enrollment → playbook (+ config). Mirrors the
    // same path `exam-mode-check/route.ts` takes (active CallerPlaybook,
    // most-recent enrollment).
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId, status: "ACTIVE" },
      orderBy: { enrolledAt: "desc" },
      select: {
        playbook: {
          select: {
            id: true,
            config: true,
          },
        },
      },
    });

    if (!enrollment?.playbook) {
      log("system", "assessment.moment.no_match", {
        level: "info",
        message: "no active enrollment for caller — no assessment plan to read",
        callerId,
        moduleSlug,
      });
      return NextResponse.json({ ok: true, result: null, reason: "no-moment" });
    }

    const playbookId = enrollment.playbook.id;
    const config = (enrollment.playbook.config ?? null) as PlaybookConfig | null;
    const plan = config?.assessmentPlan ?? null;

    if (!plan || plan.noAssessmentPlan === true) {
      log("system", "assessment.moment.no_match", {
        level: "info",
        message: plan
          ? "playbook declares noAssessmentPlan:true"
          : "no assessmentPlan on Playbook.config",
        callerId,
        moduleSlug,
        playbookId,
      });
      return NextResponse.json({ ok: true, result: null, reason: "no-moment" });
    }

    const moment = findMomentByModuleSlug(plan, moduleSlug);
    if (!moment) {
      log("system", "assessment.moment.no_match", {
        level: "info",
        message: "no AssessmentMoment cites the supplied moduleSlug",
        callerId,
        moduleSlug,
        playbookId,
      });
      return NextResponse.json({ ok: true, result: null, reason: "no-moment" });
    }

    // Materialise the moment via the canonical sampling engine. The
    // engine writes its own AppLog subjects on failure paths.
    const sampled = await sampleQuestionsForMoment({
      plan,
      moment,
      playbookId,
      callerId,
    });

    if (!sampled.ok) {
      return NextResponse.json({
        ok: true,
        result: null,
        reason: sampled.reason,
      });
    }

    const payload: AssessmentMomentMCQsPayload = {
      momentKind: moment.kind,
      moduleSlug,
      // AssessmentMoment doesn't yet carry feedbackMode; default to
      // "immediate" for MCQ rounds. Operator can revisit when the type
      // adds the field; today the shell defaults match learner-pinned
      // per-question feedback for popquiz / midpoint-check.
      feedbackMode: "immediate",
      mcqs: sampled.questions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: narrowOptions(q.options),
      })),
    };

    return NextResponse.json({ ok: true, result: payload });
  } catch (err) {
    console.error(
      "[/api/callers/[callerId]/assessment-moment-mcqs] error",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "Failed to resolve assessment moment MCQs" },
      { status: 500 },
    );
  }
}

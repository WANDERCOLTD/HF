/**
 * build-post-assessment-plan.ts — #1954 (Boaz/Eldar Unit 1.1) Post-
 * Assessment lesson-plan trigger.
 *
 * Pure-function deterministic plan generator. Reads the 4 IELTS
 * per-criterion CallScore rows for this call, identifies the WEAKEST
 * criterion (lowest score), and emits a small structured payload to
 * `Session.metadata.lessonPlan`. Fires fire-and-forget from the
 * AGGREGATE stage executor at `app/api/calls/[callId]/pipeline/
 * route.ts` right after the #1953 four-criteria completion gate
 * fires "complete".
 *
 * Architecture (see Boaz/Eldar response doc §2 TL revision):
 *   - Trigger site is post-AGGREGATE, NOT `endSession`. endSession
 *     fires the pipeline async, so `overallBand` and per-criterion
 *     scores aren't written yet — reading from endSession would race.
 *   - The natural integration point is the same try-block that runs
 *     the four-criteria gate (#1953). Both share the same prosody
 *     output + same Call + Session readiness.
 *   - Module-level toggle: `AuthoredModule.settings.generateLessonPlan`
 *     gates whether to fire. Default behaviour for the IELTS baseline
 *     module is `true` (set in the fixture); other modules opt in.
 *
 * Failure isolation:
 *   - Returns a discriminated result `{ok, plan?, reason?}` — never
 *     throws. The AGGREGATE caller wraps in `.catch(log...)` for
 *     defence-in-depth.
 *   - Skips silently when prerequisites are missing (no sessionId,
 *     no per-criterion scores, no matching authored module). Logs
 *     the skip reason at AppLog `lesson_plan.skipped`.
 */
import { prisma } from "@/lib/prisma";
import { log as appLog } from "@/lib/logger";
import type {
  AuthoredModule,
  PlaybookConfig,
  SessionLessonPlan,
  SessionMetadata,
} from "@/lib/types/json-fields";

interface BuildPostAssessmentPlanArgs {
  callId: string;
  callerId: string;
  sessionId: string | null;
  playbookId: string | null;
  curriculumModuleId: string | null;
}

interface BuildPostAssessmentPlanResult {
  ok: boolean;
  plan?: SessionLessonPlan;
  reason?:
    | "no_session"
    | "module_opt_out"
    | "no_module_match"
    | "no_per_criterion_scores"
    | "db_error";
}

const IELTS_LABEL: Record<string, string> = {
  skill_fluency_and_coherence_fc: "Fluency & Coherence",
  skill_lexical_resource_lr: "Lexical Resource",
  skill_grammatical_range_and_accuracy_gra: "Grammar",
  skill_pronunciation_p: "Pronunciation",
};

/**
 * Pure: pick the weakest criterion from a set of {parameterId, score}
 * rows. Returns null when no row maps to a known IELTS criterion.
 * Ties resolve by the IELTS parameter id alphabetical order (stable).
 */
export function pickWeakestIeltsCriterion(
  scores: ReadonlyArray<{ parameterId: string; score: number | null }>,
): { parameterId: string; label: string; score: number } | null {
  const ieltsRows = scores
    .filter(
      (r): r is { parameterId: string; score: number } =>
        typeof r.score === "number" && r.parameterId in IELTS_LABEL,
    )
    // Stable tie-break: alphabetical by parameterId so the same scores
    // always yield the same focus across reruns.
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.parameterId.localeCompare(b.parameterId);
    });
  if (ieltsRows.length === 0) return null;
  const weakest = ieltsRows[0];
  return {
    parameterId: weakest.parameterId,
    label: IELTS_LABEL[weakest.parameterId],
    score: weakest.score,
  };
}

/**
 * Pure: pick the next recommended module slug. Today the rule is
 * simple — Part 1 modules drill FC + LR; Part 3 drills GRA + thinking
 * fluency; Pronunciation gets Part 2 (cue-card monologue) where it's
 * most observable. Future epics may upgrade this to a per-criterion
 * mastery rollup.
 */
export function pickNextRecommendedModule(focusParameterId: string): string | undefined {
  switch (focusParameterId) {
    case "skill_fluency_and_coherence_fc":
      return "part1";
    case "skill_lexical_resource_lr":
      return "part1";
    case "skill_grammatical_range_and_accuracy_gra":
      return "part3";
    case "skill_pronunciation_p":
      return "part2";
    default:
      return undefined;
  }
}

/**
 * Build + persist the post-Assessment lesson plan. Returns a
 * structured result so the caller can log distinct outcomes.
 */
export async function buildPostAssessmentPlan(
  args: BuildPostAssessmentPlanArgs,
): Promise<BuildPostAssessmentPlanResult> {
  const { callId, callerId, sessionId, playbookId, curriculumModuleId } = args;

  if (!sessionId) {
    appLog("system", "lesson_plan.skipped", {
      message: "no Session.id on call — skipping post-Assessment plan",
      callId,
      reason: "no_session",
    });
    return { ok: true, reason: "no_session" };
  }

  try {
    // Module-level opt-in: read `generateLessonPlan` from the locked
    // AuthoredModule's settings. The IELTS baseline fixture sets
    // this to true; absent on other modules → opt-out → skip.
    let optedIn = false;
    if (playbookId && curriculumModuleId) {
      const [pb, curriculumModule] = await Promise.all([
        prisma.playbook.findUnique({
          where: { id: playbookId },
          select: { config: true },
        }),
        prisma.curriculumModule.findUnique({
          where: { id: curriculumModuleId },
          select: { slug: true },
        }),
      ]);
      const config = (pb?.config ?? {}) as PlaybookConfig;
      const authoredModules: AuthoredModule[] = config.modules ?? [];
      const slug = curriculumModule?.slug;
      const matched = slug
        ? authoredModules.find((m) => m.id === slug || m.id === slug)
        : undefined;
      if (!matched) {
        appLog("system", "lesson_plan.skipped", {
          message: "no AuthoredModule match for locked curriculumModule — skipping",
          callId,
          callerId,
          sessionId,
          slug,
          reason: "no_module_match",
        });
        return { ok: true, reason: "no_module_match" };
      }
      optedIn = matched.settings?.generateLessonPlan === true;
    }
    if (!optedIn) {
      appLog("system", "lesson_plan.skipped", {
        message: "module's generateLessonPlan toggle off — skipping",
        callId,
        sessionId,
        reason: "module_opt_out",
      });
      return { ok: true, reason: "module_opt_out" };
    }

    const scores = await prisma.callScore.findMany({
      where: { callId },
      select: { parameterId: true, score: true },
    });

    const weakest = pickWeakestIeltsCriterion(scores);
    if (!weakest) {
      appLog("system", "lesson_plan.skipped", {
        message: "no IELTS per-criterion scores found on call — skipping",
        callId,
        sessionId,
        reason: "no_per_criterion_scores",
        rowCount: scores.length,
      });
      return { ok: true, reason: "no_per_criterion_scores" };
    }

    const plan: SessionLessonPlan = {
      focusCriterion: weakest.parameterId,
      focusLabel: weakest.label,
      focusScore: weakest.score,
      reason: `${weakest.label} scored lowest on this session — strengthening it will lift your overall band fastest.`,
      nextRecommendedModuleSlug: pickNextRecommendedModule(weakest.parameterId),
      emittedAt: new Date().toISOString(),
    };

    // JSON merge — preserve sibling keys (overallBand, pinnedCard,
    // scoreDeltas, phaseBoundaries) the AGGREGATE-tail writers may
    // also be writing.
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const currentMetadata = (session?.metadata ?? {}) as SessionMetadata;
    const nextMetadata: SessionMetadata = { ...currentMetadata, lessonPlan: plan };

    await prisma.session.update({
      where: { id: sessionId },
      data: { metadata: nextMetadata as object },
    });

    appLog("system", "lesson_plan.emitted", {
      message: "Post-Assessment lesson plan written to Session.metadata",
      callId,
      callerId,
      sessionId,
      focusCriterion: plan.focusCriterion,
      focusLabel: plan.focusLabel,
      focusScore: plan.focusScore,
      nextRecommendedModuleSlug: plan.nextRecommendedModuleSlug,
    });

    return { ok: true, plan };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    appLog("system", "lesson_plan.write_failed", {
      message: "Post-Assessment lesson plan failed (non-blocking)",
      callId,
      sessionId,
      error: msg,
    });
    return { ok: false, reason: "db_error" };
  }
}

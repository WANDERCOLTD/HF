/**
 * @api PUT /api/courses/[courseId]/design
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @tags course, design, welcome, nps, felt-progress
 * @description Save student experience design config. Writes to
 *   Playbook.config.welcome, Playbook.config.nps, the #417 skill-banding
 *   overrides, the Felt Progress namespaces (#779 progressNarrative,
 *   #780 offboardingSummary), and the S6/S8 first-call knobs (#784
 *   firstSessionTargets, #790 firstCallMode).
 *   Pre-survey gating is computed from welcome.* via isPreSurveyEnabled
 *   (no surveys.pre write); surveys.post.enabled mirrors nps.enabled.
 *   Pass `null` for any optional override field to clear it (falls back
 *   to defaults / contract).
 * @request { welcome?: WelcomeConfig, nps?: NpsConfig, skillTierMapping?, skillScoringEmaHalfLifeDays?, skillMinCallsToFull?, progressNarrative?, offboardingSummary?, firstSessionTargets?, firstCallMode? }
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Course not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import type { WelcomeConfig, NpsConfig, PlaybookConfig } from "@/lib/types/json-fields";

/**
 * #819 — keys whose presence in the request body should trigger
 * `recompose-all` fan-out after the save commits. Skill-banding and
 * NPS/welcome don't appear here because they're read at runtime via
 * their own loaders (banding via the registry, welcome by the student
 * portal — neither is baked into the deterministic ComposedPrompt).
 *
 * All four Felt-Progress / Call-1 namespaces directly affect the
 * COMPOSE-stage output for enrolled callers — without this fan-out,
 * the existing ComposedPrompt row for each caller goes stale until
 * the next pipeline call triggers a recompose naturally.
 */
const COMPOSE_AFFECTING_KEYS = [
  "progressNarrative",
  "offboardingSummary",
  "firstSessionTargets",
  "firstCallMode",
] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;
    const body = (await req.json()) as {
      welcome?: WelcomeConfig;
      nps?: NpsConfig;
      // #417 Story C — per-playbook banding override.
      skillTierMapping?: PlaybookConfig["skillTierMapping"] | null;
      skillScoringEmaHalfLifeDays?: number | null;
      skillMinCallsToFull?: number | null;
      // #779 — Felt Progress S1. Object writes the fields; null clears the
      // namespace (falls back to all defaults from the transform).
      progressNarrative?: PlaybookConfig["progressNarrative"] | null;
      // #780 — Felt Progress S2. Same shape: object writes; null clears.
      offboardingSummary?: PlaybookConfig["offboardingSummary"] | null;
      // #784 (S6) — per-playbook first-call BEHAVIOR target overrides.
      // Object writes; null clears the namespace (falls back to domain defaults).
      firstSessionTargets?: PlaybookConfig["firstSessionTargets"] | null;
      // #790 (S8) — first-call mode override. String writes; null clears
      // (falls back to default 'onboarding' behaviour).
      firstCallMode?: PlaybookConfig["firstCallMode"] | null;
    };

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { config: true },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    const pbConfig = (playbook.config ?? {}) as PlaybookConfig;

    if (body.welcome) {
      pbConfig.welcome = body.welcome;
    }

    if (body.nps) {
      pbConfig.nps = body.nps;
    }

    // #417 Story C — banding override. Pass `null` to clear (fall back
    // to the SKILL_MEASURE_V1 contract defaults).
    if (body.skillTierMapping !== undefined) {
      if (body.skillTierMapping === null) {
        delete pbConfig.skillTierMapping;
      } else {
        pbConfig.skillTierMapping = body.skillTierMapping;
      }
    }
    if (body.skillScoringEmaHalfLifeDays !== undefined) {
      if (body.skillScoringEmaHalfLifeDays === null) {
        delete pbConfig.skillScoringEmaHalfLifeDays;
      } else {
        pbConfig.skillScoringEmaHalfLifeDays = body.skillScoringEmaHalfLifeDays;
      }
    }
    if (body.skillMinCallsToFull !== undefined) {
      if (body.skillMinCallsToFull === null) {
        delete pbConfig.skillMinCallsToFull;
      } else {
        pbConfig.skillMinCallsToFull = body.skillMinCallsToFull;
      }
    }

    // #779 — Felt Progress progressNarrative. Pass `null` to clear (fall back
    // to transform defaults). Object writes the namespace verbatim.
    if (body.progressNarrative !== undefined) {
      if (body.progressNarrative === null) {
        delete pbConfig.progressNarrative;
      } else {
        pbConfig.progressNarrative = body.progressNarrative;
      }
    }

    // #780 — Felt Progress offboardingSummary. Same null-clears semantics.
    if (body.offboardingSummary !== undefined) {
      if (body.offboardingSummary === null) {
        delete pbConfig.offboardingSummary;
      } else {
        pbConfig.offboardingSummary = body.offboardingSummary;
      }
    }

    // #784 (S6) — per-playbook first-call BEHAVIOR target overrides.
    // null or empty-object clears so the domain → INIT-001 → AUDIENCE
    // cascade applies again.
    if (body.firstSessionTargets !== undefined) {
      if (
        body.firstSessionTargets === null ||
        Object.keys(body.firstSessionTargets).length === 0
      ) {
        delete pbConfig.firstSessionTargets;
      } else {
        pbConfig.firstSessionTargets = body.firstSessionTargets;
      }
    }

    // #790 (S8) — first-call mode. null clears so the default 'onboarding'
    // path runs in `transforms/pedagogy.ts` (byte-identical to pre-#790).
    if (body.firstCallMode !== undefined) {
      if (body.firstCallMode === null) {
        delete pbConfig.firstCallMode;
      } else {
        pbConfig.firstCallMode = body.firstCallMode;
      }
    }

    // surveys.pre.enabled is now COMPUTED-ONLY from welcome.* (see isPreSurveyEnabled);
    // do NOT write it. surveys.post.enabled has no welcome-side mirror yet, so
    // mirror from nps.enabled when nps is being saved.
    if (body.nps) {
      const n = pbConfig.nps;
      pbConfig.surveys = {
        ...pbConfig.surveys,
        post: { enabled: !!n?.enabled, questions: pbConfig.surveys?.post?.questions ?? [] },
      };
    }

    await prisma.playbook.update({
      where: { id: courseId },
      data: { config: JSON.parse(JSON.stringify(pbConfig)) },
    });

    // #819 — close the chain-contract gap: educator-tunable namespaces that
    // flow into COMPOSE need to propagate to every active caller's
    // ComposedPrompt row, not just the next pipeline run. Fire the existing
    // /api/playbooks/[id]/recompose-all endpoint via the internal function
    // path (it's bounded by pLimit(5) so even large rosters are safe).
    // Fire-and-forget so the design save returns immediately; recompose
    // errors are logged but don't block the educator.
    const composeAffected = COMPOSE_AFFECTING_KEYS.some(
      (k) => body[k] !== undefined,
    );
    if (composeAffected) {
      import("@/lib/enrollment/auto-compose")
        .then(async ({ autoComposeForCaller }) => {
          const { getPlaybookRoster } = await import("@/lib/enrollment");
          const pLimit = (await import("p-limit")).default;
          const roster = await getPlaybookRoster(courseId, "ACTIVE");
          const callerIds = roster
            .map((r) => r.caller?.id)
            .filter((id): id is string => !!id);
          const limit = pLimit(5);
          await Promise.all(
            callerIds.map((cid) =>
              limit(() => autoComposeForCaller(cid, courseId)),
            ),
          );
          console.log(
            `[design PUT] recompose-all fan-out complete: ${callerIds.length} callers (course ${courseId})`,
          );
        })
        .catch((err) => {
          console.error(
            `[design PUT] recompose-all fan-out failed for course ${courseId}:`,
            err.message,
          );
        });
    }

    return NextResponse.json({ ok: true, recomposed: composeAffected });
  } catch (err) {
    console.error("[design PUT]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to save design config" },
      { status: 500 },
    );
  }
}

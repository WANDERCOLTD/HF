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
 *
 *   #826: writes go through `updatePlaybookConfig` which bumps
 *   `Playbook.composeInputsUpdatedAt` when a COMPOSE-affecting key changes.
 *   Downstream callers' prompts are marked stale; recompose happens
 *   lazily at their next call-start (or immediately if educator clicks
 *   "Recompose now" on the StalePromptPill in #831).
 * @request { welcome?: WelcomeConfig, nps?: NpsConfig, skillTierMapping?, skillScoringEmaHalfLifeDays?, skillMinCallsToFull?, progressNarrative?, offboardingSummary?, firstSessionTargets?, firstCallMode? }
 * @response 200 { ok: true, configUpdated: boolean }
 * @response 404 { ok: false, error: "Course not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import type { WelcomeConfig, NpsConfig, PlaybookConfig } from "@/lib/types/json-fields";

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

    try {
      const { composeAffectingChanged } = await updatePlaybookConfig(
        courseId,
        (pbConfig) => {
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

          // #779 — Felt Progress progressNarrative. Pass `null` to clear.
          if (body.progressNarrative !== undefined) {
            if (body.progressNarrative === null) {
              delete pbConfig.progressNarrative;
            } else {
              pbConfig.progressNarrative = body.progressNarrative;
            }
          }

          // #780 — Felt Progress offboardingSummary.
          if (body.offboardingSummary !== undefined) {
            if (body.offboardingSummary === null) {
              delete pbConfig.offboardingSummary;
            } else {
              pbConfig.offboardingSummary = body.offboardingSummary;
            }
          }

          // #784 (S6) — first-call BEHAVIOR target overrides.
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

          // #790 (S8) — first-call mode.
          if (body.firstCallMode !== undefined) {
            if (body.firstCallMode === null) {
              delete pbConfig.firstCallMode;
            } else {
              pbConfig.firstCallMode = body.firstCallMode;
            }
          }

          // surveys.pre.enabled is COMPUTED-ONLY from welcome.*;
          // surveys.post.enabled mirrors nps.enabled when nps is saved.
          if (body.nps) {
            const n = pbConfig.nps;
            pbConfig.surveys = {
              ...pbConfig.surveys,
              post: {
                enabled: !!n?.enabled,
                questions: pbConfig.surveys?.post?.questions ?? [],
              },
            };
          }

          return pbConfig;
        },
        { reason: "design PUT" },
      );

      return NextResponse.json({ ok: true, configUpdated: composeAffectingChanged });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("not found")
      ) {
        return NextResponse.json(
          { ok: false, error: "Course not found" },
          { status: 404 },
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[design PUT]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to save design config" },
      { status: 500 },
    );
  }
}

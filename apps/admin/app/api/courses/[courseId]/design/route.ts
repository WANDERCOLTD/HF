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
import { prisma } from "@/lib/prisma";
import type { WelcomeConfig, NpsConfig, PlaybookConfig } from "@/lib/types/json-fields";

/**
 * @api GET /api/courses/[courseId]/design
 * @visibility internal
 * @scope course:read
 * @auth session (OPERATOR+)
 * @tags course, design, first-session-targets
 * @description Returns the merged "first-call behaviour targets" payload
 *   that the FirstSessionSettings panel renders. Merges TWO sources at
 *   PLAYBOOK scope — `Playbook.config.firstSessionTargets` (educator-
 *   owned via this panel's Save) AND `BehaviorTarget(scope=PLAYBOOK)`
 *   rows (written by AgentTuner / Cmd+K). Each merged row carries an
 *   `origin` so the panel can render `behaviorTarget` rows read-only
 *   (#1417). Identical `parameterId` in both sources produces TWO rows
 *   (no silent dedup) so the educator can resolve the conflict.
 * @response 200 { ok: true, rows: Array<{ parameterId, value, origin: "firstSessionTargets" | "behaviorTarget" }>, firstCallMode? }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, config: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const cfg = (playbook.config ?? {}) as PlaybookConfig;
    const fst = cfg.firstSessionTargets ?? {};

    const behaviorRows = await prisma.behaviorTarget.findMany({
      where: {
        playbookId: courseId,
        scope: "PLAYBOOK",
        effectiveUntil: null,
      },
      select: {
        parameterId: true,
        targetValue: true,
        source: true,
        updatedAt: true,
      },
      orderBy: { parameterId: "asc" },
    });

    type MergedRow = {
      parameterId: string;
      value: number;
      origin: "firstSessionTargets" | "behaviorTarget";
      source?: string;
      updatedAt?: string;
    };

    const rows: MergedRow[] = [];
    for (const [parameterId, v] of Object.entries(fst)) {
      rows.push({
        parameterId,
        value: typeof v.value === "number" ? v.value : 0,
        origin: "firstSessionTargets",
      });
    }
    for (const r of behaviorRows) {
      rows.push({
        parameterId: r.parameterId,
        value: r.targetValue,
        origin: "behaviorTarget",
        source: r.source,
        updatedAt: r.updatedAt.toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      rows,
      firstCallMode: cfg.firstCallMode ?? null,
      // #1405 — surface the new gate so the ModuleVisibilitySettings panel
      // can hydrate without a second round-trip. `null` means "use default".
      firstCallModuleVisibility:
        cfg.firstCall?.firstCallModuleVisibility ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/courses/:courseId/design GET] error", err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

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
      // #1405 — first-call module-visibility gate. Writes/clears
      // `Playbook.config.firstCall.firstCallModuleVisibility` inside the
      // shared `firstCall` namespace (partial-merge — does NOT blow away
      // sibling firstCall.* fields). `null` clears just this key.
      firstCall?: {
        firstCallModuleVisibility?:
          | "mention_from_call_1"
          | "hide_until_call_2"
          | "hide_until_learner_picks"
          | null;
      };
      // Course-level tolerance overrides (split from caller Tune,
      // post-#849). Partial-merge semantics: each subfield is patched
      // independently. masteryThreshold is NOT accepted here — its
      // canonical home is BehaviorTarget(scope=PLAYBOOK).
      tolerances?: {
        retrievalCadenceOverride?: number | null;
        memoryDecayScale?: number | null;
      } | null;
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

          // #1405 — first-call module-visibility gate. Partial-merge: only
          // touches `firstCall.firstCallModuleVisibility`; sibling fields
          // (durationMinsOverride, introducePedagogy) are untouched. Unknown
          // enum values are rejected; `null` clears just this key, leaving
          // the rest of `firstCall.*` intact.
          if (body.firstCall !== undefined && body.firstCall !== null) {
            const incomingFc = body.firstCall;
            if ("firstCallModuleVisibility" in incomingFc) {
              const v = incomingFc.firstCallModuleVisibility;
              const VALID = new Set([
                "mention_from_call_1",
                "hide_until_call_2",
                "hide_until_learner_picks",
              ]);
              if (v !== null && v !== undefined && !VALID.has(v as string)) {
                throw new Error(
                  `Invalid firstCall.firstCallModuleVisibility: ${String(v)}`,
                );
              }
              const currentFc = pbConfig.firstCall ?? {};
              const nextFc = { ...currentFc };
              if (v === null || v === undefined) {
                delete nextFc.firstCallModuleVisibility;
              } else {
                nextFc.firstCallModuleVisibility = v;
              }
              if (Object.keys(nextFc).length === 0) {
                delete pbConfig.firstCall;
              } else {
                pbConfig.firstCall = nextFc;
              }
            }
          }

          // Tolerances (split from caller Tune, post-#849).
          // Patch one field at a time so a partial body (e.g. only
          // memoryDecayScale provided) does not blow away other tolerance
          // fields that were unchanged. masteryThreshold is NOT accepted
          // here — its canonical home is BehaviorTarget(scope=PLAYBOOK,
          // parameterId=TOL-MASTERY-THRESHOLD), written via
          // /api/playbooks/[id]/targets.
          if (body.tolerances !== undefined) {
            const incoming = body.tolerances as Record<string, unknown> | null;
            if (incoming === null) {
              delete pbConfig.tolerances;
            } else {
              const current = pbConfig.tolerances ?? {};
              const next = { ...current };
              if ("retrievalCadenceOverride" in incoming) {
                const v = incoming.retrievalCadenceOverride;
                if (v == null) delete next.retrievalCadenceOverride;
                else next.retrievalCadenceOverride = v as number;
              }
              if ("memoryDecayScale" in incoming) {
                const v = incoming.memoryDecayScale;
                if (v == null) delete next.memoryDecayScale;
                else next.memoryDecayScale = v as number;
              }
              if (Object.keys(next).length === 0) {
                delete pbConfig.tolerances;
              } else {
                pbConfig.tolerances = next;
              }
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

/**
 * @api GET /api/callers/:callerId/mock-results?sessionId=…
 * @visibility public
 * @scope callers:read
 * @auth session (VIEWER+ — STUDENT scoped to own caller)
 * @tags callers, voice, mock
 * @description Returns the per-criterion Mock results payload for the
 *   sanctioned `ResultsReadoutShell` learner surface (W6 of
 *   `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md`).
 *
 *   The shape mirrors the FOH `SessionScore` contract at
 *   `apps/foh/lib/types.ts` (criteria array of `{key, label, score}` +
 *   overall + optional narrative/tier). Labels arrive in the response
 *   payload (resolved server-side from canonical `Parameter.name`) so the
 *   shell's source file stays free of IELTS criterion literals — the
 *   build-time `learner-ui-leak-coverage.test.ts` walk only scans literals
 *   in learner-UI DIRS (this route lives under `app/api/`, not
 *   `components/sim/`).
 *
 *   **Sanctioned per BDD US-Mock-05** + `.claude/rules/learner-ui-leak-coverage.md`
 *   exemptions ("Mock Results screen sanctioned per BDD US-Mock-05 —
 *   per-criterion bands shown only on Results screen").
 *
 *   **Honest scoring** — when no `CallScore` rows exist for the session
 *   yet (pipeline still running, or no `IELTS-MEASURE-001` rows landed),
 *   returns `{ ok: true, result: null }`. The shell's empty state
 *   renders accordingly. We do NOT fake bands (operator-pinned rule —
 *   see MEMORY.md "NEVER fill empty scores with hardcoded /
 *   AI-guessed defaults" + `feedback_no_hardcoded_score_backfill.md`).
 *
 *   **STUDENT scoping** — gated by `requireAuth("VIEWER")` +
 *   `studentAllowedToReadCaller` so a STUDENT can ONLY read their own
 *   caller's results (per `lib/learner-scope.ts`). OPERATOR+ may read
 *   any caller's results for review.
 *
 * @pathParam callerId string - Caller.id
 * @queryParam sessionId string - Session.id / Call.id (the row to score)
 * @response 200 {ok: true, result: ResultsReadoutPayload | null}
 * @response 400 {ok: false, error: string}
 * @response 403 {ok: false, error: string}
 * @response 500 {ok: false, error: string}
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import type { ResultsReadoutPayload } from "@/components/sim/ResultsReadoutShell";

/**
 * IELTS criterion parameterIds the Results screen surfaces, in the
 * canonical display order (FC → LR → GRA → P). Keys are the canonical
 * `Parameter.parameterId` values written by `IELTS-MEASURE-001` (see
 * `lib/pipeline/prosody-consumer.ts` + `lib/lesson-plan/build-post-assessment-plan.ts`
 * for sibling consumers).
 *
 * The shell's `key` field receives a short, learner-UI-safe alias so
 * the test ids stay readable; the `label` field is resolved server-side
 * from `Parameter.name` (HF-canonical authored display name), keeping
 * IELTS criterion literals OUT of the learner-UI source per the
 * `learner-ui-leak-coverage` Coverage gate.
 */
const CRITERION_PARAM_ORDER: ReadonlyArray<{ parameterId: string; key: string }> = [
  { parameterId: "skill_fluency_and_coherence_fc", key: "fluency" },
  { parameterId: "skill_lexical_resource_lr", key: "lexical" },
  { parameterId: "skill_grammatical_range_and_accuracy_gra", key: "grammar" },
  { parameterId: "skill_pronunciation_p", key: "pronunciation" },
];

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

    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "sessionId query param is required" },
        { status: 400 },
      );
    }

    // Read every per-criterion CallScore for the session. Scoped to the
    // caller too (defence-in-depth — the unique-key on (callId, parameterId,
    // moduleId) already prevents cross-caller leakage but a paranoid
    // join keeps STUDENT data crisp).
    const paramIds = CRITERION_PARAM_ORDER.map((c) => c.parameterId);
    const scores = await prisma.callScore.findMany({
      where: {
        callId: sessionId,
        callerId,
        parameterId: { in: paramIds },
      },
      select: {
        parameterId: true,
        score: true,
      },
    });

    // No criterion rows yet → honest empty (shell renders the empty
    // state). Never fabricate bands.
    if (scores.length === 0) {
      return NextResponse.json({ ok: true, result: null });
    }

    // Resolve canonical labels server-side from the Parameter rows.
    // `Parameter.name` is the HF-authored display name (e.g. "Fluency
    // and Coherence") — IP boundary per `.claude/rules/spec-readonly-boundary.md`.
    // Labels never appear as literals in this file; they flow from DB
    // → response → shell prop.
    const params_ = await prisma.parameter.findMany({
      where: { parameterId: { in: paramIds } },
      select: { parameterId: true, name: true },
    });
    const labelByParamId = new Map(params_.map((p) => [p.parameterId, p.name]));

    // Aggregate per-criterion (a session can carry multiple scores for
    // the same criterion across sub-modules — Mock covers P1/P2/P3
    // segments per epic #1700). Take the mean per parameterId so the
    // overall Mock band reflects the full session.
    const buckets = new Map<string, number[]>();
    for (const row of scores) {
      const arr = buckets.get(row.parameterId) ?? [];
      arr.push(row.score);
      buckets.set(row.parameterId, arr);
    }

    const criteria = CRITERION_PARAM_ORDER.flatMap(({ parameterId, key }) => {
      const bucket = buckets.get(parameterId);
      if (!bucket || bucket.length === 0) return [];
      const mean = bucket.reduce((a, b) => a + b, 0) / bucket.length;
      const label = labelByParamId.get(parameterId);
      if (!label) return []; // no canonical label → skip rather than fabricate
      return [{ key, label, score: mean }];
    });

    if (criteria.length === 0) {
      return NextResponse.json({ ok: true, result: null });
    }

    const overall =
      criteria.reduce((a, c) => a + c.score, 0) / criteria.length;

    const payload: ResultsReadoutPayload = {
      overall,
      criteria,
    };

    return NextResponse.json({ ok: true, result: payload });
  } catch (err) {
    console.error("[/api/callers/[callerId]/mock-results] error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to resolve mock results" },
      { status: 500 },
    );
  }
}

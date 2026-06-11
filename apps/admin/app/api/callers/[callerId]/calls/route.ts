import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { resolveDefaultModuleForCaller } from "@/lib/curriculum/resolve-default-module";
import {
  resolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId,
} from "@/lib/curriculum/resolve-module";
import { isSessionModelV2Enabled } from "@/lib/voice/session-flag";
import { createSession } from "@/lib/voice/create-session";

/**
 * @operator-surface yes
 *
 * @api GET /api/callers/:callerId/calls
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, calls
 * @description Get the most recent active sim call for a caller (endedAt is null, source is sim, within last 2 hours).
 * @pathParam callerId string - The caller ID
 * @query active boolean - If "true", only return active (non-ended) calls
 * @response 200 { ok: true, call: { id, source, createdAt, sessionId, session: { sequenceNumber, learnerFacingNumber } } | null }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const url = new URL(_request.url);
    const activeOnly = url.searchParams.get("active") === "true";

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const where = {
      callerId,
      ...(activeOnly
        ? {
            endedAt: null,
            source: { contains: "sim" },
            createdAt: { gte: twoHoursAgo },
          }
        : {}),
    };

    // #1344 Slice 4 — `Call.callSequence` is dropped; the per-Caller
    // learner-facing number now lives on `Session.learnerFacingNumber`
    // (joined via `Call.sessionId`). Older sim consumers that read
    // `call.callSequence` should switch to the Session FK.
    const call = await prisma.call.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        source: true,
        createdAt: true,
        endedAt: true,
        sessionId: true,
        session: {
          select: { sequenceNumber: true, learnerFacingNumber: true },
        },
      },
    });

    return NextResponse.json({ ok: true, call: call || null });
  } catch (error: any) {
    console.error("GET /api/callers/[callerId]/calls error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch calls" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/callers/:callerId/calls
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, calls
 * @description Create a new call record for a caller. Auto-determines call sequence number if not provided. Links to previous call for chain tracking.
 * @pathParam callerId string - The caller ID to create a call for
 * @body source string - Call source identifier (default: "ai-simulation")
 * @body transcript string - Call transcript text (default: "")
 * @body playbookId string - Optional playbook (course) ID. If omitted, resolves from the caller's default enrollment via resolvePlaybookId.
 * @response 200 { ok: true, call: { id, source, createdAt } }
 * @response 400 { ok: false, error } - Caller has no active enrollment, or multiple enrollments with no default and no explicit playbookId
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: "Failed to create call" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("STUDENT");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const body = await request.json();
    const { source = "ai-simulation", transcript = "", usedPromptId, playbookId, requestedModuleId } = body;

    // Verify caller exists
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Resolve playbookId — explicit body field wins, else caller's default enrollment.
    // Returns null only when caller has multiple active enrollments and no default —
    // in that case the API has no way to attribute the call, so 400 the request.
    const resolvedPlaybookId = await resolvePlaybookId(callerId, playbookId);
    if (!resolvedPlaybookId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Cannot determine course for this call: caller has no active enrollment, or has multiple enrollments with no default. Pass an explicit playbookId.",
        },
        { status: 400 }
      );
    }

    // #491 Slice 1.1 — resolve requestedModuleId slug → CurriculumModule.id.
    // The picker chip stores the module's slug (e.g. "part2", "mock") in
    // requestedModuleId, but the composer reads curriculumModuleId. Without
    // resolution, the slug is dead-data and the scheduler's `workingSet` hint
    // falls back to Part 1 every call. See #480 + tech-lead review.
    //
    // Two-step chain: playbook → curriculum → module, all FK-scoped to prevent
    // cross-playbook leaks (#407 invariant). Curriculum may not exist yet for
    // a brand-new authored playbook — `syncAuthoredModulesToCurriculum` runs
    // separately. Return 400 with a clear error in either failure case.
    let resolvedCurriculumModuleId: string | null = null;
    if (requestedModuleId && typeof requestedModuleId === "string") {
      const curriculumId = await resolveCurriculumIdForPlaybook(resolvedPlaybookId);
      if (!curriculumId) {
        return NextResponse.json(
          {
            ok: false,
            error:
              `Course has no curriculum yet — authored modules haven't been synced to ` +
              `CurriculumModule rows. Run syncAuthoredModulesToCurriculum, then retry.`,
          },
          { status: 400 }
        );
      }
      const resolved = await resolveModuleByLogicalId(curriculumId, requestedModuleId);
      if (!resolved) {
        return NextResponse.json(
          {
            ok: false,
            error:
              `Module "${requestedModuleId}" not found in this course's curriculum. ` +
              `Check the module slug — picker chips should send a canonical CurriculumModule slug.`,
          },
          { status: 400 }
        );
      }
      resolvedCurriculumModuleId = resolved.id;
    }

    // #1344 Slice 4 — legacy `callSequence` is gone. The Session parent
    // row owns sequencing via `CallerSequenceCounter`; sim calls do NOT
    // bump the learner-facing counter (SIM_CALL has
    // `countsTowardLearnerNumber=false`), so this route no longer hand-
    // rolls a `MAX(callSequence)+1` read. Previous-call linkage stays —
    // we order by `createdAt` instead.
    const previousCall = await prisma.call.findFirst({
      where: { callerId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    // G6 / #1154 — when the caller didn't supply a module via the picker
    // and we have a resolved playbook, auto-resolve the default module so
    // the #1006 / I-C1 module-lock invariant has something to enforce. Pre-G6
    // 61% of IELTS V1.0 calls landed with null requestedModuleId, silently
    // skipping the invariant and re-exposing Maya-class hallucination risk.
    let finalRequestedModuleId = requestedModuleId;
    let finalCurriculumModuleId = resolvedCurriculumModuleId;
    if (!finalRequestedModuleId && !finalCurriculumModuleId && resolvedPlaybookId) {
      const defaultModule = await resolveDefaultModuleForCaller(
        callerId,
        resolvedPlaybookId,
      );
      if (defaultModule) {
        finalRequestedModuleId = defaultModule.moduleSlug;
        finalCurriculumModuleId = defaultModule.curriculumModuleId;
        console.log(
          `[calls/create] G6 auto-resolved module for caller=${callerId.slice(0, 8)} playbook=${resolvedPlaybookId.slice(0, 8)} → ${defaultModule.moduleSlug} (source: ${defaultModule.source})`,
        );
      }
    }

    // #1342 + #1344 — write a SIM_CALL Session parent row first and link
    // the Call via `sessionId`. The Session row owns the atomic
    // per-(callerId, kind) sequence. SIM_CALL has
    // `countsTowardLearnerNumber=false`, so `learnerFacingNumber` stays
    // null on this Session — sim drives don't bump the user-facing
    // "(call #N)" counter (epic #1338 class-rules).
    let sessionParentId: string | null = null;
    if (isSessionModelV2Enabled()) {
      const result = await createSession({
        callerId,
        kind: "SIM_CALL",
        source: source ?? "sim",
        voiceProvider: null,
        ...(finalRequestedModuleId ? { requestedModuleId: finalRequestedModuleId } : {}),
      });
      sessionParentId = result.session.id;
    }

    // Create the call. #1344 Slice 4 — `callSequence` column dropped;
    // sequencing now lives on `Session.sequenceNumber` /
    // `Session.learnerFacingNumber`.
    const call = await prisma.call.create({
      data: {
        callerId,
        source,
        previousCallId: previousCall?.id || null,
        transcript: transcript || "",
        externalId: source === "playground-upload" ? `upload-${Date.now()}` : `ai-sim-${Date.now()}`,
        playbookId: resolvedPlaybookId,
        ...(sessionParentId ? { sessionId: sessionParentId } : {}),
        ...(usedPromptId ? { usedPromptId } : {}),
        // #242 Slice 2: learner's pre-call module pick from the picker (slug).
        // #491 Slice 1.1: also write the resolved CurriculumModule.id so the
        // composer's scheduler workingSet picks it up. Both fields are stored
        // — `requestedModuleId` for picker reads, `curriculumModuleId` for
        // composer + pipeline consumption.
        // G6 / #1154: when neither was supplied, both come from the auto-
        // resolve fallback above so I-C1 never short-circuits on null.
        ...(finalRequestedModuleId ? { requestedModuleId: finalRequestedModuleId } : {}),
        ...(finalCurriculumModuleId ? { curriculumModuleId: finalCurriculumModuleId } : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      call: {
        id: call.id,
        source: call.source,
        createdAt: call.createdAt,
      },
    });
  } catch (error: any) {
    console.error("POST /api/callers/[callerId]/calls error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to create call" },
      { status: 500 }
    );
  }
}

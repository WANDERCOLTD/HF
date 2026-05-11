import { NextRequest, NextResponse } from "next/server";
import { executeComposition, loadComposeConfig } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * @api POST /api/courses/:courseId/dry-run-prompt
 * @visibility internal
 * @scope courses:read
 * @auth OPERATOR
 * @tags courses, composition, prompts, tuning-velocity
 * @description Compose the prompt that would fire if a learner started a call
 *   on this course right now, without persisting a Call or ComposedPrompt
 *   record. Returns the rendered prompt summary, the structured `llmPrompt`,
 *   and a `composeTrace` block detailing loader decisions, exclusions, and
 *   the final media palette.
 *
 *   Used by the "Test First Call" button on the course page to compress the
 *   tuning loop — edit course-ref.md → click → see the diff in the prompt
 *   without starting a real sim call.
 *
 * @pathParam courseId string - Playbook UUID
 * @body callSequence number - Override call count (1 = force first call). Default: 1.
 * @body requestedModuleId string - Optional authored module to lock the session to.
 * @body simCallerId string - Optional explicit caller ID to compose for. Default: pick existing learner or first caller in the course's domain.
 * @response 200 { ok: true, dryRun: true, promptSummary, llmPrompt, trace, metadata }
 * @response 400 { ok: false, error } - No usable caller available
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, domainId: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }
    if (!playbook.domainId) {
      return NextResponse.json(
        { ok: false, error: "Course has no domain assigned." },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const callSequence: number = Number.isFinite(body.callSequence) ? Math.max(1, Number(body.callSequence)) : 1;
    const requestedModuleId: string | undefined = body.requestedModuleId || undefined;
    const explicitCallerId: string | undefined = body.simCallerId || undefined;

    // --- Resolve caller ------------------------------------------------------
    // Priority: explicit > existing enrolled learner > any caller in domain.
    // We never *create* a new caller — if the user wants a fresh learner they
    // can hit the existing /test-learner endpoint. Dry-run should be cheap.
    let callerId: string | null = explicitCallerId ?? null;
    if (callerId) {
      const exists = await prisma.caller.findUnique({
        where: { id: callerId },
        select: { id: true, domainId: true },
      });
      if (!exists) {
        return NextResponse.json(
          { ok: false, error: "Caller not found" },
          { status: 404 },
        );
      }
    } else {
      const enrolled = await prisma.callerPlaybook.findFirst({
        where: { playbookId: courseId, status: "ACTIVE" },
        orderBy: { enrolledAt: "desc" },
        select: { callerId: true },
      });
      if (enrolled) {
        callerId = enrolled.callerId;
      } else {
        const anyCaller = await prisma.caller.findFirst({
          where: { domainId: playbook.domainId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (anyCaller) callerId = anyCaller.id;
      }
    }

    if (!callerId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No caller available for dry-run. Add a test learner first (Learners tab → New test learner).",
        },
        { status: 400 },
      );
    }

    // --- Load compose config + execute (no persist) --------------------------
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({
      playbookIds: [courseId],
      forceFirstCall: callSequence === 1,
      requestedModuleId,
    });

    const composition = await executeComposition(callerId, sections, fullSpecConfig, "dry-run");
    const { loadedData, resolvedSpecs, metadata } = composition;

    const promptSummary = renderPromptSummary(composition.llmPrompt);

    console.log(
      `[dry-run-prompt] course=${courseId} caller=${callerId} callSeq=${callSequence} ` +
        `sections=${metadata.sectionsActivated.length}/${metadata.sectionsActivated.length + metadata.sectionsSkipped.length} ` +
        `(load:${metadata.loadTimeMs}ms transform:${metadata.transformTimeMs}ms)`,
    );

    return NextResponse.json({
      ok: true,
      dryRun: true,
      callerId,
      callSequence,
      requestedModuleId: requestedModuleId ?? null,
      composeSpecSlug: specSlug,
      promptSummary,
      llmPrompt: composition.llmPrompt,
      trace: metadata.composeTrace ?? null,
      metadata: {
        sectionsActivated: metadata.sectionsActivated,
        sectionsSkipped: metadata.sectionsSkipped,
        activationReasons: metadata.activationReasons,
        loadTimeMs: metadata.loadTimeMs,
        transformTimeMs: metadata.transformTimeMs,
        identitySpec: resolvedSpecs.identitySpec?.name ?? null,
        playbooksUsed: loadedData.playbooks.map((p: any) => p.name),
        memoriesCount: loadedData.memories.length,
        behaviorTargetsCount: metadata.mergedTargetCount,
      },
    });
  } catch (error: any) {
    console.error("[dry-run-prompt] failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to dry-run prompt" },
      { status: 500 },
    );
  }
}

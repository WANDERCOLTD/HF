import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { generateContentSpec, loadDomainAssertions, type GenerateContentSpecOptions } from "@/lib/domain/generate-content-spec";
import { extractSkeletonFromAssertions } from "@/lib/content-trust/extract-curriculum";
import { startTaskTracking, updateTaskProgress, completeTask, failTask } from "@/lib/ai/task-guidance";

/**
 * @api POST /api/domains/:domainId/generate-content-spec
 * @visibility internal
 * @auth session (OPERATOR)
 * @tags domains, content, specs
 * @description Auto-generate a CONTENT spec from the domain's content source assertions.
 *              Uses two-phase AI generation: Phase 1 returns a skeleton (titles + descriptions)
 *              in ~3-5s for immediate UI feedback, Phase 2 enriches with learning outcomes,
 *              assessment criteria, and key terms.
 *              Idempotent — skips if content spec already exists (unless regenerate: true).
 *              Supports async mode with task tracking for long-running generation.
 * @pathParam domainId string - The domain ID
 * @bodyParam intents? { sessionCount?: number, durationMins?: number, emphasis?: string, assessments?: string } - Curriculum intent hints
 * @bodyParam regenerate? boolean - Update existing spec instead of skipping
 * @bodyParam async? boolean - Return taskId for polling instead of blocking
 * @response 200 { ok: true, result: ContentSpecResult }
 * @response 202 { ok: true, taskId: string } (async mode)
 * @response 404 { ok: false, error: "Domain not found: ..." }
 * @response 422 { ok: false, error: string, result: ContentSpecResult }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;

    // Parse optional body (existing callers send no body)
    let body: { intents?: any; regenerate?: boolean; async?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body — backwards-compatible with existing callers
    }

    const options: GenerateContentSpecOptions = {
      intents: body.intents,
      regenerate: body.regenerate,
    };

    // Async mode: return taskId for polling
    if (body.async) {
      const taskId = await startTaskTracking(authResult.session.user.id, "content_spec_generation", {
        domainId,
        intents: body.intents,
      });

      // Fire-and-forget background generation (two-phase)
      runTwoPhaseGeneration(taskId, domainId, options).catch(async (err) => {
        console.error(`[generate-content-spec] Task ${taskId} unhandled error:`, err);
        await failTask(taskId, err.message || "Content spec generation failed");
      });

      return NextResponse.json({ ok: true, taskId }, { status: 202 });
    }

    // Sync mode: block until complete
    const result = await generateContentSpec(domainId, options);

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error, result }, { status: 422 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    const status = error.message?.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: error.message || "Content spec generation failed" },
      { status }
    );
  }
}

// ── Two-phase background runner ──────────────────────

async function runTwoPhaseGeneration(
  taskId: string,
  domainId: string,
  options: GenerateContentSpecOptions,
): Promise<void> {
  await updateTaskProgress(taskId, { currentStep: 1 });

  // ── Phase 1: Skeleton (~3-5s via Haiku) ──────────────
  try {
    const { domain, assertions, subjectName, qualificationRef } = await loadDomainAssertions(domainId);

    if (assertions.length === 0) {
      await failTask(taskId, "No assertions extracted from content sources yet");
      return;
    }

    const skeleton = await extractSkeletonFromAssertions(
      assertions,
      subjectName,
      qualificationRef,
      options.intents,
    );

    if (skeleton.ok && skeleton.modules.length > 0) {
      // Push skeleton to task context — UI shows modules immediately
      await updateTaskProgress(taskId, {
        currentStep: 2,
        context: {
          skeletonReady: true,
          skeletonModules: skeleton.modules,
          skeletonName: skeleton.name,
          skeletonDescription: skeleton.description,
          assertionCount: assertions.length,
          domainName: domain.name,
        },
      });
    }
    // If skeleton fails, continue to full generation — it's just a preview
  } catch (e) {
    // Skeleton failure is non-fatal — fall through to full generation
    console.warn(`[generate-content-spec] Skeleton failed for ${domainId}, continuing to full:`, e);
  }

  // ── Phase 2: Full enrichment (light model) ───────────
  const result = await generateContentSpec(domainId, options);

  if (result.error) {
    await failTask(taskId, result.error);
    return;
  }

  // Store enriched result in task context
  await updateTaskProgress(taskId, {
    currentStep: 3,
    context: {
      skeletonReady: true, // Preserve flag so UI doesn't flash
      result,
      moduleCount: result.moduleCount,
      assertionCount: result.assertionCount,
      contentSpecId: result.contentSpec?.id,
      wasRegenerated: result.wasRegenerated,
    },
  });

  await completeTask(taskId);
}

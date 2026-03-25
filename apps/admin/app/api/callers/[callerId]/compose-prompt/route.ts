import { NextRequest, NextResponse } from "next/server";
import { executeComposition, loadComposeConfig, persistComposedPrompt } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * @api POST /api/callers/:callerId/compose-prompt
 * @visibility public
 * @scope callers:compose
 * @auth session
 * @tags callers, composition, prompts
 * @description Compose a personalized next-call prompt for a caller using the declarative composition pipeline driven by COMP-001 spec sections. Loads caller data, applies section transformations, renders a deterministic prompt summary, stores the result, and supersedes previous active prompts.
 * @pathParam callerId string - The caller ID to compose a prompt for
 * @body triggerType string - What triggered this composition (default: "manual")
 * @body triggerCallId string - Optional call ID that triggered this composition
 * @body targetOverrides object - Preview overrides for behavior targets (not persisted)
 * @body playbookIds string[] - Optional filter to specific playbooks for A/B comparison
 * @body forceFirstCall boolean - Override to treat as first call regardless of history (preview-only, not persisted)
 * @response 200 { ok: true, prompt: ComposedPrompt, metadata: { engine, model, usage, inputContext, composition } }
 * @response 500 { ok: false, error: "Failed to compose prompt" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;

    // Validate caller exists and has a domain assigned
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { id: true, domainId: true, name: true },
    });
    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }
    if (!caller.domainId) {
      return NextResponse.json(
        { ok: false, error: "Caller has no institution assigned. Please assign an institution before composing a prompt." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      triggerType = "manual",
      triggerCallId,
      targetOverrides,
      playbookIds,
      forceFirstCall = false,
    } = body;

    // Load COMPOSE spec config (shared helper)
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({
      targetOverrides,
      playbookIds,
      forceFirstCall,
    });

    // Execute composition pipeline
    const composition = await executeComposition(callerId, sections, fullSpecConfig);
    const { loadedData, resolvedSpecs, metadata } = composition;

    console.log(`[compose-prompt] Composition: ${metadata.sectionsActivated.length} activated, ${metadata.sectionsSkipped.length} skipped (load: ${metadata.loadTimeMs}ms, transform: ${metadata.transformTimeMs}ms)`);

    // Render deterministic prompt summary
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    // Persist and supersede (shared helper) — skip DB write for preview-only mode
    const composedPrompt = await persistComposedPrompt(composition, promptSummary, {
      callerId,
      playbookId: playbookIds?.[0] || null,
      triggerType: forceFirstCall ? "preview_first_call" : triggerType,
      triggerCallId,
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
      skipPersist: forceFirstCall,
    });

    return NextResponse.json({
      ok: true,
      prompt: composedPrompt,
      metadata: {
        engine: "deterministic",
        model: "renderPromptSummary",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        inputContext: {
          memoriesCount: loadedData.memories.length,
          personalityAvailable: !!loadedData.personality,
          recentCallsCount: loadedData.recentCalls.length,
          behaviorTargetsCount: metadata.mergedTargetCount,
          playbooksUsed: loadedData.playbooks.map((p: any) => p.name),
          identitySpec: resolvedSpecs.identitySpec?.name || null,
          contentSpec: null,
        },
        composition: {
          sectionsActivated: metadata.sectionsActivated,
          sectionsSkipped: metadata.sectionsSkipped,
          activationReasons: metadata.activationReasons,
          loadTimeMs: metadata.loadTimeMs,
          transformTimeMs: metadata.transformTimeMs,
        },
      },
    });
  } catch (error: any) {
    console.error("Error composing prompt:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to compose prompt" },
      { status: 500 }
    );
  }
}

/**
 * @api GET /api/callers/:callerId/compose-prompt
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, composition, prompts
 * @description Get composed prompt history for a caller. Returns prompts ordered by composition date descending, with optional status filtering.
 * @pathParam callerId string - The caller ID to fetch prompt history for
 * @query limit number - Maximum prompts to return (default 20)
 * @query status string - Filter by status: "active", "superseded", or "all" (default: all)
 * @response 200 { ok: true, prompts: ComposedPrompt[], count: number }
 * @response 500 { ok: false, error: "Failed to fetch prompts" }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status"); // "active" | "superseded" | "all"

    const prompts = await prisma.composedPrompt.findMany({
      where: {
        callerId,
        ...(status && status !== "all" ? { status } : {}),
      },
      orderBy: { composedAt: "desc" },
      take: limit,
      include: {
        triggerCall: {
          select: {
            id: true,
            createdAt: true,
            source: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      prompts,
      count: prompts.length,
    });
  } catch (error: any) {
    console.error("Error fetching prompts:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch prompts" },
      { status: 500 }
    );
  }
}

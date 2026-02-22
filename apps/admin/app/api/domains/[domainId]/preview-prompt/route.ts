import { NextRequest, NextResponse } from "next/server";
import { executeComposition, loadComposeConfig } from "@/lib/prompt/composition";
import { renderPromptSummary, renderVoicePrompt } from "@/lib/prompt/composition/renderPromptSummary";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * @api POST /api/domains/:domainId/preview-prompt
 * @visibility internal
 * @auth session
 * @tags domains, composition, prompts
 * @description Preview the first-call composed prompt for a domain without persisting it. Optionally accepts a callerId in the request body; otherwise uses an existing caller in the domain or creates a minimal preview caller.
 * @pathParam domainId string - The domain ID to preview the prompt for
 * @body { callerId?: string } Optional caller ID to use for composition
 * @response 200 { ok: true, promptSummary, voicePrompt, llmPrompt, metadata }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;

    // Validate domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, name: true, slug: true },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 }
      );
    }

    // Resolve caller: use explicit callerId from body, find existing, or create preview
    const body = await request.json().catch(() => ({}));
    const requestedCallerId = body.callerId;

    let callerId: string;
    let createdPreviewCaller = false;

    if (requestedCallerId) {
      const caller = await prisma.caller.findFirst({
        where: { id: requestedCallerId, domainId },
        select: { id: true },
      });
      if (!caller) {
        return NextResponse.json(
          { ok: false, error: "Caller not found in this domain" },
          { status: 404 }
        );
      }
      callerId = requestedCallerId;
    } else {
      const existingCaller = await prisma.caller.findFirst({
        where: { domainId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (existingCaller) {
        callerId = existingCaller.id;
      } else {
        const previewCaller = await prisma.caller.create({
          data: {
            name: `[Preview] ${domain.name}`,
            domainId,
          },
        });
        callerId = previewCaller.id;
        createdPreviewCaller = true;
      }
    }

    // Load COMPOSE spec config
    const { fullSpecConfig, sections } = await loadComposeConfig();

    // Execute composition pipeline (deterministic, no AI calls)
    const composition = await executeComposition(callerId, sections, fullSpecConfig);
    const { loadedData, resolvedSpecs, metadata } = composition;

    console.log(`[preview-prompt] Domain ${domain.slug}: ${metadata.sectionsActivated.length} activated, ${metadata.sectionsSkipped.length} skipped (load: ${metadata.loadTimeMs}ms, transform: ${metadata.transformTimeMs}ms)`);

    // Render both prompt formats
    const promptSummary = renderPromptSummary(composition.llmPrompt);
    const voicePrompt = renderVoicePrompt(composition.llmPrompt);

    // Return WITHOUT persisting — this is a preview only
    return NextResponse.json({
      ok: true,
      callerId,
      createdPreviewCaller,
      promptSummary,
      voicePrompt,
      llmPrompt: composition.llmPrompt,
      metadata: {
        sectionsActivated: metadata.sectionsActivated,
        sectionsSkipped: metadata.sectionsSkipped,
        activationReasons: metadata.activationReasons,
        loadTimeMs: metadata.loadTimeMs,
        transformTimeMs: metadata.transformTimeMs,
        identitySpec: resolvedSpecs.identitySpec?.name || null,
        contentSpec: resolvedSpecs.contentSpec?.name || null,
        playbooksUsed: loadedData.playbooks.map((p: any) => p.name),
        memoriesCount: loadedData.memories.length,
        behaviorTargetsCount: metadata.mergedTargetCount,
      },
    });
  } catch (error: any) {
    console.error("Error previewing prompt:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to preview prompt" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * @api GET /api/composed-prompts/:promptId
 * @visibility internal
 * @scope prompts:read
 * @auth OPERATOR
 * @tags prompts, composition, tuning-velocity
 * @description Fetch a single ComposedPrompt by ID — rendered prompt, llmPrompt
 *   JSON, the inputs/trace block (sections activated/skipped, compose trace),
 *   plus a list of sibling prompts on the same course for the diff dropdown.
 *
 * @pathParam promptId string - ComposedPrompt UUID
 * @query siblings number - How many sibling prompts (same playbook) to return (default 10)
 * @response 200 { ok: true, prompt, siblings }
 * @response 404 { ok: false, error: "Prompt not found" }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { promptId } = await params;
  const { searchParams } = new URL(request.url);
  const siblingLimit = Math.min(50, Math.max(1, Number(searchParams.get("siblings") || "10")));

  const prompt = await prisma.composedPrompt.findUnique({
    where: { id: promptId },
    include: {
      playbook: { select: { id: true, name: true } },
      triggerCall: { select: { id: true, createdAt: true, source: true } },
    },
  });

  if (!prompt) {
    return NextResponse.json(
      { ok: false, error: "Prompt not found" },
      { status: 404 },
    );
  }

  const siblings = prompt.playbookId
    ? await prisma.composedPrompt.findMany({
        where: {
          playbookId: prompt.playbookId,
          id: { not: prompt.id },
        },
        orderBy: { composedAt: "desc" },
        take: siblingLimit,
        select: {
          id: true,
          composedAt: true,
          triggerType: true,
          status: true,
          callerId: true,
          model: true,
        },
      })
    : [];

  return NextResponse.json({
    ok: true,
    prompt,
    siblings,
  });
}

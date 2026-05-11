import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createTwoFilesPatch, diffLines } from "diff";

export const runtime = "nodejs";

/**
 * @api GET /api/composed-prompts/:promptId/diff
 * @visibility internal
 * @scope prompts:read
 * @auth OPERATOR
 * @tags prompts, composition, tuning-velocity
 * @description Diff this ComposedPrompt against another (by query param `against`).
 *   Defaults to "previous" — the most recent prompt for the same playbook
 *   composed before this one. Returns both a unified patch string and a
 *   per-line diff array so the UI can render either inline or side-by-side.
 *
 * @pathParam promptId string - ComposedPrompt UUID (the "right" side of the diff)
 * @query against string - Either another prompt UUID, or the keyword "previous" (default).
 * @response 200 { ok: true, left, right, unifiedDiff, lines }
 * @response 404 { ok: false, error }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { promptId } = await params;
  const { searchParams } = new URL(request.url);
  const against = searchParams.get("against") || "previous";

  const right = await prisma.composedPrompt.findUnique({
    where: { id: promptId },
    select: {
      id: true,
      prompt: true,
      composedAt: true,
      playbookId: true,
      triggerType: true,
    },
  });
  if (!right) {
    return NextResponse.json(
      { ok: false, error: "Prompt not found" },
      { status: 404 },
    );
  }

  let left: typeof right | null = null;
  if (against === "previous") {
    if (right.playbookId) {
      left = await prisma.composedPrompt.findFirst({
        where: {
          playbookId: right.playbookId,
          composedAt: { lt: right.composedAt },
          id: { not: right.id },
        },
        orderBy: { composedAt: "desc" },
        select: {
          id: true,
          prompt: true,
          composedAt: true,
          playbookId: true,
          triggerType: true,
        },
      });
    }
  } else {
    left = await prisma.composedPrompt.findUnique({
      where: { id: against },
      select: {
        id: true,
        prompt: true,
        composedAt: true,
        playbookId: true,
        triggerType: true,
      },
    });
  }

  if (!left) {
    return NextResponse.json({
      ok: true,
      left: null,
      right,
      unifiedDiff: "",
      lines: [],
      message: "No earlier prompt found to compare against.",
    });
  }

  const leftText = left.prompt || "";
  const rightText = right.prompt || "";

  const unifiedDiff = createTwoFilesPatch(
    `prompt-${left.id.slice(0, 8)}.md`,
    `prompt-${right.id.slice(0, 8)}.md`,
    leftText,
    rightText,
    `composed ${left.composedAt.toISOString()}`,
    `composed ${right.composedAt.toISOString()}`,
    { context: 3 },
  );

  const lines = diffLines(leftText, rightText).map((part) => ({
    value: part.value,
    added: !!part.added,
    removed: !!part.removed,
  }));

  return NextResponse.json({
    ok: true,
    left: { id: left.id, composedAt: left.composedAt, triggerType: left.triggerType },
    right: { id: right.id, composedAt: right.composedAt, triggerType: right.triggerType },
    unifiedDiff,
    lines,
  });
}

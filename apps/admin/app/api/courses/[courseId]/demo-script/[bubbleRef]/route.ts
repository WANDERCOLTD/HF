/**
 * @operator-surface yes
 *
 * DELETE /api/courses/[courseId]/demo-script/[bubbleRef]
 *
 * Removes a single annotation from `Playbook.config.demoScript.annotations[]`
 * by its `bubbleRef`. Used by the Preview annotation editor sidetray when
 * the operator clicks "Remove annotation" (#1493).
 *
 * 404 is reserved for the playbook missing entirely; deleting an annotation
 * that doesn't exist is a no-op 200 (idempotent — matches how the
 * sidetray's UI behaves when the user double-clicks delete).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";
import type { PlaybookConfig, DemoScript } from "@/lib/types/json-fields";

/**
 * @api DELETE /api/courses/[courseId]/demo-script/[bubbleRef]
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @description Remove a single annotation by `bubbleRef` (URL-encoded).
 *   Idempotent — missing annotations return 200 with `removed: false`.
 *   Bumps `composeInputsUpdatedAt` regardless (operator-touch signal).
 * @response 200 { ok: true, removed: boolean, count: number }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string; bubbleRef: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId, bubbleRef: bubbleRefRaw } = await params;
    const bubbleRef = decodeURIComponent(bubbleRefRaw);

    let removed = false;
    let total = 0;

    try {
      await updatePlaybookConfig(
        courseId,
        (existing: PlaybookConfig) => {
          const existingScript: DemoScript =
            existing.demoScript ?? { annotations: [] };
          const before = existingScript.annotations.length;
          const annotations = existingScript.annotations.filter(
            (a) => a.bubbleRef !== bubbleRef,
          );
          removed = annotations.length < before;
          total = annotations.length;
          return {
            ...existing,
            demoScript: { annotations },
          };
        },
        { reason: "demo-script DELETE" },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("not found")) {
        return NextResponse.json(
          { ok: false, error: "Course not found" },
          { status: 404 },
        );
      }
      throw err;
    }

    await bumpPlaybookComposeTimestamp(courseId);

    return NextResponse.json({ ok: true, removed, count: total });
  } catch (err) {
    console.error("[courses/[courseId]/demo-script DELETE]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

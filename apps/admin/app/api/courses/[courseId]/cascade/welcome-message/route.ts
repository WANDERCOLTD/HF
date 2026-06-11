import { NextResponse } from "next/server";

import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveWelcomeMessage } from "@/lib/cascade/resolvers/welcome-message";

export const runtime = "nodejs";

/**
 * @api GET /api/courses/[courseId]/cascade/welcome-message
 * @visibility internal
 * @scope cascade:read
 * @auth session
 * @tags courses, cascade, welcome-message
 * @description Returns the `Effective<string | null>` envelope for the
 *   `welcomeMessage` cascade knob, scoped to the given course (`playbookId`).
 *   Walks Playbook → Domain → SYSTEM and reports the winner plus the full
 *   layer chain so `LayerBadge` + `CascadeInspectorTray` can render
 *   provenance honestly. Mirrors `/api/callers/[callerId]/cascade/voice`.
 * @pathParam courseId string - The course (Playbook) ID
 * @response 200 { data: Effective<string | null> }
 * @response 401 { error: "Unauthorized" }
 * @response 403 { error: "Forbidden" } - role below OPERATOR
 * @response 500 { data: null, error: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;

  try {
    const data = await resolveWelcomeMessage({ playbookId: courseId });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[cascade/welcome-message] failed for courseId=${courseId}:`,
      message,
    );
    return NextResponse.json(
      { data: null, error: message },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { writeCallerBehaviorTarget } from "@/lib/agent-tuner/write-target";

export const runtime = "nodejs";

const bodySchema = z.object({
  targets: z.array(
    z.object({
      parameterId: z.string().min(1),
      targetValue: z.number().min(0).max(1).nullable(),
    }),
  ),
});

/**
 * @api PATCH /api/callers/:callerId/behavior-targets
 * @visibility internal
 * @scope callers:write
 * @auth session
 * @tags callers, targets
 * @description Update CALLER-scoped behavior targets for a single caller. The server
 *   resolves every CallerIdentity attached to the caller and writes the override to each.
 *   Set targetValue to null to remove a caller-scoped override and fall back to the
 *   cascade (SEGMENT → PLAYBOOK → SYSTEM). Shared write path with
 *   `lib/agent-tuner/write-target.ts::writeCallerBehaviorTarget` so the sidebar and
 *   the Cmd+K Tuning chat cannot drift.
 * @pathParam callerId string - Caller UUID
 * @body targets Array<{ parameterId: string, targetValue: number | null }>
 * @response 200 { ok: true, results: [...] }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Caller not found" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message || "Invalid body" },
        { status: 400 },
      );
    }
    const { targets } = parsed.data;

    const results = [];
    for (const { parameterId, targetValue } of targets) {
      const r = await writeCallerBehaviorTarget(callerId, parameterId, targetValue);
      if (!r.ok) {
        if (r.reason === "caller_not_found") {
          return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
        }
        if (r.reason === "no_identity") {
          return NextResponse.json(
            { ok: false, error: "Caller has no identity to attach targets to" },
            { status: 400 },
          );
        }
        if (r.reason === "parameter_not_adjustable") {
          results.push({ parameterId, action: "rejected", reason: r.reason });
          continue;
        }
      } else {
        results.push({ parameterId, action: r.action, value: r.value });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    console.error("Error updating caller behavior targets:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update caller targets" },
      { status: 500 },
    );
  }
}

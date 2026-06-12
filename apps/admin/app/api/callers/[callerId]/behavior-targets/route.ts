/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is OPERATOR-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { writeCallerBehaviorTarget } from "@/lib/agent-tuner/write-target";
import { prisma } from "@/lib/prisma";

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

/**
 * @api GET /api/callers/:callerId/behavior-targets
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, targets
 * @description Return the per-learner behaviour-target overrides for a caller —
 *   both MANUAL/TUNING_CHAT scope=CALLER BehaviorTargets (educator-set) AND
 *   CallerTarget rows (system-managed via ADAPT/AGGREGATE). Used by the Tune
 *   sidebar (#710) to surface shadow warnings when an educator is about to
 *   tune at PLAYBOOK scope on a parameter this learner has overridden.
 * @pathParam callerId string - Caller UUID
 * @response 200 { ok: true, overrides: Array<{ parameterId, targetValue, origin }> }
 *   where origin is "MANUAL_OVERRIDE" (educator) or "ADAPTED" (system).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;

    const [callerTargets, behaviorTargets] = await Promise.all([
      prisma.callerTarget.findMany({
        where: { callerId },
        select: { parameterId: true, targetValue: true, lastUpdatedAt: true },
      }),
      prisma.behaviorTarget.findMany({
        where: {
          scope: "CALLER",
          effectiveUntil: null,
          callerIdentity: { callerId },
          source: { in: ["MANUAL", "TUNING_CHAT"] },
        },
        select: { parameterId: true, targetValue: true, source: true, updatedAt: true },
      }),
    ]);

    const byParam = new Map<string, { parameterId: string; targetValue: number; origin: "MANUAL_OVERRIDE" | "ADAPTED"; updatedAt: string }>();
    for (const ct of callerTargets) {
      byParam.set(ct.parameterId, {
        parameterId: ct.parameterId,
        targetValue: ct.targetValue,
        origin: "ADAPTED",
        updatedAt: ct.lastUpdatedAt?.toISOString() ?? new Date(0).toISOString(),
      });
    }
    for (const bt of behaviorTargets) {
      byParam.set(bt.parameterId, {
        parameterId: bt.parameterId,
        targetValue: bt.targetValue,
        origin: "MANUAL_OVERRIDE",
        updatedAt: bt.updatedAt.toISOString(),
      });
    }

    return NextResponse.json({ ok: true, overrides: Array.from(byParam.values()) });
  } catch (error: any) {
    console.error("Error reading caller behavior targets:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to read caller targets" },
      { status: 500 },
    );
  }
}

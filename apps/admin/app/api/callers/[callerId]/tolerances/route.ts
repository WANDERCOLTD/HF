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
import {
  applyLearnerTolerance,
  ALLOWED_TOLERANCE_KEYS,
} from "@/lib/tolerance/apply-learner-tolerances";

export const runtime = "nodejs";

const firstCallPayload = z
  .object({
    durationMinsOverride: z.number().int().positive().optional(),
    introducePedagogy: z.boolean().optional(),
  })
  .strict();

const bodySchema = z.object({
  firstCall: firstCallPayload.optional(),
});

/**
 * @api PATCH /api/callers/:callerId/tolerances
 * @visibility internal
 * @scope callers:write
 * @auth session
 * @tags callers, tolerances
 * @description Per-learner tolerance overrides for the #598 Slice 1 cascade.
 *   Today only the `firstCall` key is allowlisted (mirrors
 *   `ALLOWED_TOLERANCE_KEYS` in `lib/tolerance/apply-learner-tolerances.ts`).
 *   Mastery threshold per-learner overrides go via `PATCH
 *   /api/callers/:callerId/behavior-targets` (BehaviorTarget(scope=CALLER)),
 *   NOT this route — this route is the structured-JSON payload path
 *   (CallerAttribute(scope=TOLERANCE)). Unknown keys → 400.
 * @pathParam callerId string — Caller UUID
 * @body firstCall? { durationMinsOverride?: number; introducePedagogy?: boolean }
 * @response 200 { ok: true }
 * @response 400 { ok: false, error: "..." }
 * @response 401/403 via requireAuth
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

    const body = parsed.data;
    const knownKeys = Object.keys(body).filter(
      (k) => (ALLOWED_TOLERANCE_KEYS as readonly string[]).includes(k),
    );
    if (knownKeys.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `No tolerance keys to write. Accepted: ${ALLOWED_TOLERANCE_KEYS.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    if (body.firstCall) {
      const sessionUser = "session" in authResult ? authResult.session.user : null;
      await applyLearnerTolerance({
        callerId,
        key: "firstCall",
        value: body.firstCall,
        actor: sessionUser
          ? {
              userId: (sessionUser as { id?: string }).id,
              userEmail: sessionUser.email ?? undefined,
            }
          : undefined,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tolerance write failed";
    // Unknown-key throws from applyLearnerTolerance surface here too.
    const status = /unknown key/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

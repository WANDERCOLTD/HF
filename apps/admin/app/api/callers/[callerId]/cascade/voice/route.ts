/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is OPERATOR-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { explainVoiceCascade } from "@/lib/cascade/voice-explain";

export const runtime = "nodejs";

/**
 * @operator-surface yes
 *
 * @api GET /api/callers/[callerId]/cascade/voice
 * @visibility internal
 * @scope cascade:read
 * @auth session
 * @tags callers, voice, cascade
 * @description Returns the full voice-config cascade explanation for one
 *   caller — which layer (system / provider / domain / course) wins for
 *   every cascadeable field, plus the per-layer value + present-flag for
 *   non-winning layers. Read-only; no DB writes, no AuditLog row (mirrors
 *   #1290 deferral pending a shared audit-event table).
 *
 *   Secret keys (modelSecret / secret / apiKey / webhookSecret) are
 *   hard-stripped from the response.
 * @pathParam callerId string - The caller ID
 * @response 200 { data: VoiceCascadeExplanation }
 * @response 401 { error: "Unauthorized" }
 * @response 403 { error: "Forbidden" } - role below OPERATOR
 * @response 500 { data: null, error: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;

  try {
    const data = await explainVoiceCascade(callerId);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cascade/voice] failed for callerId=${callerId}:`, message);
    return NextResponse.json(
      { data: null, error: message },
      { status: 500 },
    );
  }
}

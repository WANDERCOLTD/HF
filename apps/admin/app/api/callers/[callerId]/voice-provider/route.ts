import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveVoiceProviderForCaller } from "@/lib/voice/resolve-voice-provider";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

export const runtime = "nodejs";

/**
 * @api GET /api/callers/[callerId]/voice-provider
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, voice
 * @description Returns the caller's voice-provider override (the raw
 *   field) AND the resolved slug (cascade output) so educators can see
 *   what setting is in place vs what the system will actually use.
 *   Lists registered providers from the VoiceProvider table so the UI
 *   can render a select.
 * @response 200 { ok: true, override: string | null, resolved: { slug, source }, options: { slug, displayName }[] }
 * @response 404 { ok: false, error: "Caller not found" }
 */
export async function GET(_req: Request, { params }: { params: Promise<{ callerId: string }> }) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;


  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, voiceProvider: true },
  });
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
  }

  const resolved = await resolveVoiceProviderForCaller(callerId);

  const options = await prisma.voiceProvider.findMany({
    where: { enabled: true },
    select: { slug: true, displayName: true },
    orderBy: [{ isDefault: "desc" }, { slug: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    override: caller.voiceProvider,
    resolved,
    options,
  });
}

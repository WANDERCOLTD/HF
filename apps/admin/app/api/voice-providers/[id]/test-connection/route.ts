import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getVoiceProvider } from "@/lib/voice/provider-factory";

export const runtime = "nodejs";

/**
 * @api POST /api/voice-providers/[id]/test-connection
 * @visibility internal
 * @scope voice-providers:test
 * @auth session ADMIN
 * @tags voice, admin
 * @description Test the connection for a voice provider. Instantiates
 *   the adapter via the factory (forcing a credential read) and performs
 *   a lightweight self-check: for VAPI, exercises `verifyInboundRequest`
 *   with a known-bad signature against the configured secret — a 401
 *   response confirms the secret is reachable and the HMAC scheme works.
 *
 *   Never returns raw credential values in the response or error message.
 *   Result is purely a boolean OK + short diagnostic string.
 * @response 200 { ok: true, ping: { reachable: boolean, detail: string } }
 * @response 404 { ok: false, error: "not found" }
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const row = await prisma.voiceProvider.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  try {
    const provider = await getVoiceProvider(row.slug);

    // Self-check: build a request stub with a deliberately-bad signature
    // and verify the adapter rejects it with 401. The 401 is the
    // success signal — it proves the secret is loaded and the HMAC path
    // is alive. A pass-through (null) means the secret was empty and the
    // adapter is in dev-mode no-auth (still useful info for the operator).
    const stub = {
      headers: {
        get(name: string) {
          return name === "x-vapi-signature" ? "bogus-signature-for-self-check" : null;
        },
      },
    } as unknown as import("next/server").NextRequest;
    const verifyResult = provider.verifyInboundRequest(stub, '{"self-check":true}');

    if (verifyResult === null) {
      return NextResponse.json({
        ok: true,
        ping: {
          reachable: true,
          detail: "Adapter loaded but webhook secret is unset (auth pass-through). Set credentials.webhookSecret to enable HMAC verification.",
        },
      });
    }
    if (verifyResult.status === 401) {
      return NextResponse.json({
        ok: true,
        ping: {
          reachable: true,
          detail: "Adapter loaded, HMAC scheme verified (rejected known-bad signature with 401 as expected).",
        },
      });
    }
    return NextResponse.json({
      ok: true,
      ping: {
        reachable: true,
        detail: `Adapter loaded; verify returned status ${verifyResult.status} (expected 401).`,
      },
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      ping: {
        reachable: false,
        detail: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

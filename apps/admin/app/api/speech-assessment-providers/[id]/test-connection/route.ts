import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSpeechAssessmentProvider } from "@/lib/speech-assessment/provider-factory";

export const runtime = "nodejs";

/**
 * @api POST /api/speech-assessment-providers/[id]/test-connection
 * @visibility internal
 * @scope speech-assessment-providers:test
 * @auth session ADMIN
 * @tags voice, scoring, admin
 * @description Test that the adapter for a speech assessment provider is
 *   loadable. Instantiates the adapter via the factory (forcing a
 *   credential read + adapterKey whitelist check) and invokes
 *   `getCapabilities()` — a pure introspection method that never calls
 *   the vendor.
 *
 *   **No live scoring call is made.** Both SpeechAce and SpeechSuper
 *   charge per-second of scored audio; a probe that hit the scoring
 *   endpoint would cost on every click. The capabilities probe is free
 *   and verifies the adapter loads + the credentials JSON deserialises
 *   without throwing.
 *
 *   Never returns raw credential values in the response or error message.
 * @response 200 { ok: true, ping: { reachable: boolean, capabilities?, detail } }
 * @response 404 { ok: false, error: "not found" }
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const row = await prisma.speechAssessmentProvider.findUnique({
    where: { id },
  });
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "not found" },
      { status: 404 },
    );
  }

  try {
    const adapter = await getSpeechAssessmentProvider(row.slug);
    const capabilities = adapter.getCapabilities();
    return NextResponse.json({
      ok: true,
      ping: {
        reachable: true,
        capabilities,
        detail:
          "Adapter loaded and capabilities probe succeeded. No live vendor call was made (would incur per-second scoring cost).",
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

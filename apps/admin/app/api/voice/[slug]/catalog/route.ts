import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getVoiceProvider } from "@/lib/voice/provider-factory";

export const runtime = "nodejs";

/**
 * @operator-surface yes
 *
 * @api GET /api/voice/[slug]/catalog
 * @visibility internal
 * @scope voice:catalog:read
 * @auth session OPERATOR
 * @tags voice, voice-config, anyvoice
 * @description Returns the catalog of legal voiceIds per TTS engine routed
 *   via this provider's adapter (#1421 Slice A). Used by `VoiceConfigSection`
 *   and `/x/settings/voice-providers/[id]` to populate the voiceId dropdown,
 *   filtered by the currently-selected `voiceProvider` enum value.
 *
 *   When `?voiceProvider=<key>` is supplied, the response is filtered
 *   server-side. When omitted, the full catalog across every TTS engine
 *   the adapter supports is returned (UI then filters client-side).
 *
 *   Pre-#1421 `voiceId` was a free-text input — a typo (e.g. "aster"
 *   instead of "asteria") silently broke live calls. The dropdown +
 *   validation makes that bug class structural.
 *
 * @query voiceProvider {string} optional. Filter the catalog by a single
 *   TTS engine key ("deepgram", "openai", "11labs", "azure", "playht").
 *
 * @response 200 {
 *   ok: true,
 *   voices: [{ voiceProvider, voiceId, label, description? }],
 *   hasCustomHatch: boolean,
 * }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Provider not found" }
 * @response 501 { ok: false, error: "Provider does not expose getVoiceCatalog" }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { slug } = await params;
  let provider;
  try {
    provider = await getVoiceProvider(slug);
  } catch {
    return NextResponse.json(
      { ok: false, error: `Provider "${slug}" not found` },
      { status: 404 },
    );
  }

  if (typeof provider.getVoiceCatalog !== "function") {
    return NextResponse.json(
      {
        ok: false,
        error: `Provider "${slug}" does not expose a voice catalog. The voiceId field stays as free-text for this adapter.`,
      },
      { status: 501 },
    );
  }

  const all = provider.getVoiceCatalog();
  const url = new URL(request.url);
  const filter = url.searchParams.get("voiceProvider");
  const voices = filter
    ? all.filter((v) => v.voiceProvider === filter)
    : all;

  // The UI shows a "Custom voice ID…" hatch when the currently-selected
  // voiceProvider has zero entries in the catalog (account-specific
  // providers like ElevenLabs). Pre-compute this so the UI doesn't need
  // to re-derive it from voices.length.
  const hasCustomHatch = filter !== null && voices.length === 0;

  return NextResponse.json({ ok: true, voices, hasCustomHatch });
}

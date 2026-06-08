/**
 * Seed the VoiceProvider table (AnyVoice #1031).
 *
 * Idempotent: re-runs do NOT overwrite existing credentials. The seed
 * only inserts a row when slug = "vapi" doesn't exist yet. Once the row
 * exists, credential management is the operator's job via the admin UI
 * at /x/settings/voice-providers.
 *
 * Bootstrap source: env vars `VAPI_API_KEY` and `VAPI_WEBHOOK_SECRET`.
 * These are the legacy locations from before #1031. The seed reads them
 * once, writes them into the DB row, and from that point on the env
 * vars can be removed from secrets storage.
 *
 * Usage (run on VM after migration):
 *   npx tsx prisma/seed-voice-providers.ts
 *
 * Re-runs are safe; nothing is overwritten. To rotate credentials after
 * seeding, use /x/settings/voice-providers/vapi (admin UI) or PATCH
 * /api/voice-providers/<id>.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.voiceProvider.findUnique({
    where: { slug: "vapi" },
  });

  if (existing) {
    console.log(
      `[seed:voice-providers] slug=vapi already exists (id=${existing.id}) — leaving credentials unchanged. To rotate, use /x/settings/voice-providers.`,
    );
    return;
  }

  const apiKey = process.env.VAPI_API_KEY ?? "";
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET ?? "";

  if (!apiKey && !webhookSecret) {
    console.warn(
      "[seed:voice-providers] No VAPI_API_KEY or VAPI_WEBHOOK_SECRET in env. Creating row with empty credentials — set them via /x/settings/voice-providers before any live calls.",
    );
  } else {
    console.log(
      `[seed:voice-providers] Bootstrapping from env vars (apiKey=${apiKey ? "set" : "empty"}, webhookSecret=${webhookSecret ? "set" : "empty"}).`,
    );
  }

  // #1334 — bootstrap with Deepgram Aura Asteria as the default TTS.
  // Rationale + alternatives in docs/decisions/2026-06-08-pilot-cheaper-tts.md.
  // ~12× cheaper than ElevenLabs default at equivalent conversational quality;
  // co-located with the default Deepgram STT for lowest round-trip latency.
  // Operator can flip at /x/settings/voice-providers/<id>.
  const row = await prisma.voiceProvider.create({
    data: {
      slug: "vapi",
      displayName: "VAPI Voice AI",
      adapterKey: "vapi",
      credentials: { apiKey, webhookSecret },
      config: { voiceProvider: "deepgram", voiceId: "asteria" },
      isDefault: true,
      enabled: true,
    },
  });

  console.log(
    `[seed:voice-providers] Created VoiceProvider row id=${row.id} slug=vapi isDefault=true enabled=true`,
  );
}

main()
  .catch((err) => {
    console.error("[seed:voice-providers] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

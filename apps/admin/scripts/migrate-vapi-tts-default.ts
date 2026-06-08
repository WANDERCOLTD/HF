/**
 * One-off migration — adopt Deepgram Aura Asteria as the default TTS on the
 * VAPI VoiceProvider row (#1334).
 *
 * Why a separate script and not the seed:
 *   - `prisma/seed-voice-providers.ts` is intentionally idempotent on the
 *     CREATE path only — it never overwrites an existing row's credentials
 *     or config, so an operator who has manually tuned a row never gets
 *     stomped by a re-seed.
 *   - The default-TTS change in #1334 needs to reach existing envs (hf_sandbox,
 *     hf_staging, etc.) where the row already exists with `config: {}`.
 *
 * Safety rules (run-anywhere idempotent):
 *   - Only touches the `vapi` slug row.
 *   - Only writes when `config.voiceProvider` is UNSET (= row predates #1334)
 *     OR is the prior default `"11labs"` WITH `voiceId` unset / empty (= row
 *     has the implicit ElevenLabs default, no operator override).
 *   - Leaves any row where the operator has explicitly set a non-empty
 *     `voiceId` alone — operator intent wins.
 *   - Verbose logging so an operator running this against multiple envs sees
 *     exactly what happened on each.
 *
 * Usage (run once per env that pre-dated #1334):
 *   npx tsx apps/admin/scripts/migrate-vapi-tts-default.ts
 *
 * Re-runs are no-ops once the migration has applied (or once the row has been
 * tuned away from the defaults).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_VOICE_PROVIDER = "deepgram";
const TARGET_VOICE_ID = "aura-asteria-en";

interface VapiVoiceConfigFragment {
  voiceProvider?: unknown;
  voiceId?: unknown;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const row = await prisma.voiceProvider.findUnique({
    where: { slug: "vapi" },
  });

  if (!row) {
    console.log(
      "[migrate:vapi-tts-default] No VoiceProvider row with slug=vapi found. Nothing to migrate. Run `npx tsx apps/admin/prisma/seed-voice-providers.ts` first.",
    );
    return;
  }

  const cfg = (row.config ?? {}) as VapiVoiceConfigFragment;
  const currentProvider =
    typeof cfg.voiceProvider === "string" ? cfg.voiceProvider : undefined;
  const currentVoiceId =
    typeof cfg.voiceId === "string" ? cfg.voiceId : undefined;

  const providerIsImplicitDefault =
    currentProvider === undefined ||
    (currentProvider === "11labs" && (!currentVoiceId || currentVoiceId.length === 0));

  if (!providerIsImplicitDefault) {
    console.log(
      `[migrate:vapi-tts-default] Row id=${row.id} has operator-set values (voiceProvider=${currentProvider ?? "<unset>"}, voiceId=${currentVoiceId ?? "<unset>"}). Leaving unchanged.`,
    );
    return;
  }

  if (
    currentProvider === TARGET_VOICE_PROVIDER &&
    currentVoiceId === TARGET_VOICE_ID
  ) {
    console.log(
      `[migrate:vapi-tts-default] Row id=${row.id} already on target (voiceProvider=${TARGET_VOICE_PROVIDER}, voiceId=${TARGET_VOICE_ID}). No-op.`,
    );
    return;
  }

  const nextConfig: VapiVoiceConfigFragment = {
    ...cfg,
    voiceProvider: TARGET_VOICE_PROVIDER,
    voiceId: TARGET_VOICE_ID,
  };

  await prisma.voiceProvider.update({
    where: { id: row.id },
    data: { config: nextConfig as object },
  });

  console.log(
    `[migrate:vapi-tts-default] Row id=${row.id} updated.\n` +
      `  before: voiceProvider=${currentProvider ?? "<unset>"}, voiceId=${currentVoiceId ?? "<unset>"}\n` +
      `  after:  voiceProvider=${TARGET_VOICE_PROVIDER}, voiceId=${TARGET_VOICE_ID}\n` +
      `  Reason: pre-#1334 implicit ElevenLabs default. See docs/decisions/2026-06-08-pilot-cheaper-tts.md.\n` +
      `  Provider cache invalidation: pick up on next call-start (5-min TTL) OR restart server.`,
  );
}

main()
  .catch((err) => {
    console.error("[migrate:vapi-tts-default] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

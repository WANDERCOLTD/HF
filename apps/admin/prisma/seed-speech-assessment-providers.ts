/**
 * Seed the SpeechAssessmentProvider table (#1118).
 *
 * Idempotent: re-runs do NOT overwrite existing credentials. Both rows
 * are created with `enabled: false` + empty credentials — an operator
 * must go to /x/settings/voice-scoring-providers, paste vendor keys, and
 * flip enabled to true before the PROSODY pipeline stage (#1119) can
 * resolve them.
 *
 * Neither row is `isDefault: true` — the PROSODY stage is gated on a
 * per-playbook config flag (Option A from the TL review), so no
 * sandbox-wide default is needed.
 *
 * Usage (run on VM after migration):
 *   npx tsx prisma/seed-speech-assessment-providers.ts
 *
 * Re-runs are safe; nothing is overwritten.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedRow {
  slug: string;
  displayName: string;
  adapterKey: string;
}

const ROWS: SeedRow[] = [
  {
    slug: "speechace",
    displayName: "SpeechAce (v9)",
    adapterKey: "speechace",
  },
  {
    slug: "speechsuper",
    displayName: "SpeechSuper (English Spontaneous)",
    adapterKey: "speechsuper",
  },
];

async function main() {
  for (const row of ROWS) {
    const existing = await prisma.speechAssessmentProvider.findUnique({
      where: { slug: row.slug },
    });
    if (existing) {
      console.log(
        `[seed:speech-assessment] slug=${row.slug} already exists (id=${existing.id}) — leaving credentials unchanged.`,
      );
      continue;
    }
    const created = await prisma.speechAssessmentProvider.create({
      data: {
        slug: row.slug,
        displayName: row.displayName,
        adapterKey: row.adapterKey,
        credentials: {},
        config: {},
        isDefault: false,
        enabled: false,
      },
    });
    console.log(
      `[seed:speech-assessment] Created row slug=${row.slug} id=${created.id} (enabled=false; configure at /x/settings/voice-scoring-providers).`,
    );
  }
}

main()
  .catch((err) => {
    console.error("[seed:speech-assessment] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

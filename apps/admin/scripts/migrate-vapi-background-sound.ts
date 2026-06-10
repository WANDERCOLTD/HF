/**
 * One-off migration — normalise `VoiceProvider.config.backgroundSound`
 * to a value VAPI accepts (#1438).
 *
 * Why a separate script and not the seed:
 *   - `prisma/seed-voice-providers.ts` only writes on CREATE — operator-set
 *     rows are left alone — so a stale stored value never gets stomped by
 *     a re-seed.
 *   - The structural fix (drop "phone-line" from the adapter schema enum)
 *     stops NEW writes of bad values, but rows in hf_sandbox / hf_staging /
 *     hf_prod still hold the old value until normalised.
 *
 * Live incident: hf_sandbox 2026-06-10 — stored `"phone-line"` reached VAPI
 * and produced a silent 502 chain for every outbound dial.
 *
 * Valid VAPI values: `"off"`, `"office"`, or a URL (`https?://…`).
 * Anything else (including `null`, `""`, the legacy `"phone-line"`) is
 * normalised to `"off"` — VAPI's silent default.
 *
 * Safety rules (run-anywhere idempotent):
 *   - Touches every VoiceProvider row but only mutates when `backgroundSound`
 *     is set AND not a valid value.
 *   - Leaves any URL-shaped string alone (operator may be hosting a custom
 *     audio file — the adapter guard accepts URLs).
 *   - `--dry-run` prints the planned change without writing.
 *   - Re-runs against already-migrated rows are no-ops.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/migrate-vapi-background-sound.ts --dry-run
 *   npx tsx apps/admin/scripts/migrate-vapi-background-sound.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ALLOWED_LITERAL: readonly string[] = ["off", "office"];
const URL_RE = /^https?:\/\/.+/;
const NORMALISED_VALUE = "off";

interface ConfigBlob {
  backgroundSound?: unknown;
  [key: string]: unknown;
}

function isValidValue(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (ALLOWED_LITERAL.includes(v)) return true;
  if (URL_RE.test(v)) return true;
  return false;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await prisma.voiceProvider.findMany({
    select: { id: true, slug: true, config: true },
  });

  let touched = 0;
  let skipped = 0;
  for (const row of rows) {
    const cfg = (row.config ?? {}) as ConfigBlob;
    // The `in` check distinguishes "field unset" (leave alone — adapter
    // omits the key) from "field set but invalid" (normalise to "off").
    if (!("backgroundSound" in cfg)) {
      skipped += 1;
      continue;
    }
    const current = cfg.backgroundSound;
    if (isValidValue(current)) {
      skipped += 1;
      continue;
    }
    const nextConfig: ConfigBlob = { ...cfg, backgroundSound: NORMALISED_VALUE };
    const change = `  ${row.slug} (${row.id}): backgroundSound=${JSON.stringify(current)} → "${NORMALISED_VALUE}"`;
    if (dryRun) {
      console.log(`[dry-run] ${change}`);
    } else {
      await prisma.voiceProvider.update({
        where: { id: row.id },
        data: { config: nextConfig as object },
      });
      console.log(`[updated] ${change}`);
    }
    touched += 1;
  }

  console.log(
    `[migrate:vapi-background-sound] Done. touched=${touched} skipped=${skipped} mode=${dryRun ? "dry-run" : "write"}`,
  );
  if (touched > 0 && !dryRun) {
    console.log(
      `[migrate:vapi-background-sound] Provider cache invalidation: pick up on next call-start (5-min TTL) OR restart server.`,
    );
  }
}

main()
  .catch((err) => {
    console.error("[migrate:vapi-background-sound] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

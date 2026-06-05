import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  getVoiceSystemSettings,
  updateVoiceSystemSettings,
} from "@/lib/voice/system-settings";

export const runtime = "nodejs";

/**
 * @api GET /api/voice-system-settings
 * @visibility internal
 * @scope voice-system-settings:read
 * @auth session ADMIN
 * @tags voice, admin
 * @description Read cross-provider voice settings (cost cap, default
 *   provider slug, audit retention, fallback-on-error). Applies to
 *   every VoiceProvider row. Consumed by the per-provider edit page
 *   and by the #1080 cost-cap watcher.
 * @response 200 { ok: true, settings: VoiceSystemSettings }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const settings = await getVoiceSystemSettings();
  return NextResponse.json({ ok: true, settings });
}

const patchSchema = z
  .object({
    fallbackOnAdapterError: z.enum(["silent", "throw", "escalate"]).optional(),
    maxCostPerCallUsd: z.number().positive().nullable().optional(),
    auditRetentionDays: z.number().int().positive().max(3650).optional(),
    defaultProviderSlug: z.string().max(64).optional(),
  })
  .strict();

/**
 * @api PATCH /api/voice-system-settings
 * @visibility internal
 * @scope voice-system-settings:write
 * @auth session ADMIN
 * @tags voice, admin
 * @description Update one or more cross-provider voice settings. Partial
 *   payload accepted. Invalidates the read cache on success so the next
 *   read sees the new value.
 * @body Partial<VoiceSystemSettings>
 * @response 200 { ok: true, settings: VoiceSystemSettings }
 */
export async function PATCH(req: Request) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  const settings = await updateVoiceSystemSettings(parsed.data);
  return NextResponse.json({ ok: true, settings });
}

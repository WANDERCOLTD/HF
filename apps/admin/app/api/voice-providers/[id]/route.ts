import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { maskCredentials } from "@/lib/voice/mask-credentials";
import { invalidateVoiceProviderCache } from "@/lib/voice/provider-factory";
import { VOICE_ADAPTERS } from "@/lib/voice/adapter-registry";

export const runtime = "nodejs";

/**
 * @api GET /api/voice-providers/[id]
 * @visibility internal
 * @scope voice-providers:read
 * @auth session ADMIN
 * @tags voice, admin
 * @description Get a single voice provider by id. Credentials masked.
 * @response 200 { ok: true, provider: VoiceProvider (credentials masked) }
 * @response 404 { ok: false, error: "not found" }
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const row = await prisma.voiceProvider.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // AnyVoice #1044 — return the adapter's schema + capabilities alongside
  // the row so the edit page can render a typed form without a second
  // round-trip. Adapter is instantiated with empty creds + config purely
  // to invoke its pure introspection methods; never used for transport.
  const AdapterCtor = VOICE_ADAPTERS[row.adapterKey];
  let configSchema = null;
  let capabilities = null;
  if (AdapterCtor) {
    const probe = new AdapterCtor({}, {});
    configSchema = probe.getConfigSchema();
    capabilities = probe.getCapabilities();
  }

  return NextResponse.json({
    ok: true,
    provider: {
      ...row,
      credentials: maskCredentials(row.credentials as Record<string, unknown>),
    },
    configSchema,
    capabilities,
  });
}

const patchSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  adapterKey: z.string().min(1).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/**
 * @api PATCH /api/voice-providers/[id]
 * @visibility internal
 * @scope voice-providers:write
 * @auth session ADMIN
 * @tags voice, admin
 * @description Update a voice provider. `slug` is immutable (would orphan
 *   downstream `Call.voiceProvider` / `Caller.voiceProvider` references).
 *   Setting `isDefault: true` unsets the flag on all others atomically.
 *   The factory cache for this slug is invalidated immediately after the
 *   write — a credential rotation propagates within milliseconds, not
 *   the 5-minute TTL window.
 * @body { displayName?, adapterKey?, credentials?, config?, isDefault?, enabled? }
 * @response 200 { ok: true, provider: VoiceProvider (credentials masked) }
 * @response 400 { ok: false, error: string }
 * @response 404 { ok: false, error: "not found" }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (data.adapterKey && !VOICE_ADAPTERS[data.adapterKey]) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown adapterKey: ${data.adapterKey}. Registered keys: ${Object.keys(VOICE_ADAPTERS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const existing = await prisma.voiceProvider.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // AnyVoice #1044 — validate credentials + config against the adapter's
  // declared schema before persisting. Required fields cannot be empty
  // strings; enum fields must be in the allowed set; numbers must be
  // finite. The adapter owns its schema; this loop is mechanical.
  const adapterKey = data.adapterKey ?? existing.adapterKey;
  const AdapterCtor = VOICE_ADAPTERS[adapterKey];
  if (AdapterCtor) {
    const probe = new AdapterCtor({}, {});
    const schema = probe.getConfigSchema();
    const merged: Record<string, unknown> = {
      ...((existing.credentials ?? {}) as Record<string, unknown>),
      ...((existing.config ?? {}) as Record<string, unknown>),
      ...((data.credentials ?? {}) as Record<string, unknown>),
      ...((data.config ?? {}) as Record<string, unknown>),
    };
    const fieldErrors: string[] = [];
    for (const field of schema.fields) {
      const v = merged[field.key];
      if (field.required && (v === undefined || v === null || v === "")) {
        fieldErrors.push(`${field.key} is required`);
        continue;
      }
      if (v === undefined || v === null || v === "") continue;
      if (field.type === "number" && typeof v !== "number") {
        fieldErrors.push(`${field.key} must be a number`);
      } else if (field.type === "boolean" && typeof v !== "boolean") {
        fieldErrors.push(`${field.key} must be a boolean`);
      } else if (
        field.type === "enum" &&
        (typeof v !== "string" || !field.enumValues?.includes(v))
      ) {
        fieldErrors.push(
          `${field.key} must be one of: ${(field.enumValues ?? []).join(", ")}`,
        );
      } else if (field.type === "string" && typeof v !== "string") {
        fieldErrors.push(`${field.key} must be a string`);
      }
    }
    if (fieldErrors.length > 0) {
      return NextResponse.json(
        { ok: false, error: fieldErrors.join("; ") },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.voiceProvider.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.voiceProvider.update({
      where: { id },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.adapterKey !== undefined ? { adapterKey: data.adapterKey } : {}),
        ...(data.credentials !== undefined
          ? { credentials: data.credentials as Prisma.InputJsonValue }
          : {}),
        ...(data.config !== undefined ? { config: data.config as Prisma.InputJsonValue } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    });
  });

  invalidateVoiceProviderCache(updated.slug);

  return NextResponse.json({
    ok: true,
    provider: {
      ...updated,
      credentials: maskCredentials(updated.credentials as Record<string, unknown>),
    },
  });
}

/**
 * @api DELETE /api/voice-providers/[id]
 * @visibility internal
 * @scope voice-providers:write
 * @auth session ADMIN
 * @tags voice, admin
 * @description Delete a voice provider. Cannot delete the row with
 *   `isDefault: true` — first PATCH another row to be the default, then
 *   delete this one. Cache for the deleted slug is invalidated.
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "not found" }
 * @response 409 { ok: false, error: "cannot delete the default provider" }
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const row = await prisma.voiceProvider.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  if (row.isDefault) {
    return NextResponse.json(
      { ok: false, error: "cannot delete the default provider — set another as default first" },
      { status: 409 },
    );
  }

  await prisma.voiceProvider.delete({ where: { id } });
  invalidateVoiceProviderCache(row.slug);

  return NextResponse.json({ ok: true });
}

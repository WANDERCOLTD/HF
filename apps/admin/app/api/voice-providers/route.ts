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
 * @api GET /api/voice-providers
 * @visibility internal
 * @scope voice-providers:read
 * @auth session ADMIN
 * @tags voice, admin
 * @description List all registered voice providers. Credentials are MASKED
 *   in the response — any key in `credentials` whose name ends in `key`,
 *   `secret`, `token`, or `password` is replaced with `***`. Raw values
 *   are never returned by this route.
 * @response 200 { ok: true, providers: VoiceProvider[] (credentials masked) }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const rows = await prisma.voiceProvider.findMany({
    orderBy: [{ isDefault: "desc" }, { slug: "asc" }],
  });
  const providers = rows.map((row) => ({
    ...row,
    credentials: maskCredentials(row.credentials as Record<string, unknown>),
  }));
  return NextResponse.json({ ok: true, providers });
}

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, "slug must be lowercase letters/digits/hyphens, starting with a letter"),
  displayName: z.string().min(1).max(128),
  adapterKey: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()).optional().default({}),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  isDefault: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});

/**
 * @api POST /api/voice-providers
 * @visibility internal
 * @scope voice-providers:write
 * @auth session ADMIN
 * @tags voice, admin
 * @description Create a new voice provider. `adapterKey` must match an
 *   entry in `lib/voice/adapter-registry.ts::VOICE_ADAPTERS`. Setting
 *   `isDefault: true` unsets the flag on all other providers in the same
 *   transaction (only one default allowed; enforced in code because
 *   Postgres lacks a clean partial unique index on a boolean).
 * @body { slug, displayName, adapterKey, credentials?, config?, isDefault?, enabled? }
 * @response 201 { ok: true, provider: VoiceProvider (credentials masked) }
 * @response 400 { ok: false, error: string } — validation or unknown adapterKey
 * @response 409 { ok: false, error: "slug already exists" }
 */
export async function POST(request: Request) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (!VOICE_ADAPTERS[data.adapterKey]) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown adapterKey: ${data.adapterKey}. Registered keys: ${Object.keys(VOICE_ADAPTERS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const existing = await prisma.voiceProvider.findUnique({ where: { slug: data.slug } });
  if (existing) {
    return NextResponse.json({ ok: false, error: "slug already exists" }, { status: 409 });
  }

  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.voiceProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.voiceProvider.create({
      data: {
        slug: data.slug,
        displayName: data.displayName,
        adapterKey: data.adapterKey,
        credentials: (data.credentials ?? {}) as Prisma.InputJsonValue,
        config: (data.config ?? {}) as Prisma.InputJsonValue,
        isDefault: data.isDefault,
        enabled: data.enabled,
      },
    });
  });

  invalidateVoiceProviderCache(row.slug);

  return NextResponse.json(
    {
      ok: true,
      provider: {
        ...row,
        credentials: maskCredentials(row.credentials as Record<string, unknown>),
      },
    },
    { status: 201 },
  );
}

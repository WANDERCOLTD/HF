import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { maskCredentials } from "@/lib/voice/mask-credentials";
import { invalidateSpeechAssessmentProviderCache } from "@/lib/speech-assessment/provider-factory";
import { SPEECH_ASSESSMENT_ADAPTERS } from "@/lib/speech-assessment/adapter-registry";

export const runtime = "nodejs";

/**
 * @api GET /api/speech-assessment-providers
 * @visibility internal
 * @scope speech-assessment-providers:read
 * @auth session ADMIN
 * @tags voice, scoring, admin
 * @description List all registered speech assessment providers (SpeechAce,
 *   SpeechSuper). Credentials masked via `maskCredentials` — any key whose
 *   name ends in `key`, `secret`, `token`, or `password` is replaced with
 *   `***`. Raw secrets never leave the server.
 * @response 200 { ok: true, providers: SpeechAssessmentProvider[] (credentials masked) }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const rows = await prisma.speechAssessmentProvider.findMany({
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
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "slug must be lowercase letters/digits/hyphens, starting with a letter",
    ),
  displayName: z.string().min(1).max(128),
  adapterKey: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()).optional().default({}),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  isDefault: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});

/**
 * @api POST /api/speech-assessment-providers
 * @visibility internal
 * @scope speech-assessment-providers:write
 * @auth session ADMIN
 * @tags voice, scoring, admin
 * @description Create a new speech assessment provider. `adapterKey` must
 *   match an entry in `SPEECH_ASSESSMENT_ADAPTERS`. `isDefault: true`
 *   unsets the flag on every other provider in the same transaction.
 * @body { slug, displayName, adapterKey, credentials?, config?, isDefault?, enabled? }
 * @response 201 { ok: true, provider: SpeechAssessmentProvider (credentials masked) }
 * @response 400 { ok: false, error: string }
 * @response 409 { ok: false, error: "slug already exists" }
 */
export async function POST(request: Request) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (!SPEECH_ASSESSMENT_ADAPTERS[data.adapterKey]) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown adapterKey: ${data.adapterKey}. Registered keys: ${Object.keys(SPEECH_ASSESSMENT_ADAPTERS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const existing = await prisma.speechAssessmentProvider.findUnique({
    where: { slug: data.slug },
  });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "slug already exists" },
      { status: 409 },
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.speechAssessmentProvider.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.speechAssessmentProvider.create({
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

  invalidateSpeechAssessmentProviderCache(row.slug);

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

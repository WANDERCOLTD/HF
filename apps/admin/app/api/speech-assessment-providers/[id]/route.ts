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
 * @api GET /api/speech-assessment-providers/[id]
 * @visibility internal
 * @scope speech-assessment-providers:read
 * @auth session ADMIN
 * @tags voice, scoring, admin
 * @description Get a single speech assessment provider by id. Credentials
 *   masked. Response also includes the adapter's `configSchema` +
 *   `capabilities` (instantiated with empty creds purely to invoke its
 *   pure introspection methods).
 * @response 200 { ok: true, provider, configSchema, capabilities }
 * @response 404 { ok: false, error: "not found" }
 */
export async function GET(
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

  const AdapterCtor = SPEECH_ASSESSMENT_ADAPTERS[row.adapterKey];
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
 * @api PATCH /api/speech-assessment-providers/[id]
 * @visibility internal
 * @scope speech-assessment-providers:write
 * @auth session ADMIN
 * @tags voice, scoring, admin
 * @description Update a speech assessment provider. `slug` is immutable
 *   (Call FK references could rot). `isDefault: true` unsets the flag on
 *   every other row in the same transaction. Cache invalidated immediately
 *   so credential rotations propagate without waiting for TTL.
 *
 *   Field validation: every field declared in the adapter's `configSchema`
 *   is checked against the merged credentials+config. Required fields
 *   cannot be empty, enum values must match `enumValues`, types must
 *   match.
 * @body { displayName?, adapterKey?, credentials?, config?, isDefault?, enabled? }
 * @response 200 { ok: true, provider (credentials masked) }
 * @response 400 { ok: false, error: string }
 * @response 404 { ok: false, error: "not found" }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (data.adapterKey && !SPEECH_ASSESSMENT_ADAPTERS[data.adapterKey]) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown adapterKey: ${data.adapterKey}. Registered keys: ${Object.keys(SPEECH_ASSESSMENT_ADAPTERS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const existing = await prisma.speechAssessmentProvider.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "not found" },
      { status: 404 },
    );
  }

  const adapterKey = data.adapterKey ?? existing.adapterKey;
  const AdapterCtor = SPEECH_ASSESSMENT_ADAPTERS[adapterKey];
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
      if (
        field.required &&
        (v === undefined || v === null || v === "")
      ) {
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
      await tx.speechAssessmentProvider.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.speechAssessmentProvider.update({
      where: { id },
      data: {
        ...(data.displayName !== undefined
          ? { displayName: data.displayName }
          : {}),
        ...(data.adapterKey !== undefined
          ? { adapterKey: data.adapterKey }
          : {}),
        ...(data.credentials !== undefined
          ? { credentials: data.credentials as Prisma.InputJsonValue }
          : {}),
        ...(data.config !== undefined
          ? { config: data.config as Prisma.InputJsonValue }
          : {}),
        ...(data.isDefault !== undefined
          ? { isDefault: data.isDefault }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    });
  });

  invalidateSpeechAssessmentProviderCache(updated.slug);

  return NextResponse.json({
    ok: true,
    provider: {
      ...updated,
      credentials: maskCredentials(
        updated.credentials as Record<string, unknown>,
      ),
    },
  });
}

/**
 * @api DELETE /api/speech-assessment-providers/[id]
 * @visibility internal
 * @scope speech-assessment-providers:write
 * @auth session ADMIN
 * @tags voice, scoring, admin
 * @description Delete a speech assessment provider. Refuses if the row
 *   has `isDefault: true` — flip another to default first.
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "not found" }
 * @response 409 { ok: false, error: "cannot delete the default provider" }
 */
export async function DELETE(
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
  if (row.isDefault) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "cannot delete the default provider — set another as default first",
      },
      { status: 409 },
    );
  }

  await prisma.speechAssessmentProvider.delete({ where: { id } });
  invalidateSpeechAssessmentProviderCache(row.slug);

  return NextResponse.json({ ok: true });
}

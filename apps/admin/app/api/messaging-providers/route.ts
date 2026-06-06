import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { MESSAGING_ADAPTERS } from "@/lib/messaging/registry";

export const runtime = "nodejs";

/**
 * @api GET /api/messaging-providers
 * @visibility internal
 * @scope messaging-providers:read
 * @auth session ADMIN
 * @tags messaging, admin
 * @description List all registered messaging providers. Sorted: SYSTEM
 *   defaults first (institutionId IS NULL), then by adapterKey, then by
 *   slug. Secret values are NEVER returned — only `secretRef` (the secret
 *   name in Secret Manager) is exposed.
 * @response 200 { ok: true, providers: MessagingProvider[] }
 */
export async function GET() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const providers = await prisma.messagingProvider.findMany({
    orderBy: [
      { institutionId: "asc" }, // NULLs first in Postgres asc
      { adapterKey: "asc" },
      { isDefault: "desc" },
      { slug: "asc" },
    ],
  });
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
  secretRef: z.string().min(1).max(128),
  fromAddress: z.string().min(1).max(256),
  institutionId: z.string().nullable().optional().default(null),
  isDefault: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});

/**
 * @api POST /api/messaging-providers
 * @visibility internal
 * @scope messaging-providers:write
 * @auth session ADMIN
 * @tags messaging, admin
 * @description Create a new messaging provider. `adapterKey` must match an
 *   entry in `lib/messaging/registry.ts::MESSAGING_ADAPTERS`. Setting
 *   `isDefault: true` unsets the flag on all other SYSTEM rows in the same
 *   transaction (institution-scoped rows are unaffected by SYSTEM default
 *   toggles — they win the cascade outright).
 *
 *   Postgres enforces a partial unique index on `(adapterKey) WHERE
 *   institutionId IS NULL` to prevent two SYSTEM-default rows for the same
 *   adapter — see the migration. The application-layer 409 below is the
 *   friendlier surfacing of the same constraint.
 * @body { slug, displayName, adapterKey, secretRef, fromAddress, institutionId?, isDefault?, enabled? }
 * @response 201 { ok: true, provider: MessagingProvider }
 * @response 400 { ok: false, error: string } — validation or unknown adapterKey
 * @response 409 { ok: false, error: string } — slug or (institutionId, adapterKey) collision
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

  if (!MESSAGING_ADAPTERS[data.adapterKey]) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown adapterKey: ${data.adapterKey}. Registered keys: ${Object.keys(
          MESSAGING_ADAPTERS,
        ).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const existingSlug = await prisma.messagingProvider.findUnique({ where: { slug: data.slug } });
  if (existingSlug) {
    return NextResponse.json({ ok: false, error: "slug already exists" }, { status: 409 });
  }

  // Application-layer 409 — also enforced by the partial unique index on
  // the NULL case (race-safe). For non-null institutionId the @@unique
  // constraint handles it.
  const dupScope = await prisma.messagingProvider.findFirst({
    where: { institutionId: data.institutionId, adapterKey: data.adapterKey },
  });
  if (dupScope) {
    return NextResponse.json(
      {
        ok: false,
        error: `A provider with adapterKey '${data.adapterKey}' already exists for this scope (${
          data.institutionId === null ? "SYSTEM default" : `institution ${data.institutionId}`
        }).`,
      },
      { status: 409 },
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault && data.institutionId === null) {
      await tx.messagingProvider.updateMany({
        where: {
          institutionId: null,
          adapterKey: data.adapterKey,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }
    return tx.messagingProvider.create({
      data: {
        slug: data.slug,
        displayName: data.displayName,
        adapterKey: data.adapterKey,
        secretRef: data.secretRef,
        fromAddress: data.fromAddress,
        institutionId: data.institutionId,
        isDefault: data.isDefault,
        enabled: data.enabled,
      },
    });
  });

  return NextResponse.json({ ok: true, provider: row }, { status: 201 });
}

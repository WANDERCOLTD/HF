import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { MESSAGING_ADAPTERS } from "@/lib/messaging/registry";

export const runtime = "nodejs";

/**
 * @api GET /api/messaging-providers/[id]
 * @visibility internal
 * @scope messaging-providers:read
 * @auth session ADMIN
 * @response 200 { ok: true, provider: MessagingProvider }
 * @response 404 { ok: false, error: "not found" }
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const row = await prisma.messagingProvider.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, provider: row });
}

const patchSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  adapterKey: z.string().min(1).optional(),
  secretRef: z.string().min(1).max(128).optional(),
  fromAddress: z.string().min(1).max(256).optional(),
  institutionId: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/**
 * @api PATCH /api/messaging-providers/[id]
 * @visibility internal
 * @scope messaging-providers:write
 * @auth session ADMIN
 * @description Update a messaging provider. `slug` is immutable. Setting
 *   `isDefault: true` for a SYSTEM-scope row unsets the flag on the
 *   sibling SYSTEM rows for the same adapterKey atomically.
 * @response 200 { ok: true, provider: MessagingProvider }
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

  if (data.adapterKey && !MESSAGING_ADAPTERS[data.adapterKey]) {
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

  const existing = await prisma.messagingProvider.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const willBeSystem = (data.institutionId ?? existing.institutionId) === null;
    const willBeDefault = data.isDefault ?? existing.isDefault;
    const willBeAdapterKey = data.adapterKey ?? existing.adapterKey;
    if (willBeSystem && willBeDefault) {
      await tx.messagingProvider.updateMany({
        where: {
          institutionId: null,
          adapterKey: willBeAdapterKey,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }
    return tx.messagingProvider.update({
      where: { id },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.adapterKey !== undefined ? { adapterKey: data.adapterKey } : {}),
        ...(data.secretRef !== undefined ? { secretRef: data.secretRef } : {}),
        ...(data.fromAddress !== undefined ? { fromAddress: data.fromAddress } : {}),
        ...(data.institutionId !== undefined ? { institutionId: data.institutionId } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    });
  });

  return NextResponse.json({ ok: true, provider: updated });
}

/**
 * @api DELETE /api/messaging-providers/[id]
 * @visibility internal
 * @scope messaging-providers:write
 * @auth session ADMIN
 * @description Soft-disable a provider (sets enabled=false). Hard delete
 *   is reserved for SUPERADMIN via DB tools — we don't want to orphan
 *   audit logs that reference a slug. The SYSTEM-default row CANNOT be
 *   disabled if it's the only enabled provider for its adapterKey scope
 *   (would brick the PIN flow).
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "not found" }
 * @response 409 { ok: false, error: string }
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;
  const row = await prisma.messagingProvider.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  // Refuse to disable the last enabled SYSTEM provider for this adapterKey
  // — would leave the resolver with nothing to return for SYSTEM scope.
  if (row.institutionId === null && row.enabled) {
    const otherEnabled = await prisma.messagingProvider.count({
      where: {
        institutionId: null,
        adapterKey: row.adapterKey,
        enabled: true,
        NOT: { id },
      },
    });
    if (otherEnabled === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot disable the last enabled SYSTEM provider for adapterKey '${row.adapterKey}'. Add another enabled SYSTEM row first, then disable this one.`,
        },
        { status: 409 },
      );
    }
  }

  await prisma.messagingProvider.update({
    where: { id },
    data: { enabled: false, isDefault: false },
  });

  return NextResponse.json({ ok: true });
}

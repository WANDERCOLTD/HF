import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  resolveCallerScopeForReading,
  isScopeError,
} from "@/lib/learner-scope";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    phone: z.string().trim().min(7).max(20),
  })
  .strict();

/**
 * @api PATCH /api/callers/[callerId]/phone
 * @visibility internal
 * @scope callers:update-phone
 * @auth session ANY (STUDENT scoped to own caller via learner-scope)
 * @tags callers, voice, anyvoice
 * @description Just-in-time phone capture for the [Call me] button.
 *   When a learner clicks "Call me" and their `Caller.phone` is empty,
 *   the UI inlines a "What's your phone number?" form and PATCHes it
 *   here. STUDENT sessions can only update their own caller's phone;
 *   OPERATOR+ can update any.
 *
 *   E.164-ish normalisation: strip whitespace / dashes / parens. We
 *   don't insist on a strict E.164 prefix because international
 *   formats vary; VAPI's dial API handles further validation.
 *
 * @body { phone: string }
 * @response 200 { ok: true, callerId, phone (normalised) }
 * @response 400 { ok: false, error: zod issues }
 * @response 403 { ok: false, error: "Forbidden" }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 409 { ok: false, error: "Phone already in use" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  // STUDENT-scope guard.
  const scope = await resolveCallerScopeForReading(auth.session, callerId);
  if (isScopeError(scope)) return scope.error;
  if (
    auth.session.user.role === "STUDENT" &&
    scope.scopedCallerId !== callerId
  ) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: not your caller" },
      { status: 403 },
    );
  }

  const normalized = parsed.data.phone.replace(/[\s\-()]/g, "");
  if (!/^\+?\d{7,15}$/.test(normalized)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Phone number should contain only digits (optionally starting with +) and be 7-15 digits long.",
      },
      { status: 400 },
    );
  }

  const existing = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, phone: true },
  });
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
      { status: 404 },
    );
  }

  // Conflict guard — Caller.phone is @@unique. Allow no-op when the
  // submitted value matches what's already on the row (idempotent).
  if (existing.phone === normalized) {
    return NextResponse.json({
      ok: true,
      callerId,
      phone: normalized,
      changed: false,
    });
  }

  const phoneTaken = await prisma.caller.findFirst({
    where: { phone: normalized, NOT: { id: callerId } },
    select: { id: true },
  });
  if (phoneTaken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Phone number already in use by another learner. Reach out to your operator if this is wrong.",
      },
      { status: 409 },
    );
  }

  await prisma.caller.update({
    where: { id: callerId },
    data: { phone: normalized },
  });

  return NextResponse.json({
    ok: true,
    callerId,
    phone: normalized,
    changed: true,
  });
}

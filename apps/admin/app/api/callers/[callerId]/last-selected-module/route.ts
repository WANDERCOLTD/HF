/**
 * @operator-surface yes
 *
 * POST /api/callers/[callerId]/last-selected-module
 *
 * Persist a Caller's most-recent module pick so the sim landing can
 * restore it on a later visit without the `?requestedModuleId=` URL
 * param. Pre-#1245 the choice lived only in the URL — refresh + the
 * pill re-rendered "Pick a module".
 *
 * Auth:
 *   - STUDENT: may only write to their own LEARNER Caller (the param
 *     `callerId` MUST match the session's caller; foreign callerId is
 *     refused with 403).
 *   - OPERATOR+: may write to any Caller (admin-tools surface).
 *
 * Body: `{ moduleId: string | null }`
 *   - non-null → validated against `CurriculumModule.id`
 *   - null     → clears the persisted pick (e.g. when the learner
 *                explicitly "Switch module"s back to the picker before
 *                choosing a new one).
 *
 * @api
 * @method POST
 * @path /api/callers/[callerId]/last-selected-module
 * @auth VIEWER (STUDENT scoped to own caller; OPERATOR+ unrestricted)
 * @request { moduleId: string | null }
 * @response 200 { ok: true, lastSelectedModuleId: string | null }
 * @response 400 { ok: false, error: "invalid body" | "module not found" }
 * @response 403 { ok: false, error: "STUDENT cannot write to a different caller" }
 * @response 404 { ok: false, error: "Caller not found" }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { bumpCallerComposeTimestamp } from "@/lib/compose/bump-timestamp";

const bodySchema = z.object({
  moduleId: z.string().min(1).max(64).nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;


  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid body" },
      { status: 400 },
    );
  }
  const { moduleId } = parsed.data;

  // STUDENT scope: the URL callerId must match the session's own
  // LEARNER caller. Refuse foreign writes — same leak class fixed in
  // #977 for reads, applied to this write.
  if (auth.session.user.role === "STUDENT") {
    const ownCaller = await prisma.caller.findFirst({
      where: { userId: auth.session.user.id, role: "LEARNER" },
      select: { id: true },
    });
    if (!ownCaller || ownCaller.id !== callerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "STUDENT cannot write to a different caller",
        },
        { status: 403 },
      );
    }
  }

  // Validate the moduleId references a real CurriculumModule when set.
  // Without this, an AI tool / a stale URL param could persist a dead
  // FK; the DB-level SetNull cascade catches deletes but not bad
  // initial writes.
  if (moduleId !== null) {
    const module = await prisma.curriculumModule.findUnique({
      where: { id: moduleId },
      select: { id: true },
    });
    if (!module) {
      return NextResponse.json(
        { ok: false, error: "module not found" },
        { status: 400 },
      );
    }
  }

  try {
    const updated = await prisma.caller.update({
      where: { id: callerId },
      data: { lastSelectedModuleId: moduleId },
      select: { id: true, lastSelectedModuleId: true },
    });
    // Module selection is a compose-affecting per-caller write — the
    // composed prompt's `modules` section (transforms/modules.ts) renders
    // around `currentModuleSlug`. Without this bump, the next call serves
    // the previous module's pre-composed prompt via I-CT2 cascade Step 1
    // (Session.producedComposedPromptId) or Step 2 (most-recent ACTIVE
    // ComposedPrompt). Stale runs persist until an unrelated bump fires.
    await bumpCallerComposeTimestamp(callerId);
    return NextResponse.json({
      ok: true,
      lastSelectedModuleId: updated.lastSelectedModuleId,
    });
  } catch (e) {
    // Prisma P2025 = record not found
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 },
      );
    }
    throw e;
  }
}

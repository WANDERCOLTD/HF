/**
 * @operator-surface yes
 *
 * GET /api/callers/[callerId]/module-stall-pool?moduleSlug=<slug>
 *
 * Read-side helper for the client stall detector (#1743, epic #1700
 * Theme 2b). Resolves the caller's active playbook, walks
 * `Playbook.config.modules[]` for the module matching `moduleSlug`, and
 * returns its `settings.scaffoldPool` (or `[]` when unset).
 *
 * Flag-gated by `HF_FLAG_IELTS_MODULE_SETTINGS` per epic #1700 decision 5
 * — flag-off returns an empty pool, which disables the chip.
 *
 * Auth:
 *   - STUDENT: own LEARNER caller only (foreign callerId → 403).
 *   - OPERATOR+: any caller.
 *
 * @api
 * @method GET
 * @path /api/callers/[callerId]/module-stall-pool
 * @auth VIEWER (STUDENT scoped to own caller)
 * @response 200 { ok: true, pool: string[] }
 * @response 400 { ok: false, error: "moduleSlug required" }
 * @response 403 { ok: false, error: "STUDENT cannot read a different caller" }
 * @response 404 { ok: false, error: "Caller not found" }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import { resolveActivePlaybookId } from "@/lib/caller/resolve-active-playbook";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const url = new URL(req.url);
  const moduleSlug = url.searchParams.get("moduleSlug");
  if (!moduleSlug) {
    return NextResponse.json(
      { ok: false, error: "moduleSlug required" },
      { status: 400 },
    );
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
  }

  if (!isIeltsModuleSettingsEnabled()) {
    return NextResponse.json({ ok: true, pool: [] });
  }

  const playbookId = await resolveActivePlaybookId(callerId);
  if (!playbookId) {
    return NextResponse.json({ ok: true, pool: [] });
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  if (!playbook) {
    return NextResponse.json({ ok: true, pool: [] });
  }

  const config = (playbook.config ?? {}) as PlaybookConfig;
  const modules: AuthoredModule[] = config.modules ?? [];
  const matched = modules.find((m) => m.id === moduleSlug);
  const pool = (matched?.settings?.scaffoldPool ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  return NextResponse.json({ ok: true, pool });
}

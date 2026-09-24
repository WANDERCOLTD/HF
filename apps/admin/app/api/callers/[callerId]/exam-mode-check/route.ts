/**
 * @api GET /api/callers/:callerId/exam-mode-check?moduleSlug=mock
 * @visibility public
 * @scope callers:read
 * @auth session (VIEWER+ — STUDENT scoped to own caller)
 * @tags callers, voice
 * @description Returns whether the supplied module slug should mount the
 *   IELTS Mock exam shell (Epic #1700 Theme 4 / #1745) AND the resolved
 *   `AuthoredModule.mode` + `AuthoredModule.sessionTerminal` shape the
 *   canonical `resolveLearnerShell` dispatcher consumes (epic #2163 S2,
 *   PR #2199; this route's #2206/W1+W2+W3 extension).
 *
 *   `examMode` is preserved for back-compat with the original
 *   `shouldMountExamModeShell` reader (#1745). New callers SHOULD prefer
 *   `mode` + `sessionTerminal` and hand them to `resolveLearnerShell`
 *   instead — `examMode` is `true` iff Mock-style (CurriculumModule
 *   `coversModules.length > 0`).
 *
 *   Discriminator priority:
 *     1. AuthoredModule (Playbook.config.modules[]) matched on `id` —
 *        carries the declarative `mode` + `sessionTerminal` typed-union
 *        values from PR #2173 / epic #2163.
 *     2. CurriculumModule.coversModules — legacy `examMode` flag (#1745).
 *
 *   No moduleSlug → `{ examMode: false, mode: null, sessionTerminal:
 *   false }`. Unknown module → same fallback.
 *
 * @pathParam callerId string - Caller.id
 * @queryParam moduleSlug string - module slug (AuthoredModule.id OR CurriculumModule.slug)
 * @response 200 { ok: true, examMode: boolean, mode: AuthoredModuleMode | null, sessionTerminal: boolean }
 * @response 403 { ok: false, error: string }
 * @response 500 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { PlaybookCurriculumRole } from "@prisma/client";
import type { AuthoredModule, AuthoredModuleMode, PlaybookConfig } from "@/lib/types/json-fields";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }

    const moduleSlug = req.nextUrl.searchParams.get("moduleSlug");
    if (!moduleSlug) {
      return NextResponse.json({
        ok: true,
        examMode: false,
        mode: null,
        sessionTerminal: false,
      });
    }

    // Resolve the caller's active enrollment → playbook (+ config) → primary
    // curriculum. Mirrors the same path the call-start pipeline takes (single
    // CallerPlaybook with status ACTIVE; primary Curriculum link).
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId, status: "ACTIVE" },
      orderBy: { enrolledAt: "desc" },
      select: {
        playbook: {
          select: {
            config: true,
            playbookCurricula: {
              where: { role: PlaybookCurriculumRole.primary },
              select: { curriculumId: true },
            },
          },
        },
      },
    });

    // Read AuthoredModule.mode + sessionTerminal from Playbook.config.modules[].
    // This is the declarative source-of-truth — the resolver consumes these
    // shapes directly.
    const config = (enrollment?.playbook?.config ?? null) as PlaybookConfig | null;
    const authoredModules: AuthoredModule[] = Array.isArray(config?.modules)
      ? (config!.modules as AuthoredModule[])
      : [];
    const authored = authoredModules.find((m) => m?.id === moduleSlug) ?? null;
    const mode: AuthoredModuleMode | null = authored?.mode ?? null;
    const sessionTerminal: boolean = authored?.sessionTerminal === true;

    // Legacy `examMode` — preserved for #1745 back-compat. Resolved via
    // CurriculumModule.coversModules (the Mock-style multi-part signal).
    const curriculumId = enrollment?.playbook?.playbookCurricula[0]?.curriculumId;
    let examMode = false;
    if (curriculumId) {
      const targetModule = await prisma.curriculumModule.findFirst({
        where: { curriculumId, slug: moduleSlug },
        select: { coversModules: true },
      });
      examMode = (targetModule?.coversModules?.length ?? 0) > 0;
    }

    return NextResponse.json({
      ok: true,
      examMode,
      mode,
      sessionTerminal,
    });
  } catch (err) {
    console.error("[/api/callers/[callerId]/exam-mode-check] error", err);
    return NextResponse.json(
      { ok: false, error: "Failed to resolve exam mode" },
      { status: 500 },
    );
  }
}

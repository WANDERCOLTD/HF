/**
 * Course modules — Phase P3 of the Course Detail tab refactor (epic #1850).
 *
 * Returns the AuthoredModule[] (Playbook.config.modules) used by the
 * Modules tab's LH picker AND the per-module Inspector. Distinct from
 * the sibling `/api/courses/:courseId/sessions` route, which returns
 * the CurriculumModule[] (the curriculum-side list) — Authored vs
 * Curriculum is the canonical playbook-vs-curriculum split documented
 * in `lib/types/json-fields.ts` (AuthoredModule JSDoc, line 846).
 *
 * AuthoredModule lives on `Playbook.config.modules`. The G8 module-
 * scoped settings (`settings.questionTarget`, `settings.cueCardPool`,
 * etc.) hang off each AuthoredModule, and the per-module Inspector
 * (`ModuleInspectorPanel`) needs the full row — including the nested
 * `settings` object — to render the right values.
 *
 * OPERATOR+ gate per `.claude/rules/api-conventions.md` — the response
 * carries authoring-side metadata (`prerequisites`, `terminal`,
 * `coversModules`) that isn't a learner read.
 *
 * @api OPERATOR
 */

import { NextResponse } from "next/server";

import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

export const runtime = "nodejs";

interface ModuleSummary {
  id: string;
  label: string;
  /** Free-form catalogue duration, e.g. "20 min fixed", "Student-led". */
  duration: string;
  mode: AuthoredModule["mode"];
  frequency: AuthoredModule["frequency"];
  learnerSelectable: boolean;
  sessionTerminal: boolean;
  /** Position in a structured course's lesson plan (continuous → undefined). */
  position?: number;
  /** True when this module is the course-complete trigger
   *  under `completionMode === "terminal-only"`. */
  terminal?: boolean;
  /** G8 module-scoped settings — verbatim sub-object. The Inspector
   *  renders against this; storage path resolution is per-key under
   *  `config.modules[].settings.<key>` with `arrayKey: "id"`. */
  settings: NonNullable<AuthoredModule["settings"]> | Record<string, never>;
}

interface ModulesResponse {
  ok: true;
  modules: ModuleSummary[];
}

interface ModulesError {
  ok: false;
  error: string;
}

/**
 * @api GET /api/courses/:courseId/modules
 * @visibility internal
 * @scope courses:read
 * @auth session (OPERATOR+)
 * @description Returns the AuthoredModule list from `Playbook.config.modules`.
 *   Used by the Modules tab's LH picker + per-module Inspector. Distinct
 *   from `/sessions` (which returns CurriculumModule + lesson plan).
 * @response 200 { ok: true, modules: ModuleSummary[] }
 * @response 403 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse<ModulesResponse | ModulesError>> {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) {
      return auth.error as NextResponse<ModulesError>;
    }

    const { courseId } = await params;
    if (!courseId) {
      return NextResponse.json(
        { ok: false, error: "courseId is required" },
        { status: 400 },
      );
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, config: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const config = (playbook.config ?? null) as PlaybookConfig | null;
    const raw = config?.modules ?? [];

    const modules: ModuleSummary[] = raw
      .filter((m): m is AuthoredModule => Boolean(m) && typeof m === "object")
      .map((m) => ({
        id: m.id,
        label: m.label,
        duration: m.duration,
        mode: m.mode,
        frequency: m.frequency,
        learnerSelectable: m.learnerSelectable,
        sessionTerminal: m.sessionTerminal,
        position: m.position,
        terminal: m.terminal,
        settings: (m.settings ?? {}) as ModuleSummary["settings"],
      }))
      .sort((a, b) => {
        const ap = a.position ?? Number.MAX_SAFE_INTEGER;
        const bp = b.position ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return a.label.localeCompare(b.label);
      });

    return NextResponse.json({ ok: true, modules });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

/**
 * Section-scoped recompose — #1558 S3b.
 *
 * Educator-triggered, out-of-pipeline. Patches one section across every
 * active enrolled caller's most-recent active `ComposedPrompt` (the row
 * any subsequent call would pick up via the I-CT2 cascade). Sibling
 * `llmPrompt` outputKeys stay byte-identical; the prose `prompt` field
 * is re-rendered globally (TL decision 2026-06-14).
 *
 * Decisions captured in `docs/decisions/2026-06-14-section-scoped-recompose.md`:
 *
 *   - Hybrid fanout: sync when ≤20 active callers, async fire-and-forget
 *     above (mirrors `eager-reprompt-on-bump.ts` from #1429).
 *   - 14-of-14 sections SAFE per the ADR's verdict table. Two carry
 *     read-time caveats (`contentTrust` freshness lag 1 cycle;
 *     `priorCallFeedback` route SHOULD reject 422 mid-pipeline — we
 *     document this in the JSDoc and rely on call-site discipline, not
 *     structural detection, in S3b).
 *
 * Per-caller mechanism: `lib/compose/recompose-section.ts`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { COMPOSE_SECTION_KEYS } from "@/lib/compose/section";
import type { ComposeSectionKey } from "@/lib/compose/section";
import { recomposeSectionForCaller } from "@/lib/compose/recompose-section";

export const runtime = "nodejs";

/**
 * The sync/async cutoff. ≤20 callers → educator waits, sees the result
 * in the response. Above → fire-and-forget, response carries
 * `{ fanoutMode: "async", queued: N }`.
 */
const SYNC_FANOUT_THRESHOLD = 20;

const BodySchema = z
  .object({
    sectionKey: z.enum(COMPOSE_SECTION_KEYS as unknown as [string, ...string[]]),
    dryRun: z.boolean().optional(),
  })
  .strict();

/**
 * @api POST /api/courses/:courseId/recompose-section
 * @visibility internal
 * @scope courses:write
 * @auth session (OPERATOR+)
 * @description Recompose one section across every active enrolled caller's
 *   active `ComposedPrompt`. Sibling outputKeys stay byte-identical; the
 *   prose `prompt` field is re-rendered globally from the patched JSON.
 *   Hybrid fanout: sync when ≤20 active callers, async fire-and-forget above.
 *
 *   dryRun=true previews against the FIRST active caller — no writes.
 *
 *   MUST NOT be invoked mid-pipeline. The pipeline's COMPOSE stage runs
 *   end-of-run and patching mid-pipeline would race that write. The route
 *   does not detect this structurally in S3b — rely on call-site discipline.
 * @body { sectionKey: ComposeSectionKey, dryRun?: boolean }
 * @response 200 (dryRun)
 *   { ok: true, dryRun: true, sectionKey: string,
 *     previewDiff: { before: Record, after: Record, composedPromptId: string },
 *     affectedCallerCount: number }
 * @response 200 (live, sync)
 *   { ok: true, sectionKey: string, fanoutMode: "sync",
 *     affectedCallerCount: number, patched: number, skipped: number,
 *     failures: string[] }
 * @response 200 (live, async)
 *   { ok: true, sectionKey: string, fanoutMode: "async", queued: number }
 * @response 200 (no callers / no baseline)
 *   { ok: true, sectionKey: string, fanoutMode: "sync",
 *     affectedCallerCount: 0, patched: 0, skipped: 0, failures: [] }
 * @response 400 { ok: false, error: string }
 * @response 403 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;
    if (!courseId) {
      return NextResponse.json(
        { ok: false, error: "courseId is required" },
        { status: 400 },
      );
    }

    const rawBody = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        },
        { status: 400 },
      );
    }
    const { sectionKey, dryRun } = parsed.data as {
      sectionKey: ComposeSectionKey;
      dryRun?: boolean;
    };

    const course = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    // Enumerate active callers ONCE — used by both branches and reported
    // as `affectedCallerCount` so the educator sees the blast radius.
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { playbookId: courseId, status: "ACTIVE" },
      select: { callerId: true },
    });
    const callerIds = enrollments.map((e) => e.callerId);

    // ---- dryRun branch -----------------------------------------------
    if (dryRun) {
      // Preview against the first active caller. Caller selection is
      // arbitrary by design — section text is per-caller, so a true
      // multi-caller dryRun would need to render every caller and
      // diff. The educator's typical workflow is "tweak welcome on
      // the demo caller, preview, save" — single-caller preview matches
      // that flow. Cohort-wide preview is parked.
      if (callerIds.length === 0) {
        return NextResponse.json({
          ok: true,
          dryRun: true,
          sectionKey,
          previewDiff: null,
          affectedCallerCount: 0,
        });
      }
      const result = await recomposeSectionForCaller(
        callerIds[0],
        courseId,
        sectionKey,
        { dryRun: true },
      );
      if (!result) {
        // No baseline ComposedPrompt for the first caller. Treat as a
        // soft empty result — the educator gets a clear signal without
        // a 4xx.
        return NextResponse.json({
          ok: true,
          dryRun: true,
          sectionKey,
          previewDiff: null,
          affectedCallerCount: callerIds.length,
          note: "No active ComposedPrompt for the preview caller — recompose-section is a PATCH primitive. Run a full compose first.",
        });
      }
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sectionKey,
        previewDiff: {
          before: result.dryRun ? result.before : null,
          after: result.dryRun ? result.after : null,
          composedPromptId: result.composedPromptId,
        },
        affectedCallerCount: callerIds.length,
      });
    }

    // ---- live branch -------------------------------------------------
    // No active callers — return a clean empty success. No section hash
    // bump (nothing to patch).
    if (callerIds.length === 0) {
      return NextResponse.json({
        ok: true,
        sectionKey,
        fanoutMode: "sync" as const,
        affectedCallerCount: 0,
        patched: 0,
        skipped: 0,
        failures: [],
      });
    }

    // ≤ threshold → sync. The educator sees per-caller outcomes in the
    // response. Throws on a per-caller helper are CAUGHT and recorded
    // in `failures` so one bad caller doesn't abort the fanout.
    if (callerIds.length <= SYNC_FANOUT_THRESHOLD) {
      let patched = 0;
      let skipped = 0;
      const failures: string[] = [];
      for (const callerId of callerIds) {
        try {
          const result = await recomposeSectionForCaller(
            callerId,
            courseId,
            sectionKey,
          );
          if (!result) {
            skipped += 1;
          } else if (!result.dryRun && result.patched) {
            patched += 1;
          } else {
            skipped += 1;
          }
        } catch (err: unknown) {
          failures.push(callerId);
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[recompose-section] callerId=${callerId} playbookId=${courseId} sectionKey=${sectionKey} error=${message}`,
          );
        }
      }
      return NextResponse.json({
        ok: true,
        sectionKey,
        fanoutMode: "sync" as const,
        affectedCallerCount: callerIds.length,
        patched,
        skipped,
        failures,
      });
    }

    // > threshold → async fire-and-forget. The educator gets immediate
    // acknowledgment; per-caller progress lands in `[recompose-section]`
    // log lines. Mirrors `triggerEagerRepromptForDemoCallers` from #1429.
    for (const callerId of callerIds) {
      void recomposeSectionForCaller(callerId, courseId, sectionKey).catch(
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[recompose-section] callerId=${callerId} playbookId=${courseId} sectionKey=${sectionKey} error=${message}`,
          );
        },
      );
    }
    return NextResponse.json({
      ok: true,
      sectionKey,
      fanoutMode: "async" as const,
      queued: callerIds.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

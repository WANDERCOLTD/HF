/**
 * @operator-surface yes
 *
 * POST /api/courses/[courseId]/demo-script
 *
 * Upserts a single Preview-lens sticky-note annotation into
 * `Playbook.config.demoScript.annotations[]`, keyed by `bubbleRef`. Used
 * by the Preview annotation editor sidetray (#1493, Epic #1442 Layer 4).
 *
 * The route is intentionally separate from the existing
 * `PUT /api/courses/[courseId]/session-flow` — that handler is already
 * juggling `sessionFlow / lessonPlanMode / welcomeMessage / nps` and a
 * `demoScript` payload has no relationship to any of them (TL question R2
 * in #1493). Dedicated routes also let `arch-checker` keep the
 * operator-surface boundary tight.
 *
 * **Composition isolation (R3 in #1493).** `demoScript` is `NEVER-COMPOSE` —
 * the JSDoc on `PlaybookConfig.demoScript` says so, the test in
 * `tests/api/courses/demo-script.test.ts` asserts the structural grep
 * against `lib/prompt/composition/` returns zero hits. If a future
 * composer needs to surface presenter notes, add a NEW field — do not
 * teach composition to read `demoScript`.
 *
 * Save bumps `composeInputsUpdatedAt` via the standard
 * `bumpPlaybookComposeTimestamp` helper. This is structurally harmless
 * because `demoScript` is NOT a compose-affecting key
 * (`composeAffectingChanged` returns false), and the Preview "is the
 * compose surface stale?" banner reads the same timestamp — so the
 * banner correctly stays put while a presenter scribbles annotations.
 *
 * In other words: the bump tells the UI "the operator touched the
 * course" without telling the composer "regenerate the prompt".
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import { bumpPlaybookComposeTimestamp } from "@/lib/compose/bump-timestamp";
import type {
  PlaybookConfig,
  DemoAnnotation,
  DemoScript,
} from "@/lib/types/json-fields";

const BodySchema = z.object({
  bubbleRef: z.string().min(1, "bubbleRef is required").max(300),
  presenterNote: z.string().max(4000),
  isWowMoment: z.boolean(),
  durationSecOnStep: z.number().int().positive().max(3600).optional(),
});

type Body = z.infer<typeof BodySchema>;

/**
 * @api GET /api/courses/[courseId]/demo-script
 * @visibility internal
 * @scope course:read
 * @auth session (OPERATOR+)
 * @description Returns the operator-only demo script for a course. This
 *   is NEVER returned by composition — it lives alongside the Preview
 *   lens and is read only by the Preview annotation editor.
 * @response 200 { ok: true, demoScript: DemoScript }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;
    const row = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { config: true },
    });
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }
    const cfg = (row.config ?? {}) as PlaybookConfig;
    const demoScript: DemoScript = cfg.demoScript ?? { annotations: [] };
    return NextResponse.json({ ok: true, demoScript });
  } catch (err) {
    console.error("[courses/[courseId]/demo-script GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * @api POST /api/courses/[courseId]/demo-script
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @description Upsert a single Preview-lens annotation by `bubbleRef`.
 *   If an annotation with the same `bubbleRef` exists, its fields are
 *   replaced; otherwise a new entry is appended to
 *   `config.demoScript.annotations[]`. Bumps `composeInputsUpdatedAt`
 *   (operator-touch signal — does NOT invalidate composer cache).
 * @request { bubbleRef: string, presenterNote: string, isWowMoment: boolean, durationSecOnStep?: number }
 * @response 200 { ok: true, annotation: DemoAnnotation, count: number }
 * @response 400 { ok: false, error: "Invalid body", details?: unknown }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;
    const json = (await req.json()) as unknown;
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body: Body = parsed.data;

    let upsertedAnnotation: DemoAnnotation | null = null;
    let total = 0;

    try {
      await updatePlaybookConfig(
        courseId,
        (existing: PlaybookConfig) => {
          const existingScript: DemoScript =
            existing.demoScript ?? { annotations: [] };
          const annotations = [...existingScript.annotations];
          const next: DemoAnnotation = {
            bubbleRef: body.bubbleRef,
            presenterNote: body.presenterNote,
            isWowMoment: body.isWowMoment,
            ...(body.durationSecOnStep !== undefined
              ? { durationSecOnStep: body.durationSecOnStep }
              : {}),
          };
          const idx = annotations.findIndex(
            (a) => a.bubbleRef === body.bubbleRef,
          );
          if (idx === -1) {
            annotations.push(next);
          } else {
            annotations[idx] = next;
          }
          upsertedAnnotation = next;
          total = annotations.length;
          return {
            ...existing,
            demoScript: { annotations },
          };
        },
        { reason: "demo-script POST" },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("not found")) {
        return NextResponse.json(
          { ok: false, error: "Course not found" },
          { status: 404 },
        );
      }
      throw err;
    }

    // `demoScript` is NOT in COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS, so the
    // central helper above will NOT have bumped the timestamp. Bump it
    // explicitly so the Preview lens flips its "operator made changes"
    // indicator. The bump is structurally harmless to the composer (no
    // affecting-key changed → COMPOSE re-reads same inputs → same prompt).
    await bumpPlaybookComposeTimestamp(courseId);

    return NextResponse.json({
      ok: true,
      annotation: upsertedAnnotation,
      count: total,
    });
  } catch (err) {
    console.error("[courses/[courseId]/demo-script POST]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

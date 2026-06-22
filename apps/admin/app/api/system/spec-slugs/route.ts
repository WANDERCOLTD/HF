/**
 * @api GET /api/system/spec-slugs
 * @visibility internal
 * @scope system:read
 * @auth session (OPERATOR+)
 * @tags assessment, ui-typeahead
 * @description Returns `{slug, outputType, specRole, scope}` rows for
 *   AnalysisSpec records, optionally filtered by `outputType` (canonical)
 *   or `role` (back-compat alias). Consumed by the AssessmentPlanEditor
 *   lens (#2176 S1) to populate the `scoringSpec` typeahead in
 *   `AssessmentMomentEditor`. Operator-only — typeahead is admin tooling.
 * @query outputType: AnalysisOutputType (optional; default = all)
 *   Accepted values: MEASURE | LEARN | ADAPT | MEASURE_AGENT | AGGREGATE
 *   | COMPOSE | REWARD | SUPERVISE | PROSODY | CALLER_ATTRIBUTE_NEXT
 * @query role: same as outputType (back-compat alias accepted; if both
 *   are supplied, `outputType` wins).
 * @response 200 { ok: true, specs: Array<{slug, outputType, specRole, scope}> }
 *
 * Story: #2176 S1 — CourseAssessmentPlan editor lens.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const OUTPUT_TYPE_VALUES = [
  "MEASURE",
  "LEARN",
  "ADAPT",
  "MEASURE_AGENT",
  "AGGREGATE",
  "COMPOSE",
  "REWARD",
  "SUPERVISE",
  "PROSODY",
  "CALLER_ATTRIBUTE_NEXT",
] as const;

const QuerySchema = z.object({
  outputType: z.enum(OUTPUT_TYPE_VALUES).optional(),
  role: z.enum(OUTPUT_TYPE_VALUES).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const url = new URL(req.url);
  const raw = {
    outputType: url.searchParams.get("outputType") ?? undefined,
    role: url.searchParams.get("role") ?? undefined,
  };
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid-query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const outputType = parsed.data.outputType ?? parsed.data.role;

  try {
    const specs = await prisma.analysisSpec.findMany({
      where: outputType ? { outputType } : undefined,
      select: {
        slug: true,
        outputType: true,
        specRole: true,
        scope: true,
      },
      orderBy: { slug: "asc" },
    });
    return NextResponse.json({ ok: true, specs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "spec-slugs failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

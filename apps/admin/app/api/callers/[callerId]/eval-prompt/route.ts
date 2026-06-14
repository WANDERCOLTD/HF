/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * HF-M.2 rule audit: handler is OPERATOR-only at the auth gate; STUDENT cannot
 * reach. The studentAllowedToReadCaller guard would be a no-op here; the
 * disable + this comment is the documented trust chain. If the auth gate
 * ever loosens to admit STUDENT (e.g. requireAuth("VIEWER")), remove this
 * disable AND add the guard call.
 */
/**
 * @api Prompt Eval — Quality Evaluation
 * @description Evaluates a composed call prompt against a quality rubric (7 dimensions)
 *   and returns actionable improvements mapped to admin surfaces.
 * @auth OPERATOR
 * @tags prompt-eval, callers
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getPromptTemplate } from "@/lib/prompts/prompt-settings";
import { interpolateTemplate } from "@/lib/prompts/interpolate";
import { SECTION_MAP, renderSectionMapForAI, resolveAdminPaths } from "@/lib/prompt-analyzer/section-map";
import { jsonrepair } from "jsonrepair";
import { prisma } from "@/lib/prisma";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface EvalDimension {
  name: string;
  score: number;
  verdict: "strong" | "adequate" | "weak";
  findings: string[];
  improvements: string[];
}

interface EvalImprovement {
  priority: number;
  title: string;
  description: string;
  adminPath: string;
  adminLabel: string;
  sectionKeys: string[];
}

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------

/**
 * @api POST /api/callers/:callerId/eval-prompt
 * @auth OPERATOR
 * @description Evaluate a composed prompt against the quality rubric.
 * @body { composedPromptId: string }
 * @response 200 { ok: true, eval: { overall, dimensions, topImprovements } }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const body = await request.json();
    const { composedPromptId } = body;

    // ── Validate ──
    if (!composedPromptId || typeof composedPromptId !== "string") {
      return NextResponse.json({ ok: false, error: "composedPromptId is required" }, { status: 400 });
    }

    // ── Fetch composed prompt ──
    const composed = await prisma.composedPrompt.findFirst({
      where: { id: composedPromptId, callerId },
    });

    if (!composed) {
      return NextResponse.json({ ok: false, error: "Composed prompt not found for this caller" }, { status: 404 });
    }

    // ── Build AI prompt ──
    const sectionMapText = renderSectionMapForAI();
    const systemTemplate = await getPromptTemplate("prompt-eval");
    const systemPrompt = interpolateTemplate(systemTemplate, { sectionMap: sectionMapText });

    // Build section keys from llmPrompt JSON
    const llmPrompt = (composed.llmPrompt ?? {}) as Record<string, unknown>;
    const sectionKeys = Object.keys(llmPrompt).filter(
      (k) => !k.startsWith("_version") && !k.startsWith("_format"),
    );

    // Composition metadata from inputs
    const inputs = (composed.inputs ?? {}) as Record<string, unknown>;

    const userMessage = `## COMPOSED PROMPT (human-readable)

${composed.prompt}

## STRUCTURED SECTIONS (keys present in llmPrompt)

${sectionKeys.join(", ")}

## COMPOSITION METADATA

- Memories count: ${inputs.memoriesCount ?? "unknown"}
- Personality available: ${inputs.personalityAvailable ?? "unknown"}
- Recent calls count: ${inputs.recentCallsCount ?? "unknown"}
- Behavior targets count: ${inputs.behaviorTargetsCount ?? "unknown"}
- Courses used: ${Array.isArray(inputs.playbooksUsed) ? (inputs.playbooksUsed as string[]).join(", ") : "unknown"}
- Sections activated: ${Array.isArray((inputs.composition as Record<string, unknown>)?.sectionsActivated) ? ((inputs.composition as Record<string, unknown>).sectionsActivated as string[]).join(", ") : "unknown"}
- Sections skipped: ${Array.isArray((inputs.composition as Record<string, unknown>)?.sectionsSkipped) ? ((inputs.composition as Record<string, unknown>).sectionsSkipped as string[]).join(", ") : "none"}

## llmPrompt JSON

${JSON.stringify(llmPrompt, null, 2)}`;

    // ── AI call ──
    // @ai-call prompt-eval.analyse — Evaluate composed prompt quality | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "prompt-eval.analyse",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      },
      { callerId, sourceOp: "prompt-eval.analyse" },
    );

    const content = result.content || "";

    // ── Parse response ──
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { ok: false, error: "AI did not return valid JSON evaluation" },
        { status: 502 },
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonrepair(jsonMatch[0]));
    } catch {
      return NextResponse.json(
        { ok: false, error: "Failed to parse AI evaluation response" },
        { status: 502 },
      );
    }

    // ── Build typed response ──
    const dimensions: EvalDimension[] = (parsed.dimensions || []).map((d: any) => ({
      name: d.name || "Unknown",
      score: typeof d.score === "number" ? d.score : 0,
      verdict: d.verdict || "weak",
      findings: Array.isArray(d.findings) ? d.findings : [],
      improvements: Array.isArray(d.improvements) ? d.improvements : [],
    }));

    const topImprovements: EvalImprovement[] = (parsed.topImprovements || []).map((r: any, i: number) => {
      // Resolve admin surface from the first affected section key
      const firstSection = (r.sectionKeys || [])[0];
      const mapping = SECTION_MAP.find((m) => m.sectionKey === firstSection);
      const surface = mapping ? resolveAdminPaths(mapping.adminSurfaces, callerId)[0] : null;

      return {
        priority: r.priority ?? i + 1,
        title: r.title || "Improvement needed",
        description: r.description || "",
        adminPath: surface?.path || "",
        adminLabel: surface?.label || "",
        sectionKeys: Array.isArray(r.sectionKeys) ? r.sectionKeys : [],
      };
    });

    const evalPayload = {
      overall: {
        score: typeof parsed.overall?.score === "number" ? parsed.overall.score : 0,
        verdict: parsed.overall?.verdict || "weak",
        summary: parsed.overall?.summary || "Evaluation complete.",
      },
      dimensions,
      topImprovements,
    };

    // Persist eval result on the composed prompt
    await prisma.composedPrompt.update({
      where: { id: composedPromptId },
      data: { evalResult: evalPayload as unknown as Prisma.InputJsonValue, evalAt: new Date() },
    });

    return NextResponse.json({ ok: true, eval: evalPayload });
  } catch (error: any) {
    console.error("[prompt-eval] Evaluation error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Evaluation failed" },
      { status: 500 },
    );
  }
}

/**
 * @api Prompt Analyzer — Analyse
 * @description AI-powered analysis of prompt diffs, mapping changes to admin surfaces.
 * @auth ADMIN
 * @tags prompt-analyzer
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getPromptTemplate } from "@/lib/prompts/prompt-settings";
import { interpolateTemplate } from "@/lib/prompts/interpolate";
import { SECTION_MAP, renderSectionMapForAI, resolveAdminPaths } from "@/lib/prompt-analyzer/section-map";
import { jsonrepair } from "jsonrepair";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface AnalyseRequest {
  callerId: string;
  currentPrompt: string;
  desiredPrompt: string;
  llmPromptJson: Record<string, any>;
}

interface SectionAnalysis {
  sectionKey: string;
  label: string;
  status: "changed" | "unchanged";
  changes: string[];
  adminSurfaces: Array<{ path: string; label: string; action: string }>;
}

interface Recommendation {
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
 * @api POST /api/prompt-analyzer/analyse
 * @auth ADMIN
 * @description Analyse the diff between a current and desired prompt, returning
 *   section-level changes and actionable recommendations.
 * @body { callerId: string, currentPrompt: string, desiredPrompt: string, llmPromptJson: object }
 * @response 200 { ok: true, analysis: { summary, sections, recommendations } }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body: AnalyseRequest = await request.json();

    // ── Validate ──
    if (!body.callerId || typeof body.callerId !== "string") {
      return NextResponse.json({ ok: false, error: "callerId is required" }, { status: 400 });
    }
    if (!body.currentPrompt || !body.desiredPrompt) {
      return NextResponse.json({ ok: false, error: "Both currentPrompt and desiredPrompt are required" }, { status: 400 });
    }
    if (body.currentPrompt.trim() === body.desiredPrompt.trim()) {
      return NextResponse.json({ ok: false, error: "Prompts are identical — nothing to analyse" }, { status: 400 });
    }

    // ── Build AI prompt ──
    const sectionMapText = renderSectionMapForAI();
    const systemTemplate = await getPromptTemplate("prompt-analyzer");
    const systemPrompt = interpolateTemplate(systemTemplate, { sectionMap: sectionMapText });

    // Build a concise section key list from the llmPrompt JSON
    const sectionKeys = body.llmPromptJson ? Object.keys(body.llmPromptJson).filter((k) => !k.startsWith("_version") && !k.startsWith("_format")) : [];

    const userMessage = `## CURRENT PROMPT

${body.currentPrompt}

## DESIRED PROMPT

${body.desiredPrompt}

## STRUCTURED SECTIONS (keys present in llmPrompt JSON)

${sectionKeys.join(", ")}

## llmPrompt JSON (section-level structure)

${JSON.stringify(body.llmPromptJson, null, 2)}`;

    // ── AI call ──
    // @ai-call prompt-analyzer.analyse — Analyse prompt diff and map to admin surfaces | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "prompt-analyzer.analyse",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      },
      { callerId: body.callerId, sourceOp: "prompt-analyzer.analyse" },
    );

    const content = result.content || "";

    // ── Parse response ──
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { ok: false, error: "AI did not return valid JSON analysis" },
        { status: 502 },
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonrepair(jsonMatch[0]));
    } catch {
      return NextResponse.json(
        { ok: false, error: "Failed to parse AI analysis response" },
        { status: 502 },
      );
    }

    // ── Enrich with admin surface links ──
    const sections: SectionAnalysis[] = (parsed.sections || []).map((s: any) => {
      const mapping = SECTION_MAP.find((m) => m.sectionKey === s.sectionKey);
      return {
        sectionKey: s.sectionKey,
        label: mapping?.label || s.sectionKey,
        status: s.status || "unchanged",
        changes: Array.isArray(s.changes) ? s.changes : [],
        adminSurfaces: mapping ? resolveAdminPaths(mapping.adminSurfaces, body.callerId) : [],
      };
    });

    const recommendations: Recommendation[] = (parsed.recommendations || []).map((r: any, i: number) => {
      // Find the first admin surface from the first affected section
      const firstSection = (r.sectionKeys || [])[0];
      const mapping = SECTION_MAP.find((m) => m.sectionKey === firstSection);
      const surface = mapping ? resolveAdminPaths(mapping.adminSurfaces, body.callerId)[0] : null;

      return {
        priority: r.priority ?? i + 1,
        title: r.title || "Change required",
        description: r.description || "",
        adminPath: surface?.path || "",
        adminLabel: surface?.label || "",
        sectionKeys: Array.isArray(r.sectionKeys) ? r.sectionKeys : [],
      };
    });

    return NextResponse.json({
      ok: true,
      analysis: {
        summary: parsed.summary || "Analysis complete.",
        sections,
        recommendations,
      },
    });
  } catch (error: any) {
    console.error("[prompt-analyzer] Analyse error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Analysis failed" },
      { status: 500 },
    );
  }
}

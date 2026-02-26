import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { generateGroups } from "@/lib/institution-types/generate-groups";

/**
 * @api POST /api/playbook-groups/generate
 * @visibility internal
 * @scope groups:write
 * @auth bearer
 * @tags groups, departments, ai
 * @body domainId string - Domain context for the generation
 * @body description string - Free-text description of institution structure
 * @body institutionType string? - Institution type slug for context
 * @body followUpAnswers object? - Answers to previously asked clarifying questions
 * @description AI-generate department/division/track structure from a description. Returns groups, optional clarifying questions, and confidence score.
 * @response 200 { ok: true, groups: [...], questions: [...], confidence: number }
 * @response 400 { ok: false, error: "description is required" }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const body = await request.json();
  const { description, institutionType, followUpAnswers } = body;

  if (!description || typeof description !== "string" || description.trim().length < 10) {
    return NextResponse.json(
      { ok: false, error: "Please provide a description of at least 10 characters" },
      { status: 400 }
    );
  }

  try {
    const result = await generateGroups(
      description.trim(),
      institutionType || undefined,
      followUpAnswers || undefined
    );

    return NextResponse.json({
      ok: true,
      groups: result.groups,
      questions: result.questions,
      confidence: result.confidence,
    });
  } catch (err: any) {
    console.error("[generate-groups] AI generation failed:", err.message);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to generate structure. Try using a template instead.",
      },
      { status: 500 }
    );
  }
}

/**
 * @api Meta Prompts API
 * @description CRUD for system prompt template overrides.
 * @auth ADMIN
 * @tags meta-prompts
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { PROMPT_REGISTRY } from "@/lib/prompts/registry";
import {
  getAllPromptStates,
  setPromptTemplate,
  resetPromptTemplate,
} from "@/lib/prompts/prompt-settings";
import type { PromptSlug } from "@/lib/prompts/registry";

/**
 * @api GET /api/meta-prompts
 * @auth ADMIN
 * @description List all registered prompts with current values and override status.
 * @response 200 { ok: true, prompts: PromptState[] }
 */
export async function GET() {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const prompts = await getAllPromptStates();
    return NextResponse.json({ ok: true, prompts });
  } catch (error: any) {
    console.error("[meta-prompts] GET error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to load prompts" },
      { status: 500 },
    );
  }
}

/**
 * @api POST /api/meta-prompts
 * @auth ADMIN
 * @description Save a prompt template override.
 * @body { slug: string, value: string }
 * @response 200 { ok: true }
 * @response 400 { ok: false, error: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const { slug, value } = await request.json();

    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ ok: false, error: "slug is required" }, { status: 400 });
    }
    if (!value || typeof value !== "string") {
      return NextResponse.json({ ok: false, error: "value is required and must be a string" }, { status: 400 });
    }
    if (value.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Prompt cannot be empty" }, { status: 400 });
    }

    const entry = PROMPT_REGISTRY.get(slug);
    if (!entry) {
      return NextResponse.json({ ok: false, error: `Unknown prompt: ${slug}` }, { status: 400 });
    }
    if (!entry.isEditable) {
      return NextResponse.json({ ok: false, error: `Prompt "${slug}" is not editable` }, { status: 400 });
    }

    // Validate that all required template vars are preserved
    for (const v of entry.templateVars) {
      if (!value.includes(`{{${v}}}`)) {
        return NextResponse.json(
          { ok: false, error: `Template variable {{${v}}} is required but missing from the prompt` },
          { status: 400 },
        );
      }
    }

    await setPromptTemplate(slug as PromptSlug, value);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[meta-prompts] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to save prompt" },
      { status: 500 },
    );
  }
}

/**
 * @api DELETE /api/meta-prompts
 * @auth ADMIN
 * @description Reset a prompt to its code default.
 * @query slug - The prompt slug to reset
 * @response 200 { ok: true }
 * @response 400 { ok: false, error: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const slug = new URL(request.url).searchParams.get("slug");
    if (!slug) {
      return NextResponse.json(
        { ok: false, error: "slug query parameter is required" },
        { status: 400 },
      );
    }

    if (!PROMPT_REGISTRY.has(slug)) {
      return NextResponse.json(
        { ok: false, error: `Unknown prompt: ${slug}` },
        { status: 400 },
      );
    }

    await resetPromptTemplate(slug as PromptSlug);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[meta-prompts] DELETE error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to reset prompt" },
      { status: 500 },
    );
  }
}

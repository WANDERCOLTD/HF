/**
 * @api POST /api/playbooks/:playbookId/variant
 * @visibility public
 * @scope playbook:write
 * @auth session (OPERATOR or higher)
 * @tags playbooks, variants, course-product-line
 * @description Create a sibling Variant Playbook against the parent's
 *   shared Curriculum + Subject + Source library. Variants share content
 *   authority but carry their own teaching profile (Pop Quiz / Revision
 *   Aid / Exam Assessment). Mastery flows across siblings via shared
 *   CurriculumModule UUIDs — see CC-E in docs/chain-contracts.md. #1034.
 * @pathParam playbookId string - The PARENT Playbook to sibling-clone.
 * @body name string - Display name for the new variant Course (required, max 200).
 * @body preset "revision"|"popquiz"|"exam" - Optional teaching-profile preset (config seed only — forward-declared keys, no runtime effect yet).
 * @body reason string - Free-form audit trail note (optional).
 * @response 201 { ok: true, variantPlaybookId: string, sharedCurriculumId: string|null, subjectLinks: number, sourceLinks: number, unlinkedDuplicateSubjects: number }
 * @response 400 { ok: false, error: string }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Parent Playbook not found" }
 * @response 500 { ok: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { createPlaybookVariant, type VariantPreset } from "@/lib/playbooks/create-variant";

const bodySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200, "name must be 200 chars or fewer"),
  preset: z.enum(["revision", "popquiz", "exam"]).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { playbookId: parentPlaybookId } = await params;
  if (!parentPlaybookId) {
    return NextResponse.json(
      { ok: false, error: "playbookId path parameter is required" },
      { status: 400 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    body = bodySchema.parse(raw);
  } catch (e: unknown) {
    const message = e instanceof z.ZodError
      ? e.issues.map((issue) => issue.message).join("; ")
      : (e instanceof Error ? e.message : "Invalid JSON body");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    const result = await createPlaybookVariant({
      parentPlaybookId,
      name: body.name,
      preset: body.preset as VariantPreset | undefined,
      actorUserId: auth.session.user.id,
      reason: body.reason,
    });

    return NextResponse.json(
      {
        ok: true,
        variantPlaybookId: result.variantPlaybookId,
        sharedCurriculumId: result.sharedCurriculumId,
        subjectLinks: result.subjectLinks,
        sourceLinks: result.sourceLinks,
        unlinkedDuplicateSubjects: result.unlinkedDuplicateSubjects,
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not found")) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 404 },
      );
    }
    console.error("[playbooks/:id/variant] POST error:", e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

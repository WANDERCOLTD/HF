import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * @api POST /api/playbook-groups/:id/preview-tone
 * @visibility internal
 * @scope groups:read
 * @auth bearer
 * @tags groups, departments, identity
 * @description Preview how a department's tone override combines with the domain identity. Returns a text preview showing base tone + department override = combined.
 * @response 200 { ok: true, preview: { baseTone, departmentOverride, combined } }
 * @response 404 { ok: false, error: "Group not found" }
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const { id } = await context.params;

  const group = await prisma.playbookGroup.findUnique({
    where: { id },
    include: {
      domain: {
        select: {
          name: true,
          onboardingIdentitySpec: {
            select: { config: true },
          },
        },
      },
    },
  });

  if (!group) {
    return NextResponse.json(
      { ok: false, error: "Group not found" },
      { status: 404 }
    );
  }

  // Extract base tone from domain identity spec
  const identityConfig = group.domain.onboardingIdentitySpec?.config as
    | Record<string, any>
    | null;
  const baseTone =
    identityConfig?.styleGuidelines ||
    identityConfig?.communicationStyle ||
    "Default institutional tone";

  // Extract department override
  const override = group.identityOverride as Record<string, any> | null;
  const styleNotes = override?.styleNotes || null;
  const toneSliders = override?.toneSliders || null;

  // Build combined preview
  let departmentOverride = "";
  if (styleNotes) {
    departmentOverride += styleNotes;
  }
  if (toneSliders) {
    const sliderDescriptions: string[] = [];
    if (toneSliders.formality > 0.6) sliderDescriptions.push("more formal");
    if (toneSliders.formality < 0.4) sliderDescriptions.push("more casual");
    if (toneSliders.warmth > 0.6) sliderDescriptions.push("warmer");
    if (toneSliders.warmth < 0.4) sliderDescriptions.push("more matter-of-fact");
    if (toneSliders.pace > 0.6) sliderDescriptions.push("more measured pace");
    if (toneSliders.pace < 0.4) sliderDescriptions.push("quicker pace");
    if (toneSliders.encourage > 0.6) sliderDescriptions.push("more encouraging");
    if (toneSliders.precision > 0.6) sliderDescriptions.push("more precise terminology");

    if (sliderDescriptions.length > 0) {
      if (departmentOverride) departmentOverride += ". ";
      departmentOverride += `Tone adjustments: ${sliderDescriptions.join(", ")}`;
    }
  }

  const combined = departmentOverride
    ? `${typeof baseTone === "string" ? baseTone : "Base institutional tone"}, with department emphasis on: ${departmentOverride}`
    : typeof baseTone === "string"
      ? baseTone
      : "No tone overrides configured";

  return NextResponse.json({
    ok: true,
    preview: {
      domainName: group.domain.name,
      groupName: group.name,
      baseTone: typeof baseTone === "string" ? baseTone : "Default institutional tone",
      departmentOverride: departmentOverride || "No department-specific tone",
      combined,
    },
  });
}

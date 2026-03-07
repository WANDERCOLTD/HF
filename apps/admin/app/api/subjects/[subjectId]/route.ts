import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { TEACHING_PROFILE_KEYS, type TeachingProfileKey } from "@/lib/content-trust/teaching-profiles";

type Params = { params: Promise<{ subjectId: string }> };

/**
 * @api GET /api/subjects/:subjectId
 * @visibility internal
 * @scope subjects:read
 * @auth session
 * @tags subjects
 * @description Get subject detail with sources, domains, and latest curriculum.
 * @param subjectId string - Subject ID (path)
 * @response 200 { subject: {...} }
 * @response 404 { error: "Subject not found" }
 * @response 500 { error: "..." }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      include: {
        sources: {
          include: {
            source: {
              include: { _count: { select: { assertions: true } } },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
        domains: {
          include: { domain: { select: { id: true, name: true, slug: true } } },
        },
        curricula: {
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    return NextResponse.json({ subject });
  } catch (error: any) {
    console.error("[subjects/:id] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api PATCH /api/subjects/:subjectId
 * @visibility internal
 * @scope subjects:update
 * @auth session
 * @tags subjects
 * @description Update subject fields (name, description, trust level, qualification info, active status).
 * @param subjectId string - Subject ID (path)
 * @body name string - Display name
 * @body description string - Subject description
 * @body defaultTrustLevel string - Default trust level for sources
 * @body qualificationBody string - Awarding body
 * @body qualificationRef string - Qualification reference
 * @body qualificationLevel string - Qualification level
 * @body isActive boolean - Active status
 * @body teachingProfile string|null - Teaching profile key (e.g. "comprehension-led") or null to clear
 * @body teachingOverrides object|null - Override individual profile settings (teachingMode, interactionPattern, deliveryHints)
 * @response 200 { subject: {...} }
 * @response 400 { error: "Invalid teachingProfile: ..." }
 * @response 500 { error: "..." }
 */
/**
 * @api DELETE /api/subjects/:subjectId
 * @visibility internal
 * @scope subjects:delete
 * @auth session
 * @tags subjects
 * @description Soft-delete a subject by setting isActive to false. Requires OPERATOR role.
 * @param subjectId string - Subject ID (path)
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Subject not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      select: { id: true },
    });

    if (!subject) {
      return NextResponse.json(
        { ok: false, error: "Subject not found" },
        { status: 404 }
      );
    }

    await prisma.subject.update({
      where: { id: subjectId },
      data: { isActive: false },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[subjects/:id] DELETE error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;
    const body = await req.json();

    const {
      name,
      description,
      defaultTrustLevel,
      qualificationBody,
      qualificationRef,
      qualificationLevel,
      isActive,
      teachingProfile,
      teachingOverrides,
    } = body;

    // Validate teachingProfile if provided (null is valid — clears the profile)
    if (teachingProfile !== undefined && teachingProfile !== null) {
      if (!TEACHING_PROFILE_KEYS.includes(teachingProfile as TeachingProfileKey)) {
        return NextResponse.json(
          { error: `Invalid teachingProfile: ${teachingProfile}. Valid values: ${TEACHING_PROFILE_KEYS.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (defaultTrustLevel !== undefined) data.defaultTrustLevel = defaultTrustLevel;
    if (qualificationBody !== undefined) data.qualificationBody = qualificationBody;
    if (qualificationRef !== undefined) data.qualificationRef = qualificationRef;
    if (qualificationLevel !== undefined) data.qualificationLevel = qualificationLevel;
    if (isActive !== undefined) data.isActive = isActive;
    if (teachingProfile !== undefined) data.teachingProfile = teachingProfile;
    if (teachingOverrides !== undefined) data.teachingOverrides = teachingOverrides;

    const subject = await prisma.subject.update({
      where: { id: subjectId },
      data,
    });

    return NextResponse.json({ subject });
  } catch (error: any) {
    console.error("[subjects/:id] PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

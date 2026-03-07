import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { TEACHING_PROFILE_KEYS, type TeachingProfileKey } from "@/lib/content-trust/teaching-profiles";

/**
 * @api GET /api/subjects
 * @visibility internal
 * @scope subjects:read
 * @auth session
 * @tags subjects
 * @description List all subjects with source, domain, curriculum counts, and lesson plan session counts.
 * @query activeOnly string - "false" to include inactive (default: true)
 * @query domainId string - Filter to subjects linked to this domain
 * @response 200 { subjects: [...{ ..., lessonPlanSessions: number }] }
 * @response 500 { error: "..." }
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const domainId = searchParams.get("domainId");

    const where: any = {};
    if (activeOnly) where.isActive = true;
    if (domainId) where.domains = { some: { domainId } };

    const subjects = await prisma.subject.findMany({
      where,
      include: {
        _count: {
          select: {
            sources: true,
            domains: true,
            curricula: true,
          },
        },
        domains: {
          include: { domain: { select: { id: true, name: true, slug: true } } },
        },
        curricula: {
          select: { id: true, deliveryConfig: true },
        },
      },
      orderBy: [{ name: "asc" }],
    });

    // Compute lesson plan session counts from curriculum JSON
    const subjectsWithCounts = subjects.map((s) => {
      let lessonPlanSessions = 0;
      for (const c of s.curricula) {
        const dc = c.deliveryConfig as Record<string, any> | null;
        if (dc?.lessonPlan?.entries?.length) {
          lessonPlanSessions += dc.lessonPlan.entries.length;
        }
      }
      const { curricula: _curricula, ...rest } = s;
      return { ...rest, lessonPlanSessions };
    });

    return NextResponse.json({ subjects: subjectsWithCounts });
  } catch (error: any) {
    console.error("[subjects] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api POST /api/subjects
 * @visibility internal
 * @scope subjects:create
 * @auth session
 * @tags subjects
 * @description Create a new subject with optional qualification metadata.
 * @body slug string - Unique slug (required)
 * @body name string - Display name (required)
 * @body description string - Subject description
 * @body defaultTrustLevel string - Default trust level (default: UNVERIFIED)
 * @body qualificationBody string - Awarding body
 * @body qualificationRef string - Qualification reference
 * @body qualificationLevel string - Qualification level
 * @body teachingProfile string - Teaching profile key (e.g. "comprehension-led")
 * @response 201 { subject: {...} }
 * @response 400 { error: "slug and name are required" }
 * @response 400 { error: "Invalid teachingProfile: ..." }
 * @response 409 { error: "A subject with this slug already exists" }
 * @response 500 { error: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json();
    const {
      slug,
      name,
      description,
      defaultTrustLevel,
      qualificationBody,
      qualificationRef,
      qualificationLevel,
      teachingProfile,
    } = body;

    if (!slug || !name) {
      return NextResponse.json(
        { error: "slug and name are required" },
        { status: 400 }
      );
    }

    // Validate teachingProfile if provided
    if (teachingProfile && !TEACHING_PROFILE_KEYS.includes(teachingProfile as TeachingProfileKey)) {
      return NextResponse.json(
        { error: `Invalid teachingProfile: ${teachingProfile}. Valid values: ${TEACHING_PROFILE_KEYS.join(", ")}` },
        { status: 400 }
      );
    }

    const subject = await prisma.subject.create({
      data: {
        slug,
        name,
        description,
        defaultTrustLevel: defaultTrustLevel || "UNVERIFIED",
        qualificationBody,
        qualificationRef,
        qualificationLevel,
        teachingProfile: teachingProfile || undefined,
      },
    });

    return NextResponse.json({ subject }, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "A subject with this slug already exists" },
        { status: 409 }
      );
    }
    console.error("[subjects] POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

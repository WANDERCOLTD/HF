import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { isStudentVisibleDefault } from "@/lib/doc-type-icons";

type Params = { params: Promise<{ subjectId: string }> };

/**
 * @api GET /api/subjects/:subjectId/sources
 * @visibility internal
 * @scope subjects:read
 * @auth session
 * @tags subjects
 * @description List content sources attached to a subject with assertion counts.
 * @param subjectId string - Subject ID (path)
 * @response 200 { sources: [...] }
 * @response 500 { error: "..." }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;

    const sources = await prisma.subjectSource.findMany({
      where: { subjectId },
      include: {
        source: {
          include: { _count: { select: { assertions: true } } },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({ sources });
  } catch (error: any) {
    console.error("[subjects/:id/sources] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api POST /api/subjects/:subjectId/sources
 * @visibility internal
 * @scope subjects:update
 * @auth session
 * @tags subjects
 * @description Attach an existing source or create a new one and attach it to a subject.
 * @param subjectId string - Subject ID (path)
 * @body sourceId string - Existing source ID to attach
 * @body slug string - Slug for new source (required if no sourceId)
 * @body name string - Name for new source (required if no sourceId)
 * @body trustLevel string - Trust level override
 * @body tags string[] - Tags (default: ["content"])
 * @body sortOrder number - Sort order (default: 0)
 * @response 201 { subjectSource: {...}, source?: {...} }
 * @response 400 { error: "Provide sourceId to attach existing, or slug+name to create new" }
 * @response 404 { error: "Subject not found" }
 * @response 409 { error: "This source is already attached to this subject" }
 * @response 500 { error: "..." }
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;
    const body = await req.json();

    // Verify subject exists
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    let sourceId = body.sourceId;
    let source;

    if (!sourceId && body.slug && body.name) {
      // Create new ContentSource and attach
      source = await prisma.contentSource.create({
        data: {
          slug: body.slug,
          name: body.name,
          description: body.description,
          trustLevel: body.trustLevel || subject.defaultTrustLevel,
        },
      });
      sourceId = source.id;
    } else if (!sourceId) {
      return NextResponse.json(
        { error: "Provide sourceId to attach existing, or slug+name to create new" },
        { status: 400 }
      );
    }

    // Auto-tag student-visible if no explicit tags provided
    let tags: string[] = body.tags || ["content"];
    if (!body.tags) {
      // Look up document type to determine student visibility default
      const srcInfo = await prisma.contentSource.findUnique({
        where: { id: sourceId },
        select: { documentType: true },
      });
      if (srcInfo?.documentType && isStudentVisibleDefault(srcInfo.documentType)) {
        tags = [...tags, "student-material"];
      }
    }

    const subjectSource = await prisma.subjectSource.create({
      data: {
        subjectId,
        sourceId,
        tags,
        trustLevelOverride: body.trustLevelOverride || null,
        sortOrder: body.sortOrder || 0,
      },
      include: {
        source: {
          include: { _count: { select: { assertions: true } } },
        },
      },
    });

    return NextResponse.json({ subjectSource, source }, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "This source is already attached to this subject" },
        { status: 409 }
      );
    }
    console.error("[subjects/:id/sources] POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api PATCH /api/subjects/:subjectId/sources
 * @visibility internal
 * @scope subjects:update
 * @auth session
 * @tags subjects
 * @description Update a SubjectSource's tags (e.g. toggle student-material visibility).
 * @param subjectId string - Subject ID (path)
 * @body sourceId string - Source ID to update (required)
 * @body tags string[] - Updated tags array (required)
 * @response 200 { ok: true, subjectSource: {...} }
 * @response 400 { error: "sourceId and tags are required" }
 * @response 500 { error: "..." }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;
    const body = await req.json();

    if (!body.sourceId || !Array.isArray(body.tags)) {
      return NextResponse.json(
        { error: "sourceId and tags are required" },
        { status: 400 },
      );
    }

    const subjectSource = await prisma.subjectSource.upsert({
      where: {
        subjectId_sourceId: {
          subjectId,
          sourceId: body.sourceId,
        },
      },
      update: { tags: body.tags },
      create: {
        subjectId,
        sourceId: body.sourceId,
        tags: body.tags,
      },
      include: {
        source: {
          include: { _count: { select: { assertions: true } } },
        },
      },
    });

    return NextResponse.json({ ok: true, subjectSource });
  } catch (error: any) {
    console.error("[subjects/:id/sources] PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @api DELETE /api/subjects/:subjectId/sources
 * @visibility internal
 * @scope subjects:update
 * @auth session
 * @tags subjects
 * @description Detach a source from a subject (does not delete the ContentSource itself).
 * @param subjectId string - Subject ID (path)
 * @body sourceId string - Source ID to detach (required)
 * @response 200 { ok: true }
 * @response 400 { error: "sourceId is required" }
 * @response 500 { error: "..." }
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;
    const body = await req.json();

    if (!body.sourceId) {
      return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
    }

    await prisma.subjectSource.delete({
      where: {
        subjectId_sourceId: {
          subjectId,
          sourceId: body.sourceId,
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[subjects/:id/sources] DELETE error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

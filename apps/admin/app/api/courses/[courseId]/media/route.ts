import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * @api GET /api/courses/[courseId]/media
 * @visibility internal
 * @scope content-sources:read
 * @auth VIEWER
 * @tags courses, media
 * @description List media assets (extracted images, uploaded files) across all subjects
 *   linked to a course. Supports pagination and optional MIME type filtering.
 * @query type string — Filter by MIME prefix: "image", "pdf", "audio" (optional)
 * @query limit number — Max results (default: 50)
 * @query offset number — Pagination offset (default: 0)
 * @response 200 { ok, media, total }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;
  const url = request.nextUrl;
  const typeFilter = url.searchParams.get("type") || undefined;
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit !== null ? Math.min(Math.max(Number(rawLimit), 0), 200) : 50;
  const offset = Number(url.searchParams.get("offset")) || 0;

  // Verify course exists and get linked subjects
  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      subjects: {
        select: { subjectId: true },
      },
    },
  });

  if (!playbook) {
    return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
  }

  const subjectIds = playbook.subjects.map((s) => s.subjectId);

  if (subjectIds.length === 0) {
    return NextResponse.json({ ok: true, media: [], total: 0 });
  }

  // Build MIME type filter
  const mimeFilter: Record<string, string> = {
    image: "image/",
    pdf: "application/pdf",
    audio: "audio/",
  };
  const mimePrefix = typeFilter ? mimeFilter[typeFilter] : undefined;

  // Query MediaAssets through SubjectMedia junction
  const where = {
    subjects: { some: { subjectId: { in: subjectIds } } },
    ...(mimePrefix
      ? mimePrefix.endsWith("/")
        ? { mimeType: { startsWith: mimePrefix } }
        : { mimeType: mimePrefix }
      : {}),
  };

  // Count-only mode (limit=0) — for tab badge without loading full records
  if (limit === 0) {
    const total = await prisma.mediaAsset.count({ where });
    return NextResponse.json({ ok: true, media: [], total });
  }

  const [media, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        fileName: true,
        title: true,
        fileSize: true,
        mimeType: true,
        trustLevel: true,
        captionText: true,
        figureRef: true,
        pageNumber: true,
        extractedFrom: true,
        createdAt: true,
        source: {
          select: { id: true, name: true },
        },
        subjects: {
          where: { subjectId: { in: subjectIds } },
          select: {
            subject: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.mediaAsset.count({ where }),
  ]);

  const result = media.map((m) => ({
    id: m.id,
    fileName: m.fileName,
    title: m.title,
    fileSize: m.fileSize,
    mimeType: m.mimeType,
    trustLevel: m.trustLevel,
    captionText: m.captionText,
    figureRef: m.figureRef,
    pageNumber: m.pageNumber,
    extractedFrom: m.extractedFrom,
    createdAt: m.createdAt.toISOString(),
    sourceName: m.source?.name || null,
    sourceId: m.source?.id || null,
    subjectName: m.subjects[0]?.subject?.name || null,
  }));

  return NextResponse.json({ ok: true, media: result, total });
}

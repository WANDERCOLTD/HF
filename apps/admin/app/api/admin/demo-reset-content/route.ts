import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * @api POST /api/admin/demo-reset-content
 * @visibility internal
 * @scope admin:write
 * @auth session (SUPERADMIN)
 * @tags admin, data-management, demo, content
 * @description Delete all ContentSources (and cascading assertions, questions, vocabulary)
 *   for a given domain. Forces re-extraction on next upload.
 *   Accepts { domainId } in body. SubjectSource links and MediaAsset source refs are
 *   cleaned up; Subjects are kept.
 * @request { domainId: string }
 * @response 200 { ok: true, deleted: { sources: number, subjects_unlinked: number }, domainName: string }
 * @response 400 { ok: false, error: "domainId is required" }
 * @response 403 { ok: false, error: "SUPERADMIN required" }
 * @response 404 { ok: false, error: "Domain not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth("SUPERADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json().catch(() => ({}));
    const { domainId } = body as { domainId?: string };

    if (!domainId) {
      return NextResponse.json(
        { ok: false, error: "domainId is required" },
        { status: 400 },
      );
    }

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, name: true },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 },
      );
    }

    // Find all subjects linked to this domain
    const subjectDomains = await prisma.subjectDomain.findMany({
      where: { domainId },
      select: { subjectId: true },
    });
    const subjectIds = subjectDomains.map((sd) => sd.subjectId);

    if (subjectIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: { sources: 0, subjects_unlinked: 0 }, domainName: domain.name });
    }

    // Find all ContentSources linked to these subjects
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId: { in: subjectIds } },
      select: { sourceId: true },
    });
    const sourceIds = [...new Set(subjectSources.map((ss) => ss.sourceId))];

    if (sourceIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: { sources: 0, subjects_unlinked: 0 }, domainName: domain.name });
    }

    // Clean up join tables first
    const unlinked = await prisma.subjectSource.deleteMany({
      where: { sourceId: { in: sourceIds } },
    });

    // Detach MediaAssets (onDelete: SetNull won't fire on bulk delete)
    await prisma.mediaAsset.updateMany({
      where: { sourceId: { in: sourceIds } },
      data: { sourceId: null },
    });

    // Delete ContentSources — assertions, questions, vocabulary, curricula cascade automatically
    const deleted = await prisma.contentSource.deleteMany({
      where: { id: { in: sourceIds } },
    });

    return NextResponse.json({
      ok: true,
      deleted: {
        sources: deleted.count,
        subjects_unlinked: unlinked.count,
      },
      domainName: domain.name,
    });
  } catch (error: unknown) {
    console.error("Demo content reset error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Reset failed" },
      { status: 500 },
    );
  }
}

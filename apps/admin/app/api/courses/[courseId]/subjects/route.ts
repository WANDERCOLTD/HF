import { requireAuth, isAuthError } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { INSTRUCTION_CATEGORIES } from '@/lib/content-trust/resolve-config';

/**
 * @api GET /api/courses/:courseId/subjects
 * @desc List subjects explicitly linked to a course (playbook-scoped only)
 * @auth VIEWER+
 * @tags courses, subjects
 * @returns {object} { ok, subjects: Subject[], course: { id, name, domainId, domainName } }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const auth = await requireAuth('VIEWER');
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;

  try {
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        name: true,
        domainId: true,
        domain: { select: { id: true, name: true } },
      },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: 'Course not found' }, { status: 404 });
    }

    // Course-scoped only — no domain fallback
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      include: {
        subject: {
          include: {
            sources: {
              include: {
                source: {
                  select: {
                    id: true,
                    name: true,
                    documentType: true,
                    extractorVersion: true,
                    linkedSourceId: true,
                    linkedSource: { select: { id: true, name: true } },
                    _count: { select: { assertions: true } },
                  },
                },
              },
            },
            _count: { select: { sources: true, curricula: true } },
          },
        },
      },
    });

    const subjectRecords = playbookSubjects.map((ps) => ps.subject);

    // Count instruction-category assertions per source (single query for all)
    const allSourceIds = subjectRecords.flatMap((s) =>
      s.sources.map((ss) => ss.sourceId)
    );
    const instructionBySource = allSourceIds.length > 0
      ? await prisma.contentAssertion.groupBy({
          by: ["sourceId"],
          where: {
            sourceId: { in: allSourceIds },
            category: { in: [...INSTRUCTION_CATEGORIES] },
          },
          _count: { id: true },
        })
      : [];
    const instrMap = new Map(
      instructionBySource.map((g) => [g.sourceId, g._count.id])
    );

    const subjects = subjectRecords
      .filter((s) => s.isActive)
      .map((s) => {
        const assertionCount = s.sources.reduce(
          (sum, ss) => sum + (ss.source._count?.assertions || 0),
          0
        );
        const instructionCount = s.sources.reduce(
          (sum, ss) => sum + (instrMap.get(ss.sourceId) || 0),
          0
        );
        return {
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          defaultTrustLevel: s.defaultTrustLevel,
          teachingProfile: s.teachingProfile,
          sourceCount: s._count.sources,
          curriculumCount: s._count.curricula,
          assertionCount,
          instructionCount,
          contentAssertionCount: assertionCount - instructionCount,
          sources: s.sources.map((ss) => ({
            id: ss.source.id,
            name: ss.source.name,
            documentType: ss.source.documentType,
            extractorVersion: ss.source.extractorVersion,
            assertionCount: ss.source._count?.assertions || 0,
            linkedSourceId: ss.source.linkedSourceId,
            linkedSourceName: ss.source.linkedSource?.name || null,
          })),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });

    return NextResponse.json({
      ok: true,
      subjects,
      course: {
        id: playbook.id,
        name: playbook.name,
        domainId: playbook.domainId,
        domainName: playbook.domain.name,
      },
    }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (err: any) {
    console.error('[GET /api/courses/:courseId/subjects]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

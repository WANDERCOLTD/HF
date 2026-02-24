import { requireAuth, isAuthError } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * @api GET /api/courses/:courseId/subjects
 * @desc List subjects linked to the course's domain via SubjectDomain
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

    const subjectDomains = await prisma.subjectDomain.findMany({
      where: { domainId: playbook.domainId },
      include: {
        subject: {
          include: {
            sources: {
              include: {
                source: {
                  select: {
                    id: true,
                    name: true,
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

    const subjects = subjectDomains
      .map((sd) => sd.subject)
      .filter((s) => s.isActive)
      .map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        defaultTrustLevel: s.defaultTrustLevel,
        sourceCount: s._count.sources,
        curriculumCount: s._count.curricula,
        assertionCount: s.sources.reduce(
          (sum, ss) => sum + (ss.source._count?.assertions || 0),
          0
        ),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));

    return NextResponse.json({
      ok: true,
      subjects,
      course: {
        id: playbook.id,
        name: playbook.name,
        domainId: playbook.domainId,
        domainName: playbook.domain.name,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/courses/:courseId/subjects]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

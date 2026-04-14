import { requireAuth, isAuthError } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * @api GET /api/courses
 * @desc List courses (playbooks) for the current user's domain(s)
 * @auth OPERATOR+
 * @param {string} q - Optional fuzzy search query for course name
 * @returns {object} { ok, courses: Course[], domains: Domain[], existingCourse?: Course }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth('OPERATOR');
  if (isAuthError(auth)) return auth.error;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  try {
    const query: any = {
      include: {
        domain: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, groupType: true } },
        subjects: {
          select: {
            subject: {
              select: {
                id: true,
                name: true,
                teachingProfile: true,
                sources: {
                  select: {
                    source: {
                      select: {
                        id: true,
                        documentType: true,
                        _count: { select: { assertions: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        _count: { select: { enrollments: true, items: true } },
      },
      orderBy: { name: 'asc' },
    };

    if (q) {
      query.where = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { domain: { name: { contains: q, mode: 'insensitive' } } },
        ],
      };
    }

    const [playbooks, domains] = await Promise.all([
      prisma.playbook.findMany(query),
      prisma.domain.findMany({
        select: { id: true, name: true },
        where: { isActive: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Collect all source IDs to batch-fetch category counts
    const allSourceIds: string[] = [];
    for (const pb of playbooks as any[]) {
      for (const ps of pb.subjects || []) {
        for (const ss of ps.subject?.sources || []) {
          allSourceIds.push(ss.source.id);
        }
      }
    }

    // Batch category counts for all sources across all courses
    const categoryCounts = allSourceIds.length > 0
      ? await prisma.contentAssertion.groupBy({
          by: ['sourceId', 'category'],
          where: { sourceId: { in: allSourceIds } },
          _count: { id: true },
        })
      : [];

    // Build sourceId → category → count map
    const categoryBySource = new Map<string, Map<string, number>>();
    for (const row of categoryCounts) {
      if (!categoryBySource.has(row.sourceId)) categoryBySource.set(row.sourceId, new Map());
      categoryBySource.get(row.sourceId)!.set(row.category || 'fact', row._count.id);
    }

    const courses = playbooks.map((pb: any) => {
      const config = pb.config as Record<string, any> | null;
      const subjects = (pb.subjects || []).map((ps: any) => ps.subject);

      // Aggregate content stats across all subjects/sources
      let totalTPs = 0;
      let sourceCount = 0;
      const docTypes = new Set<string>();
      const aggregatedCategories: Record<string, number> = {};
      const seenSources = new Set<string>();

      for (const sub of subjects) {
        for (const ss of sub.sources || []) {
          const src = ss.source;
          if (seenSources.has(src.id)) continue;
          seenSources.add(src.id);
          sourceCount++;
          totalTPs += src._count.assertions;
          if (src.documentType) docTypes.add(src.documentType);

          const catMap = categoryBySource.get(src.id);
          if (catMap) {
            for (const [cat, count] of catMap) {
              aggregatedCategories[cat] = (aggregatedCategories[cat] || 0) + count;
            }
          }
        }
      }

      // First subject's teaching profile (primary pedagogy signal)
      const teachingProfile = subjects.find((s: any) => s.teachingProfile)?.teachingProfile || null;

      return {
        id: pb.id,
        name: pb.name,
        description: pb.description,
        domain: pb.domain,
        group: pb.group || null,
        subjects: subjects.map((s: any) => ({ id: s.id, name: s.name })),
        studentCount: pb._count.enrollments,
        specCount: pb._count.items,
        status: pb.status.toLowerCase(),
        version: pb.version,
        createdAt: pb.createdAt.toISOString(),
        // Enriched fields
        audience: config?.audience || null,
        learningStructure: (config?.learningStructure as 'structured' | 'continuous' | undefined) || null,
        teachingProfile,
        contentStats: {
          totalTPs,
          sourceCount,
          docTypes: [...docTypes],
          categories: aggregatedCategories,
        },
      };
    });

    // If searching, check for exact match to suggest reuse
    let existingCourse = null;
    if (q && courses.length > 0) {
      existingCourse = courses.find((c) => c.name.toLowerCase() === q.toLowerCase());
    }

    return NextResponse.json({
      ok: true,
      courses,
      domains,
      existingCourse: existingCourse || null,
    });
  } catch (err) {
    console.error('Error fetching courses:', err);
    return NextResponse.json(
      { error: 'Failed to fetch courses' },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/courses
 * @desc Create a new course (playbook) with initial configuration
 * @auth OPERATOR+
 * @body {object} { domainId, courseName, learningOutcomes, teachingStyle, ... }
 * @returns {object} { course: Course }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth('OPERATOR');
  if (isAuthError(auth)) return auth.error;

  try {
    const body = await request.json();
    const {
      domainId,
      courseName,
      learningOutcomes,
      teachingStyle,
      welcomeMessage,
      studentEmails,
      groupId,
    } = body;

    if (!domainId || !courseName) {
      return NextResponse.json(
        { error: 'Missing required fields: domainId, courseName' },
        { status: 400 }
      );
    }

    // Create the playbook
    const playbook = await prisma.playbook.create({
      data: {
        name: courseName,
        domainId,
        groupId: groupId || undefined,
        status: 'PUBLISHED',
        description: learningOutcomes?.join('\n') || '',
      },
      include: {
        domain: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
    });

    const course = {
      id: playbook.id,
      name: playbook.name,
      domain: playbook.domain,
      studentCount: playbook._count.enrollments,
      status: playbook.status.toLowerCase(),
      createdAt: playbook.createdAt.toISOString(),
    };

    return NextResponse.json({ course });
  } catch (err) {
    console.error('Error creating course:', err);
    return NextResponse.json(
      { error: 'Failed to create course' },
      { status: 500 }
    );
  }
}

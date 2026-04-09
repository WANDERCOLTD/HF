import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isAuthError } from '@/lib/permissions';
import { getSubjectsForPlaybook } from '@/lib/knowledge/domain-sources';

/**
 * @api GET /api/courses/:courseId/assertions/:assertionId
 * @visibility internal
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, content-trust
 * @description Returns full detail for a single assertion, scoped to the course's subject graph.
 *   Used by the AssertionDetailDrawer on the Course Content tab.
 * @pathParam courseId string - Playbook UUID
 * @pathParam assertionId string - ContentAssertion UUID
 * @response 200 { ok, assertion: AssertionDetail }
 * @response 404 { ok: false, error: "Not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string; assertionId: string }> },
) {
  try {
    const authResult = await requireAuth('VIEWER');
    if (isAuthError(authResult)) return authResult.error;

    const { courseId, assertionId } = await params;

    const assertion = await prisma.contentAssertion.findUnique({
      where: { id: assertionId },
      select: {
        id: true,
        assertion: true,
        category: true,
        tags: true,
        chapter: true,
        section: true,
        pageRef: true,
        taxYear: true,
        examRelevance: true,
        learningOutcomeRef: true,
        topicSlug: true,
        depth: true,
        trustLevel: true,
        teachMethod: true,
        reviewedBy: true,
        reviewedAt: true,
        createdAt: true,
        sourceId: true,
        source: { select: { id: true, name: true } },
        _count: { select: { children: true, questions: true, vocabulary: true, mediaLinks: true } },
        children: {
          orderBy: { depth: "asc" },
          select: { id: true, assertion: true, category: true, depth: true },
        },
        questions: {
          select: { id: true, questionText: true, questionType: true },
        },
        vocabulary: {
          select: { id: true, term: true, definition: true },
        },
      },
    });

    if (!assertion) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    // Verify assertion belongs to this course's subject graph
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { domain: { select: { id: true } } },
    });
    if (!playbook?.domain?.id) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const { subjects } = await getSubjectsForPlaybook(courseId, playbook.domain.id);
    const sourceIds = new Set(
      subjects.flatMap((s) => s.sources.map((src) => src.sourceId)),
    );

    if (!sourceIds.has(assertion.sourceId)) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    // Resolve reviewer if reviewedBy is set
    let reviewer: { id: string; name: string | null; email: string } | null = null;
    if (assertion.reviewedBy) {
      const user = await prisma.user.findUnique({
        where: { id: assertion.reviewedBy },
        select: { id: true, name: true, email: true },
      });
      reviewer = user;
    }

    // Strip sourceId from response (internal FK)
    const { sourceId: _sourceId, reviewedBy: _reviewedBy, ...rest } = assertion;

    return NextResponse.json({ ok: true, assertion: { ...rest, reviewer } });
  } catch (err: any) {
    console.error('[assertion-detail] Error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || 'Internal error' },
      { status: 500 },
    );
  }
}

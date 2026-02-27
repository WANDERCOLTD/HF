import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

type Params = { params: Promise<{ curriculumId: string }> };

interface MediaRef {
  mediaId: string;
  fileName: string;
  captionText: string | null;
  figureRef: string | null;
  mimeType: string;
}

interface SessionMedia {
  session: number;
  label: string;
  images: MediaRef[];
}

// ── GET — Resolve images per session + unassigned ─────

/**
 * @api GET /api/curricula/:curriculumId/lesson-plan/media-map
 * @visibility public
 * @scope curricula:read
 * @auth session (VIEWER+)
 * @tags curricula, lesson-plan, media
 * @description Resolve which images belong to each lesson plan session (from persisted media[] or
 *   auto-computed via assertion links), plus unassigned images from the subject media library.
 * @response 200 { ok, sessions, unassigned, stats }
 * @response 404 { ok: false, error: "..." }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;

    // Load curriculum + subject linkage
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: {
        id: true,
        deliveryConfig: true,
        subjectId: true,
      },
    });

    if (!curriculum) {
      return NextResponse.json({ ok: false, error: "Curriculum not found" }, { status: 404 });
    }

    const dc = (curriculum.deliveryConfig as Record<string, any>) || {};
    const lessonPlan = dc.lessonPlan;
    const entries: any[] = lessonPlan?.entries || [];

    if (entries.length === 0) {
      return NextResponse.json({
        ok: true,
        sessions: [],
        unassigned: [],
        stats: { total: 0, assigned: 0, unassigned: 0 },
      });
    }

    // Load all image-type media from the subject's media library
    const allSubjectMedia: MediaRef[] = [];
    if (curriculum.subjectId) {
      const subjectMedia = await prisma.subjectMedia.findMany({
        where: {
          subjectId: curriculum.subjectId,
          media: { mimeType: { startsWith: "image/" } },
        },
        include: {
          media: {
            select: {
              id: true,
              fileName: true,
              captionText: true,
              figureRef: true,
              mimeType: true,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      });

      const seen = new Set<string>();
      for (const sm of subjectMedia) {
        if (!seen.has(sm.media.id)) {
          seen.add(sm.media.id);
          allSubjectMedia.push({
            mediaId: sm.media.id,
            fileName: sm.media.fileName,
            captionText: sm.media.captionText,
            figureRef: sm.media.figureRef,
            mimeType: sm.media.mimeType,
          });
        }
      }
    }

    // Resolve images per session
    const sessions: SessionMedia[] = [];
    const assignedMediaIds = new Set<string>();

    for (const entry of entries) {
      const sessionImages: MediaRef[] = [];

      // Priority 1: persisted media[] on the entry
      if (Array.isArray(entry.media) && entry.media.length > 0) {
        for (const m of entry.media) {
          if (m.mediaId) {
            // Enrich from allSubjectMedia if available (persisted refs may have stale metadata)
            const full = allSubjectMedia.find((sm) => sm.mediaId === m.mediaId);
            sessionImages.push(full || {
              mediaId: m.mediaId,
              fileName: m.fileName || "Unknown",
              captionText: m.captionText ?? null,
              figureRef: m.figureRef ?? null,
              mimeType: m.mimeType || "image/unknown",
            });
            assignedMediaIds.add(m.mediaId);
          }
        }
      }

      // Priority 2: backfill via learningOutcomeRefs → assertions → AssertionMedia
      if (sessionImages.length === 0 && Array.isArray(entry.learningOutcomeRefs) && entry.learningOutcomeRefs.length > 0) {
        const backfilled = await resolveMediaFromLORefs(entry.learningOutcomeRefs, curriculum.subjectId);
        for (const ref of backfilled) {
          if (!assignedMediaIds.has(ref.mediaId)) {
            sessionImages.push(ref);
            assignedMediaIds.add(ref.mediaId);
          }
        }
      }

      // Priority 3: backfill via assertionIds → AssertionMedia
      if (sessionImages.length === 0 && Array.isArray(entry.assertionIds) && entry.assertionIds.length > 0) {
        const backfilled = await resolveMediaFromAssertionIds(entry.assertionIds);
        for (const ref of backfilled) {
          if (!assignedMediaIds.has(ref.mediaId)) {
            sessionImages.push(ref);
            assignedMediaIds.add(ref.mediaId);
          }
        }
      }

      sessions.push({
        session: entry.session,
        label: entry.label || `Session ${entry.session}`,
        images: sessionImages,
      });
    }

    // Unassigned = subject media not in any session
    const unassigned = allSubjectMedia.filter((m) => !assignedMediaIds.has(m.mediaId));

    return NextResponse.json({
      ok: true,
      sessions,
      unassigned,
      stats: {
        total: allSubjectMedia.length,
        assigned: assignedMediaIds.size,
        unassigned: unassigned.length,
      },
    });
  } catch (error: any) {
    console.error("[curricula/:id/lesson-plan/media-map] GET error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────

/**
 * Resolve media from learning outcome refs:
 * LO refs → ContentAssertions matching those LOs → AssertionMedia → MediaAsset
 */
async function resolveMediaFromLORefs(
  loRefs: string[],
  subjectId: string | null,
): Promise<MediaRef[]> {
  if (loRefs.length === 0) return [];

  // Build OR conditions for LO ref matching (LO refs can be partial, e.g., "LO1" matches "LO1.1")
  const loConditions = loRefs.map((ref) => ({
    learningOutcomeRef: { contains: ref },
  }));

  const assertionIds = await prisma.contentAssertion.findMany({
    where: {
      OR: loConditions,
      ...(subjectId ? { source: { subjects: { some: { subjectId } } } } : {}),
    },
    select: { id: true },
    take: 200,
  });

  return resolveMediaFromAssertionIds(assertionIds.map((a) => a.id));
}

/**
 * Resolve media from assertion IDs: assertionIds → AssertionMedia → MediaAsset
 */
async function resolveMediaFromAssertionIds(assertionIds: string[]): Promise<MediaRef[]> {
  if (assertionIds.length === 0) return [];

  const links = await prisma.assertionMedia.findMany({
    where: { assertionId: { in: assertionIds } },
    select: {
      media: {
        select: {
          id: true,
          fileName: true,
          captionText: true,
          figureRef: true,
          mimeType: true,
        },
      },
    },
  });

  // Deduplicate by media ID
  const seen = new Set<string>();
  const results: MediaRef[] = [];
  for (const link of links) {
    if (!seen.has(link.media.id)) {
      seen.add(link.media.id);
      results.push({
        mediaId: link.media.id,
        fileName: link.media.fileName,
        captionText: link.media.captionText,
        figureRef: link.media.figureRef,
        mimeType: link.media.mimeType,
      });
    }
  }

  return results;
}

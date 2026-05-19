/**
 * @api GET /api/student/materials
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @desc Returns student-visible content sources for the caller's enrolled course.
 *   Sources tagged "student-material" are included. Each source returns its original
 *   uploaded document (via MediaAsset public URL), plus extracted vocabulary and questions.
 * @response 200 { ok: true, courseName, materials: SessionMaterial[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { getPublicMediaUrl } from "@/app/api/media/[id]/public/route";

interface SessionMaterial {
  sourceId: string;
  sourceName: string;
  documentType: string | null;
  sortOrder: number;
  media: {
    id: string;
    fileName: string;
    mimeType: string;
    publicUrl: string;
  } | null;
  vocabulary: Array<{ term: string; definition: string; partOfSpeech: string | null }>;
  questions: Array<{ text: string; type: string }>;
}

export async function GET(request: NextRequest) {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const callerId = auth.callerId;

  // Resolve caller's enrolled playbook
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });
  if (!caller?.domainId) {
    return NextResponse.json({ ok: true, courseName: null, materials: [] });
  }

  const playbookId = await resolvePlaybookId(callerId);
  if (!playbookId) {
    return NextResponse.json({ ok: true, courseName: null, materials: [] });
  }

  // Read student-visible content via PlaybookSource (the content boundary
  // since 2026-04-17). Pre-#483 this traversed the Subject chain — that
  // path leaked content from sibling courses sharing a Subject. See #478.
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { name: true },
  });
  if (!playbook) {
    return NextResponse.json({ ok: true, courseName: null, materials: [] });
  }

  const playbookSources = await prisma.playbookSource.findMany({
    where: {
      playbookId,
      tags: { has: "student-material" },
    },
    include: {
      source: {
        select: {
          id: true,
          name: true,
          documentType: true,
          mediaAssets: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              storageKey: true,
              storageType: true,
            },
          },
          vocabulary: {
            select: {
              term: true,
              definition: true,
              partOfSpeech: true,
            },
            orderBy: { term: "asc" },
          },
          questions: {
            select: {
              questionText: true,
              questionType: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Build response — no answer keys in questions
  const materials: SessionMaterial[] = await Promise.all(
    playbookSources.map(async (ps) => {
      const media = ps.source.mediaAssets[0];
      let publicUrl: string | null = null;

      if (media) {
        publicUrl = await getPublicMediaUrl(
          media.id,
          media.storageKey,
          media.storageType,
        );
      }

      return {
        sourceId: ps.source.id,
        sourceName: ps.source.name,
        documentType: ps.source.documentType,
        sortOrder: ps.sortOrder,
        media: media
          ? {
              id: media.id,
              fileName: media.fileName,
              mimeType: media.mimeType,
              publicUrl: publicUrl!,
            }
          : null,
        vocabulary: ps.source.vocabulary.map((v) => ({
          term: v.term,
          definition: v.definition,
          partOfSpeech: v.partOfSpeech,
        })),
        questions: ps.source.questions.map((q) => ({
          text: q.questionText,
          type: q.questionType,
        })),
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    courseName: playbook.name,
    materials,
  });
}

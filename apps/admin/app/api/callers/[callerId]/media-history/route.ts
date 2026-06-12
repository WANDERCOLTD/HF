import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api GET /api/callers/:callerId/media-history
 * @visibility internal
 * @scope callers:media:history
 * @auth session (VIEWER+)
 * @tags callers, media
 * @description Get all media shared with a caller across their calls. Supports sort, order, type filter, and call filter.
 * @query sort - Sort field: date (default), name, type
 * @query order - Sort order: desc (default), asc
 * @query type - Filter by MIME type prefix: all (default), image, pdf, audio
 * @query callId - Optional call ID to filter to a single call
 * @response 200 { ok: true, media: SharedMediaItem[], total: number }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;

  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") || "date";
  const order = url.searchParams.get("order") || "desc";
  const typeFilter = url.searchParams.get("type") || "all";
  const callIdFilter = url.searchParams.get("callId");

  // Build where clause
  const where: Record<string, unknown> = {
    mediaId: { not: null },
    call: { callerId },
  };

  if (callIdFilter) {
    where.callId = callIdFilter;
  }

  // Build MIME filter
  if (typeFilter === "image") {
    where.media = { mimeType: { startsWith: "image/" } };
  } else if (typeFilter === "pdf") {
    where.media = { mimeType: "application/pdf" };
  } else if (typeFilter === "audio") {
    where.media = { mimeType: { startsWith: "audio/" } };
  }

  // Build orderBy
  let orderBy: Record<string, unknown>;
  if (sort === "name") {
    orderBy = { media: { fileName: order as "asc" | "desc" } };
  } else if (sort === "type") {
    orderBy = { media: { mimeType: order as "asc" | "desc" } };
  } else {
    orderBy = { createdAt: order as "asc" | "desc" };
  }

  const messages = await prisma.callMessage.findMany({
    where,
    include: {
      media: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          title: true,
        },
      },
    },
    orderBy,
  });

  const media = messages
    .filter((m) => m.media)
    .map((m) => ({
      id: m.id,
      mediaId: m.media!.id,
      fileName: m.media!.fileName,
      mimeType: m.media!.mimeType,
      title: m.media!.title,
      content: m.content,
      sharedAt: m.createdAt,
      callId: m.callId,
      url: `/api/media/${m.media!.id}`,
    }));

  return NextResponse.json({ ok: true, media, total: media.length });
}

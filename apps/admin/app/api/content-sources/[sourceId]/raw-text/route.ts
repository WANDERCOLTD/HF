import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getStorageAdapter } from "@/lib/storage";
import { extractTextFromBuffer } from "@/lib/content-trust/extract-assertions";

type RouteParams = { params: Promise<{ sourceId: string }> };

/**
 * @api GET /api/content-sources/:sourceId/raw-text
 * @visibility internal
 * @scope content-sources:read
 * @auth session
 * @tags content-trust, wizard
 * @description Returns the FULL extracted text of a ContentSource by re-running
 *   the text extractor against the linked MediaAsset. Distinct from
 *   `GET /api/content-sources/:sourceId` which returns `textSample` truncated
 *   to ~2000 chars (set at ingest time).
 *
 *   Purpose (wizard fix): `detectAuthoredModules` needs the full document text
 *   to parse the `## Modules` table — most course-refs put the table well past
 *   the 2KB textSample cutoff (e.g. the IELTS Speaking course-ref has it at
 *   char 20,490). Without this endpoint, the wizard mis-reports
 *   `curriculumPath = "generated"` for courses that DO declare a module
 *   catalogue, then defaults the progressionMode picker the wrong way and
 *   tells the AI "no module catalogue found" via the GROUND TRUTH overlay.
 *
 * @pathParam sourceId string - ContentSource ID
 * @response 200 { ok: true, text: string, byteLength: number, mediaAssetId: string | null }
 * @response 404 { ok: false, error: "not-found" | "no-media-asset" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { sourceId } = await params;

    const source = await prisma.contentSource.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        mediaAssets: {
          select: { id: true, storageKey: true, fileName: true },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!source) {
      return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
    }
    const media = source.mediaAssets[0];
    if (!media) {
      return NextResponse.json({ ok: false, error: "no-media-asset" }, { status: 404 });
    }

    const storage = getStorageAdapter();
    const buffer = await storage.download(media.storageKey);
    const { text } = await extractTextFromBuffer(buffer, media.fileName);

    return NextResponse.json({
      ok: true,
      text: text ?? "",
      byteLength: text ? Buffer.byteLength(text, "utf8") : 0,
      mediaAssetId: media.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

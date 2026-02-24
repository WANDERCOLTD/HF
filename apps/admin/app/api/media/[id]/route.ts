import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getStorageAdapter, computeContentHash, isAllowedMimeType, isAllowedFileSize } from "@/lib/storage";
import { config } from "@/lib/config";

/**
 * @api GET /api/media/:id
 * @visibility internal
 * @scope media:read
 * @auth session (VIEWER+)
 * @tags media
 * @description Serve a media file by ID. Generates a signed URL from the storage backend and redirects to it. For local storage, streams the file directly.
 * @response 302 Redirect to signed URL
 * @response 404 { ok: false, error: "Media not found" }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;

  const media = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!media) {
    return NextResponse.json({ ok: false, error: "Media not found" }, { status: 404 });
  }

  const storage = getStorageAdapter();

  // For local storage, stream the file directly using a fresh local adapter instance
  if (media.storageType === "local") {
    try {
      const { LocalStorageAdapter } = await import("@/lib/storage/local");
      const localAdapter = new LocalStorageAdapter();
      const buffer = await localAdapter.download(media.storageKey);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": media.mimeType,
          "Content-Disposition": `attachment; filename="${media.fileName}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }
  }

  // For GCS (and fallback), redirect to signed URL with original filename in Content-Disposition
  const signedUrl = await storage.getSignedUrl(media.storageKey, 3600, media.fileName);
  return NextResponse.redirect(signedUrl);
}

/**
 * @api PATCH /api/media/:id
 * @visibility internal
 * @scope media:replace
 * @auth session (OPERATOR+)
 * @tags media
 * @description Replace the file content of an existing media asset. Validates MIME type and file size,
 *   uploads the new file, removes the old one from storage, and updates the database record.
 *   All existing references (SubjectMedia, CallMessage, ConversationArtifact) are preserved.
 * @body file File - The replacement file (multipart/form-data)
 * @response 200 { ok: true, media: { id, fileName, mimeType, fileSize, url }, previousFileName: string }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Media not found" }
 * @response 409 { ok: false, error: "A file with this content already exists" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;

  const existing = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Media not found" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No replacement file provided" }, { status: 400 });
    }

    // Validate MIME type
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        { ok: false, error: `File type "${file.type}" not allowed. Allowed: ${config.storage.allowedMimeTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (!isAllowedFileSize(file.size)) {
      const maxMB = Math.round(config.storage.maxFileSize / 1048576);
      return NextResponse.json(
        { ok: false, error: `File too large (${Math.round(file.size / 1048576)}MB). Maximum: ${maxMB}MB` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const newContentHash = computeContentHash(buffer);

    // If content is identical, no-op
    if (newContentHash === existing.contentHash) {
      return NextResponse.json({
        ok: true,
        media: {
          id: existing.id,
          fileName: existing.fileName,
          mimeType: existing.mimeType,
          fileSize: existing.fileSize,
          title: existing.title,
          url: `/api/media/${existing.id}`,
        },
        noChange: true,
      });
    }

    // Check if the new content hash collides with a *different* media asset
    const collision = await prisma.mediaAsset.findUnique({ where: { contentHash: newContentHash } });
    if (collision && collision.id !== id) {
      return NextResponse.json(
        { ok: false, error: "A file with this content already exists", existingMediaId: collision.id },
        { status: 409 }
      );
    }

    // Upload new file to storage
    const storage = getStorageAdapter();
    const { storageKey: newStorageKey } = await storage.upload(buffer, {
      fileName: file.name,
      mimeType: file.type,
      contentHash: newContentHash,
    });

    // Delete old file from storage (best-effort — don't fail the request)
    try {
      await storage.delete(existing.storageKey);
    } catch (err) {
      console.warn(`[media/replace] Failed to delete old storage key ${existing.storageKey}:`, err);
    }

    // Update DB record
    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        contentHash: newContentHash,
        storageKey: newStorageKey,
        storageType: config.storage.backend,
      },
    });

    return NextResponse.json({
      ok: true,
      media: {
        id: updated.id,
        fileName: updated.fileName,
        mimeType: updated.mimeType,
        fileSize: updated.fileSize,
        title: updated.title,
        url: `/api/media/${updated.id}`,
      },
      previousFileName: existing.fileName,
    });
  } catch (error) {
    console.error("Media replace error:", error);
    return NextResponse.json({ ok: false, error: "File replacement failed" }, { status: 500 });
  }
}

/**
 * @api DELETE /api/media/:id
 * @visibility internal
 * @scope media:delete
 * @auth session (ADMIN+)
 * @tags media
 * @description Delete a media file by ID. Removes from storage backend and database.
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Media not found" }
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { id } = await params;

  const media = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!media) {
    return NextResponse.json({ ok: false, error: "Media not found" }, { status: 404 });
  }

  // Delete from storage backend
  const storage = getStorageAdapter();
  await storage.delete(media.storageKey);

  // Delete from database (cascades SubjectMedia links)
  await prisma.mediaAsset.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

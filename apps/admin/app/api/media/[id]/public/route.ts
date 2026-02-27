import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorageAdapter } from "@/lib/storage";
import { config } from "@/lib/config";
import crypto from "crypto";

/**
 * @api GET /api/media/:id/public?token=<hmac>&expires=<epoch>
 * @visibility public
 * @scope media:public-read
 * @auth hmac-token
 * @tags media, channels
 * @description Serve a media file without session auth, validated by HMAC token.
 *   Used by external delivery channels (Twilio MMS, WhatsApp) to fetch media
 *   when sending content to callers. Tokens are time-limited.
 *
 *   Token format: HMAC-SHA256(mediaId:expiresEpoch, INTERNAL_API_SECRET)
 *
 * @query token string - HMAC-SHA256 token
 * @query expires string - Unix epoch expiry timestamp
 * @response 200 File stream with Content-Type
 * @response 401 { error: "Invalid or expired token" }
 * @response 404 { error: "Media not found" }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token");
  const expires = request.nextUrl.searchParams.get("expires");

  if (!token || !expires) {
    return NextResponse.json({ error: "Missing token or expires" }, { status: 401 });
  }

  // Check expiry
  const expiresMs = parseInt(expires, 10) * 1000;
  if (isNaN(expiresMs) || Date.now() > expiresMs) {
    return NextResponse.json({ error: "Token expired" }, { status: 401 });
  }

  // Validate HMAC
  const expected = generateMediaToken(id, parseInt(expires, 10));
  if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const media = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!media) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  try {
    const storage = getStorageAdapter();
    const buffer = await storage.download(media.storageKey);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Disposition": `inline; filename="${media.fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

// ── Token helpers (exported for use by share_content tool) ──

const TOKEN_SECRET_KEY = "media-public-token";

/**
 * Generate an HMAC token for public media access.
 */
export function generateMediaToken(mediaId: string, expiresEpoch: number): string {
  const payload = `${mediaId}:${expiresEpoch}`;
  return crypto
    .createHmac("sha256", `${config.security.internalApiSecret}:${TOKEN_SECRET_KEY}`)
    .update(payload)
    .digest("hex");
}

/**
 * Build a public URL for a media asset with HMAC token.
 * For GCS storage, uses signed URLs directly (faster, no proxy).
 * For local storage, uses the HMAC-token route.
 */
export async function getPublicMediaUrl(
  mediaId: string,
  storageKey: string,
  storageType: string,
  expirySeconds = 86400,
): Promise<string> {
  // GCS: use native signed URLs (Twilio fetches directly from GCS)
  if (storageType === "gcs") {
    const storage = getStorageAdapter();
    return storage.getSignedUrl(storageKey, expirySeconds);
  }

  // Local storage: use HMAC-token route
  const expiresEpoch = Math.floor((Date.now() + expirySeconds * 1000) / 1000);
  const token = generateMediaToken(mediaId, expiresEpoch);
  return `${config.app.url}/api/media/${mediaId}/public?token=${token}&expires=${expiresEpoch}`;
}

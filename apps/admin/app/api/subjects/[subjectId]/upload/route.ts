import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractTextFromBuffer,
} from "@/lib/content-trust/extract-assertions";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { classifyDocument, fetchFewShotExamples } from "@/lib/content-trust/classify-document";
import { resolveExtractionConfig } from "@/lib/content-trust/resolve-config";
import { getStorageAdapter, computeContentHash } from "@/lib/storage";
import { config } from "@/lib/config";
import { findDuplicateSource } from "@/lib/content-trust/dedup-source";

/**
 * @api POST /api/subjects/:subjectId/upload
 * @visibility public
 * @scope subjects:write
 * @auth OPERATOR
 * @tags subjects, content-trust, classification
 * @description Drag-drop endpoint: upload a document, auto-create ContentSource,
 *   classify its document type via AI, and attach to subject.
 *   Does NOT start extraction — user must confirm the classification first,
 *   then trigger extraction via POST /api/content-sources/:sourceId/extract.
 *
 * @body file File (PDF, DOCX, TXT, MD, JSON)
 * @body tags string — comma-separated tags (default: "content")
 * @body sourceName string — optional display name (defaults to filename)
 * @body trustLevel string — optional override (defaults to subject's defaultTrustLevel)
 *
 * @response 202 { ok, source, classification, awaitingClassification }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ subjectId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { subjectId } = await params;

    // Verify subject exists
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      return NextResponse.json({ ok: false, error: "Subject not found" }, { status: 404 });
    }

    // Parse form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const tagsRaw = (formData.get("tags") as string) || "content";
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    const sourceName = (formData.get("sourceName") as string) || null;
    const trustLevelOverride = (formData.get("trustLevel") as string) || null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    const validExtensions = [".pdf", ".docx", ".txt", ".md", ".markdown", ".json"];
    if (!validExtensions.some((ext) => fileName.endsWith(ext))) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type. Supported: ${validExtensions.join(", ")}` },
        { status: 400 }
      );
    }

    // ── Read file into buffer (used for text extraction + storage) ──

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = computeContentHash(buffer);

    // ── Institution-scoped dedup check (fast, no AI) ──

    const dedup = await findDuplicateSource(contentHash, subjectId);

    if (dedup.deduplicated && dedup.existingSource) {
      // Same file already uploaded + extracted within this institution — reuse it
      const existingId = dedup.existingSource.id;

      // Link existing source to this subject (idempotent)
      await prisma.subjectSource.upsert({
        where: { subjectId_sourceId: { subjectId, sourceId: existingId } },
        update: {},
        create: {
          subjectId,
          sourceId: existingId,
          tags,
          trustLevelOverride: trustLevelOverride ? (trustLevelOverride as any) : null,
        },
      });

      // Link existing media to subject (idempotent)
      const existingMedia = await prisma.mediaAsset.findUnique({ where: { contentHash } });
      if (existingMedia) {
        await prisma.subjectMedia.upsert({
          where: { subjectId_mediaId: { subjectId, mediaId: existingMedia.id } },
          update: {},
          create: { subjectId, mediaId: existingMedia.id },
        });
      }

      console.log(`[subjects/:id/upload] Deduplicated "${file.name}" → reusing source ${existingId} (${dedup.assertionCount} assertions)`);

      return NextResponse.json(
        {
          ok: true,
          source: {
            id: dedup.existingSource.id,
            slug: dedup.existingSource.slug,
            name: dedup.existingSource.name,
            trustLevel: dedup.existingSource.trustLevel,
            documentType: dedup.existingSource.documentType,
            documentTypeSource: null,
          },
          classification: null,
          tags,
          fileName: file.name,
          textLength: null,
          mediaId: existingMedia?.id ?? null,
          awaitingClassification: false,
          deduplicated: true,
          assertionCount: dedup.assertionCount,
        },
        { status: 200 }
      );
    }

    // ── Extract text (fast, no AI) ──

    const { text } = await extractTextFromBuffer(buffer, file.name);
    if (!text.trim()) {
      return NextResponse.json(
        { ok: false, error: "Could not extract text from document" },
        { status: 422 }
      );
    }

    // ── Classify document type (AI, ~1-2 sec) ──

    const extractionConfig = await resolveExtractionConfig();
    const fewShotConfig = extractionConfig.classification.fewShot;

    // Resolve domain from subject for domain-aware few-shot examples
    let domainId: string | undefined;
    try {
      const subjectWithDomains = await prisma.subject.findUnique({
        where: { id: subjectId },
        select: { domains: { select: { domainId: true }, take: 1 } },
      });
      domainId = subjectWithDomains?.domains?.[0]?.domainId;
    } catch { /* best-effort */ }

    const examples = fewShotConfig?.enabled !== false
      ? await fetchFewShotExamples({ domainId }, fewShotConfig)
      : [];
    const classification = await classifyDocument(
      text.substring(0, extractionConfig.classification.sampleSize),
      file.name,
      extractionConfig,
      examples,
    );

    // Auto-set tags: CURRICULUM → add "syllabus"
    const finalTags = classification.documentType === "CURRICULUM" && !tags.includes("syllabus")
      ? [...tags, "syllabus"]
      : tags;

    // ── Create ContentSource (with classified type + contentHash) ──

    const baseSlug = file.name
      .replace(/\.[^/.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const sourceSlug = `${subject.slug}-${baseSlug}`;
    const displayName = sourceName || file.name.replace(/\.[^/.]+$/, "");

    const trustLevel = trustLevelOverride || subject.defaultTrustLevel;
    let source;
    try {
      source = await prisma.contentSource.create({
        data: {
          slug: sourceSlug,
          name: displayName,
          trustLevel: trustLevel as any,
          documentType: classification.documentType as any,
          documentTypeSource: `ai:${classification.confidence.toFixed(2)}`,
          textSample: text.substring(0, 1000),
          aiClassification: `${classification.documentType}:${classification.confidence.toFixed(2)}`,
          contentHash,
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        source = await prisma.contentSource.create({
          data: {
            slug: `${sourceSlug}-${Date.now()}`,
            name: displayName,
            trustLevel: trustLevel as any,
            documentType: classification.documentType as any,
            documentTypeSource: `ai:${classification.confidence.toFixed(2)}`,
            textSample: text.substring(0, 1000),
            aiClassification: `${classification.documentType}:${classification.confidence.toFixed(2)}`,
            contentHash,
          },
        });
      } else {
        throw err;
      }
    }

    // Attach to subject
    await prisma.subjectSource.create({
      data: {
        subjectId,
        sourceId: source.id,
        tags: finalTags,
        trustLevelOverride: trustLevelOverride ? (trustLevelOverride as any) : null,
      },
    });

    // ── Store file in storage backend + create MediaAsset ──

    const storage = getStorageAdapter();

    // Check for duplicate media content
    const existingMedia = await prisma.mediaAsset.findUnique({ where: { contentHash } });
    let mediaId: string;

    if (existingMedia) {
      // Reuse existing storage, just link to this source
      mediaId = existingMedia.id;
      await prisma.mediaAsset.update({
        where: { id: existingMedia.id },
        data: { sourceId: source.id },
      });
    } else {
      const mimeType = file.type || "application/octet-stream";
      const { storageKey } = await storage.upload(buffer, {
        fileName: file.name,
        mimeType,
        contentHash,
      });

      const media = await prisma.mediaAsset.create({
        data: {
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          contentHash,
          storageKey,
          storageType: config.storage.backend,
          uploadedBy: authResult.session.user.id,
          sourceId: source.id,
          trustLevel: trustLevel as any,
        },
      });
      mediaId = media.id;
    }

    // Link media to subject via SubjectMedia (so content pickers can find it)
    await prisma.subjectMedia.upsert({
      where: { subjectId_mediaId: { subjectId, mediaId } },
      update: {},
      create: { subjectId, mediaId },
    });

    // ── Return immediately (no extraction started) ──

    return NextResponse.json(
      {
        ok: true,
        source: {
          id: source.id,
          slug: source.slug,
          name: source.name,
          trustLevel: source.trustLevel,
          documentType: source.documentType,
          documentTypeSource: source.documentTypeSource,
        },
        classification: {
          documentType: classification.documentType,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
        },
        tags: finalTags,
        fileName: file.name,
        textLength: text.length,
        mediaId,
        awaitingClassification: true,
        deduplicated: false,
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error("[subjects/:id/upload] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}

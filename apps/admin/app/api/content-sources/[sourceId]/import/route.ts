import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractText,
  extractAssertions,
  chunkText,
  quickExtract,
  type ChunkCompleteData,
} from "@/lib/content-trust/extract-assertions";
import type { DocumentType, TeachingMode } from "@/lib/content-trust/resolve-config";
import { resolveExtractionConfig } from "@/lib/content-trust/resolve-config";
import { classifyDocument, fetchFewShotExamples } from "@/lib/content-trust/classify-document";
import { segmentDocument } from "@/lib/content-trust/segment-document";
import { extractAssertionsSegmented } from "@/lib/content-trust/extract-assertions";
import { saveAssertions } from "@/lib/content-trust/save-assertions";
import { createExtractionTask, getJob, updateJob } from "@/lib/content-trust/extraction-jobs";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getStorageAdapter, computeContentHash } from "@/lib/storage";
import { config } from "@/lib/config";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
  backgroundRun,
} from "@/lib/ai/task-guidance";

// ── Background: Classify document ──────────────────────

async function runBackgroundClassification(
  sourceId: string,
  taskId: string,
  file: File,
  fileBuffer: Buffer,
  userId: string,
) {
  try {
    const source = await prisma.contentSource.findUnique({
      where: { id: sourceId },
      select: { id: true, trustLevel: true },
    });

    if (!source) {
      await failTask(taskId, "Source not found");
      return;
    }

    // Extract text
    const { text } = await extractText(file);

    if (!text.trim()) {
      await failTask(taskId, "Could not extract text from document");
      return;
    }

    // Classify document type via AI
    const extractionConfig = await resolveExtractionConfig(sourceId);
    const fewShotConfig = extractionConfig.classification.fewShot;
    const examples = fewShotConfig?.enabled !== false
      ? await fetchFewShotExamples({ sourceId }, fewShotConfig)
      : [];
    const classification = await classifyDocument(
      text.substring(0, extractionConfig.classification.sampleSize),
      file.name,
      extractionConfig,
      examples,
    );

    // Update source with classification
    await prisma.contentSource.update({
      where: { id: sourceId },
      data: {
        documentType: classification.documentType,
        documentTypeSource: `ai:${classification.confidence.toFixed(2)}`,
        textSample: text.substring(0, 1000),
        aiClassification: `${classification.documentType}:${classification.confidence.toFixed(2)}`,
      },
    });

    // Store file as MediaAsset
    const contentHash = computeContentHash(fileBuffer);
    const storage = getStorageAdapter();
    const existingMedia = await prisma.mediaAsset.findUnique({ where: { contentHash } });
    let mediaId: string;

    if (existingMedia) {
      mediaId = existingMedia.id;
      await prisma.mediaAsset.update({
        where: { id: existingMedia.id },
        data: { sourceId },
      });
    } else {
      const mimeType = file.type || "application/octet-stream";
      const { storageKey } = await storage.upload(fileBuffer, {
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
          uploadedBy: userId,
          sourceId,
          trustLevel: source.trustLevel as any,
        },
      });
      mediaId = media.id;
    }

    console.log(`[classify-background] Classified "${file.name}" as ${classification.documentType} (confidence: ${classification.confidence}) — stored as media ${mediaId}`);

    // Save result to task context
    await updateTaskProgress(taskId, {
      context: {
        classification: {
          documentType: classification.documentType,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
        },
        mediaId,
        textLength: text.length,
      },
    });

    await completeTask(taskId);
  } catch (error: any) {
    console.error("[classify-background] Error:", error);
    await failTask(taskId, error.message);
  }
}

/**
 * @api POST /api/content-sources/:sourceId/import
 * @visibility public
 * @scope content-sources:write
 * @auth session
 * @tags content-trust
 * @description Upload a document (PDF, text, markdown) and extract ContentAssertions linked to this source.
 *   - mode=classify: Classify document type (AI) + store file in background, return taskId for polling
 *   - mode=preview: Extract and return assertions without saving (dry run)
 *   - mode=import: Extract and save assertions to database
 *   - mode=background: Start extraction + import in background, return job ID for polling
 * @body file File - The document to parse (multipart/form-data)
 * @body mode "classify" | "preview" | "import" | "background" - Whether to classify-only, preview, save, or run in background (default: preview)
 * @body focusChapters string - Comma-separated chapter names to focus on (optional)
 * @body maxAssertions number - Max assertions to extract (default: 500)
 * @response 202 { ok: true, taskId: string } (classify mode - async)
 * @response 200 { ok: true, assertions: ExtractedAssertion[], created: number, duplicatesSkipped: number, warnings: string[] }
 * @response 202 { ok: true, jobId: string } (background mode)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { sourceId } = await params;

    // Verify source exists
    const source = await prisma.contentSource.findUnique({
      where: { id: sourceId },
      select: { id: true, slug: true, name: true, trustLevel: true, qualificationRef: true, documentType: true, documentTypeSource: true },
    });

    if (!source) {
      return NextResponse.json({ ok: false, error: "Source not found" }, { status: 404 });
    }

    // Parse form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mode = (formData.get("mode") as string) || "preview";
    const focusChaptersRaw = formData.get("focusChapters") as string | null;
    const maxAssertionsRaw = formData.get("maxAssertions") as string | null;
    const teachingModeRaw = formData.get("teachingMode") as string | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    // Validate file type
    const name = file.name.toLowerCase();
    const validExtensions = [".pdf", ".txt", ".md", ".markdown", ".json", ".docx"];
    if (!validExtensions.some((ext) => name.endsWith(ext))) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type. Supported: ${validExtensions.join(", ")}` },
        { status: 400 }
      );
    }

    const focusChapters = focusChaptersRaw?.split(",").map((s) => s.trim()).filter(Boolean);
    const maxAssertions = maxAssertionsRaw ? parseInt(maxAssertionsRaw, 10) : 500;
    const VALID_TEACHING_MODES: TeachingMode[] = ["recall", "comprehension", "practice", "syllabus"];
    const teachingMode: TeachingMode | undefined =
      teachingModeRaw && VALID_TEACHING_MODES.includes(teachingModeRaw as TeachingMode)
        ? (teachingModeRaw as TeachingMode)
        : undefined;

    // ── Classify mode: start background classification ──
    if (mode === "classify") {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Create task
      const taskId = await startTaskTracking(authResult.session.user.id, "classification", {
        sourceId,
        fileName: file.name,
      });

      // Fire background classification (no await)
      backgroundRun(taskId, () =>
        runBackgroundClassification(sourceId, taskId, file, buffer, authResult.session.user.id)
      );

      return NextResponse.json(
        { ok: true, taskId },
        { status: 202 }
      );
    }

    // ── Background mode: return immediately, extract in background ──
    if (mode === "background") {
      // Extract text synchronously (fast) so we can validate the file
      const { text, pages, fileType } = await extractText(file);
      if (!text.trim()) {
        return NextResponse.json(
          { ok: false, error: "Could not extract text from document" },
          { status: 422 }
        );
      }

      const chunks = chunkText(text);

      // Auto-classify document type if not explicitly set (documentTypeSource is null = schema default)
      let documentType = source.documentType as DocumentType;
      if (!source.documentTypeSource) {
        try {
          const extractionConfig = await resolveExtractionConfig(source.id);
          const fewShotConfig = extractionConfig.classification.fewShot;
          const examples = fewShotConfig?.enabled !== false
            ? await fetchFewShotExamples({ sourceId: source.id }, fewShotConfig)
            : [];
          const classification = await classifyDocument(text, file.name, extractionConfig, examples);
          documentType = classification.documentType;
          await prisma.contentSource.update({
            where: { id: sourceId },
            data: {
              documentType: classification.documentType,
              documentTypeSource: `ai:${classification.confidence.toFixed(2)}`,
              textSample: text.substring(0, 1000),
              aiClassification: `${classification.documentType}:${classification.confidence.toFixed(2)}`,
            },
          });
          console.log(`[import] Auto-classified "${file.name}" as ${classification.documentType} (confidence: ${classification.confidence}, examples: ${examples.length})`);
        } catch (classifyErr: any) {
          console.warn(`[import] Auto-classification failed, proceeding with default:`, classifyErr?.message);
        }
      }

      const job = await createExtractionTask(authResult.session.user.id, sourceId, file.name);
      await updateJob(job.id, { status: "extracting", totalChunks: chunks.length });

      // Fire-and-forget the extraction + import
      runBackgroundExtraction(job.id, source, text, file.name, fileType, pages, {
        sourceSlug: source.slug,
        sourceId: source.id,
        documentType,
        qualificationRef: source.qualificationRef || undefined,
        focusChapters,
        maxAssertions,
        teachingMode,
      }).catch(async (err) => {
        console.error(`[extraction-job] ${job.id} unhandled error:`, err);
        await updateJob(job.id, { status: "error", error: err.message || "Unknown error" });
      });

      return NextResponse.json(
        { ok: true, jobId: job.id, totalChunks: chunks.length, documentType },
        { status: 202 }
      );
    }

    // ── Synchronous modes (preview / import) ──
    const { text, pages, fileType } = await extractText(file);

    if (!text.trim()) {
      return NextResponse.json(
        { ok: false, error: "Could not extract text from document" },
        { status: 422 }
      );
    }

    // Auto-classify document type if not explicitly set
    let syncDocumentType = source.documentType as DocumentType;
    if (!source.documentTypeSource) {
      try {
        const extractionConfig = await resolveExtractionConfig(source.id);
        const fewShotConfig = extractionConfig.classification.fewShot;
        const examples = fewShotConfig?.enabled !== false
          ? await fetchFewShotExamples({ sourceId: source.id }, fewShotConfig)
          : [];
        const classification = await classifyDocument(text, file.name, extractionConfig, examples);
        syncDocumentType = classification.documentType;
        await prisma.contentSource.update({
          where: { id: sourceId },
          data: {
            documentType: classification.documentType,
            documentTypeSource: `ai:${classification.confidence.toFixed(2)}`,
            textSample: text.substring(0, 1000),
            aiClassification: `${classification.documentType}:${classification.confidence.toFixed(2)}`,
          },
        });
      } catch {
        // proceed with default
      }
    }

    // Try section segmentation for composite documents
    const syncSegmentation = await segmentDocument(text, file.name);
    const extractionOptions = {
      sourceSlug: source.slug,
      sourceId: source.id,
      documentType: syncDocumentType,
      qualificationRef: source.qualificationRef || undefined,
      focusChapters,
      maxAssertions,
      teachingMode,
    };

    const result = syncSegmentation.isComposite && syncSegmentation.sections.length > 1
      ? await extractAssertionsSegmented(text, syncSegmentation.sections, extractionOptions)
      : await extractAssertions(text, extractionOptions);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, warnings: result.warnings }, { status: 422 });
    }

    // Preview mode — return assertions without saving
    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        sourceSlug: source.slug,
        fileName: file.name,
        fileType,
        pages: pages || null,
        textLength: text.length,
        assertions: result.assertions,
        total: result.assertions.length,
        warnings: result.warnings,
      });
    }

    // Import mode — save to database
    const { created, duplicatesSkipped } = await saveAssertions(source.id, result.assertions);

    return NextResponse.json({
      ok: true,
      mode: "import",
      sourceSlug: source.slug,
      fileName: file.name,
      created,
      duplicatesSkipped,
      total: result.assertions.length,
      warnings: result.warnings,
    });
  } catch (error: any) {
    console.error("[content-sources/:id/import] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}

/**
 * @api GET /api/content-sources/:sourceId/import?jobId=xxx
 * @visibility public
 * @scope content-sources:read
 * @auth session
 * @tags content-trust
 * @description Poll the status of a background extraction job.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "jobId query param required" }, { status: 400 });
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found or expired" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, job });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function runBackgroundExtraction(
  jobId: string,
  source: { id: string; slug: string; qualificationRef: string | null },
  text: string,
  fileName: string,
  fileType: string,
  pages: number | undefined,
  options: { sourceSlug: string; sourceId?: string; documentType?: DocumentType; qualificationRef?: string; focusChapters?: string[]; maxAssertions?: number; teachingMode?: TeachingMode }
) {
  // ── Phase 1: Quick pass (Haiku, ~3-8s) ──
  try {
    const extractionConfig = await resolveExtractionConfig(source.id);
    const categories = extractionConfig.extraction.categories.map((c) => c.id);
    const quickResults = await quickExtract(text, categories);

    if (quickResults.length > 0) {
      await updateJob(jobId, {
        quickPreview: quickResults,
        quickPreviewCount: quickResults.length,
      } as any);
    }
  } catch (err: any) {
    console.warn(`[extraction-job] ${jobId} quick pass failed (non-fatal):`, err?.message);
    // Quick pass failure is non-fatal — continue to full extraction
  }

  // ── Phase 2: Full extraction (existing pipeline) ──

  // Track cumulative per-chunk save counts
  let totalCreated = 0;
  let totalDuplicatesSkipped = 0;
  let chunkSaveFailures = 0;

  // Per-chunk save callback
  const onChunkComplete = async (data: ChunkCompleteData) => {
    try {
      const { created, duplicatesSkipped } = await saveAssertions(source.id, data.assertions);
      totalCreated += created;
      totalDuplicatesSkipped += duplicatesSkipped;
    } catch (err: any) {
      chunkSaveFailures++;
      console.error(`[import] Per-chunk save failed for chunk ${data.chunkIndex}:`, err.message);
    }
  };

  // Try section segmentation for composite documents
  const segmentation = await segmentDocument(text, fileName);
  const sharedOpts = {
    ...options,
    onChunkDone: (chunkIndex: number, totalChunks: number, extractedSoFar: number) => {
      updateJob(jobId, {
        currentChunk: chunkIndex + 1,
        totalChunks,
        extractedCount: extractedSoFar,
      });
    },
    onChunkComplete,
  };

  let result;
  if (segmentation.isComposite && segmentation.sections.length > 1) {
    console.log(`[import] Composite document detected: ${segmentation.sections.length} sections in "${fileName}"`);
    result = await extractAssertionsSegmented(text, segmentation.sections, sharedOpts);
  } else {
    result = await extractAssertions(text, sharedOpts);
  }

  if (!result.ok) {
    await updateJob(jobId, {
      status: "error",
      error: result.error || "Extraction failed",
      warnings: result.warnings,
    });
    return;
  }

  // Reconciliation save: catch any assertions that failed per-chunk saves
  if (chunkSaveFailures > 0) {
    console.log(`[import] ${chunkSaveFailures} chunk save(s) failed — running reconciliation save`);
    try {
      const { created, duplicatesSkipped } = await saveAssertions(source.id, result.assertions);
      totalCreated += created;
      totalDuplicatesSkipped += duplicatesSkipped;
    } catch (err: any) {
      console.error(`[import] Reconciliation save failed for source ${source.id}:`, err.message);
    }
  }

  await updateJob(jobId, {
    status: "done",
    importedCount: totalCreated,
    duplicatesSkipped: totalDuplicatesSkipped,
    extractedCount: result.assertions.length,
  });
}

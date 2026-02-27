import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractText,
  extractAssertions,
  extractAssertionsSegmented,
  extractTextFromBuffer,
  chunkText,
  quickExtract,
} from "@/lib/content-trust/extract-assertions";
import type { DocumentType, TeachingMode, InteractionPattern } from "@/lib/content-trust/resolve-config";
import { resolveExtractionConfig } from "@/lib/content-trust/resolve-config";
import { classifyDocument, fetchFewShotExamples } from "@/lib/content-trust/classify-document";
import { segmentDocument } from "@/lib/content-trust/segment-document";
import { getExtractor } from "@/lib/content-trust/extractors/registry";
import type { SpecialistChunkCompleteData } from "@/lib/content-trust/extractors/base-extractor";
import { saveAssertions } from "@/lib/content-trust/save-assertions";
import { saveQuestions } from "@/lib/content-trust/save-questions";
import { saveVocabulary } from "@/lib/content-trust/save-vocabulary";
import { linkContentForSource } from "@/lib/content-trust/link-content";
import { createExtractionTask, getJob, updateJob } from "@/lib/content-trust/extraction-jobs";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getStorageAdapter, computeContentHash } from "@/lib/storage";
import { config } from "@/lib/config";
import { embedAssertionsForSource } from "@/lib/embeddings";
import { structureSourceIfEligible } from "@/lib/content-trust/structure-assertions";
import {
  extractImagesFromPdf,
  extractImagesFromDocx,
  linkImagesToSubject,
  persistImageMetadata,
} from "@/lib/content-trust/extract-images";
import { linkFiguresToAssertions } from "@/lib/content-trust/link-figures";
import { getImageExtractionSettings } from "@/lib/system-settings";
import { checkAutoTriggerCurriculum } from "@/lib/jobs/auto-trigger";
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
      // Extract text + buffer synchronously (fast) so we can validate and store
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const { text } = await extractTextFromBuffer(fileBuffer, file.name);
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

      // Store file as MediaAsset (needed for image extraction + future re-extraction)
      let mediaStorageKey: string | undefined;
      try {
        const contentHash = computeContentHash(fileBuffer);
        const storage = getStorageAdapter();
        const existingMedia = await prisma.mediaAsset.findUnique({ where: { contentHash } });

        if (existingMedia) {
          mediaStorageKey = existingMedia.storageKey;
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
          await prisma.mediaAsset.create({
            data: {
              fileName: file.name,
              fileSize: file.size,
              mimeType,
              contentHash,
              storageKey,
              storageType: config.storage.backend,
              uploadedBy: authResult.session.user.id,
              sourceId,
              trustLevel: source.trustLevel as any,
            },
          });
          mediaStorageKey = storageKey;
        }
      } catch (mediaErr: any) {
        // Non-fatal — extraction works without stored media, just no image extraction
        console.warn(`[import] MediaAsset storage failed (non-fatal):`, mediaErr?.message);
      }

      // Resolve interactionPattern + teachingMode from linked domain's playbook
      let interactionPattern: InteractionPattern | undefined;
      let resolvedTeachingMode: TeachingMode | undefined = teachingMode;
      let subjectId: string | undefined;
      try {
        const sourceSubject = await prisma.subjectSource.findFirst({
          where: { sourceId },
          select: { subjectId: true },
        });
        subjectId = sourceSubject?.subjectId;

        if (subjectId) {
          const domainLink = await prisma.subjectDomain.findFirst({
            where: { subjectId },
            select: { domainId: true },
          });
          if (domainLink) {
            const playbook = await prisma.playbook.findFirst({
              where: { domainId: domainLink.domainId, status: "PUBLISHED" },
              select: { config: true },
            });
            const pbConfig = playbook?.config as Record<string, any> | null;
            if (pbConfig?.interactionPattern) {
              interactionPattern = pbConfig.interactionPattern as InteractionPattern;
            }
            if (!resolvedTeachingMode && pbConfig?.teachingMode) {
              resolvedTeachingMode = pbConfig.teachingMode as TeachingMode;
            }
          }
        }
      } catch {
        // Best-effort — extraction works without these, just misses teachMethod assignment
      }

      const job = await createExtractionTask(authResult.session.user.id, sourceId, file.name, subjectId);
      await updateJob(job.id, { status: "extracting", totalChunks: chunks.length });

      // Fire-and-forget the extraction + import
      runBackgroundExtraction(job.id, source, text, file.name, {
        sourceSlug: source.slug,
        sourceId: source.id,
        documentType,
        qualificationRef: source.qualificationRef || undefined,
        focusChapters,
        maxAssertions,
        interactionPattern,
        teachingMode: resolvedTeachingMode,
        mediaStorageKey,
        subjectId,
        userId: authResult.session.user.id,
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
    // NOTE: These use the legacy generic extraction pipeline (assertions only, no specialist
    // extractors, no questions/vocabulary, no image extraction). No active UI callers use
    // these modes — all UI paths use mode=classify or mode=background above.
    // If these modes are needed in future, they should be upgraded to use getExtractor().
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

/**
 * Full background extraction pipeline — uses the specialist extractor framework
 * (same as /api/content-sources/:id/extract and /api/course-pack/ingest).
 *
 * Pipeline: quick preview → specialist extraction → save assertions/questions/vocabulary →
 * content linking → embedding → auto-structuring → image extraction → curriculum trigger
 */
async function runBackgroundExtraction(
  jobId: string,
  source: { id: string; slug: string; qualificationRef: string | null },
  text: string,
  fileName: string,
  opts: {
    sourceSlug: string;
    sourceId: string;
    documentType: DocumentType;
    qualificationRef?: string;
    focusChapters?: string[];
    maxAssertions?: number;
    interactionPattern?: InteractionPattern;
    teachingMode?: TeachingMode;
    mediaStorageKey?: string;
    subjectId?: string;
    userId: string;
  },
) {
  // ── Phase 1: Quick pass (Haiku, ~3-8s) ──
  try {
    const quickConfig = await resolveExtractionConfig(source.id, opts.documentType, opts.interactionPattern);
    const categories = quickConfig.extraction.categories.map((c) => c.id);
    const quickResults = await quickExtract(text, categories);

    if (quickResults.length > 0) {
      await updateJob(jobId, {
        quickPreview: quickResults,
        quickPreviewCount: quickResults.length,
      } as any);
    }
  } catch (err: any) {
    console.warn(`[extraction-job] ${jobId} quick pass failed (non-fatal):`, err?.message);
  }

  // ── Phase 2: Full extraction via specialist extractor framework ──

  let totalCreated = 0;
  let totalDuplicatesSkipped = 0;
  let totalQuestionsCreated = 0;
  let totalVocabularyCreated = 0;
  let chunkSaveFailures = 0;

  const extractor = getExtractor(opts.documentType);
  const extractionConfig = await resolveExtractionConfig(source.id, opts.documentType, opts.interactionPattern);

  // Per-chunk save callback (assertions + questions + vocabulary)
  const onChunkComplete = async (data: SpecialistChunkCompleteData) => {
    try {
      if (data.assertions.length > 0) {
        const { created, duplicatesSkipped } = await saveAssertions(source.id, data.assertions);
        totalCreated += created;
        totalDuplicatesSkipped += duplicatesSkipped;
      }
      if (data.questions.length > 0) {
        const qResult = await saveQuestions(source.id, data.questions);
        totalQuestionsCreated += qResult.created;
      }
      if (data.vocabulary.length > 0) {
        const vResult = await saveVocabulary(source.id, data.vocabulary);
        totalVocabularyCreated += vResult.created;
      }
    } catch (err: any) {
      chunkSaveFailures++;
      console.error(`[import] Per-chunk save failed for chunk ${data.chunkIndex}:`, err.message);
    }
    // Store quick preview from first chunk for immediate UI feedback
    if (data.chunkIndex === 0 && data.assertions.length > 0) {
      updateJob(jobId, {
        quickPreview: data.assertions.slice(0, 5).map((a) => ({ text: a.assertion, category: a.category })),
      });
    }
  };

  const result = await extractor.extract(text, {
    sourceSlug: opts.sourceSlug,
    sourceId: opts.sourceId,
    documentType: opts.documentType,
    qualificationRef: opts.qualificationRef,
    focusChapters: opts.focusChapters,
    teachingMode: opts.teachingMode,
    maxAssertions: opts.maxAssertions || extractionConfig.extraction.maxAssertionsPerDocument,
    onChunkDone: (chunkIndex: number, totalChunks: number, extractedSoFar: number) => {
      updateJob(jobId, {
        currentChunk: chunkIndex + 1,
        totalChunks,
        extractedCount: extractedSoFar,
      });
    },
  }, extractionConfig, onChunkComplete);

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
      if (result.questions?.length) {
        const qResult = await saveQuestions(source.id, result.questions);
        totalQuestionsCreated += qResult.created;
      }
      if (result.vocabulary?.length) {
        const vResult = await saveVocabulary(source.id, result.vocabulary);
        totalVocabularyCreated += vResult.created;
      }
    } catch (err: any) {
      console.error(`[import] Reconciliation save failed for source ${source.id}:`, err.message);
    }
  }

  // Link questions/vocabulary to their best-matching assertions
  let linkingWarnings: string[] = [];
  if (totalQuestionsCreated > 0 || totalVocabularyCreated > 0) {
    try {
      const linkResult = await linkContentForSource(source.id);
      linkingWarnings = linkResult.warnings;
      console.log(
        `[import] Linking for ${source.id}: ${linkResult.questionsLinked}q linked, ${linkResult.questionsOrphaned}q orphaned, ` +
        `${linkResult.vocabularyLinked}v linked, ${linkResult.vocabularyOrphaned}v orphaned`,
      );
    } catch (err: any) {
      console.error(`[import] Content linking failed for source ${source.id}:`, err);
      linkingWarnings = [`Content linking failed: ${err.message}`];
    }
  }

  await updateJob(jobId, {
    status: "done",
    importedCount: totalCreated,
    duplicatesSkipped: totalDuplicatesSkipped,
    extractedCount: result.assertions.length,
    warnings: [...(result.warnings || []), ...linkingWarnings],
  });

  console.log(`[import] Source ${source.id}: ${totalCreated} assertions, ${totalQuestionsCreated} questions, ${totalVocabularyCreated} vocabulary items`);

  // ── Post-processing (fire-and-forget) ──

  // Embed new assertions for vector search
  if (totalCreated > 0) {
    embedAssertionsForSource(source.id).catch((err) =>
      console.error(`[import] Embedding failed for source ${source.id}:`, err),
    );

    // Auto-structure into pedagogical pyramid
    structureSourceIfEligible(source.id).catch((err) =>
      console.error(`[import] Auto-structure failed for source ${source.id}:`, err),
    );
  }

  // Image extraction (needs stored MediaAsset)
  if (opts.mediaStorageKey) {
    runImageExtraction(source.id, opts.userId, fileName, opts.mediaStorageKey).catch((err) =>
      console.error(`[import] Image extraction failed for source ${source.id}:`, err),
    );
  }

  // Auto-trigger curriculum generation
  if (opts.subjectId) {
    checkAutoTriggerCurriculum(opts.subjectId, opts.userId).catch((err) =>
      console.error(`[import] Auto-trigger curriculum error for subject ${opts.subjectId}:`, err),
    );
  }
}

// ── Image extraction runner ──

async function runImageExtraction(
  sourceId: string,
  userId: string,
  fileName: string,
  storageKey: string,
): Promise<void> {
  const settings = await getImageExtractionSettings();
  if (!settings.enabled) return;

  const nameLower = fileName.toLowerCase();
  const isPdf = nameLower.endsWith(".pdf");
  const isDocx = nameLower.endsWith(".docx");
  if (!isPdf && !isDocx) return;

  const storage = getStorageAdapter();
  const buffer = await storage.download(storageKey);

  const result = isPdf
    ? await extractImagesFromPdf(buffer, sourceId, userId, settings)
    : await extractImagesFromDocx(buffer, sourceId, userId, settings);

  if (!result.ok || result.images.length === 0) {
    if (result.warnings.length > 0) {
      console.log(`[import] Image extraction for ${sourceId}:`, result.warnings.join("; "));
    }
    return;
  }

  console.log(`[import] Extracted ${result.images.length} images from ${fileName}`);
  await persistImageMetadata(result.images);
  const subjectLinked = await linkImagesToSubject(sourceId, result.images);
  console.log(`[import] Linked ${subjectLinked} image-subject pairs for ${sourceId}`);

  const linkResult = await linkFiguresToAssertions(sourceId, result.images);
  console.log(
    `[import] Figure-assertion linking for ${sourceId}: ${linkResult.linked} linked, ${linkResult.unlinked} unlinked`,
  );
}

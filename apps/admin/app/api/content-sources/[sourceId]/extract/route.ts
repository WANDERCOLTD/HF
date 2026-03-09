import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractAssertions,
  extractAssertionsSegmented,
  extractTextFromBuffer,
  chunkText,
  type ChunkCompleteData,
} from "@/lib/content-trust/extract-assertions";
import type { SpecialistChunkCompleteData } from "@/lib/content-trust/extractors/base-extractor";
import { segmentDocument } from "@/lib/content-trust/segment-document";
import { saveAssertions } from "@/lib/content-trust/save-assertions";
import { saveQuestions } from "@/lib/content-trust/save-questions";
import { saveVocabulary } from "@/lib/content-trust/save-vocabulary";
import { getExtractor } from "@/lib/content-trust/extractors/registry";
import { resolveExtractionConfig } from "@/lib/content-trust/resolve-config";
import {
  createExtractionTask,
  updateJob,
} from "@/lib/content-trust/extraction-jobs";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { checkAutoTriggerCurriculum } from "@/lib/jobs/auto-trigger";
import { embedAssertionsForSource } from "@/lib/embeddings";
import { structureSourceIfEligible } from "@/lib/content-trust/structure-assertions";
import { linkContentForSource } from "@/lib/content-trust/link-content";
import { getStorageAdapter } from "@/lib/storage";
import { scaffoldDomain } from "@/lib/domain/scaffold";
import { generateContentSpec } from "@/lib/domain/generate-content-spec";
import {
  extractImagesFromPdf,
  extractImagesFromDocx,
  linkImagesToSubject,
  persistImageMetadata,
  type ExtractedImage,
} from "@/lib/content-trust/extract-images";
import { linkFiguresToAssertions } from "@/lib/content-trust/link-figures";
import { purgeSourceContent } from "@/lib/content-trust/purge-source-content";
import { getImageExtractionSettings } from "@/lib/system-settings";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
} from "@/lib/ai/task-guidance";
import type { DocumentType, InteractionPattern, TeachingMode } from "@/lib/content-trust/resolve-config";
import { syncGoalsFromReference } from "@/lib/goals/sync-goals-from-reference";

/**
 * @api POST /api/content-sources/:sourceId/extract
 * @visibility public
 * @scope content-sources:write
 * @auth OPERATOR
 * @tags content-trust, extraction, classification
 * @description Trigger extraction for a classified content source.
 *   Called after user confirms the document type classification.
 *   Reads documentType from the source record and uses type-specific extraction config.
 *
 * @pathParam sourceId string - ContentSource UUID
 * @body subjectId string - Optional Subject UUID (for auto-trigger curriculum check; omit for orphan sources)
 * @body text string - Optional pre-extracted text (if not provided, downloads from linked media asset)
 * @body interactionPattern string - Optional interaction pattern (socratic, directive, etc.) for pattern-specific extraction categories
 * @body replace boolean - Optional: delete existing assertions/questions/vocabulary before re-extracting (default false)
 *
 * @response 202 { ok, jobId, totalChunks }
 * @response 400 { ok: false, error }
 * @response 404 { ok: false, error }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;
    const userId = authResult.session.user.id;

    const { sourceId } = await params;

    // Load source
    const source = await prisma.contentSource.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        slug: true,
        name: true,
        documentType: true,
        subjects: {
          select: {
            subjectId: true,
            subject: {
              select: {
                slug: true,
                name: true,
                qualificationRef: true,
              },
            },
          },
          take: 1,
        },
        mediaAssets: {
          select: { id: true, storageKey: true, mimeType: true, fileName: true },
          take: 1,
        },
        _count: { select: { assertions: true } },
      },
    });

    if (!source) {
      return NextResponse.json({ ok: false, error: "Content source not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const subjectId = body.subjectId || source.subjects[0]?.subjectId || undefined;
    const subjectSlug = source.subjects[0]?.subject?.slug || source.slug;

    // Resolve interactionPattern + teachingMode + subjectDiscipline from body or domain playbook
    let interactionPattern: InteractionPattern | undefined = body.interactionPattern || undefined;
    let teachingMode: TeachingMode | undefined;
    let subjectDiscipline: string | undefined;
    if (subjectId) {
      try {
        const domainLink = await prisma.subjectDomain.findFirst({
          where: { subjectId },
          select: { domainId: true },
        });
        if (domainLink) {
          // Include DRAFT playbooks — not just PUBLISHED — so in-progress courses get teachMethod assignment
          const playbook = await prisma.playbook.findFirst({
            where: { domainId: domainLink.domainId, status: { in: ["PUBLISHED", "DRAFT"] } },
            select: { config: true },
          });
          const pbConfig = playbook?.config as Record<string, any> | null;
          if (!interactionPattern && pbConfig?.interactionPattern) {
            interactionPattern = pbConfig.interactionPattern as InteractionPattern;
          }
          if (pbConfig?.teachingMode) {
            teachingMode = pbConfig.teachingMode as TeachingMode;
          }
          if (pbConfig?.subjectDiscipline) {
            subjectDiscipline = pbConfig.subjectDiscipline as string;
          }
        }
        // Fall back to subject's teaching profile if playbook didn't provide teachingMode
        if (!teachingMode) {
          const subject = await prisma.subject.findUnique({
            where: { id: subjectId },
            select: { teachingProfile: true, teachingOverrides: true },
          });
          if (subject?.teachingProfile) {
            const { getTeachingProfile } = await import("@/lib/content-trust/teaching-profiles");
            const profile = getTeachingProfile(subject.teachingProfile);
            if (profile) {
              const overrides = subject.teachingOverrides as Record<string, any> | null;
              teachingMode = (overrides?.teachingMode || profile.teachingMode) as TeachingMode;
              if (!interactionPattern) {
                interactionPattern = (overrides?.interactionPattern || profile.interactionPattern) as InteractionPattern;
              }
            }
          }
        }
      } catch {
        // Best-effort — extraction works without these, just misses teachMethod assignment
      }
    }
    const subjectName = source.subjects[0]?.subject?.name || source.name;
    const qualificationRef = source.subjects[0]?.subject?.qualificationRef || undefined;

    // Get text — either from body or from linked media asset
    let text = body.text as string | undefined;

    if (!text) {
      // Download from linked media asset
      const media = source.mediaAssets[0];
      if (!media) {
        return NextResponse.json(
          { ok: false, error: "No linked media asset found. Upload a file first." },
          { status: 400 },
        );
      }

      const storage = getStorageAdapter();
      const buffer = await storage.download(media.storageKey);
      const extracted = await extractTextFromBuffer(buffer, media.fileName);
      text = extracted.text;

      if (!text?.trim()) {
        return NextResponse.json(
          { ok: false, error: "Could not extract text from stored file." },
          { status: 422 },
        );
      }
    }

    // Create extraction task and start background job
    const chunks = chunkText(text);
    const job = await createExtractionTask(userId, sourceId, source.name, subjectId, subjectName);
    await updateJob(job.id, { status: "extracting", totalChunks: chunks.length });

    // Fire-and-forget background extraction with document type
    const replace = body.replace === true;
    const fileName = source.mediaAssets[0]?.fileName || source.name;
    const mediaStorageKey = source.mediaAssets[0]?.storageKey;
    runBackgroundExtraction(
      job.id,
      sourceId,
      subjectId,
      userId,
      text,
      fileName,
      replace,
      {
        sourceSlug: subjectSlug,
        sourceId,
        documentType: source.documentType as DocumentType,
        qualificationRef,
        maxAssertions: 500,
        mediaStorageKey,
        interactionPattern,
        teachingMode,
        subjectDiscipline,
        subjectName,
      },
    ).catch(async (err) => {
      console.error(`[content-sources/:id/extract] Background job ${job.id} error:`, err);
      await updateJob(job.id, { status: "error", error: err.message || "Extraction failed" });
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        totalChunks: chunks.length,
        documentType: source.documentType,
      },
      { status: 202 },
    );
  } catch (error: any) {
    console.error("[content-sources/:id/extract] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Extraction failed" },
      { status: 500 },
    );
  }
}

// ── Background extraction + save ──

async function runBackgroundExtraction(
  jobId: string,
  sourceId: string,
  subjectId: string | undefined,
  userId: string,
  text: string,
  fileName: string,
  replace: boolean,
  opts: {
    sourceSlug: string;
    sourceId: string;
    documentType: DocumentType;
    qualificationRef?: string;
    maxAssertions: number;
    mediaStorageKey?: string;
    interactionPattern?: InteractionPattern;
    teachingMode?: TeachingMode;
    subjectDiscipline?: string;
    subjectName?: string;
  },
) {
  // Replace mode: purge existing content before re-extracting
  if (replace) {
    const purged = await purgeSourceContent(sourceId);
    console.log(`[extract] Replace mode — purged ${purged.assertions} assertions, ${purged.questions} questions, ${purged.vocabulary} vocabulary for source ${sourceId}`);
  }

  // Track cumulative per-chunk save counts for the final job record
  let totalCreated = 0;
  let totalDuplicatesSkipped = 0;
  let totalQuestionsCreated = 0;
  let totalVocabularyCreated = 0;
  let chunkSaveFailures = 0;

  // Per-chunk save callback for generic extractors (assertions only)
  const onChunkComplete = async (data: ChunkCompleteData) => {
    try {
      const { created, duplicatesSkipped } = await saveAssertions(sourceId, data.assertions);
      totalCreated += created;
      totalDuplicatesSkipped += duplicatesSkipped;
    } catch (err: any) {
      chunkSaveFailures++;
      console.error(`[extract] Per-chunk save failed for chunk ${data.chunkIndex}:`, err.message);
    }
    // After first chunk: store quick preview in job context so UI can show "Quick scan" immediately
    if (data.chunkIndex === 0 && data.assertions.length > 0) {
      updateJob(jobId, {
        quickPreview: data.assertions.slice(0, 5).map((a) => ({ text: a.assertion, category: a.category })),
      });
    }
  };

  // Per-chunk save callback for specialist extractors (assertions + questions + vocabulary)
  const onSpecialistChunkComplete = async (data: SpecialistChunkCompleteData) => {
    try {
      if (data.assertions.length > 0) {
        const { created, duplicatesSkipped } = await saveAssertions(sourceId, data.assertions);
        totalCreated += created;
        totalDuplicatesSkipped += duplicatesSkipped;
      }
      if (data.questions.length > 0) {
        const qResult = await saveQuestions(sourceId, data.questions);
        totalQuestionsCreated += qResult.created;
      }
      if (data.vocabulary.length > 0) {
        const vResult = await saveVocabulary(sourceId, data.vocabulary);
        totalVocabularyCreated += vResult.created;
      }
    } catch (err: any) {
      chunkSaveFailures++;
      console.error(`[extract] Per-chunk save failed for chunk ${data.chunkIndex}:`, err.message);
    }
    // After first chunk: store quick preview in job context so UI can show "Quick scan" immediately
    if (data.chunkIndex === 0 && data.assertions.length > 0) {
      updateJob(jobId, {
        quickPreview: data.assertions.slice(0, 5).map((a) => ({ text: a.assertion, category: a.category })),
      });
    }
  };

  // Check if this document type has a specialist extractor
  const SPECIALIST_TYPES: DocumentType[] = ["CURRICULUM", "COMPREHENSION", "ASSESSMENT", "READING_PASSAGE", "QUESTION_BANK"];
  const useSpecialist = SPECIALIST_TYPES.includes(opts.documentType);

  let assertionResult: { ok: boolean; assertions: any[]; warnings: string[]; error?: string };
  let extractedQuestions: any[] = [];
  let extractedVocabulary: any[] = [];

  if (useSpecialist) {
    // Use specialist extractor (returns assertions + questions + vocabulary)
    const extractor = getExtractor(opts.documentType);
    const extractionConfig = await resolveExtractionConfig(opts.sourceId, opts.documentType, opts.interactionPattern, opts.subjectDiscipline, opts.subjectName);

    const fullResult = await extractor.extract(text, {
      ...opts,
      onChunkDone: (chunkIndex, totalChunks, extractedSoFar) => {
        updateJob(jobId, {
          currentChunk: chunkIndex + 1,
          totalChunks,
          extractedCount: extractedSoFar,
        });
      },
    }, extractionConfig, onSpecialistChunkComplete);

    assertionResult = fullResult;
    extractedQuestions = fullResult.questions || [];
    extractedVocabulary = fullResult.vocabulary || [];
  } else {
    // Use existing pipeline (segment → extract assertions)
    const segmentation = await segmentDocument(text, fileName);
    const sharedOpts = {
      ...opts,
      onChunkDone: (chunkIndex: number, totalChunks: number, extractedSoFar: number) => {
        updateJob(jobId, {
          currentChunk: chunkIndex + 1,
          totalChunks,
          extractedCount: extractedSoFar,
        });
      },
      onChunkComplete,
    };

    if (segmentation.isComposite && segmentation.sections.length > 1) {
      console.log(`[extract] Composite document detected: ${segmentation.sections.length} sections`);
      assertionResult = await extractAssertionsSegmented(text, segmentation.sections, sharedOpts);
    } else {
      assertionResult = await extractAssertions(text, sharedOpts);
    }
  }

  if (!assertionResult.ok) {
    updateJob(jobId, {
      status: "error",
      error: assertionResult.error || "Extraction failed",
      warnings: assertionResult.warnings,
    });
    return;
  }

  // Reconciliation save: catch any assertions that failed per-chunk saves
  // saveAssertions deduplicates by contentHash, so this is a no-op if all chunks saved successfully
  if (chunkSaveFailures > 0) {
    console.log(`[extract] ${chunkSaveFailures} chunk save(s) failed — running reconciliation save`);
    try {
      const { created, duplicatesSkipped } = await saveAssertions(sourceId, assertionResult.assertions);
      totalCreated += created;
      totalDuplicatesSkipped += duplicatesSkipped;

      if (extractedQuestions.length > 0) {
        const qResult = await saveQuestions(sourceId, extractedQuestions);
        totalQuestionsCreated += qResult.created;
      }
      if (extractedVocabulary.length > 0) {
        const vResult = await saveVocabulary(sourceId, extractedVocabulary);
        totalVocabularyCreated += vResult.created;
      }
    } catch (err: any) {
      console.error(`[extract] Reconciliation save failed for source ${sourceId}:`, err.message);
    }
  }

  // Link questions/vocabulary to their best-matching assertions
  let linkingWarnings: string[] = [];
  if (totalQuestionsCreated > 0 || totalVocabularyCreated > 0) {
    try {
      const linkResult = await linkContentForSource(sourceId);
      linkingWarnings = linkResult.warnings;
      console.log(
        `[extract] Linking for ${sourceId}: ${linkResult.questionsLinked}q linked, ${linkResult.questionsOrphaned}q orphaned, ` +
        `${linkResult.vocabularyLinked}v linked, ${linkResult.vocabularyOrphaned}v orphaned`,
      );
    } catch (err: any) {
      console.error(`[extract] Content linking failed for source ${sourceId}:`, err);
      linkingWarnings = [`Content linking failed: ${err.message}`];
    }
  }

  await updateJob(jobId, {
    status: "done",
    importedCount: totalCreated,
    duplicatesSkipped: totalDuplicatesSkipped,
    extractedCount: assertionResult.assertions.length,
    warnings: [...(assertionResult.warnings || []), ...linkingWarnings],
  });

  console.log(`[extract] Source ${sourceId}: ${totalCreated} assertions, ${totalQuestionsCreated} questions, ${totalVocabularyCreated} vocabulary items`);

  // Embed new assertions in background (non-blocking)
  if (totalCreated > 0) {
    embedAssertionsForSource(sourceId).catch((err) =>
      console.error(`[extract] Embedding failed for source ${sourceId}:`, err)
    );

    // Auto-structure into pedagogical pyramid (non-blocking)
    structureSourceIfEligible(sourceId).catch((err) =>
      console.error(`[extract] Auto-structure failed for source ${sourceId}:`, err)
    );

    // Sync assessment_approach → playbook config.goals (non-blocking)
    syncGoalsFromReference(sourceId).catch((err) =>
      console.error(`[extract] Goal sync failed for source ${sourceId}:`, err)
    );
  }

  // ── Image extraction (non-blocking) ──
  // Extract embedded images from the source document and link to assertions.
  // Runs after text extraction so figure-assertion linking can match refs.
  if (opts.mediaStorageKey) {
    runImageExtraction(sourceId, userId, fileName, opts.mediaStorageKey).catch((err) =>
      console.error(`[extract] Image extraction failed for source ${sourceId}:`, err),
    );
  }

  // Auto-trigger curriculum generation if all extractions for this subject are done
  if (subjectId) {
    try {
      await checkAutoTriggerCurriculum(subjectId, userId);
    } catch (err) {
      console.error(`[content-sources/:id/extract] Auto-trigger error for subject ${subjectId}:`, err);
    }
  }

  // Auto-scaffold playbook + content spec for each linked domain via task tracking
  // This ensures teachers can configure onboarding without needing to manually set up specs
  if (subjectId && totalCreated > 0) {
    try {
      const linkedDomains = await prisma.domain.findMany({
        where: {
          subjects: { some: { subjectId } },
        },
        select: { id: true, slug: true, name: true },
      });

      for (const domain of linkedDomains) {
        // Create a scaffold task for visibility + persistence
        const scaffoldTaskId = await startTaskTracking(userId, "scaffolding", {
          domainId: domain.id,
          domainName: domain.name,
          step: "playbook_setup",
          message: "Setting up curriculum playbook...",
        });

        // Fire background scaffolding (non-blocking)
        runScaffoldingTask(scaffoldTaskId, domain.id, userId).catch(async (err) => {
          console.error(`[extract] Scaffolding task failed for ${domain.slug}:`, err);
          await failTask(scaffoldTaskId, err.message);
        });
      }
    } catch (err) {
      console.error(`[extract] Auto-scaffolding error for subject ${subjectId}:`, err);
    }
  }
}

// ── Scaffolding task runner ──

async function runScaffoldingTask(taskId: string, domainId: string, userId: string) {
  try {
    // Step 1: Ensure domain has a playbook
    await updateTaskProgress(taskId, {
      context: { step: "playbook_setup", message: "Setting up curriculum playbook..." },
    });
    await scaffoldDomain(domainId);

    // Step 2: Generate content spec from assertions
    await updateTaskProgress(taskId, {
      context: { step: "content_generation", message: "Generating curriculum structure..." },
    });
    const contentResult = await generateContentSpec(domainId);

    // Step 3: Complete
    await updateTaskProgress(taskId, {
      context: {
        step: "completed",
        message: "Curriculum ready for configuration",
        summary: {
          playbook: contentResult.contentSpec?.name || "(auto-scaffolded)",
          modules: contentResult.moduleCount,
          assertions: contentResult.assertionCount,
        },
      },
    });
    await completeTask(taskId);
  } catch (err: any) {
    throw err;
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

  // Download file buffer from storage
  const storage = getStorageAdapter();
  const buffer = await storage.download(storageKey);

  let result;
  if (isPdf) {
    result = await extractImagesFromPdf(buffer, sourceId, userId, settings);
  } else {
    result = await extractImagesFromDocx(buffer, sourceId, userId, settings);
  }

  if (!result.ok) {
    console.warn(`[extract] Image extraction not ok for ${sourceId}:`, result.warnings);
    return;
  }

  if (result.images.length === 0) {
    if (result.warnings.length > 0) {
      console.log(`[extract] No images extracted for ${sourceId}:`, result.warnings.join("; "));
    }
    return;
  }

  console.log(`[extract] Extracted ${result.images.length} images from ${fileName}`);

  // Persist caption/figureRef metadata on the MediaAsset records
  await persistImageMetadata(result.images);

  // Link images to subject's media library (for content catalog visibility)
  const subjectLinked = await linkImagesToSubject(sourceId, result.images);
  console.log(`[extract] Linked ${subjectLinked} image-subject pairs for ${sourceId}`);

  // Link images to assertions that reference them
  const linkResult = await linkFiguresToAssertions(sourceId, result.images);
  console.log(
    `[extract] Figure-assertion linking for ${sourceId}: ${linkResult.linked} linked, ${linkResult.unlinked} unlinked`,
  );

  if (linkResult.warnings.length > 0) {
    console.warn(`[extract] Figure linking warnings:`, linkResult.warnings.join("; "));
  }
}

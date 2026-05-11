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
import { getExtractor, EXTRACTOR_VERSION, isExtractionOutdated } from "@/lib/content-trust/extractors/registry";
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
import { snapshotAssertionIds, refreshLessonPlanAssertions } from "@/lib/lesson-plan/refresh-assertion-ids";
import { getImageExtractionSettings } from "@/lib/system-settings";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
} from "@/lib/ai/task-guidance";
import type { DocumentType, InteractionPattern, TeachingMode } from "@/lib/content-trust/resolve-config";
import { syncGoalsFromReference } from "@/lib/goals/sync-goals-from-reference";
import { syncConstraintsFromReference } from "@/lib/goals/sync-constraints-from-reference";
import { maybeGenerateMcqs, regenerateSiblingMcqs } from "@/lib/assessment/generate-mcqs";

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

    // Load source. Also pull `contentDeclaration` so declared defaults
    // (hf-default-category → extractor, hf-question-assessment-use → questions)
    // are honoured here too. See parse-content-declaration.ts.
    const source = await prisma.contentSource.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        slug: true,
        name: true,
        documentType: true,
        extractorVersion: true,
        contentDeclaration: true,
        subjects: {
          select: {
            id: true,
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

    // Extraction cache gate: skip if assertions exist, extractor is current, and not a forced replace
    const replace = body.replace === true;
    if (
      !replace &&
      source._count.assertions > 0 &&
      !isExtractionOutdated(source.extractorVersion)
    ) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "extraction-current",
        message: `Source already has ${source._count.assertions} assertions at extractor v${source.extractorVersion}. Pass replace:true to force re-extraction.`,
        sourceId,
        existingAssertions: source._count.assertions,
        extractorVersion: source.extractorVersion,
      });
    }
    const subjectId = body.subjectId || source.subjects[0]?.subjectId || undefined;
    const subjectSourceId = source.subjects[0]?.id || undefined;
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
        // Source has no backing file (e.g. URL-type, seed, or legacy source).
        // Re-extract is idempotent: if the source already has extracted content,
        // treat this as a no-op "skipped" so batch re-extraction doesn't surface
        // scary errors. If it has NO content at all, that IS a real error.
        const assertionCount = await prisma.contentAssertion.count({
          where: { sourceId },
        });
        if (assertionCount > 0) {
          return NextResponse.json({
            ok: true,
            skipped: true,
            reason: "no-media-asset",
            message: "Source has no re-extractable file. Existing content preserved.",
            sourceId,
            existingAssertions: assertionCount,
          });
        }
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

    // Guard: reject if extraction already in progress for this source
    // First, clean up stale tasks stuck in_progress for over 10 minutes (server restart, timeout, etc.)
    // TaskStatus enum has only {in_progress, completed, abandoned}; UserTask has no `result` field.
    // Mark as abandoned and record the reason as a blocker string.
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const { count: staleCleaned } = await prisma.userTask.updateMany({
      where: {
        taskType: "extraction",
        status: "in_progress",
        context: { path: ["sourceId"], equals: sourceId },
        updatedAt: { lt: staleThreshold },
      },
      data: { status: "abandoned", blockers: ["Stale task auto-cleaned"] },
    });
    if (staleCleaned > 0) {
      console.log(`[extract] Cleaned ${staleCleaned} stale extraction task(s) for source ${sourceId}`);
    }

    const activeTask = await prisma.userTask.findFirst({
      where: {
        taskType: "extraction",
        status: "in_progress",
        context: { path: ["sourceId"], equals: sourceId },
      },
      select: { id: true },
    });
    if (activeTask) {
      return NextResponse.json(
        { ok: false, error: "Extraction already in progress for this source" },
        { status: 409 },
      );
    }

    // Create extraction task and start background job
    const chunks = chunkText(text);
    const job = await createExtractionTask(userId, sourceId, source.name, subjectId, subjectName, subjectSourceId);
    await updateJob(job.id, { status: "extracting", totalChunks: chunks.length });

    // Epic #131 A2 — curriculum-aware extraction. When the subject already has
    // a curriculum with Learning Objectives, pass the LO list into the extractor
    // prompt as a constrained enum so assertions get tagged with structured refs
    // (LO1, LO2) instead of free-text topic names. If no curriculum yet exists
    // (first extraction creates it), curriculumLoRefs is empty and the reconciler
    // backfills the FK in a second pass after curriculum save (A4).
    const curriculumLoRefs = await fetchCurriculumLoRefs(subjectId).catch(() => []);

    // Fire-and-forget background extraction with document type
    const fileName = source.mediaAssets[0]?.fileName || source.name;
    const mediaStorageKey = source.mediaAssets[0]?.storageKey;
    // Pull declared defaults from the source's contentDeclaration.
    // See parse-content-declaration.ts.
    const sourceDeclaration = (source.contentDeclaration ?? null) as
      | import("@/lib/content-trust/parse-content-declaration").ContentDeclaration
      | null;
    runBackgroundExtraction(
      job.id,
      sourceId,
      subjectId,
      subjectSourceId,
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
        curriculumLoRefs,
        declaredDefaultCategory: sourceDeclaration?.defaultCategory ?? undefined,
        declaredAssessmentUse: sourceDeclaration?.questionAssessmentUse ?? null,
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
  subjectSourceId: string | undefined,
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
    curriculumLoRefs?: { ref: string; description: string }[];
    /** Front-matter override: default category for assertions whose AI tag is invalid. */
    declaredDefaultCategory?: string;
    /** Front-matter override: assessmentUse forced onto every saved question. */
    declaredAssessmentUse?: import("@prisma/client").AssessmentUse | null;
  },
) {
  // Replace mode: snapshot old IDs then purge existing content before re-extracting
  let purgedAssertionIds: Set<string> | undefined;
  if (replace) {
    purgedAssertionIds = await snapshotAssertionIds(sourceId);
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
      const { created, duplicatesSkipped } = await saveAssertions(sourceId, data.assertions, subjectSourceId);
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
        const { created, duplicatesSkipped } = await saveAssertions(sourceId, data.assertions, subjectSourceId);
        totalCreated += created;
        totalDuplicatesSkipped += duplicatesSkipped;
      }
      if (data.questions.length > 0) {
        const qResult = await saveQuestions(sourceId, data.questions, subjectSourceId, opts.declaredAssessmentUse, opts.documentType);
        totalQuestionsCreated += qResult.created;
      }
      if (data.vocabulary.length > 0) {
        const vResult = await saveVocabulary(sourceId, data.vocabulary, subjectSourceId);
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
      const { created, duplicatesSkipped } = await saveAssertions(sourceId, assertionResult.assertions, subjectSourceId);
      totalCreated += created;
      totalDuplicatesSkipped += duplicatesSkipped;

      if (extractedQuestions.length > 0) {
        const qResult = await saveQuestions(sourceId, extractedQuestions, undefined, opts.declaredAssessmentUse, opts.documentType);
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
      const linkResult = await linkContentForSource(sourceId, subjectSourceId);
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

  // Refresh stale assertionIds in any lesson plans that referenced purged assertions
  if (purgedAssertionIds && purgedAssertionIds.size > 0 && totalCreated > 0) {
    try {
      const refreshResult = await refreshLessonPlanAssertions(sourceId, purgedAssertionIds);
      if (refreshResult.curriculaUpdated > 0) {
        console.log(
          `[extract] Refreshed lesson plan assertions: ${refreshResult.curriculaUpdated} curricula, ` +
          `${refreshResult.entriesCleared} entries cleared, ${refreshResult.entriesRefilled} refilled`,
        );
      }
    } catch (err: any) {
      console.error(`[extract] Lesson plan assertion refresh failed for source ${sourceId}:`, err.message);
    }
  }

  // Stamp extraction version + timestamp for staleness detection
  await prisma.contentSource.update({
    where: { id: sourceId },
    data: { extractorVersion: EXTRACTOR_VERSION, lastExtractedAt: new Date() },
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

    // Sync edge_case/teaching_rule → playbook config.constraints (non-blocking)
    syncConstraintsFromReference(sourceId).catch((err) =>
      console.error(`[extract] Constraint sync failed for source ${sourceId}:`, err)
    );
  }

  // ── MCQ auto-generation (non-blocking) ──
  // If this source is a curriculum's primarySource and has no MCQs, generate from assertions.
  maybeGenerateMcqs(sourceId, userId, subjectSourceId).catch((err) =>
    console.error(`[extract] MCQ generation failed for source ${sourceId}:`, err),
  );

  // ── QB re-trigger: regenerate sibling MCQs when a QUESTION_BANK is extracted ──
  // Comprehension courses generate MCQs from TUTOR_QUESTIONs — but those only exist
  // after the QB is extracted. Re-trigger sibling sources so they get skill-aligned MCQs.
  if (opts.documentType === "QUESTION_BANK" && subjectId) {
    regenerateSiblingMcqs(subjectId, sourceId, userId).catch((err) =>
      console.error(`[extract] Sibling MCQ regeneration failed for subject ${subjectId}:`, err),
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

/**
 * Epic #131 A2 — fetch existing LearningObjective rows for the subject's
 * curricula so the extractor prompt can constrain `learningOutcomeRef` output
 * to a known enum instead of accepting free-text topic names. Returns an empty
 * array when no curriculum exists yet (first extraction), in which case refs
 * will be null and the A4 reconciler populates the FK after curriculum save.
 *
 * Also returns an empty array when every LO row has a garbage description
 * (where `description` is just the ref string or shorter than 4 chars). The
 * extraction prompt would otherwise see meaningless "LO-1: LO1" entries and
 * the AI — unable to decide which category maps to which — would safely omit
 * the ref field entirely. Returning [] falls back to the un-constrained
 * extraction prompt, which is better than asking the AI to match on garbage.
 * The fix is to regenerate the curriculum via the Curriculum tab (#138).
 */
async function fetchCurriculumLoRefs(
  subjectId: string | undefined,
): Promise<{ ref: string; description: string }[]> {
  if (!subjectId) return [];
  const los = await prisma.learningObjective.findMany({
    where: { module: { curriculum: { subjectId }, isActive: true } },
    select: { ref: true, description: true },
    orderBy: [{ module: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  // Dedup by ref — if the same ref appears across modules, take the first
  // description. (Defect #5 — module duplication — is tracked separately.)
  const seen = new Set<string>();
  const deduped: { ref: string; description: string }[] = [];
  for (const lo of los) {
    if (seen.has(lo.ref)) continue;
    seen.add(lo.ref);
    deduped.push({ ref: lo.ref, description: lo.description });
  }

  // Garbage guard: if every description is invalid (equals ref, empty, or < 4
  // chars), return [] so the extractor doesn't prompt the AI with a useless
  // enum. The un-constrained prompt ("only populate if explicitly labelled")
  // produces honest nulls instead of silently-rejected free text.
  const { isValidLoPair } = await import("@/lib/content-trust/validate-lo-linkage");
  const validCount = deduped.filter((lo) => isValidLoPair(lo.ref, lo.description)).length;
  if (validCount === 0) {
    console.warn(
      `[extract] fetchCurriculumLoRefs: all ${deduped.length} LO rows for subject ${subjectId} have garbage descriptions — falling back to un-constrained prompt. Regenerate the curriculum via the Curriculum tab to fix this.`,
    );
    return [];
  }
  return deduped;
}

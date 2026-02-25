import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DocumentType } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { extractTextFromBuffer } from "@/lib/content-trust/extract-assertions";
import { getStorageAdapter, computeContentHash } from "@/lib/storage";
import { config } from "@/lib/config";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
  backgroundRun,
} from "@/lib/ai/task-guidance";

/**
 * @api POST /api/course-pack/ingest
 * @visibility internal
 * @scope content:write
 * @auth OPERATOR
 * @tags course-pack, content-trust, subjects
 * @description Ingest a confirmed course pack manifest. Creates Subjects, ContentSources,
 *   uploads files, and triggers background extraction for each file. Returns a taskId
 *   for polling overall pack ingestion progress.
 *
 * @body files File[] — the uploaded documents
 * @body manifest string — JSON PackManifest from /api/course-pack/analyze
 * @body domainId string — domain to link subjects to
 * @body courseName string — course name (for slug generation)
 *
 * @response 202 { ok, taskId, subjects: { id, name }[], sourceCount }
 */

// ── Types ──────────────────────────────────────────────

interface ManifestFile {
  fileIndex: number;
  fileName: string;
  documentType: string;
  role: string;
  confidence: number;
  reasoning: string;
}

interface ManifestGroup {
  groupName: string;
  suggestedSubjectName: string;
  files: ManifestFile[];
}

interface PackManifest {
  groups: ManifestGroup[];
  pedagogyFiles: ManifestFile[];
}

// ── Route ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const formData = await req.formData();
    const manifestJson = formData.get("manifest") as string;
    const domainId = formData.get("domainId") as string;
    const courseName = (formData.get("courseName") as string) || "";

    if (!manifestJson) {
      return NextResponse.json({ ok: false, error: "Missing manifest" }, { status: 400 });
    }
    if (!domainId) {
      return NextResponse.json({ ok: false, error: "Missing domainId" }, { status: 400 });
    }

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, slug: true, name: true },
    });
    if (!domain) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    const manifest: PackManifest = JSON.parse(manifestJson);

    // Collect all files from form data
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "files" && value instanceof File) {
        files.push(value);
      }
    }

    // Validate file count matches manifest
    const manifestFileCount = manifest.groups.reduce((n, g) => n + g.files.length, 0)
      + manifest.pedagogyFiles.length;
    if (files.length < manifestFileCount) {
      return NextResponse.json(
        { ok: false, error: `Expected ${manifestFileCount} files but received ${files.length}` },
        { status: 400 },
      );
    }

    // Create task for tracking overall progress
    const taskId = await startTaskTracking(authResult.session.user.id, "course_pack_ingest", {
      courseName,
      domainId,
      fileCount: files.length,
      groupCount: manifest.groups.length,
    });

    // Track created entities for response
    const createdSubjects: Array<{ id: string; name: string }> = [];
    let sourceCount = 0;

    // Run ingestion in background
    backgroundRun(taskId, async () => {
      try {
        const totalSteps = manifest.groups.length + (manifest.pedagogyFiles.length > 0 ? 1 : 0);
        let currentStep = 0;

        // ── Process each subject group ──

        for (const group of manifest.groups) {
          currentStep++;
          await updateTaskProgress(taskId, {
            context: {
              phase: "creating-subject",
              message: `Creating subject: ${group.suggestedSubjectName}`,
              stepIndex: currentStep,
              totalSteps,
            },
          });

          // Create or find Subject
          const subjectSlug = `${domain.slug}-${group.suggestedSubjectName}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");

          let subject = await prisma.subject.findFirst({
            where: { slug: subjectSlug },
          });

          if (!subject) {
            subject = await prisma.subject.create({
              data: {
                slug: subjectSlug,
                name: group.suggestedSubjectName,
                isActive: true,
              },
            });
          }

          createdSubjects.push({ id: subject.id, name: subject.name });

          // Link Subject to Domain (idempotent)
          const existingLink = await prisma.subjectDomain.findFirst({
            where: { subjectId: subject.id, domainId },
          });
          if (!existingLink) {
            await prisma.subjectDomain.create({
              data: { subjectId: subject.id, domainId },
            });
          }

          // Create ContentSource for each file in group (synchronous — needed for pairing)
          const groupSources: Array<{ sourceId: string; role: string; fileName: string }> = [];

          for (const mf of group.files) {
            const file = files[mf.fileIndex];
            if (!file) continue;

            await updateTaskProgress(taskId, {
              context: {
                phase: "uploading",
                message: `Uploading: ${file.name}`,
                stepIndex: currentStep,
                totalSteps,
              },
            });

            const result = await createSourceAndStartExtraction(
              file,
              subject.id,
              domain.slug,
              mf.documentType,
              authResult.session.user.id,
            );
            groupSources.push({ sourceId: result.sourceId, role: mf.role, fileName: file.name });
            sourceCount++;
          }

          // ── Auto-pair passage ↔ question bank within this group ──
          const passageSources = groupSources.filter((s) => s.role === "passage");
          const questionSources = groupSources.filter((s) => s.role === "questions");

          if (passageSources.length > 0 && questionSources.length > 0) {
            // If there's exactly one passage, link all question sources to it
            // If multiple passages, pair by position (P1→Q1, P2→Q2)
            for (let qi = 0; qi < questionSources.length; qi++) {
              const pairedPassage = passageSources.length === 1
                ? passageSources[0]
                : passageSources[qi] || passageSources[0];

              await prisma.contentSource.update({
                where: { id: questionSources[qi].sourceId },
                data: { linkedSourceId: pairedPassage.sourceId },
              });
              console.log(
                `[course-pack/ingest] Paired: ${questionSources[qi].fileName} → ${pairedPassage.fileName}`,
              );
            }
          }
        }

        // ── Process pedagogy files (attach to domain, not a specific subject) ──

        if (manifest.pedagogyFiles.length > 0) {
          currentStep++;
          await updateTaskProgress(taskId, {
            context: {
              phase: "pedagogy",
              message: "Processing teaching guides...",
              stepIndex: currentStep,
              totalSteps,
            },
          });

          // Create a "Course Guide" subject for pedagogy files
          const pedSubjectSlug = `${domain.slug}-course-guide`;
          let pedSubject = await prisma.subject.findFirst({
            where: { slug: pedSubjectSlug },
          });
          if (!pedSubject) {
            pedSubject = await prisma.subject.create({
              data: {
                slug: pedSubjectSlug,
                name: `${courseName || domain.name} Course Guide`,
                isActive: true,
              },
            });
          }

          // Link to domain
          const existingPedLink = await prisma.subjectDomain.findFirst({
            where: { subjectId: pedSubject.id, domainId },
          });
          if (!existingPedLink) {
            await prisma.subjectDomain.create({
              data: { subjectId: pedSubject.id, domainId },
            });
          }

          createdSubjects.push({ id: pedSubject.id, name: pedSubject.name });

          for (const mf of manifest.pedagogyFiles) {
            const file = files[mf.fileIndex];
            if (!file) continue;

            await createSourceAndStartExtraction(
              file,
              pedSubject.id,
              domain.slug,
              mf.documentType || "LESSON_PLAN",
              authResult.session.user.id,
            );
            sourceCount++;
          }
        }

        // ── Complete ──

        await updateTaskProgress(taskId, {
          context: {
            phase: "done",
            message: "Pack ingestion complete",
            subjects: createdSubjects,
            sourceCount,
          },
        });
        await completeTask(taskId);
      } catch (error: unknown) {
        console.error("[course-pack/ingest] Background error:", error);
        await failTask(taskId, error instanceof Error ? error.message : "Background ingestion failed");
      }
    });

    return NextResponse.json(
      {
        ok: true,
        taskId,
        subjects: createdSubjects,
        sourceCount,
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    console.error("[course-pack/ingest] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Ingest failed" },
      { status: 500 },
    );
  }
}

// ── Helpers ────────────────────────────────────────────

/**
 * Create a ContentSource, store the file, and start background extraction
 * using the specialist extractor pipeline (same quality as single-file upload).
 *
 * Source creation + file storage is synchronous (fast, needed for pairing).
 * Extraction is fire-and-forget per file (non-blocking).
 */
async function createSourceAndStartExtraction(
  file: File,
  subjectId: string,
  domainSlug: string,
  documentType: string,
  userId: string,
) {
  const buffer = Buffer.from(await file.arrayBuffer());

  // Extract text for classification & text sample
  const { text } = await extractTextFromBuffer(buffer, file.name);

  const finalDocType = documentType as DocumentType;

  // Create ContentSource
  const baseSlug = file.name
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const sourceSlug = `${domainSlug}-${baseSlug}-${Date.now()}`;
  const displayName = file.name.replace(/\.[^/.]+$/, "");

  const source = await prisma.contentSource.create({
    data: {
      slug: sourceSlug,
      name: displayName,
      trustLevel: "UNVERIFIED",
      documentType: finalDocType,
      documentTypeSource: "pack-manifest",
      textSample: text.substring(0, 2000),
    },
  });

  // Attach to subject
  await prisma.subjectSource.create({
    data: {
      subjectId,
      sourceId: source.id,
      tags: ["content", "pack-upload"],
    },
  });

  // Store file as MediaAsset
  const contentHash = computeContentHash(buffer);
  const storage = getStorageAdapter();

  const existingMedia = await prisma.mediaAsset.findUnique({ where: { contentHash } });
  let mediaId: string;

  if (existingMedia) {
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
        uploadedBy: userId,
        sourceId: source.id,
        trustLevel: "UNVERIFIED",
      },
    });
    mediaId = media.id;
  }

  // Link media to subject
  await prisma.subjectMedia.upsert({
    where: { subjectId_mediaId: { subjectId, mediaId } },
    update: {},
    create: { subjectId, mediaId },
  });

  // ── Fire-and-forget: extraction using specialist extractor pipeline ──
  // Same quality path as POST /api/content-sources/:id/extract
  // Per-chunk saves: assertions appear in DB progressively as chunks complete
  (async () => {
    try {
      const { getExtractor } = await import("@/lib/content-trust/extractors/registry");
      const { resolveExtractionConfig } = await import("@/lib/content-trust/resolve-config");
      const { saveAssertions } = await import("@/lib/content-trust/save-assertions");
      const { saveQuestions } = await import("@/lib/content-trust/save-questions");
      const { saveVocabulary } = await import("@/lib/content-trust/save-vocabulary");
      const { linkContentForSource } = await import("@/lib/content-trust/link-content");
      const { embedAssertionsForSource } = await import("@/lib/embeddings");

      let totalCreated = 0;
      let chunkSaveFailures = 0;
      let totalQuestionsCreated = 0;
      let totalVocabularyCreated = 0;

      const extractor = getExtractor(finalDocType);
      const extractionConfig = await resolveExtractionConfig(source.id, finalDocType);

      const result = await extractor.extract(text, {
        sourceSlug: source.slug,
        sourceId: source.id,
        documentType: finalDocType,
        maxAssertions: extractionConfig.extraction.maxAssertionsPerDocument,
      }, extractionConfig, async (data) => {
        // Per-chunk save: assertions + questions + vocabulary appear in DB progressively
        try {
          if (data.assertions.length > 0) {
            const { created } = await saveAssertions(source.id, data.assertions);
            totalCreated += created;
          }
          if (data.questions.length > 0) {
            const qResult = await saveQuestions(source.id, data.questions);
            totalQuestionsCreated += qResult.created;
          }
          if (data.vocabulary.length > 0) {
            const vResult = await saveVocabulary(source.id, data.vocabulary);
            totalVocabularyCreated += vResult.created;
          }
        } catch (err: unknown) {
          chunkSaveFailures++;
          console.error(`[course-pack/ingest] Per-chunk save failed for ${file.name} chunk ${data.chunkIndex}:`, err instanceof Error ? err.message : err);
        }
      });

      if (!result.ok) {
        console.error(`[course-pack/ingest] Extraction failed for ${file.name}:`, result.error);
        return;
      }

      // Reconciliation save if any per-chunk saves failed
      if (chunkSaveFailures > 0) {
        console.log(`[course-pack/ingest] ${chunkSaveFailures} chunk save(s) failed for ${file.name} — running reconciliation`);
        try {
          const { created } = await saveAssertions(source.id, result.assertions);
          totalCreated += created;
          if (result.questions?.length) {
            const qResult = await saveQuestions(source.id, result.questions);
            totalQuestionsCreated += qResult.created;
          }
          if (result.vocabulary?.length) {
            const vResult = await saveVocabulary(source.id, result.vocabulary);
            totalVocabularyCreated += vResult.created;
          }
        } catch (reconErr: unknown) {
          console.error(`[course-pack/ingest] Reconciliation save failed for ${file.name}:`, reconErr instanceof Error ? reconErr.message : reconErr);
        }
      }

      // Link questions/vocabulary to assertions
      if (totalQuestionsCreated > 0 || totalVocabularyCreated > 0) {
        await linkContentForSource(source.id).catch((err: unknown) => {
          console.error(`[course-pack/ingest] Linking failed for ${file.name}:`, err instanceof Error ? err.message : err);
        });
      }

      // Embed assertions for semantic search (non-blocking)
      if (totalCreated > 0) {
        embedAssertionsForSource(source.id).catch((err: unknown) => {
          console.error(`[course-pack/ingest] Embedding failed for ${file.name}:`, err instanceof Error ? err.message : err);
        });
      }

      console.log(
        `[course-pack/ingest] ${file.name}: ${result.assertions.length} assertions, ` +
        `${result.questions?.length || 0} questions, ${result.vocabulary?.length || 0} vocabulary`,
      );
    } catch (err: unknown) {
      console.error(`[course-pack/ingest] Extraction failed for ${file.name}:`, err instanceof Error ? err.message : err);
    }
  })();

  return { sourceId: source.id, mediaId };
}

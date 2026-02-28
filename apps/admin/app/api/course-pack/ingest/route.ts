import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DocumentType } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { extractTextFromBuffer } from "@/lib/content-trust/extract-assertions";
import { getStorageAdapter, computeContentHash } from "@/lib/storage";
import { config } from "@/lib/config";
import type { InteractionPattern, TeachingMode } from "@/lib/content-trust/resolve-config";
import { checkAutoTriggerCurriculum } from "@/lib/jobs/auto-trigger";
import type { SendIngestEvent } from "@/lib/content-trust/ingest-events";

/**
 * @api POST /api/course-pack/ingest
 * @visibility internal
 * @scope content:write
 * @auth OPERATOR
 * @tags course-pack, content-trust, subjects
 * @description Ingest a confirmed course pack manifest. Creates Subjects, ContentSources,
 *   uploads files, and runs extraction for each file. Returns an SSE stream with
 *   real-time progress events (subject creation, file upload, chunk extraction, completion).
 *
 * @body files File[] — the uploaded documents
 * @body manifest string — JSON PackManifest from /api/course-pack/analyze
 * @body domainId string — domain to link subjects to
 * @body courseName string — course name (for slug generation)
 * @body interactionPattern string (optional) — e.g. "socratic", "directive"
 *
 * @response 200 text/event-stream — SSE progress events, final "complete" event includes
 *   { subjects, sourceCount, totalAssertions, totalQuestions, totalVocabulary }
 */

export const maxDuration = 300; // 5 min — large packs with multiple files

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
  // Auth + validation must happen before the stream (can't send JSON errors inside SSE)
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
  }

  const manifestJson = formData.get("manifest") as string;
  const domainId = formData.get("domainId") as string;
  const courseName = (formData.get("courseName") as string) || "";
  const interactionPattern = (formData.get("interactionPattern") as string) || undefined;
  const teachingMode = (formData.get("teachingMode") as string) as TeachingMode | undefined;
  const subjectDiscipline = (formData.get("subjectDiscipline") as string) || undefined;

  if (!manifestJson) {
    return NextResponse.json({ ok: false, error: "Missing manifest" }, { status: 400 });
  }
  if (!domainId) {
    return NextResponse.json({ ok: false, error: "Missing domainId" }, { status: 400 });
  }

  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, slug: true, name: true },
  });
  if (!domain) {
    return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
  }

  let manifest: PackManifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid manifest JSON" }, { status: 400 });
  }

  const files: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key === "files" && value instanceof File) {
      files.push(value);
    }
  }

  const manifestFileCount = manifest.groups.reduce((n, g) => n + g.files.length, 0)
    + manifest.pedagogyFiles.length;
  if (files.length < manifestFileCount) {
    return NextResponse.json(
      { ok: false, error: `Expected ${manifestFileCount} files but received ${files.length}` },
      { status: 400 },
    );
  }

  const userId = authResult.session.user.id;

  // ── SSE stream ──────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send: SendIngestEvent = (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        send({ phase: "init", message: "" });

        const createdSubjects: Array<{ id: string; name: string }> = [];
        let sourceCount = 0;
        let grandTotalAssertions = 0;
        let grandTotalQuestions = 0;
        let grandTotalVocabulary = 0;
        let grandTotalImages = 0;

        // ── Process each subject group ──

        for (const group of manifest.groups) {
          send({
            phase: "creating-subject",
            message: `Creating subject: ${group.suggestedSubjectName}`,
            data: { subjectName: group.suggestedSubjectName },
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

          send({
            phase: "subject-created",
            message: `Subject ready: ${subject.name}`,
            data: { subjectId: subject.id, subjectName: subject.name },
          });

          // Create + extract each file in group
          const groupSources: Array<{ sourceId: string; role: string; fileName: string }> = [];
          const totalFilesInGroup = group.files.length;

          for (let fi = 0; fi < group.files.length; fi++) {
            const mf = group.files[fi];
            const file = files[mf.fileIndex];
            if (!file) continue;

            send({
              phase: "uploading",
              message: `Uploading: ${file.name}`,
              data: { fileName: file.name, fileIndex: fi, totalFiles: totalFilesInGroup },
            });

            const { sourceId, mediaId, mediaStorageKey, text, source } = await createSource(
              file, subject.id, domain.slug, mf.documentType, userId,
            );
            groupSources.push({ sourceId, role: mf.role, fileName: file.name });
            sourceCount++;

            send({
              phase: "source-created",
              message: `Uploaded: ${file.name}`,
              data: { sourceId, fileName: file.name },
            });

            // Await extraction with SSE events per chunk
            const fileTotals = await extractSource(
              source, text, mf.documentType as DocumentType, file.name,
              subject.id, userId, interactionPattern as InteractionPattern | undefined,
              teachingMode, send, mediaStorageKey, subjectDiscipline, subject.name,
            );

            grandTotalAssertions += fileTotals.assertions;
            grandTotalQuestions += fileTotals.questions;
            grandTotalVocabulary += fileTotals.vocabulary;
            grandTotalImages += fileTotals.images;
          }

          // ── Auto-pair passage ↔ question bank within this group ──
          const passageSources = groupSources.filter((s) => s.role === "passage");
          const questionSources = groupSources.filter((s) => s.role === "questions");

          if (passageSources.length > 0 && questionSources.length > 0) {
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

        // ── Process pedagogy files ──

        if (manifest.pedagogyFiles.length > 0) {
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

            send({
              phase: "uploading",
              message: `Uploading: ${file.name}`,
              data: { fileName: file.name },
            });

            const { sourceId, mediaStorageKey: pedMediaKey, text, source } = await createSource(
              file, pedSubject.id, domain.slug, mf.documentType || "LESSON_PLAN", userId,
            );
            sourceCount++;

            send({
              phase: "source-created",
              message: `Uploaded: ${file.name}`,
              data: { sourceId, fileName: file.name },
            });

            const fileTotals = await extractSource(
              source, text, (mf.documentType || "LESSON_PLAN") as DocumentType, file.name,
              pedSubject.id, userId, interactionPattern as InteractionPattern | undefined,
              teachingMode, send, pedMediaKey, subjectDiscipline, pedSubject.name,
            );

            grandTotalAssertions += fileTotals.assertions;
            grandTotalQuestions += fileTotals.questions;
            grandTotalVocabulary += fileTotals.vocabulary;
            grandTotalImages += fileTotals.images;
          }
        }

        // ── Complete ──

        send({
          phase: "complete",
          message: "Extraction complete",
          data: {
            subjects: createdSubjects,
            sourceCount,
            totalAssertions: grandTotalAssertions,
            totalQuestions: grandTotalQuestions,
            totalVocabulary: grandTotalVocabulary,
            totalImages: grandTotalImages,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Ingestion failed";
        console.error("[course-pack/ingest] Stream error:", err);
        send({ phase: "error", message: msg, data: { error: msg } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Helpers ────────────────────────────────────────────

/**
 * Create a ContentSource + MediaAsset and link to subject.
 * Pure DB/storage — no extraction, returns the text for the caller to extract.
 */
async function createSource(
  file: File,
  subjectId: string,
  domainSlug: string,
  documentType: string,
  userId: string,
) {
  const buffer = Buffer.from(await file.arrayBuffer());
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
  let mediaStorageKey: string | undefined;

  if (existingMedia) {
    mediaId = existingMedia.id;
    mediaStorageKey = existingMedia.storageKey;
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
    mediaStorageKey = storageKey;
  }

  // Link media to subject
  await prisma.subjectMedia.upsert({
    where: { subjectId_mediaId: { subjectId, mediaId } },
    update: {},
    create: { subjectId, mediaId },
  });

  return { sourceId: source.id, mediaId, mediaStorageKey, text, source };
}

/**
 * Run extraction on a source with SSE progress events per chunk.
 * Awaited (not fire-and-forget) so the stream stays open until extraction completes.
 * Post-processing (embedding, structuring, curriculum) remains fire-and-forget.
 * Image extraction runs after text extraction and is awaited for accurate counts.
 */
async function extractSource(
  source: { id: string; slug: string; name: string },
  text: string,
  documentType: DocumentType,
  fileName: string,
  subjectId: string,
  userId: string,
  interactionPattern: InteractionPattern | undefined,
  teachingMode: TeachingMode | undefined,
  send: SendIngestEvent,
  mediaStorageKey?: string,
  subjectDiscipline?: string,
  subjectName?: string,
): Promise<{ assertions: number; questions: number; vocabulary: number; images: number }> {
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

    const extractor = getExtractor(documentType);
    const extractionConfig = await resolveExtractionConfig(source.id, documentType, interactionPattern, subjectDiscipline, subjectName ?? source.name);

    send({
      phase: "extracting",
      message: `Extracting: ${fileName}`,
      data: { fileName, sourceId: source.id },
    });

    const result = await extractor.extract(text, {
      sourceSlug: source.slug,
      sourceId: source.id,
      documentType,
      teachingMode,
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
        console.error(`[course-pack/ingest] Per-chunk save failed for ${fileName} chunk ${data.chunkIndex}:`, err instanceof Error ? err.message : err);
      }

      // Stream chunk progress to client
      // Per-chunk deltas for client-side accumulation (handles out-of-order arrival)
      // Running totals kept for backward compat (safe: Node.js single-threaded += between awaits)
      send({
        phase: "chunk-complete",
        message: `${fileName}: chunk ${data.chunkIndex + 1}/${data.totalChunks}`,
        data: {
          fileName,
          sourceId: source.id,
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks,
          chunkAssertions: data.assertions.length,
          chunkQuestions: data.questions.length,
          chunkVocabulary: data.vocabulary.length,
          assertions: totalCreated,
          questions: totalQuestionsCreated,
          vocabulary: totalVocabularyCreated,
        },
      });
    });

    if (!result.ok) {
      console.error(`[course-pack/ingest] Extraction failed for ${fileName} (source=${source.id}):`, result.error);
      send({
        phase: "file-error",
        message: `${fileName}: extraction failed`,
        data: { fileName, sourceId: source.id, error: result.error || "Extraction failed" },
      });
      return { assertions: 0, questions: 0, vocabulary: 0, images: 0 };
    }

    // Reconciliation save if any per-chunk saves failed
    if (chunkSaveFailures > 0) {
      console.log(`[course-pack/ingest] ${chunkSaveFailures} chunk save(s) failed for ${fileName} — running reconciliation`);
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
        console.error(`[course-pack/ingest] Reconciliation save failed for ${fileName}:`, reconErr instanceof Error ? reconErr.message : reconErr);
      }
    }

    // Link questions/vocabulary to assertions
    if (totalQuestionsCreated > 0 || totalVocabularyCreated > 0) {
      await linkContentForSource(source.id).catch((err: unknown) => {
        console.error(`[course-pack/ingest] Linking failed for ${fileName}:`, err instanceof Error ? err.message : err);
      });
    }

    // ── Image extraction (awaited for accurate counts) ──
    let totalImagesExtracted = 0;
    const nameLower = fileName.toLowerCase();
    const isPdf = nameLower.endsWith(".pdf");
    const isDocx = nameLower.endsWith(".docx");

    if (mediaStorageKey && (isPdf || isDocx)) {
      try {
        const { extractImagesFromPdf, extractImagesFromDocx, linkImagesToSubject, persistImageMetadata } =
          await import("@/lib/content-trust/extract-images");
        const { linkFiguresToAssertions } = await import("@/lib/content-trust/link-figures");
        const { getImageExtractionSettings } = await import("@/lib/system-settings");
        const { getStorageAdapter: getStorage } = await import("@/lib/storage");

        const imgSettings = await getImageExtractionSettings();
        if (imgSettings.enabled) {
          send({
            phase: "images-extracting",
            message: `${fileName}: extracting images...`,
            data: { fileName, sourceId: source.id },
          });

          const storage = getStorage();
          const buffer = await storage.download(mediaStorageKey);

          const imgResult = isPdf
            ? await extractImagesFromPdf(buffer, source.id, userId, imgSettings)
            : await extractImagesFromDocx(buffer, source.id, userId, imgSettings);

          if (imgResult.ok && imgResult.images.length > 0) {
            await persistImageMetadata(imgResult.images);
            await linkImagesToSubject(source.id, imgResult.images);
            await linkFiguresToAssertions(source.id, imgResult.images);
            totalImagesExtracted = imgResult.images.length;

            send({
              phase: "images-complete",
              message: `${fileName}: ${totalImagesExtracted} image${totalImagesExtracted !== 1 ? "s" : ""} extracted`,
              data: { fileName, sourceId: source.id, images: totalImagesExtracted },
            });
          }
        }
      } catch (imgErr: unknown) {
        console.error(`[course-pack/ingest] Image extraction failed for ${fileName}:`, imgErr instanceof Error ? imgErr.message : imgErr);
      }
    }

    send({
      phase: "file-complete",
      message: `${fileName}: ${totalCreated} points${totalQuestionsCreated ? `, ${totalQuestionsCreated} questions` : ""}${totalVocabularyCreated ? `, ${totalVocabularyCreated} vocab` : ""}${totalImagesExtracted ? `, ${totalImagesExtracted} images` : ""}`,
      data: {
        fileName,
        sourceId: source.id,
        assertions: totalCreated,
        questions: totalQuestionsCreated,
        vocabulary: totalVocabularyCreated,
        images: totalImagesExtracted,
      },
    });

    // Post-processing: fire-and-forget (non-blocking)
    if (totalCreated > 0) {
      send({
        phase: "post-processing",
        message: `${fileName}: indexing...`,
        data: { fileName },
      });

      embedAssertionsForSource(source.id).catch((err: unknown) => {
        console.error(`[course-pack/ingest] Embedding failed for ${fileName}:`, err instanceof Error ? err.message : err);
      });

      import("@/lib/content-trust/structure-assertions").then(({ structureSourceIfEligible }) => {
        structureSourceIfEligible(source.id).catch((err: unknown) => {
          console.error(`[course-pack/ingest] Auto-structure failed for ${fileName}:`, err instanceof Error ? err.message : err);
        });
      });
    }

    // Auto-trigger curriculum generation
    checkAutoTriggerCurriculum(subjectId, userId).catch((err: unknown) => {
      console.error(`[course-pack/ingest] Auto-trigger error for ${fileName}:`, err instanceof Error ? err.message : err);
    });

    console.log(
      `[course-pack/ingest] ${fileName}: ${totalCreated} assertions, ` +
      `${totalQuestionsCreated} questions, ${totalVocabularyCreated} vocabulary, ${totalImagesExtracted} images`,
    );

    return {
      assertions: totalCreated,
      questions: totalQuestionsCreated,
      vocabulary: totalVocabularyCreated,
      images: totalImagesExtracted,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Extraction crashed";
    console.error(`[course-pack/ingest] Extraction crashed for ${fileName} (source=${source.id}):`, msg);
    send({
      phase: "file-error",
      message: `${fileName}: ${msg}`,
      data: { fileName, sourceId: source.id, error: msg },
    });
    return { assertions: 0, questions: 0, vocabulary: 0, images: 0 };
  }
}

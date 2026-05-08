import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { extractTextFromBuffer } from "@/lib/content-trust/extract-assertions";
import { classifyDocument, fetchFewShotExamples, buildMultiPointSample, filenameTypeHint } from "@/lib/content-trust/classify-document";
import { validateManifest } from "@/lib/content-trust/validate-manifest";
import { resolveExtractionConfig } from "@/lib/content-trust/resolve-config";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { interpolateTemplate } from "@/lib/prompts/interpolate";
import { config } from "@/lib/config";
import { logAI } from "@/lib/logger";
import { jsonrepair } from "jsonrepair";

/**
 * @api POST /api/course-pack/analyze
 * @visibility internal
 * @scope content:write
 * @auth OPERATOR
 * @tags course-pack, content-trust, classification
 * @description Analyze multiple uploaded files as a course pack. Uses AI to group
 *   files into subjects (e.g., "The Secret Garden" passages + question banks)
 *   and classify each file's pedagogical role. Single AI call sees ALL file
 *   summaries together to detect cross-file relationships.
 *
 * @body files File[] — the uploaded documents (PDF, DOCX, TXT, MD, JSON)
 * @body courseName string — name of the course being created
 * @body domainId string — optional existing domain ID
 *
 * @response 200 { ok, manifest: PackManifest }
 */

// ── Types ──────────────────────────────────────────────

interface PackFile {
  fileIndex: number;
  fileName: string;
  documentType: string;
  role: "passage" | "questions" | "reference" | "pedagogy";
  confidence: number;
  reasoning: string;
}

interface PackGroup {
  groupName: string;
  suggestedSubjectName: string;
  files: PackFile[];
}

interface PackManifest {
  groups: PackGroup[];
  pedagogyFiles: PackFile[];
}

/** @system-constant content-processing — Max characters extracted per file for AI analysis */
const TEXT_SAMPLE_LIMIT = 2000;

const VALID_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown", ".json"];

const VALID_DOC_TYPES = [
  "CURRICULUM", "TEXTBOOK", "WORKSHEET", "EXAMPLE", "ASSESSMENT",
  "REFERENCE", "COMPREHENSION", "LESSON_PLAN", "POLICY_DOCUMENT",
  "READING_PASSAGE", "QUESTION_BANK", "COURSE_REFERENCE",
];

// ── Helpers ────────────────────────────────────────────

const COURSE_PACK_ANALYZE_FALLBACK = `You are a curriculum analyst. You analyze uploaded course files and group them by subject/topic.

Your task:
1. Examine ALL file summaries together
2. Group files that belong to the same subject/topic (e.g., files about the same book, chapter, or topic area)
3. Identify any "pedagogy" files — documents about teaching approach, session structure, or skills frameworks (not student content)
4. Classify each file's document type and role

Document types: {{validDocTypes}}

Type disambiguation:
- COURSE_REFERENCE — a document that primarily contains tutor instructions (skills framework, session flow, scaffolding rules, teaching principles, edge-case handling, communication rules) but may ALSO contain student-facing content (facts, definitions, examples). If a document contains BOTH tutor instructions AND student content, classify as COURSE_REFERENCE — the extraction pipeline handles mixed content by routing each assertion to the appropriate category.
- READING_PASSAGE — standalone prose the learner reads (stories, articles, chapters). Contains NO questions.
- QUESTION_BANK — structured tutor questions with skill refs, model responses, or tiered guidance. NOT a test — it's a teaching tool.
- COMPREHENSION — combined text + questions in the SAME document (e.g., "Read this passage then answer...")
- ASSESSMENT — formal tests, exams, past papers, mark schemes
- Use TEXTBOOK only for general reference/informational content that doesn't fit the above

File roles:
- "passage" — reading material, standalone text (READING_PASSAGE, TEXTBOOK, or part of COMPREHENSION)
- "questions" — question banks, exercises, assessments (QUESTION_BANK, ASSESSMENT, WORKSHEET)
- "reference" — reference guides, glossaries, appendices
- "pedagogy" — teaching instructions, session plans, skills frameworks

Respond with valid JSON matching this schema:
{
  "groups": [
    {
      "groupName": "Short descriptive name",
      "suggestedSubjectName": "Subject name for the group",
      "files": [
        {
          "fileIndex": 0,
          "fileName": "original.docx",
          "documentType": "COMPREHENSION",
          "role": "passage",
          "confidence": 0.9,
          "reasoning": "Brief explanation"
        }
      ]
    }
  ],
  "pedagogyFiles": [
    {
      "fileIndex": 6,
      "fileName": "course-ref.md",
      "documentType": "COURSE_REFERENCE",
      "role": "pedagogy",
      "confidence": 0.85,
      "reasoning": "Brief explanation"
    }
  ]
}

Rules:
- Every file must appear exactly once (either in a group or in pedagogyFiles)
- Group files by shared subject matter, not by file type
- A passage and its question bank should be in the SAME group
- ONE primary subject per course: all content files for the same course belong in ONE group. Do NOT create separate groups for different chapters, documents, or question banks within the same course
- Course guides, lesson plans, skills frameworks, session plans, and policy documents are NOT subjects — they MUST go in pedagogyFiles, never in groups
- COURSE_REFERENCE, LESSON_PLAN, and POLICY_DOCUMENT types always belong in pedagogyFiles
- Only create multiple groups if files genuinely cover DIFFERENT academic disciplines (e.g., "English Literature" vs "Mathematics")
- If a file doesn't clearly belong to any group, add it to the largest existing group rather than creating a new one
- Use the course name "{{courseName}}" for context about what these files are for`;

function roleFromType(docType: string): PackFile["role"] {
  const map: Record<string, PackFile["role"]> = {
    READING_PASSAGE: "passage",
    TEXTBOOK: "passage",
    COMPREHENSION: "passage",
    QUESTION_BANK: "questions",
    ASSESSMENT: "questions",
    WORKSHEET: "questions",
    LESSON_PLAN: "pedagogy",
    POLICY_DOCUMENT: "pedagogy",
    COURSE_REFERENCE: "pedagogy",
    REFERENCE: "reference",
    CURRICULUM: "reference",
    EXAMPLE: "reference",
  };
  return map[docType] || "passage";
}

// ── Route ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const formData = await req.formData();
    const courseName = (formData.get("courseName") as string) || "";
    const files: File[] = [];

    // Collect all files from form data
    for (const [key, value] of formData.entries()) {
      if (key === "files" && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No files uploaded" },
        { status: 400 },
      );
    }

    // Single file — classify via AI (same classifier as content-trust pipeline)
    if (files.length === 1) {
      const f = files[0];

      // Validate file type
      const fname = f.name.toLowerCase();
      if (!VALID_EXTENSIONS.some((ext) => fname.endsWith(ext))) {
        return NextResponse.json(
          { ok: false, error: `Unsupported file type: ${f.name}. Supported: ${VALID_EXTENSIONS.join(", ")}` },
          { status: 400 },
        );
      }

      // Extract text sample
      let textSample = "";
      try {
        const buffer = Buffer.from(await f.arrayBuffer());
        const { text } = await extractTextFromBuffer(buffer, f.name);
        textSample = text;
      } catch {
        // Falls through to classification with empty text → TEXTBOOK fallback
      }

      // Run classification
      let docType = "TEXTBOOK";
      let confidence = 0.5;
      let reasoning = "Could not extract text for classification";

      if (textSample.length > 50) {
        try {
          const extractionConfig = await resolveExtractionConfig();
          const fewShot = await fetchFewShotExamples();
          const result = await classifyDocument(textSample, f.name, extractionConfig, fewShot);
          docType = result.documentType;
          confidence = result.confidence;
          reasoning = result.reasoning;
        } catch (err: unknown) {
          console.warn("[course-pack/analyze] Single-file classification failed:", err);
          reasoning = "Classification failed — defaulted to Textbook";
        }
      }

      const groupName = f.name.replace(/\.[^/.]+$/, "");
      logAI("course-pack.analyze:result", `Analyze single file "${f.name}"`, JSON.stringify({ documentType: docType, confidence, reasoning }), {
        fileCount: 1, courseName, documentType: docType,
      });
      return NextResponse.json({
        ok: true,
        manifest: {
          groups: [{
            groupName,
            suggestedSubjectName: courseName || groupName,
            files: [{
              fileIndex: 0,
              fileName: f.name,
              documentType: docType,
              role: roleFromType(docType),
              confidence,
              reasoning,
            }],
          }],
          pedagogyFiles: [],
        } satisfies PackManifest,
      });
    }

    // Validate all file types
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (!VALID_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        return NextResponse.json(
          { ok: false, error: `Unsupported file type: ${file.name}. Supported: ${VALID_EXTENSIONS.join(", ")}` },
          { status: 400 },
        );
      }
    }

    // Extract text samples from each file (first 2000 chars)
    const fileSummaries: Array<{ index: number; fileName: string; textSample: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const { text } = await extractTextFromBuffer(buffer, file.name);
        fileSummaries.push({
          index: i,
          fileName: file.name,
          textSample: buildMultiPointSample(text, TEXT_SAMPLE_LIMIT),
        });
      } catch {
        fileSummaries.push({
          index: i,
          fileName: file.name,
          textSample: "[Could not extract text]",
        });
      }
    }

    // Build AI prompt
    const fileDescriptions = fileSummaries
      .map((f) => [
        `--- FILE ${f.index}: ${f.fileName} ---`,
        f.textSample,
        `--- END FILE ${f.index} ---`,
      ].join("\n"))
      .join("\n\n");

    const template = await getPromptSpec(config.specs.coursePackAnalyzer, COURSE_PACK_ANALYZE_FALLBACK);
    const systemPrompt = interpolateTemplate(template, {
      validDocTypes: VALID_DOC_TYPES.join(", "),
      courseName,
    });

    const userPrompt = `Course: "${courseName}"
${files.length} files uploaded:

${fileDescriptions}

Analyze these files and group them by subject. Return JSON only.`;

    // @ai-call course-pack.analyze — Group uploaded course files into subjects | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "course-pack.analyze",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      { sourceOp: "course-pack:analyze" },
    );

    // Parse AI response — wrap with jsonrepair to handle truncated strings,
    // trailing commas, single quotes, etc. Mirrors the established pattern in
    // base-extractor.ts:475 and generate-mcqs.ts:945.
    const raw = typeof result === "string" ? result : result?.content || "";
    const responseText = raw.trim();
    const jsonStr = responseText.startsWith("{")
      ? responseText
      : responseText.replace(/^```json?\n?/, "").replace(/\n?```$/, "");

    const parsed = JSON.parse(jsonrepair(jsonStr)) as PackManifest;

    // Validate and sanitize the manifest
    const manifest: PackManifest = {
      groups: (parsed.groups || []).map((g) => ({
        groupName: g.groupName || "Unnamed Group",
        suggestedSubjectName: g.suggestedSubjectName || g.groupName || "Unnamed Subject",
        files: (g.files || []).map((f) => ({
          fileIndex: f.fileIndex,
          fileName: f.fileName || files[f.fileIndex]?.name || "unknown",
          documentType: VALID_DOC_TYPES.includes(f.documentType) ? f.documentType : "TEXTBOOK",
          role: (["passage", "questions", "reference", "pedagogy"] as const).includes(f.role as PackFile["role"])
            ? f.role
            : "passage",
          confidence: Math.min(1, Math.max(0, f.confidence || 0.5)),
          reasoning: f.reasoning || "",
        })),
      })),
      pedagogyFiles: (parsed.pedagogyFiles || []).map((f) => ({
        fileIndex: f.fileIndex,
        fileName: f.fileName || files[f.fileIndex]?.name || "unknown",
        documentType: VALID_DOC_TYPES.includes(f.documentType) ? f.documentType : "LESSON_PLAN",
        role: "pedagogy" as const,
        confidence: Math.min(1, Math.max(0, f.confidence || 0.5)),
        reasoning: f.reasoning || "",
      })),
    };

    // Verify all files are accounted for
    const assignedIndices = new Set<number>();
    for (const g of manifest.groups) {
      for (const f of g.files) assignedIndices.add(f.fileIndex);
    }
    for (const f of manifest.pedagogyFiles) assignedIndices.add(f.fileIndex);

    // Add any missing files to their own group
    for (let i = 0; i < files.length; i++) {
      if (!assignedIndices.has(i)) {
        manifest.groups.push({
          groupName: files[i].name.replace(/\.[^/.]+$/, ""),
          suggestedSubjectName: files[i].name.replace(/\.[^/.]+$/, ""),
          files: [{
            fileIndex: i,
            fileName: files[i].name,
            documentType: "TEXTBOOK",
            role: "passage",
            confidence: 0.3,
            reasoning: "Not classified by AI — added as standalone",
          }],
        });
      }
    }

    // ── Filename-based overrides ──
    // When a filename explicitly names its type (e.g. "course-reference.md")
    // but the AI returned something generic, override and relocate if needed.
    for (const g of manifest.groups) {
      const toMove: number[] = [];
      for (let fi = 0; fi < g.files.length; fi++) {
        const f = g.files[fi];
        const hint = filenameTypeHint(f.fileName);
        if (hint) {
          if (hint.type !== f.documentType) {
            console.log(`[course-pack/analyze] Filename override: ${f.fileName} AI=${f.documentType} → ${hint.type}`);
            f.documentType = hint.type;
            f.role = hint.role;
            f.reasoning = `${f.reasoning} [Filename signal → ${hint.type}]`;
            f.confidence = Math.max(f.confidence, 0.85);
            if (hint.role === "pedagogy") toMove.push(fi);
          } else {
            console.log(`[course-pack/analyze] Filename hint confirmed: ${f.fileName} = ${hint.type}`);
          }
        }
      }
      // Move pedagogy-typed files from content groups to pedagogyFiles
      for (const idx of toMove.reverse()) {
        manifest.pedagogyFiles.push({ ...g.files[idx], role: "pedagogy" });
        g.files.splice(idx, 1);
      }
    }
    // Also check pedagogy files for misclassification
    for (const f of manifest.pedagogyFiles) {
      const hint = filenameTypeHint(f.fileName);
      if (hint && hint.type !== f.documentType) {
        console.log(`[course-pack/analyze] Filename override (pedagogy): ${f.fileName} AI=${f.documentType} → ${hint.type}`);
        f.documentType = hint.type;
        f.reasoning = `${f.reasoning} [Filename signal → ${hint.type}]`;
        f.confidence = Math.max(f.confidence, 0.85);
      }
    }
    // Drop empty groups after migration
    manifest.groups = manifest.groups.filter((g) => g.files.length > 0);

    // ── Structural guard: fix AI mistakes before returning ──
    const { manifest: validatedManifest, fixes } = validateManifest(manifest);

    const totalFiles = validatedManifest.groups.reduce((n, g) => n + g.files.length, 0) + validatedManifest.pedagogyFiles.length;
    logAI("course-pack.analyze:result", `Analyze ${files.length} files for "${courseName}"`, JSON.stringify({
      groups: validatedManifest.groups.length,
      pedagogyFiles: validatedManifest.pedagogyFiles.length,
      totalFiles,
      fixes: fixes.length,
    }), { fileCount: files.length, courseName, groupCount: validatedManifest.groups.length });

    return NextResponse.json({ ok: true, manifest: validatedManifest, fixes });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Pack analysis failed";
    console.error("[course-pack/analyze] Error:", error);
    logAI("course-pack.analyze:error", `Analyze failed`, msg, { level: "error" });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}

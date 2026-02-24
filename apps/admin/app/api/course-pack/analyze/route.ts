import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { extractTextFromBuffer } from "@/lib/content-trust/extract-assertions";

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

/** Maximum characters extracted from each file for AI analysis */
const TEXT_SAMPLE_LIMIT = 2000;

const VALID_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown", ".json"];

const VALID_DOC_TYPES = [
  "CURRICULUM", "TEXTBOOK", "WORKSHEET", "EXAMPLE", "ASSESSMENT",
  "REFERENCE", "COMPREHENSION", "LESSON_PLAN", "POLICY_DOCUMENT",
  "READING_PASSAGE", "QUESTION_BANK",
];

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

    // Single file — skip pack analysis, return simple manifest
    if (files.length === 1) {
      const f = files[0];
      return NextResponse.json({
        ok: true,
        manifest: {
          groups: [{
            groupName: f.name.replace(/\.[^/.]+$/, ""),
            suggestedSubjectName: courseName || f.name.replace(/\.[^/.]+$/, ""),
            files: [{
              fileIndex: 0,
              fileName: f.name,
              documentType: "TEXTBOOK",
              role: "passage" as const,
              confidence: 0.5,
              reasoning: "Single file — will be classified during extraction",
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
          textSample: text.substring(0, TEXT_SAMPLE_LIMIT),
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

    const systemPrompt = `You are a curriculum analyst. You analyze uploaded course files and group them by subject/topic.

Your task:
1. Examine ALL file summaries together
2. Group files that belong to the same subject/topic (e.g., files about the same book, chapter, or topic area)
3. Identify any "pedagogy" files — documents about teaching approach, session structure, or skills frameworks (not student content)
4. Classify each file's document type and role

Document types: ${VALID_DOC_TYPES.join(", ")}

Type disambiguation:
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
      "documentType": "LESSON_PLAN",
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
- If a file doesn't clearly belong to any group, put it in its own group
- Use the course name "${courseName}" for context about what these files are for`;

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

    // Parse AI response
    const responseText = result.content.trim();
    let jsonStr = responseText.startsWith("{")
      ? responseText
      : responseText.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

    const parsed = JSON.parse(jsonStr) as PackManifest;

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

    return NextResponse.json({ ok: true, manifest });
  } catch (error: unknown) {
    console.error("[course-pack/analyze] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Pack analysis failed" },
      { status: 500 },
    );
  }
}

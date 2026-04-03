import { describe, it, expect } from "vitest";
import { validateManifest } from "@/lib/content-trust/validate-manifest";

// Helper to build a minimal manifest file
function file(overrides: Partial<{
  fileIndex: number; fileName: string; documentType: string; role: string; confidence: number; reasoning: string;
}> = {}) {
  return {
    fileIndex: 0,
    fileName: "test.pdf",
    documentType: "READING_PASSAGE",
    role: "passage" as string,
    confidence: 0.9,
    reasoning: "test",
    ...overrides,
  };
}

describe("validateManifest", () => {
  it("passes through a valid single-group manifest unchanged", () => {
    const manifest = {
      groups: [{
        groupName: "English Literature",
        suggestedSubjectName: "English Literature",
        files: [
          file({ fileIndex: 0, fileName: "passage.pdf" }),
          file({ fileIndex: 1, fileName: "questions.pdf", documentType: "QUESTION_BANK", role: "questions" }),
        ],
      }],
      pedagogyFiles: [],
    };

    const { manifest: result, fixes } = validateManifest(manifest);
    expect(fixes).toHaveLength(0);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].files).toHaveLength(2);
  });

  it("moves COURSE_REFERENCE from content groups to pedagogyFiles", () => {
    const manifest = {
      groups: [
        {
          groupName: "English Literature",
          suggestedSubjectName: "English Literature",
          files: [file({ fileIndex: 0, fileName: "passage.pdf" })],
        },
        {
          groupName: "Course Guide",
          suggestedSubjectName: "Course Guide",
          files: [file({ fileIndex: 1, fileName: "guide.md", documentType: "COURSE_REFERENCE", role: "reference" })],
        },
      ],
      pedagogyFiles: [],
    };

    const { manifest: result, fixes } = validateManifest(manifest);
    expect(result.pedagogyFiles).toHaveLength(1);
    expect(result.pedagogyFiles[0].fileName).toBe("guide.md");
    // Course Guide group should be removed (empty after moving file)
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].suggestedSubjectName).toBe("English Literature");
    expect(fixes.some(f => f.action === "moved-to-pedagogy")).toBe(true);
  });

  it("moves LESSON_PLAN from content groups to pedagogyFiles", () => {
    const manifest = {
      groups: [{
        groupName: "Main",
        suggestedSubjectName: "Main",
        files: [
          file({ fileIndex: 0, fileName: "passage.pdf" }),
          file({ fileIndex: 1, fileName: "plan.pdf", documentType: "LESSON_PLAN", role: "pedagogy" }),
        ],
      }],
      pedagogyFiles: [],
    };

    const { manifest: result, fixes } = validateManifest(manifest);
    expect(result.groups[0].files).toHaveLength(1);
    expect(result.pedagogyFiles).toHaveLength(1);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].action).toBe("moved-to-pedagogy");
  });

  it("reproduces the Secret Garden bug: 3 groups → 1 group + pedagogy", () => {
    // This is the exact scenario from the bug report:
    // AI created 3 subjects when there should be 1 subject + pedagogy
    const manifest = {
      groups: [
        {
          groupName: "English Language",
          suggestedSubjectName: "English Language",
          files: [file({ fileIndex: 0, fileName: "secret-garden-ch1.pdf", documentType: "READING_PASSAGE" })],
        },
        {
          groupName: "Secret Garden Ch.1 Theme Comprehension",
          suggestedSubjectName: "Secret Garden Ch.1 Theme Comprehension",
          files: [file({ fileIndex: 1, fileName: "comprehension.pdf", documentType: "COMPREHENSION" })],
        },
        {
          groupName: "Course Guide",
          suggestedSubjectName: "PW: Secret Garden 1015 Course Guide",
          files: [file({ fileIndex: 2, fileName: "course-guide.md", documentType: "COURSE_REFERENCE", role: "pedagogy" })],
        },
      ],
      pedagogyFiles: [],
    };

    const { manifest: result, fixes } = validateManifest(manifest);

    // Course guide → pedagogy
    expect(result.pedagogyFiles).toHaveLength(1);
    expect(result.pedagogyFiles[0].fileName).toBe("course-guide.md");

    // Remaining 2 small groups → merged into 1 primary
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].files).toHaveLength(2);

    // Should have at least 2 fixes (move to pedagogy + merge)
    expect(fixes.length).toBeGreaterThanOrEqual(2);
  });

  it("merges single-file REFERENCE groups into primary", () => {
    const manifest = {
      groups: [
        {
          groupName: "Main Content",
          suggestedSubjectName: "Biology",
          files: [
            file({ fileIndex: 0, fileName: "textbook.pdf", documentType: "TEXTBOOK" }),
            file({ fileIndex: 1, fileName: "questions.pdf", documentType: "QUESTION_BANK", role: "questions" }),
          ],
        },
        {
          groupName: "Glossary",
          suggestedSubjectName: "Biology Glossary",
          files: [file({ fileIndex: 2, fileName: "glossary.pdf", documentType: "REFERENCE", role: "reference" })],
        },
      ],
      pedagogyFiles: [],
    };

    const { manifest: result, fixes } = validateManifest(manifest);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].files).toHaveLength(3);
    expect(fixes.some(f => f.action === "merged-singleton")).toBe(true);
  });

  it("preserves genuinely distinct multi-subject packs", () => {
    // A pack with 2 large groups = legitimately different subjects
    const manifest = {
      groups: [
        {
          groupName: "Mathematics",
          suggestedSubjectName: "Mathematics",
          files: [
            file({ fileIndex: 0, fileName: "algebra.pdf", documentType: "TEXTBOOK" }),
            file({ fileIndex: 1, fileName: "algebra-questions.pdf", documentType: "QUESTION_BANK", role: "questions" }),
            file({ fileIndex: 2, fileName: "geometry.pdf", documentType: "TEXTBOOK" }),
          ],
        },
        {
          groupName: "Physics",
          suggestedSubjectName: "Physics",
          files: [
            file({ fileIndex: 3, fileName: "mechanics.pdf", documentType: "TEXTBOOK" }),
            file({ fileIndex: 4, fileName: "mechanics-questions.pdf", documentType: "QUESTION_BANK", role: "questions" }),
            file({ fileIndex: 5, fileName: "optics.pdf", documentType: "TEXTBOOK" }),
          ],
        },
      ],
      pedagogyFiles: [],
    };

    const { manifest: result, fixes } = validateManifest(manifest);
    // Both groups are large and distinct — should NOT be merged
    expect(result.groups).toHaveLength(2);
    expect(fixes).toHaveLength(0);
  });

  it("does not mutate the input manifest", () => {
    const original = {
      groups: [{
        groupName: "Main",
        suggestedSubjectName: "Main",
        files: [
          file({ fileIndex: 0, documentType: "COURSE_REFERENCE" }),
        ],
      }],
      pedagogyFiles: [],
    };

    const originalStr = JSON.stringify(original);
    validateManifest(original);
    expect(JSON.stringify(original)).toBe(originalStr);
  });
});

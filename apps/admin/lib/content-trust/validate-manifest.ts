/**
 * Manifest validation guard — deterministic rules applied AFTER AI classification,
 * BEFORE any DB writes. Prevents the AI from creating structural mistakes like
 * promoting course guides into separate subjects.
 *
 * Pattern: AI proposes → guard validates → code executes.
 * Use this pattern anywhere AI output drives entity creation.
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

interface ManifestFix {
  action: "moved-to-pedagogy" | "merged-singleton" | "merged-group";
  file?: ManifestFile;
  fromGroup?: string;
  toGroup?: string;
  reason: string;
}

interface ValidationResult {
  manifest: PackManifest;
  fixes: ManifestFix[];
}

// ── Constants ──────────────────────────────────────────

/** Document types that are NEVER a subject — always pedagogy/supporting material */
const PEDAGOGY_DOC_TYPES = new Set([
  "COURSE_REFERENCE",
  // #385 Slice 1 Phase 3 — subtypes inherit pedagogy-not-subject status.
  "COURSE_REFERENCE_CANONICAL",
  "COURSE_REFERENCE_TUTOR_BRIEFING",
  "COURSE_REFERENCE_ASSESSOR_RUBRIC",
  "LESSON_PLAN",
  "POLICY_DOCUMENT",
]);

/** Document types that are supporting material, not standalone subjects */
const SUPPORTING_DOC_TYPES = new Set([
  ...PEDAGOGY_DOC_TYPES,
  "REFERENCE",
  "CURRICULUM",
]);

// ── Guard ──────────────────────────────────────────────

/**
 * Validate and fix a PackManifest before ingestion.
 * Deterministic rules that override AI structural decisions:
 *
 * 1. Pedagogy-type files in content groups → move to pedagogyFiles
 * 2. Single-file groups with supporting doc types → merge into primary group
 * 3. Groups that are clearly the same subject → merge into one
 *
 * Returns the fixed manifest + a log of all changes made.
 */
export function validateManifest(manifest: PackManifest): ValidationResult {
  const fixes: ManifestFix[] = [];

  // Deep clone to avoid mutating input
  const result: PackManifest = JSON.parse(JSON.stringify(manifest));

  // ── Rule 1: Move pedagogy-typed files from content groups to pedagogyFiles ──

  for (const group of result.groups) {
    const toMove: number[] = [];
    for (let i = 0; i < group.files.length; i++) {
      const file = group.files[i];
      if (PEDAGOGY_DOC_TYPES.has(file.documentType)) {
        toMove.push(i);
        fixes.push({
          action: "moved-to-pedagogy",
          file,
          fromGroup: group.groupName,
          reason: `${file.documentType} is pedagogy — must not be a content subject`,
        });
      }
    }
    for (const idx of toMove.reverse()) {
      const [moved] = group.files.splice(idx, 1);
      moved.role = "pedagogy";
      result.pedagogyFiles.push(moved);
    }
  }

  // Remove empty groups after pedagogy extraction
  result.groups = result.groups.filter(g => g.files.length > 0);

  // ── Rule 2: Merge single-file supporting groups into the primary group ──

  if (result.groups.length > 1) {
    const primaryIdx = findPrimaryGroupIndex(result.groups);
    const toMerge: number[] = [];

    for (let i = 0; i < result.groups.length; i++) {
      if (i === primaryIdx) continue;
      const group = result.groups[i];

      // Single-file group with a supporting doc type → merge
      if (group.files.length === 1 && SUPPORTING_DOC_TYPES.has(group.files[0].documentType)) {
        toMerge.push(i);
        fixes.push({
          action: "merged-singleton",
          file: group.files[0],
          fromGroup: group.groupName,
          toGroup: result.groups[primaryIdx].groupName,
          reason: `Single ${group.files[0].documentType} file promoted to subject — merged into primary`,
        });
      }
    }

    // Merge in reverse order to preserve indices
    for (const idx of toMerge.reverse()) {
      result.groups[primaryIdx].files.push(...result.groups[idx].files);
      result.groups.splice(idx, 1);
    }
  }

  // ── Rule 3: If all remaining groups share the same course context, merge them ──
  // (e.g., "Secret Garden Ch.1" and "Secret Garden Ch.2" are the same subject)
  // Only apply when ALL non-primary groups are small (≤2 files) — avoids merging
  // genuinely distinct multi-topic packs.

  if (result.groups.length > 1) {
    const primaryIdx = findPrimaryGroupIndex(result.groups);
    const smallNonPrimary = result.groups
      .filter((_, i) => i !== primaryIdx)
      .every(g => g.files.length <= 2);

    if (smallNonPrimary && result.groups.length <= 4) {
      // Merge all into primary
      const primary = result.groups[primaryIdx];
      const toRemove: number[] = [];

      for (let i = 0; i < result.groups.length; i++) {
        if (i === primaryIdx) continue;
        const group = result.groups[i];
        fixes.push({
          action: "merged-group",
          fromGroup: group.groupName,
          toGroup: primary.groupName,
          reason: `Small group (${group.files.length} file${group.files.length !== 1 ? "s" : ""}) merged into primary subject — avoid subject fragmentation`,
        });
        primary.files.push(...group.files);
        toRemove.push(i);
      }

      for (const idx of toRemove.reverse()) {
        result.groups.splice(idx, 1);
      }
    }
  }

  if (fixes.length > 0) {
    console.log(
      `[validate-manifest] Applied ${fixes.length} fix(es):`,
      fixes.map(f => `${f.action}: ${f.reason}`).join("; "),
    );
  }

  return { manifest: result, fixes };
}

/**
 * Find the "primary" group — the one most likely to be the actual subject.
 * Heuristic: largest group by file count, with tie-break on having passage/content files.
 */
function findPrimaryGroupIndex(groups: ManifestGroup[]): number {
  let bestIdx = 0;
  let bestScore = 0;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    let score = g.files.length * 10;
    // Bonus for having actual content (passages, questions, comprehension)
    for (const f of g.files) {
      if (["READING_PASSAGE", "TEXTBOOK", "COMPREHENSION", "QUESTION_BANK"].includes(f.documentType)) {
        score += 5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

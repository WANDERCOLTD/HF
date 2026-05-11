/**
 * Markdown Front-Matter Content Declarations
 *
 * Educators tune content classification by declaring intent in markdown
 * front-matter rather than relying on AI inference. This module parses
 * those declarations into a strongly typed `ContentDeclaration` shape
 * which downstream classifiers (classifyDocument, classifyLo, extractor
 * pipelines, question creators) consult before falling back to AI.
 *
 * Two surface forms are accepted; both produce the same in-memory shape:
 *
 * Form A — YAML front-matter (preferred for new docs):
 *
 *   ---
 *   hf-document-type: COURSE_REFERENCE
 *   hf-default-category: session_flow
 *   hf-audience: tutor-only
 *   hf-lo-system-role: TEACHING_INSTRUCTION
 *   hf-question-assessment-use: TUTOR_ONLY
 *   ---
 *
 *   # Title
 *
 * Form B — Blockquote header (matches existing IELTS docs):
 *
 *   # Title
 *
 *   > **Document type:** COURSE_REFERENCE · **Intended assertion category:** session_flow
 *   > · **LO systemRole:** TEACHING_INSTRUCTION · **Audience: tutor-only**
 *
 * AI-to-DB guard pattern: declarations are HINTS the educator vouches for,
 * but every field is validated against the canonical enum surface. Unknown
 * values are rejected with a warning, and the consumer falls back to AI
 * inference for that field. Declarations CANNOT inject arbitrary enum
 * values into the DB.
 *
 * See docs/CONTENT-PIPELINE.md §3 and §6 for how declarations slot into
 * the broader classification taxonomy and veto chain.
 */

import type { DocumentType, InstructionCategory } from "./resolve-config";
import { INSTRUCTION_CATEGORIES } from "./resolve-config";
import type { AssessmentUse, LoSystemRole } from "@prisma/client";

// ── Public types ──────────────────────────────────────────────────────

export type ContentAudience = "learner" | "tutor-only" | "assessor-only";

/** Parsed + validated declaration. Every field is optional — missing fields fall back to AI. */
export interface ContentDeclaration {
  documentType?: DocumentType;
  defaultCategory?: InstructionCategory | string;
  audience?: ContentAudience;
  loSystemRole?: LoSystemRole;
  questionAssessmentUse?: AssessmentUse;
  /** Accumulated warnings from parsing (invalid enum, malformed block, etc.). */
  sourceWarnings: string[];
  /** True when at least one field was parsed and validated successfully. */
  hasDeclaration: boolean;
  /** Which surface form produced the declaration (for logging/debug). */
  format?: "yaml" | "blockquote";
}

// ── Canonical enum allow-lists ────────────────────────────────────────
//
// IMPORTANT: any time a new value is added to one of the underlying enums
// (DocumentType, LoSystemRole, AssessmentUse, INSTRUCTION_CATEGORIES),
// confirm the value is also acceptable as a declared override. See the
// pre-change checklist in docs/CONTENT-PIPELINE.md §10.

const DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  "CURRICULUM",
  "TEXTBOOK",
  "WORKSHEET",
  "EXAMPLE",
  "ASSESSMENT",
  "REFERENCE",
  "COMPREHENSION",
  "LESSON_PLAN",
  "POLICY_DOCUMENT",
  "READING_PASSAGE",
  "QUESTION_BANK",
  "COURSE_REFERENCE",
]);

const LO_SYSTEM_ROLES: ReadonlySet<LoSystemRole> = new Set<LoSystemRole>([
  "NONE",
  "ASSESSOR_RUBRIC",
  "ITEM_GENERATOR_SPEC",
  "SCORE_EXPLAINER",
  "TEACHING_INSTRUCTION",
]);

const ASSESSMENT_USES: ReadonlySet<AssessmentUse> = new Set<AssessmentUse>([
  "PRE_TEST",
  "POST_TEST",
  "BOTH",
  "FORMATIVE",
  "TUTOR_ONLY",
]);

const AUDIENCES: ReadonlySet<ContentAudience> = new Set<ContentAudience>([
  "learner",
  "tutor-only",
  "assessor-only",
]);

const ASSERTION_CATEGORIES: ReadonlySet<string> = new Set<string>([
  ...INSTRUCTION_CATEGORIES,
  // Learner-facing categories (§3.1 in CONTENT-PIPELINE.md). Allowed as
  // declared defaultCategory so educators can pin learner-doc extractions
  // to a specific category too.
  "factual_claim",
  "definition",
  "rule",
  "procedure",
  "vocabulary",
  "key_term",
  "concept",
  "threshold",
  "reading_passage",
  "example",
  // Legacy / generic extractor outputs.
  "fact",
  "process",
]);

// ── Entry point ───────────────────────────────────────────────────────

/**
 * Parse declarations from the head of a markdown document.
 *
 * Tries YAML front-matter first (Form A); if absent, falls back to the
 * blockquote header pattern (Form B). When neither form is present, the
 * returned declaration has every field unset and `hasDeclaration === false`.
 */
export function parseContentDeclaration(markdown: string): ContentDeclaration {
  const result: ContentDeclaration = {
    sourceWarnings: [],
    hasDeclaration: false,
  };

  if (!markdown || typeof markdown !== "string") return result;

  // Try YAML front-matter first — must start at the very top.
  const yamlBlock = extractYamlFrontMatter(markdown);
  if (yamlBlock !== null) {
    result.format = "yaml";
    parseKeyValuePairs(yamlBlock, result);
    if (result.hasDeclaration) return result;
  }

  // Fall back to blockquote header — scan first ~25 non-blank lines.
  const blockquote = extractDeclarationBlockquote(markdown);
  if (blockquote !== null) {
    result.format = "blockquote";
    parseBlockquoteFields(blockquote, result);
  }

  return result;
}

// ── YAML front-matter (Form A) ────────────────────────────────────────

/**
 * Pull the YAML front-matter block (`---\n...\n---`) from the head of the
 * document. Returns null when the doc doesn't open with a YAML fence.
 *
 * Intentionally NOT a full YAML parser — we only support `key: value`
 * lines and `#` comments. Educators don't need nested YAML for this.
 */
function extractYamlFrontMatter(markdown: string): string | null {
  // Strip a leading BOM and any blank lines before the fence.
  const stripped = markdown.replace(/^﻿/, "").replace(/^\s+/, "");
  if (!stripped.startsWith("---")) return null;
  const lines = stripped.split(/\r?\n/);
  if (lines[0].trim() !== "---") return null;

  // Find the closing fence within the first 50 lines (generous cap).
  const MAX_FENCE_LINES = 50;
  for (let i = 1; i < Math.min(lines.length, MAX_FENCE_LINES); i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(1, i).join("\n");
    }
  }
  return null;
}

function parseKeyValuePairs(yamlBody: string, result: ContentDeclaration): void {
  for (const rawLine of yamlBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes.
    value = value.replace(/^["']|["']$/g, "");
    if (!value) continue;

    applyDeclaredField(key, value, result);
  }
}

// ── Blockquote header (Form B) ────────────────────────────────────────

/**
 * Extract the contiguous blockquote (lines starting with `>`) immediately
 * following the first heading, if present. Returns null otherwise.
 *
 * Multiple `>` lines are joined into a single string with spaces so a
 * declaration that spans wrapped lines parses uniformly.
 */
function extractDeclarationBlockquote(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let i = 0;

  // Skip leading blanks + a YAML fence we already rejected (don't re-scan it).
  if (lines[0]?.trim() === "---") {
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++; // step past closing fence
  }
  while (i < lines.length && !lines[i].trim()) i++;

  // Optional H1 (or any heading) before the blockquote.
  if (i < lines.length && /^#{1,6}\s+/.test(lines[i])) {
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
  }

  if (i >= lines.length) return null;
  if (!lines[i].trim().startsWith(">")) return null;

  const blockLines: string[] = [];
  while (i < lines.length && lines[i].trim().startsWith(">")) {
    blockLines.push(lines[i].replace(/^\s*>\s?/, ""));
    i++;
  }
  return blockLines.join(" ");
}

/**
 * The blockquote uses prose like:
 *   **Document type:** COURSE_REFERENCE · **Intended assertion category:** `session_flow`
 *   · **LO systemRole:** TEACHING_INSTRUCTION · **Audience: tutor-only**
 *
 * Each field is `**Label[:]** value`. We split on `·` (middle dot) when
 * present so each chunk only carries one field, then extract `Label → value`
 * via regex. Both `**Audience: tutor-only**` (label includes value) and
 * `**Audience:** tutor-only` are tolerated.
 */
function parseBlockquoteFields(blockquote: string, result: ContentDeclaration): void {
  const chunks = blockquote
    .split(/[·•|]/) // middle dot · or bullet • or pipe separator
    .map((c) => c.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    // Form 1: **Label:** value
    const labelValue = chunk.match(/\*\*\s*([^*:]+?)\s*[:：]\s*\*\*\s*(.+)$/);
    if (labelValue) {
      const label = labelValue[1].trim().toLowerCase();
      const value = stripDecorations(labelValue[2]);
      applyLabeledField(label, value, result);
      continue;
    }
    // Form 2: **Label: value** (label and value both inside the bold)
    const labelInside = chunk.match(/\*\*\s*([^*:]+?)\s*[:：]\s*([^*]+?)\s*\*\*/);
    if (labelInside) {
      const label = labelInside[1].trim().toLowerCase();
      const value = stripDecorations(labelInside[2]);
      applyLabeledField(label, value, result);
      continue;
    }
  }
}

/** Map prose labels to the YAML key surface, then delegate to applyDeclaredField. */
function applyLabeledField(label: string, value: string, result: ContentDeclaration): void {
  const normalized = label.replace(/\s+/g, " ").trim();
  switch (normalized) {
    case "document type":
    case "doc type":
      applyDeclaredField("hf-document-type", value, result);
      return;
    case "intended assertion category":
    case "default category":
    case "assertion category":
    case "category":
      // The IELTS docs sometimes list several categories joined by `/`.
      // Pick the first — multiple defaults is ambiguous, so we accept only one.
      // Re-strip decorations after the split so e.g. `\`session_flow\`` becomes
      // `session_flow` before enum lookup.
      applyDeclaredField(
        "hf-default-category",
        stripDecorations(value.split(/\s*[\/,]\s*/)[0]),
        result,
      );
      return;
    case "lo systemrole":
    case "lo systemrole if generated":
    case "lo system role":
    case "lo audience":
      applyDeclaredField("hf-lo-system-role", value, result);
      return;
    case "question assessmentuse":
    case "question assessmentuse if generated":
    case "assessmentuse":
    case "assessment use":
      applyDeclaredField("hf-question-assessment-use", value, result);
      return;
    case "audience":
      applyDeclaredField("hf-audience", value, result);
      return;
    default:
      // Unknown labels are silently ignored — the blockquote header carries
      // other commentary too (e.g. "Dual-path parsing"), and we don't want
      // every prose sentence to surface a warning.
      return;
  }
}

/**
 * Strip backticks, surrounding quotes, trailing punctuation, and stray
 * bold markers so the value is just the bare token (e.g. `COURSE_REFERENCE`).
 */
function stripDecorations(raw: string): string {
  return raw
    .trim()
    .replace(/^[`"'*]+|[`"'*]+$/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/[.,;]+$/g, "")
    .trim();
}

// ── Field application + validation ────────────────────────────────────

function applyDeclaredField(
  key: string,
  rawValue: string,
  result: ContentDeclaration,
): void {
  const value = rawValue.trim();
  if (!value) return;

  switch (key) {
    case "hf-document-type":
    case "hf-doc-type": {
      const upper = value.toUpperCase();
      if (DOCUMENT_TYPES.has(upper as DocumentType)) {
        result.documentType = upper as DocumentType;
        result.hasDeclaration = true;
      } else {
        result.sourceWarnings.push(
          `Ignored declared hf-document-type="${value}" — not a known DocumentType. Falling back to AI inference.`,
        );
      }
      return;
    }
    case "hf-default-category":
    case "hf-assertion-category": {
      const lower = value.toLowerCase().replace(/\s+/g, "_");
      if (ASSERTION_CATEGORIES.has(lower)) {
        result.defaultCategory = lower;
        result.hasDeclaration = true;
      } else {
        result.sourceWarnings.push(
          `Ignored declared hf-default-category="${value}" — not a known ContentAssertion.category. Falling back to AI inference.`,
        );
      }
      return;
    }
    case "hf-audience": {
      const lower = value.toLowerCase().replace(/[\s_]/g, "-");
      if (AUDIENCES.has(lower as ContentAudience)) {
        result.audience = lower as ContentAudience;
        result.hasDeclaration = true;
      } else {
        result.sourceWarnings.push(
          `Ignored declared hf-audience="${value}" — expected one of: ${[...AUDIENCES].join(", ")}.`,
        );
      }
      return;
    }
    case "hf-lo-system-role":
    case "hf-lo-systemrole": {
      const upper = value.toUpperCase().replace(/[\s-]/g, "_");
      if (LO_SYSTEM_ROLES.has(upper as LoSystemRole)) {
        result.loSystemRole = upper as LoSystemRole;
        result.hasDeclaration = true;
      } else {
        result.sourceWarnings.push(
          `Ignored declared hf-lo-system-role="${value}" — not a known LoSystemRole. Falling back to AI inference.`,
        );
      }
      return;
    }
    case "hf-question-assessment-use":
    case "hf-question-assessmentuse":
    case "hf-assessment-use": {
      const upper = value.toUpperCase().replace(/[\s-]/g, "_");
      if (ASSESSMENT_USES.has(upper as AssessmentUse)) {
        result.questionAssessmentUse = upper as AssessmentUse;
        result.hasDeclaration = true;
      } else {
        result.sourceWarnings.push(
          `Ignored declared hf-question-assessment-use="${value}" — not a known AssessmentUse. Falling back to AI inference.`,
        );
      }
      return;
    }
    default:
      // Unknown hf-* keys are warned — the educator likely typo'd. Non-hf keys
      // are ignored silently (front-matter may carry other metadata too).
      if (key.startsWith("hf-")) {
        result.sourceWarnings.push(
          `Unknown declaration key "${key}" — ignored. See docs/CONTENT-PIPELINE.md §3 for supported keys.`,
        );
      }
      return;
  }
}

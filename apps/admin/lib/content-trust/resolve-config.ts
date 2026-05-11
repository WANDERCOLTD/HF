/**
 * Content Extraction Config Resolver
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §3
 * @canonical-doc docs/CONTENT-PIPELINE.md §4
 *
 * Resolves extraction and structuring configuration by merging:
 * 1. System-level CONTENT-EXTRACT-001 spec (global defaults)
 * 2. Domain-level override spec (per-domain customization)
 *
 * Follows the same pattern as identity layer merging (mergeIdentitySpec).
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { getPromptTemplate } from "@/lib/prompts/prompt-settings";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface PyramidLevel {
  depth: number;
  label: string;
  maxChildren: number;
  renderAs: "paragraph" | "heading" | "subheading" | "bold" | "bullet";
  description?: string;
}

export interface ExtractionCategory {
  id: string;
  label: string;
  description: string;
}

export type DocumentType = "CURRICULUM" | "TEXTBOOK" | "WORKSHEET" | "EXAMPLE" | "ASSESSMENT" | "REFERENCE" | "COMPREHENSION" | "LESSON_PLAN" | "POLICY_DOCUMENT" | "READING_PASSAGE" | "QUESTION_BANK" | "COURSE_REFERENCE";

/**
 * Categories that represent tutor instructions (how to teach),
 * as opposed to student content (what to teach).
 * Used by the courseInstructions loader and the course-instructions transform
 * to filter assertions by intent rather than by source DocumentType.
 */
export const INSTRUCTION_CATEGORIES = [
  "teaching_rule",
  "session_flow",
  "scaffolding_technique",
  "skill_framework",
  "communication_rule",
  "assessment_approach",
  "differentiation",
  "edge_case",
  "learner_model",
  "session_override",
  "content_strategy",
  "session_metadata",
  "skill_description",
  "assessment_guidance",
] as const;

export type InstructionCategory = typeof INSTRUCTION_CATEGORIES[number];

export interface ClassificationConfig {
  systemPrompt: string;
  llmConfig: { temperature: number; maxTokens: number };
  sampleSize: number;
  fewShot: {
    enabled: boolean;
    maxExamples: number;
    exampleSampleSize: number;
    domainAware: boolean;
  };
}

export interface TypeOverride {
  extraction?: Partial<ExtractionConfig["extraction"]>;
  structuring?: Partial<ExtractionConfig["structuring"]>;
  rendering?: Partial<ExtractionConfig["rendering"]>;
}

export interface ExtractionConfig {
  extraction: {
    systemPrompt: string;
    categories: ExtractionCategory[];
    llmConfig: { temperature: number; maxTokens: number };
    chunkSize: number;
    maxAssertionsPerDocument: number;
    rules: {
      requirePrecision: string[];
      noInvention: boolean;
      trackTaxYear: boolean;
      trackValidity: boolean;
    };
  };
  structuring: {
    systemPrompt: string;
    levels: PyramidLevel[];
    targetChildCount: number;
    llmConfig: { temperature: number; maxTokens: number };
  };
  rendering: {
    defaultMaxDepth: number;
    depthAdaptation: {
      entryLevel: number;
      fastPace: number;
      advancedPriorKnowledge: number;
    };
  };
  classification: ClassificationConfig;
  typeOverrides: Partial<Record<DocumentType, TypeOverride>>;
}

// ------------------------------------------------------------------
// Default config (fallback if no spec found)
// ------------------------------------------------------------------

const DEFAULT_CONFIG: ExtractionConfig = {
  extraction: {
    systemPrompt: `You are a content extraction specialist. Your job is to parse educational/training material and extract atomic teaching points (assertions).

Each assertion should be:
- A single, self-contained fact, definition, threshold, rule, process step, or example
- Specific enough to be independently verifiable against the source
- Tagged with its category and any relevant metadata

Categories:
- fact: A specific factual statement (e.g., "The ISA allowance is £20,000")
- definition: A term definition (e.g., "An annuity is a series of regular payments")
- threshold: A numeric limit or boundary (e.g., "Higher rate tax starts at £50,270")
- rule: A regulatory or procedural rule (e.g., "Advisors must check affordability before recommending")
- process: A step in a procedure (e.g., "Step 3: Calculate the net relevant earnings")
- example: An illustrative example (e.g., "Example: If a client earns £80,000...")

Return a JSON array of objects with these fields:
- assertion: string (the teaching point)
- category: string (one of the configured categories)
- chapter: string | null (chapter or section heading this comes from)
- section: string | null (sub-section)
- tags: string[] (2-5 keywords)
- examRelevance: number (0.0-1.0, how likely to appear in an exam)
- learningOutcomeRef: string | null (e.g., "LO2", "AC2.3" if identifiable)
- validUntil: string | null (ISO date if time-bound, e.g., tax year figures)
- taxYear: string | null (e.g., "2024/25" if applicable)

IMPORTANT:
- Extract EVERY distinct teaching point, not just highlights
- Be precise with numbers, dates, and thresholds
- If content mentions a tax year or validity period, include it
- Do NOT invent information not present in the source text
- Return ONLY valid JSON (no markdown code fences)`,
    categories: [
      { id: "fact", label: "Factual Statement", description: "A specific factual statement" },
      { id: "definition", label: "Term Definition", description: "A term definition" },
      { id: "threshold", label: "Threshold/Limit", description: "A numeric limit or boundary" },
      { id: "rule", label: "Rule/Regulation", description: "A regulatory or procedural rule" },
      { id: "process", label: "Process Step", description: "A step in a procedure" },
      { id: "example", label: "Example/Scenario", description: "An illustrative example" },
    ],
    llmConfig: { temperature: 0.1, maxTokens: 6000 },
    chunkSize: 8000,
    maxAssertionsPerDocument: 500,
    rules: {
      requirePrecision: ["numbers", "dates", "thresholds"],
      noInvention: true,
      trackTaxYear: false,
      trackValidity: true,
    },
  },
  structuring: {
    systemPrompt: `You are organizing extracted teaching points into a pedagogical pyramid.

Given a set of raw teaching points (assertions), create a hierarchical structure following the configured pyramid levels. Each level should branch into approximately the target number of children.

Rules:
- Every existing assertion must appear as a leaf-level detail under exactly one parent
- Aim for the target child count per node (default: ~3 children)
- Topic slugs should be kebab-case (e.g., "temperature-control")
- Preserve the exact text of existing assertions at the leaf level
- Create new synthesized text for all higher levels
- Higher levels should summarize and frame their children pedagogically
- Return valid JSON matching the requested schema`,
    levels: [
      { depth: 0, label: "overview", maxChildren: 1, renderAs: "paragraph", description: "One paragraph framing the entire subject" },
      { depth: 1, label: "topic", maxChildren: 7, renderAs: "heading", description: "Major topic areas" },
      { depth: 2, label: "key_point", maxChildren: 4, renderAs: "bold", description: "Key points per topic" },
      { depth: 3, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Specific facts, rules, thresholds" },
    ],
    targetChildCount: 3,
    llmConfig: { temperature: 0.2, maxTokens: 8000 },
  },
  rendering: {
    defaultMaxDepth: 3,
    depthAdaptation: {
      entryLevel: -1,
      fastPace: -1,
      advancedPriorKnowledge: -1,
    },
  },
  classification: {
    systemPrompt: `You are a document classification specialist for an educational content system.
You receive a multi-point sample from a document (start, middle, and end sections) plus the filename. Classify the document into one of these types:

- CURRICULUM: A formal syllabus, curriculum specification, or qualification framework. Contains Learning Outcomes (LOs), Assessment Criteria (ACs), range statements, or module descriptors. Highly structured with numbered LOs and ACs. Examples: CII R04 syllabus, Ofqual qualification spec, City & Guilds Level 2 Food Safety handbook.
- TEXTBOOK: A published study text, training manual, or dense reference material structured as chapters covering a subject. Contains detailed explanations, chapters, worked examples organised by topic. The primary teaching content used for first-teaching. Must have chapter/section structure and explanatory prose written TO the student. Examples: Sprenger food safety textbook, BFT study guide, Key Stage 2 Maths textbook, insurance study text. NOT a past paper, NOT a question set with mark schemes, NOT a test — those are ASSESSMENT.
- COMPREHENSION: A reading passage or article with comprehension questions, vocabulary exercises, and/or answer keys. The learner reads the passage then answers questions to demonstrate understanding. The document is primarily READ-ONLY — the learner does not fill anything in. Examples: "The Black Death" reading worksheet, British Council LearnEnglish article, reading comprehension sheet with questions at the end.
- WORKSHEET: A fill-in / write-up / production sheet that the student COMPLETES. Contains blank spaces, tables to fill, exercises requiring written answers, lab sheets. The learner produces content ON the sheet. Examples: lab report template, math practice sheet, fill-in-the-blank grammar exercise, write-up template.
- ASSESSMENT: Formal test/exam material — ANY past paper, exam paper, mock, practice paper, practice test, or test. Typical features: numbered exam questions (Q1, Q2, Question 1), answer boxes or blank lines for pupil responses, marks indicated ("(2 marks)", "[3]"), a cover page stating "DO NOT OPEN UNTIL...", a time limit, "write your answer here", mark schemes, grade boundaries, or question-and-answer pairs. If the document IS a test paper (even without a mark scheme attached), classify as ASSESSMENT. Worked examples INSIDE an exam paper do NOT make it a textbook. Examples: 2024 KS2 SATs paper, mock GCSE paper, end-of-module test, past paper with mark scheme, practice paper, arithmetic test paper.
- REFERENCE: Quick reference card, glossary, cheat sheet, or summary table. Flat lookup material, no narrative or exercises. Examples: tax rate card, food temperature reference chart, glossary of terms.
- EXAMPLE: An illustrative or case-study document used as source material for discussion. Something the AI will talk ABOUT with the learner. Examples: sample cross-contamination report, case study document, sample complaint letter.
- LESSON_PLAN: A teacher-facing plan with objectives, activities, timing, differentiation strategies, and assessment opportunities. NOT a student document. Examples: lesson plan for "Introduction to Negotiation", scheme of work, teaching guide.
- POLICY_DOCUMENT: A regulatory, compliance, or safety procedure document. Defines required practices, hazards, control measures, legal requirements. Examples: Food Standards Agency pest control guide, HACCP procedures, health & safety policy, regulatory compliance manual.
- READING_PASSAGE: A standalone reading passage or text extract that the learner reads before or during a tutoring session. Contains narrative, descriptive, or informational prose but NO questions, exercises, or answer keys. Often has metadata headers (title, author, word count, text type). The document IS the text the learner reads — nothing more. Examples: chapter extract from The Secret Garden, a poem for analysis, a news article for discussion, a descriptive passage for comprehension practice.
- QUESTION_BANK: A tutor reference document containing questions mapped to skills or learning outcomes, with model answers at multiple proficiency tiers (e.g., Emerging / Developing / Secure), suggested tutor responses or "next moves" at each tier, and assessment guidance. NOT a learner-facing test — it is a teaching script or tutor playbook. The tutor uses this to guide conversation. Typically references a separate reading passage. Examples: comprehension question bank with tiered model responses, skill-mapped discussion guide, tutor playbook for a specific passage.
- COURSE_REFERENCE: A tutor instruction document that tells the AI HOW to deliver a course. Contains some or all of: skills framework with proficiency tiers, session flow/phases, scaffolding rules, teaching principles, teaching techniques, communication guidelines, assessment approach, course outcomes, edge-case handling, parent communication rules. This is instructions FOR the tutor, not content FOR the student — even if it describes what students should learn (learning outcomes) or what student responses look like at each proficiency level (calibration material). The key distinction: a TEXTBOOK teaches the student directly; a COURSE_REFERENCE tells the tutor how to teach. If the document says "the tutor should..." or "this document is for the tutor" or describes session structure and teaching approach, it is a COURSE_REFERENCE. Examples: course reference guide, tutor methodology document, teaching approach playbook, course delivery handbook.

DISAMBIGUATION RULES (apply in order):
0. Describes HOW to teach a course: tutor behaviour rules, skills framework, session flow/phases, scaffolding techniques, teaching approach, communication guidelines, or course-level learning outcomes → COURSE_REFERENCE (not LESSON_PLAN, TEXTBOOK, or QUESTION_BANK). A COURSE_REFERENCE MAY contain learning outcomes, proficiency tier descriptions, and student response examples — these are calibration material for the tutor, not student-facing content. If the document's primary purpose is instructing the tutor on course delivery (not teaching students directly), classify as COURSE_REFERENCE.
1. Has numbered LOs/ACs/Range statements → CURRICULUM (not TEXTBOOK)
2. Pure reading text with NO questions, exercises, or answer keys — just the passage → READING_PASSAGE (not TEXTBOOK or COMPREHENSION)
3. Questions with tiered model responses (Emerging/Developing/Secure) + tutor guidance + skill mappings → QUESTION_BANK (not ASSESSMENT or COMPREHENSION)
4. Has reading passage + comprehension questions + answers IN THE SAME DOCUMENT, learner reads but doesn't fill in → COMPREHENSION (not WORKSHEET or READING_PASSAGE)
5. Has blank spaces, fill-in tables, or requires learner to write/produce content → WORKSHEET (not COMPREHENSION)
6. Has any of: mark scheme, grade boundaries, numbered exam-style questions (Q1, Q2) with marks indicated like "(2 marks)" or "[3]", answer boxes/lines for pupil responses, a cover page stating "time allowed" or "DO NOT OPEN", or is titled/identified as a past paper, mock, practice paper, SATs paper, GCSE paper, A-level paper, exam, or test → ASSESSMENT (not TEXTBOOK, not WORKSHEET). Worked examples inside an exam paper do NOT make it a TEXTBOOK.
7. Is teacher-facing with lesson timing, activities, differentiation → LESSON_PLAN (not TEXTBOOK)
8. Defines safety procedures, hazards, control measures, legal requirements → POLICY_DOCUMENT (not TEXTBOOK or REFERENCE)
9. Is flat lookup (glossary, chart, table) with no narrative → REFERENCE (not TEXTBOOK)

IMPORTANT: Look at ALL sections (start, middle, AND end) before classifying. Many teaching documents are COMPOSITE.

Return a JSON object:
{
  "documentType": "CURRICULUM" | "TEXTBOOK" | "COMPREHENSION" | "WORKSHEET" | "ASSESSMENT" | "REFERENCE" | "EXAMPLE" | "LESSON_PLAN" | "POLICY_DOCUMENT" | "READING_PASSAGE" | "QUESTION_BANK" | "COURSE_REFERENCE",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence explaining why"
}

Return ONLY valid JSON (no markdown code fences).`,
    llmConfig: { temperature: 0.1, maxTokens: 500 },
    sampleSize: 2000,
    fewShot: {
      enabled: true,
      maxExamples: 5,
      exampleSampleSize: 200,
      domainAware: true,
    },
  },
  typeOverrides: {
    CURRICULUM: {
      extraction: {
        systemPrompt: `You are extracting from a formal syllabus or curriculum document.
Map Learning Outcomes (LOs) to topics, Assessment Criteria (ACs) to key points, and Range statements to details.
Preserve all LO/AC references exactly as written (e.g., "LO2", "AC2.3").

Each assertion should capture one specific requirement, outcome, or criterion from the syllabus.
Use these categories:
- learning_outcome: A formal Learning Outcome statement (e.g., "LO2: Understand the principles of food safety")
- assessment_criterion: An Assessment Criterion under an LO (e.g., "AC2.3: Explain the importance of temperature control")
- range: A range statement or scope item (e.g., "Range: hot holding, cold storage, chilling, freezing")
- definition: A defined term from the syllabus
- rule: A regulatory or procedural requirement

Return a JSON array with: assertion, category, chapter, section, tags, examRelevance, learningOutcomeRef, validUntil, taxYear.
Return ONLY valid JSON.`,
        categories: [
          { id: "learning_outcome", label: "Learning Outcome", description: "A formal LO statement from the syllabus" },
          { id: "assessment_criterion", label: "Assessment Criterion", description: "An AC under a Learning Outcome" },
          { id: "range", label: "Range/Scope", description: "A range statement or scope item" },
          { id: "definition", label: "Term Definition", description: "A defined term from the syllabus" },
          { id: "rule", label: "Rule/Regulation", description: "A regulatory requirement" },
        ],
      },
      structuring: {
        levels: [
          { depth: 0, label: "module", maxChildren: 10, renderAs: "heading", description: "Top-level module or unit" },
          { depth: 1, label: "learning_outcome", maxChildren: 8, renderAs: "subheading", description: "Learning Outcome" },
          { depth: 2, label: "assessment_criterion", maxChildren: 6, renderAs: "bold", description: "Assessment Criterion" },
          { depth: 3, label: "range_detail", maxChildren: 8, renderAs: "bullet", description: "Range statement or detail" },
        ],
      },
    },
    WORKSHEET: {
      extraction: {
        systemPrompt: `You are extracting from a learner worksheet or activity sheet.
This document is something a learner looks at and works through during a lesson.
It may contain MULTIPLE section types: reading passages, vocabulary exercises, comprehension questions, discussion prompts, and answer keys.

Capture EACH distinct element with its appropriate category. Pay special attention to:
- Vocabulary exercises: Extract each term+definition as a pair (e.g., "to clash — to be in conflict")
- True/False questions: Extract the statement AND the correct answer (e.g., "Statement: X. Answer: False")
- Matching exercises: Extract the paired items (e.g., "Joey takes the orange → Win-lose negotiation")
- Discussion prompts: Extract the open-ended question
- Answer keys: Extract each answer linked to its question number

Categories:
- question: A general question or task for the learner
- true_false: A True/False statement with its correct answer
- matching_exercise: A matching pair (term→definition, situation→type)
- vocabulary_exercise: A vocabulary term paired with its definition
- activity: An activity or exercise instruction
- discussion_prompt: An open-ended discussion question
- information: Key teaching content or context from a reading passage
- reference: Reference data, tables, or source material
- answer_key_item: An answer from an answer key section

Return a JSON array with: assertion, category, chapter, section, tags, examRelevance, learningOutcomeRef.
For true_false items, include the correct answer in the assertion text (e.g., "Negotiating is about insisting on our point of view. [Answer: False]").
For matching items, use arrow notation (e.g., "to clash → to be in conflict").
Return ONLY valid JSON.`,
        categories: [
          { id: "question", label: "Question/Task", description: "A general question or task for the learner" },
          { id: "true_false", label: "True/False", description: "A True/False statement with correct answer" },
          { id: "matching_exercise", label: "Matching", description: "A matching pair (term→definition, situation→type)" },
          { id: "vocabulary_exercise", label: "Vocabulary", description: "A vocabulary term paired with its definition" },
          { id: "activity", label: "Activity", description: "An activity or exercise instruction" },
          { id: "discussion_prompt", label: "Discussion", description: "An open-ended discussion question" },
          { id: "information", label: "Information", description: "Key teaching content from a reading passage" },
          { id: "reference", label: "Reference Data", description: "Tables, sources, or reference material" },
          { id: "answer_key_item", label: "Answer Key", description: "An answer from an answer key section" },
        ],
        maxAssertionsPerDocument: 200,
      },
    },
    EXAMPLE: {
      extraction: {
        systemPrompt: `You are extracting from an illustrative or case-study document.
This is a source document the AI tutor will discuss WITH the learner — not teach FROM.
Capture: what the document shows, key concepts it illustrates, why it is significant,
discussion points a tutor might raise about it, and model exemplars the learner should
hear or read (e.g. a band-tier sample answer, a worked solution, a model dialogue).

Categories:
- example: A learner-facing model exemplar — a sample answer, worked solution, or model dialogue. Use this for "what good looks like" content the tutor surfaces to the learner directly.
- concept: A key concept the example illustrates
- observation: Something notable about the document
- discussion_point: A question or point a tutor would raise about this example
- context: Background context about the document

When a block carries a tier marker (e.g. "Band 7", "Band 5", "Distinction", "Pass"), include
it in tags so paired exemplars can be grouped.

Return a JSON array with: assertion, category, chapter, section, tags.
Return ONLY valid JSON.`,
        categories: [
          { id: "example", label: "Model Exemplar", description: "A learner-facing model answer or worked example" },
          { id: "concept", label: "Key Concept", description: "A concept the example illustrates" },
          { id: "observation", label: "Observation", description: "Something notable about the document" },
          { id: "discussion_point", label: "Discussion Point", description: "A point a tutor would raise" },
          { id: "context", label: "Context", description: "Background context" },
        ],
        maxAssertionsPerDocument: 50,
      },
    },
    ASSESSMENT: {
      extraction: {
        systemPrompt: `You are extracting from assessment or quiz material.
Capture each question, the correct answer(s), common misconceptions, and which Learning Outcome is being tested.

For True/False questions, extract the statement AND correct answer together.
For matching questions, extract each pair.
For multiple choice, extract the question and all options with the correct one marked.

Categories:
- question: A general assessment question
- answer: The correct answer or mark scheme point
- true_false: A True/False statement with its correct answer
- matching_item: A matching pair from a matching exercise
- misconception: A common wrong answer or misunderstanding
- fact: A factual statement used in the question context
- mark_scheme: A marking criterion or rubric point

Return a JSON array with: assertion, category, chapter, section, tags, examRelevance, learningOutcomeRef.
For true_false items, include the correct answer (e.g., "Statement: X. Answer: False").
Return ONLY valid JSON.`,
        categories: [
          { id: "question", label: "Question", description: "A general assessment question" },
          { id: "answer", label: "Correct Answer", description: "The correct answer or mark scheme point" },
          { id: "true_false", label: "True/False", description: "A True/False statement with correct answer" },
          { id: "matching_item", label: "Matching Item", description: "A matching pair from an exercise" },
          { id: "misconception", label: "Misconception", description: "A common wrong answer" },
          { id: "fact", label: "Factual Statement", description: "A fact used in question context" },
          { id: "mark_scheme", label: "Mark Scheme", description: "A marking criterion or rubric point" },
        ],
      },
    },
    REFERENCE: {
      extraction: {
        systemPrompt: `You are extracting from a reference card, glossary, or quick-reference document.
Extract terms, definitions, thresholds, key values, and rules as flat items.
No deep structuring needed — these are lookup items.

Categories:
- definition: A term definition
- threshold: A numeric limit or boundary value
- rule: A rule or regulation
- fact: A factual statement or key value

Return a JSON array with: assertion, category, tags.
Return ONLY valid JSON.`,
        maxAssertionsPerDocument: 200,
      },
      structuring: {
        levels: [
          { depth: 0, label: "topic", maxChildren: 20, renderAs: "heading", description: "Topic grouping" },
          { depth: 1, label: "term", maxChildren: 10, renderAs: "bullet", description: "Individual term or value" },
        ],
      },
    },
    COMPREHENSION: {
      extraction: {
        systemPrompt: `You are extracting from a comprehension document — a reading passage with comprehension questions, vocabulary exercises, and answer keys.
This is a teaching resource: the learner reads the passage, then answers questions to demonstrate understanding.

Extract the READING CONTENT as teaching assertions, and separately identify QUESTIONS, VOCABULARY, and ANSWERS.

Categories:
- reading_passage: A key fact or teaching point from the reading passage
- comprehension_question: A question the learner must answer about the passage
- answer: The correct answer to a comprehension question
- vocabulary_item: A vocabulary term with its definition (e.g., "to clash — to be in conflict")
- discussion_prompt: An open-ended discussion question
- matching_exercise: A matching pair (item → type/definition)
- true_false: A True/False statement with its correct answer
- key_fact: An important factual statement from the passage
- answer_key_item: An answer from an answer key section

For true_false items, include the answer: "Statement: X. [Answer: True/False]"
For vocabulary, use arrow notation: "term → definition"
For matching, use arrow notation: "item → match"

Return a JSON array with: assertion, category, chapter, section, tags, examRelevance, learningOutcomeRef.
Return ONLY valid JSON.`,
        categories: [
          { id: "reading_passage", label: "Reading Passage", description: "Key fact or teaching point from the reading" },
          { id: "comprehension_question", label: "Comprehension Question", description: "A question about the passage" },
          { id: "answer", label: "Answer", description: "The correct answer to a question" },
          { id: "vocabulary_item", label: "Vocabulary", description: "A term with its definition" },
          { id: "discussion_prompt", label: "Discussion Prompt", description: "An open-ended discussion question" },
          { id: "matching_exercise", label: "Matching Exercise", description: "A matching pair" },
          { id: "true_false", label: "True/False", description: "A True/False statement with answer" },
          { id: "key_fact", label: "Key Fact", description: "An important factual statement" },
          { id: "answer_key_item", label: "Answer Key", description: "An answer from the answer key" },
        ],
        maxAssertionsPerDocument: 300,
      },
      structuring: {
        levels: [
          { depth: 0, label: "source_group", maxChildren: 5, renderAs: "heading", description: "Top-level grouping (passage, questions, vocab)" },
          { depth: 1, label: "passage_section", maxChildren: 8, renderAs: "subheading", description: "Section within reading or question set" },
          { depth: 2, label: "teaching_point", maxChildren: 6, renderAs: "bold", description: "Individual teaching point or question" },
          { depth: 3, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Supporting detail or answer" },
        ],
      },
    },
    LESSON_PLAN: {
      extraction: {
        systemPrompt: `You are extracting from a teacher's lesson plan.
Capture objectives, activities, timing, resources, differentiation strategies, and assessment opportunities.

Categories:
- objective: A lesson objective or learning aim
- activity: A teaching activity or task description
- timing: A time allocation for an activity or phase
- resource: A resource needed for the lesson
- differentiation: A differentiation or extension strategy
- assessment_opportunity: How learning will be assessed during the lesson
- plenary: A plenary or wrap-up activity
- starter: A starter or warm-up activity

Return a JSON array with: assertion, category, chapter, section, tags, learningOutcomeRef.
Return ONLY valid JSON.`,
        categories: [
          { id: "objective", label: "Objective", description: "A lesson objective or learning aim" },
          { id: "activity", label: "Activity", description: "A teaching activity or task" },
          { id: "timing", label: "Timing", description: "Time allocation for an activity" },
          { id: "resource", label: "Resource", description: "A resource needed" },
          { id: "differentiation", label: "Differentiation", description: "A differentiation strategy" },
          { id: "assessment_opportunity", label: "Assessment", description: "How learning is assessed" },
          { id: "plenary", label: "Plenary", description: "Wrap-up activity" },
          { id: "starter", label: "Starter", description: "Warm-up activity" },
        ],
        maxAssertionsPerDocument: 100,
      },
      structuring: {
        levels: [
          { depth: 0, label: "phase", maxChildren: 6, renderAs: "heading", description: "Lesson phase (starter, main, plenary)" },
          { depth: 1, label: "activity", maxChildren: 5, renderAs: "bold", description: "Individual activity" },
          { depth: 2, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Activity detail or resource" },
        ],
      },
    },
    POLICY_DOCUMENT: {
      extraction: {
        systemPrompt: `You are extracting from a regulatory, compliance, or safety procedure document.
These documents define required practices, hazards, control measures, and legal requirements.

Categories:
- safety_point: A safety requirement or best practice
- procedure: A procedural step or process requirement
- legal_requirement: A legal or regulatory requirement
- hazard: A hazard or risk that must be managed
- control_measure: A control measure or preventive action
- record_requirement: A record-keeping or documentation requirement
- corrective_action: A corrective action for non-compliance
- key_fact: An important factual statement

Return a JSON array with: assertion, category, chapter, section, tags, examRelevance, learningOutcomeRef.
Return ONLY valid JSON.`,
        categories: [
          { id: "safety_point", label: "Safety Point", description: "A safety requirement or best practice" },
          { id: "procedure", label: "Procedure", description: "A procedural step" },
          { id: "legal_requirement", label: "Legal Requirement", description: "A legal or regulatory requirement" },
          { id: "hazard", label: "Hazard", description: "A hazard or risk" },
          { id: "control_measure", label: "Control Measure", description: "A preventive action" },
          { id: "record_requirement", label: "Record Requirement", description: "A documentation requirement" },
          { id: "corrective_action", label: "Corrective Action", description: "Action for non-compliance" },
          { id: "key_fact", label: "Key Fact", description: "An important factual statement" },
        ],
        maxAssertionsPerDocument: 300,
      },
      structuring: {
        levels: [
          { depth: 0, label: "topic", maxChildren: 10, renderAs: "heading", description: "Major topic area" },
          { depth: 1, label: "safety_point", maxChildren: 6, renderAs: "bold", description: "Individual safety point or requirement" },
          { depth: 2, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Supporting detail or measure" },
        ],
      },
    },
    READING_PASSAGE: {
      extraction: {
        systemPrompt: `You are extracting from a standalone reading passage — a text the learner reads before or during a tutoring session.
This is literary or informational prose. There are no questions. Your job is to extract the content that a tutor would discuss with the learner.

Categories:
- key_event: A major plot event, turning point, or factual point in the passage
- character: A character introduction, description, or significant action
- vocabulary_highlight: A word or phrase that is rich for vocabulary-in-context discussion (challenging, unusual, or deliberately chosen by the writer)
- language_feature: A notable use of language — metaphor, simile, personification, imagery, alliteration, atmosphere, tone shift
- theme: A theme, idea, or message the passage explores or implies
- key_quote: A significant quote worth close reading or discussion (include the exact text)
- setting: A place, time, or atmosphere detail that matters to the passage

IMPORTANT:
- Extract vocabulary_highlight items that a tutor would ask "What do you think this word means here?"
- Extract language_feature items that a tutor would ask "Why did the writer describe it this way?"
- For key_quote, include the EXACT text from the passage in quotation marks
- Capture the passage's emotional arc or atmosphere shifts
- Do NOT invent content not present in the source text
- Return ONLY valid JSON`,
        categories: [
          { id: "key_event", label: "Key Event", description: "A major plot event or factual point" },
          { id: "character", label: "Character", description: "A character introduction or significant action" },
          { id: "vocabulary_highlight", label: "Vocabulary", description: "A word/phrase rich for vocabulary discussion" },
          { id: "language_feature", label: "Language Feature", description: "Notable language use (metaphor, imagery, etc.)" },
          { id: "theme", label: "Theme", description: "A theme or idea the passage explores" },
          { id: "key_quote", label: "Key Quote", description: "A significant quote for close reading" },
          { id: "setting", label: "Setting", description: "Place, time, or atmosphere detail" },
        ],
        maxAssertionsPerDocument: 100,
      },
      structuring: {
        levels: [
          { depth: 0, label: "passage", maxChildren: 1, renderAs: "paragraph", description: "Passage overview and context" },
          { depth: 1, label: "section", maxChildren: 5, renderAs: "heading", description: "Major section or scene" },
          { depth: 2, label: "teaching_point", maxChildren: 6, renderAs: "bold", description: "Individual teaching point" },
          { depth: 3, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Supporting detail or quote" },
        ],
      },
    },
    QUESTION_BANK: {
      extraction: {
        systemPrompt: `You are extracting from a tutor question bank — a teaching reference document with skill-mapped questions and tiered model responses.
This is NOT a learner-facing test. It is a structured guide for an AI tutor, containing:
- Questions organized by comprehension/teaching skill
- Model responses at multiple proficiency tiers (e.g., Emerging, Developing, Secure)
- Suggested tutor moves (what to say/do next) at each tier
- Assessment notes explaining what the question tests
- Text references pointing to specific parts of the reading passage

Categories:
- session_metadata: Session-level information (recommended sequence, objective, passage metadata)
- skill_description: A description of a skill being assessed (e.g., "Retrieval: Locating explicit information...")
- tutor_question: A question the tutor asks, with its full tiered response structure (this is the primary output)
- assessment_guidance: General assessment notes or teaching guidance

For tutor_question items, the assertion text should be the question itself.
Tag each tutor_question with the skill it targets (e.g., "retrieval", "inference", "vocabulary", "language-effect").

Return a JSON array with: assertion, category, chapter (= skill name), section (= question number like "1.1"), tags, learningOutcomeRef.
Return ONLY valid JSON.`,
        categories: [
          { id: "session_metadata", label: "Session Metadata", description: "Session info, recommended sequence, passage metadata" },
          { id: "skill_description", label: "Skill Description", description: "Description of a comprehension skill" },
          { id: "tutor_question", label: "Tutor Question", description: "A skill-mapped question with tiered responses" },
          { id: "assessment_guidance", label: "Assessment Guidance", description: "General assessment or teaching guidance" },
        ],
        maxAssertionsPerDocument: 200,
        // Tighter chunk size for QB docs: each tutor_question expands into question +
        // tiered model responses + tutor moves + assessment guidance — output JSON is
        // the densest of any documentType. The 8000-char default causes max_tokens
        // truncation on banks larger than ~15KB (e.g. IELTS Part 2 cue-card banks).
        chunkSize: 4000,
      },
      structuring: {
        levels: [
          { depth: 0, label: "skill_group", maxChildren: 10, renderAs: "heading", description: "Comprehension skill (Retrieval, Inference, etc.)" },
          { depth: 1, label: "question", maxChildren: 5, renderAs: "bold", description: "Individual question with tiered responses" },
          { depth: 2, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Model response or assessment note" },
        ],
      },
    },
    COURSE_REFERENCE: {
      extraction: {
        systemPrompt: `You are extracting from a course reference document that may contain BOTH tutor instructions AND student-facing content.

Extract EVERY distinct assertion. Classify each into the correct category based on whether it instructs the TUTOR or teaches the STUDENT.

INSTRUCTION categories (for tutor-directed rules — how to teach):
- teaching_rule: A rule or principle the tutor must follow (e.g., "Never grade or score during the session")
- session_flow: A session structure element — phase, timing, transition (e.g., "Start with a 2-min warm-up review")
- session_override: A session-scoped override that REPLACES the default onboarding/flow for a specific call number. Look for headings/markers like "**Session scope:** 1" or "First Call" — the section number becomes the call number the override applies to.
- scaffolding_technique: A specific scaffolding or teaching technique (e.g., "Use graduated prompts: open → guided → direct")
- skill_framework: A skill or proficiency tier from a skills framework (e.g., "Retrieval: Locating explicit information — Emerging/Developing/Secure")
- communication_rule: A communication or tone guideline (e.g., "Use encouraging language", "Never say 'wrong'")
- assessment_approach: How to assess or measure learner progress (e.g., "Observe comprehension through retelling accuracy")
- differentiation: An adaptation or differentiation strategy (e.g., "For struggling readers, provide sentence starters")
- edge_case: How to handle an edge case or difficult situation (e.g., "If learner becomes frustrated, switch to a lighter activity")

CONTENT categories (for student-facing material — what to teach):
- fact: A specific factual statement the student should learn
- definition: A term definition
- threshold: A numeric limit or boundary
- rule: A subject-matter rule (not a tutor behaviour rule)
- process: A step in a procedure
- example: An illustrative example

CLASSIFICATION GUIDE:
- "Never grade during the session" → teaching_rule (instructs the tutor)
- "Photosynthesis converts light energy into chemical energy" → fact (teaches the student)
- "Use scaffolding before giving answers" → scaffolding_technique (instructs the tutor)
- "Retrieval: Locating explicit information — Emerging/Developing/Secure" → skill_framework (tutor calibration)
- "The boiling point of water is 100°C" → fact (teaches the student)

Preserve the directive/imperative tone for tutor instructions. Be precise with facts and figures for content.
Extract the WHY when given (e.g., "Use open questions to encourage higher-order thinking").
Return ONLY valid JSON.`,
        categories: [
          // Instruction categories (how to teach)
          { id: "teaching_rule", label: "Teaching Rule", description: "A rule or principle the tutor must follow" },
          { id: "session_flow", label: "Session Flow", description: "A session structure element — phase, timing, transition" },
          { id: "session_override", label: "Session Override", description: "A call-number-scoped override that REPLACES default onboarding/flow phases (e.g. **Session scope:** 1)" },
          { id: "scaffolding_technique", label: "Scaffolding Technique", description: "A specific teaching or scaffolding technique" },
          { id: "skill_framework", label: "Skill/Proficiency", description: "A skill or proficiency tier from a skills framework" },
          { id: "communication_rule", label: "Communication Rule", description: "A communication or tone guideline" },
          { id: "assessment_approach", label: "Assessment Approach", description: "How to assess learner progress" },
          { id: "differentiation", label: "Differentiation", description: "An adaptation or differentiation strategy" },
          { id: "edge_case", label: "Edge Case", description: "How to handle a difficult or edge-case situation" },
          // Content categories (what to teach — for mixed documents)
          { id: "fact", label: "Factual Statement", description: "A specific factual statement (student content)" },
          { id: "definition", label: "Term Definition", description: "A term definition (student content)" },
          { id: "threshold", label: "Threshold/Limit", description: "A numeric limit or boundary (student content)" },
          { id: "rule", label: "Subject Rule", description: "A subject-matter rule — not a tutor behaviour rule (student content)" },
          { id: "process", label: "Process Step", description: "A step in a procedure (student content)" },
          { id: "example", label: "Example/Scenario", description: "An illustrative example (student content)" },
        ],
        maxAssertionsPerDocument: 200,
        // Tighter chunk size for COURSE_REFERENCE docs: INSTRUCTION_CATEGORIES
        // extraction is dense — every teaching rule / session flow / scaffolding
        // technique produces a verbose assertion with rationale and tags. The
        // 8000-char default causes max_tokens truncation on course-refs ≥ ~25KB
        // (seen with the IELTS Speaking course-ref).
        chunkSize: 6000,
      },
      structuring: {
        levels: [
          { depth: 0, label: "domain", maxChildren: 6, renderAs: "heading", description: "Major instruction domain (session flow, communication, assessment)" },
          { depth: 1, label: "rule_group", maxChildren: 5, renderAs: "bold", description: "Group of related rules or techniques" },
          { depth: 2, label: "instruction", maxChildren: 4, renderAs: "bullet", description: "Individual instruction or technique" },
        ],
      },
    },
  },
};

// ------------------------------------------------------------------
// Deep merge utility
// ------------------------------------------------------------------

/**
 * Deep-merge two objects. Override values win; arrays are replaced (not concatenated).
 */
export function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideVal = override[key];
    const baseVal = base[key];

    if (overrideVal === undefined) continue;

    if (
      overrideVal !== null &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      // Recurse for nested objects
      result[key] = deepMerge(baseVal as any, overrideVal as any);
    } else {
      // Direct replacement (including arrays)
      result[key] = overrideVal as T[keyof T];
    }
  }

  return result;
}

// ------------------------------------------------------------------
// Meta Prompts — DB-overridable system prompts
// ------------------------------------------------------------------

/**
 * Load DEFAULT_CONFIG with DB-overridable prompt texts.
 * Cascade: Meta Prompts (SystemSettings) > hardcoded defaults in DEFAULT_CONFIG.
 * Spec-level overrides still win (applied later in resolution chain).
 */
async function resolveDefaultConfigWithPrompts(): Promise<ExtractionConfig> {
  const [extraction, structuring, classification] = await Promise.all([
    getPromptTemplate("content-extraction"),
    getPromptTemplate("content-structuring"),
    getPromptTemplate("content-classification"),
  ]);
  return {
    ...DEFAULT_CONFIG,
    extraction: { ...DEFAULT_CONFIG.extraction, systemPrompt: extraction },
    structuring: { ...DEFAULT_CONFIG.structuring, systemPrompt: structuring },
    classification: { ...DEFAULT_CONFIG.classification, systemPrompt: classification },
  };
}

// ------------------------------------------------------------------
// Config resolution
// ------------------------------------------------------------------

/**
 * Resolve extraction config for a content source.
 *
 * Resolution chain:
 * 1. Load system spec (CONTENT-EXTRACT-001)
 * 2. Find domain via: ContentSource → SubjectSource → Subject → SubjectDomain → Domain
 * 3. Find domain-level EXTRACT spec override (if any)
 * 4. Deep-merge: domain override wins where specified
 * 5. Apply document-type-specific overrides (if documentType provided)
 */
export async function resolveExtractionConfig(
  sourceId?: string,
  documentType?: DocumentType,
  interactionPattern?: InteractionPattern,
  subjectDiscipline?: string,
  subjectName?: string,
): Promise<ExtractionConfig> {
  // 0. Load defaults with DB-overridable prompts
  const baseConfig = await resolveDefaultConfigWithPrompts();

  // 1. Load system spec
  const systemSpec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: config.specs.contentExtract.toLowerCase() },
      specRole: "EXTRACT",
      scope: "SYSTEM",
    },
    select: { config: true },
  });

  const systemConfig = systemSpec?.config as Record<string, any> | null;
  let resolved = systemConfig
    ? deepMerge(baseConfig, systemConfig as Partial<ExtractionConfig>)
    : baseConfig;

  // 2. If we have a sourceId, find the domain and check for overrides
  if (sourceId) {
    const domainOverride = await findDomainOverrideConfig(sourceId);
    if (domainOverride) {
      resolved = deepMerge(resolved, domainOverride as Partial<ExtractionConfig>);
    }
  }

  // 3. Apply document-type-specific overrides
  resolved = applyTypeOverrides(resolved, documentType);

  // 3.5 Apply subject-discipline preamble (sits below pattern preamble in final prompt)
  const discipline = inferSubjectDiscipline(subjectDiscipline, subjectName);
  resolved = applySubjectPreamble(resolved, discipline);

  // 4. Apply interaction pattern overrides (most specific — prepends extraction preamble, outermost)
  resolved = applyPatternOverrides(resolved, interactionPattern);

  return resolved;
}

/**
 * Resolve extraction config for a specific domain (by domainId).
 * Used by the domain config UI.
 */
export async function resolveExtractionConfigForDomain(
  domainId: string,
  documentType?: DocumentType,
): Promise<ExtractionConfig> {
  // 0. Load defaults with DB-overridable prompts
  const baseConfig = await resolveDefaultConfigWithPrompts();

  // 1. Load system spec
  const systemSpec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: config.specs.contentExtract.toLowerCase() },
      specRole: "EXTRACT",
      scope: "SYSTEM",
    },
    select: { config: true },
  });

  const systemConfig = systemSpec?.config as Record<string, any> | null;
  let resolved = systemConfig
    ? deepMerge(baseConfig, systemConfig as Partial<ExtractionConfig>)
    : baseConfig;

  // 2. Find domain-level override
  const domainSpec = await findDomainExtractSpec(domainId);
  if (domainSpec) {
    resolved = deepMerge(resolved, domainSpec as Partial<ExtractionConfig>);
  }

  // 3. Apply document-type-specific overrides
  resolved = applyTypeOverrides(resolved, documentType);

  return resolved;
}

/**
 * Apply document-type-specific overrides to a resolved config.
 * Type overrides are the last merge step — they override both system and domain configs.
 */
function applyTypeOverrides(
  resolved: ExtractionConfig,
  documentType?: DocumentType,
): ExtractionConfig {
  if (!documentType || documentType === "TEXTBOOK") return resolved;

  const typeOverride = resolved.typeOverrides?.[documentType];
  if (!typeOverride) return resolved;

  let result = resolved;
  if (typeOverride.extraction) {
    result = deepMerge(result, { extraction: typeOverride.extraction } as Partial<ExtractionConfig>);
  }
  if (typeOverride.structuring) {
    result = deepMerge(result, { structuring: typeOverride.structuring } as Partial<ExtractionConfig>);
  }
  if (typeOverride.rendering) {
    result = deepMerge(result, { rendering: typeOverride.rendering } as Partial<ExtractionConfig>);
  }
  return result;
}

/**
 * Find domain override config by following the source → subject → domain chain.
 */
async function findDomainOverrideConfig(sourceId: string): Promise<Record<string, any> | null> {
  // Find the domain(s) this source belongs to via Subject → SubjectDomain
  const subjectSources = await prisma.subjectSource.findMany({
    where: { sourceId },
    select: {
      subject: {
        select: {
          domains: {
            select: { domainId: true },
            take: 1,
          },
        },
      },
    },
    take: 1,
  });

  const domainId = subjectSources[0]?.subject?.domains?.[0]?.domainId;
  if (!domainId) return null;

  return findDomainExtractSpec(domainId);
}

/**
 * Find a domain-level EXTRACT spec override for a specific domain.
 */
async function findDomainExtractSpec(domainId: string): Promise<Record<string, any> | null> {
  // Find a domain-scoped EXTRACT override across all published playbooks in
  // the domain. When multiple playbooks have a matching spec, picks the first
  // deterministically (oldest by createdAt) and warns so config drift between
  // courses is visible in logs rather than silently masked.
  const candidates = await prisma.playbook.findMany({
    where: {
      domainId,
      status: "PUBLISHED",
      items: {
        some: {
          itemType: "SPEC",
          spec: {
            specRole: "EXTRACT",
            scope: "DOMAIN",
            domain: "content-trust",
            isActive: true,
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      items: {
        where: {
          itemType: "SPEC",
          spec: {
            specRole: "EXTRACT",
            scope: "DOMAIN",
            domain: "content-trust",
            isActive: true,
          },
        },
        select: {
          spec: {
            select: { config: true },
          },
        },
        take: 1,
      },
    },
  });

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    console.warn(
      `[resolve-config] Domain ${domainId} has ${candidates.length} published playbooks with content-trust EXTRACT overrides — using oldest ("${candidates[0].name}"). If they differ, extraction may be inconsistent across courses.`,
    );
  }

  const specConfig = candidates[0]?.items?.[0]?.spec?.config as Record<string, any> | null;
  return specConfig || null;
}

/**
 * Get the max depth (leaf level) from the pyramid levels config.
 */
export function getMaxDepth(extractionConfig: ExtractionConfig): number {
  const levels = extractionConfig.structuring.levels;
  if (levels.length === 0) return 0;
  return Math.max(...levels.map((l) => l.depth));
}

/**
 * Get the leaf level label from the pyramid levels config.
 */
export function getLeafLabel(extractionConfig: ExtractionConfig): string {
  const levels = extractionConfig.structuring.levels;
  if (levels.length === 0) return "detail";
  return levels[levels.length - 1].label;
}

// ── Communication Style ───────────────────────────────────────────────────────

/**
 * WHO the AI is — the personality archetype set at Domain level.
 * Maps to Identity Spec slugs: TUT-001, COACH-001, COMPANION-001,
 * GUIDE-001, MENTOR-001, FACILITATOR-001, ADVISOR-001.
 */
export type CommunicationStyle =
  | "tutor" | "coach" | "companion"
  | "guide" | "mentor" | "facilitator" | "advisor";

export const COMMUNICATION_STYLE_LABELS: Record<CommunicationStyle, { label: string; icon: string; description: string }> = {
  tutor:       { label: "Tutor",       icon: "🧑‍🏫", description: "Patient, Socratic, scaffolded — schools and tutoring" },
  coach:       { label: "Coach",       icon: "🏆",   description: "Goal-driven, accountability — corporate and exec dev" },
  companion:   { label: "Companion",   icon: "💙",   description: "Warm peer, no pressure — wellbeing and elder care" },
  guide:       { label: "Guide",       icon: "🗺️",   description: "Calm navigator, informational — healthcare and govt" },
  mentor:      { label: "Mentor",      icon: "🌟",   description: "Wise counsellor, reflective — youth and leadership" },
  facilitator: { label: "Facilitator", icon: "🤝",   description: "Group enabler, process authority — communities" },
  advisor:     { label: "Advisor",     icon: "📋",   description: "Clinical expert, evidence-based — finance and legal" },
};

export const COMMUNICATION_STYLE_ORDER: CommunicationStyle[] = [
  "tutor", "coach", "companion", "guide", "mentor", "facilitator", "advisor",
];

// ── Interaction Pattern ───────────────────────────────────────────────────────

/**
 * WHAT the session does — the communication style set at Playbook level.
 * Drives extraction emphasis (what gets pulled from content) and session flow.
 * Stored in Playbook.config.interactionPattern.
 */
export type InteractionPattern =
  | "socratic" | "directive" | "advisory" | "coaching"
  | "companion" | "facilitation" | "reflective" | "open"
  | "conversational-guide";

export const INTERACTION_PATTERN_LABELS: Record<InteractionPattern, { label: string; icon: string; description: string; examples: string }> = {
  socratic:    { label: "Socratic",     icon: "🔍", description: "Question → reflect → discover",         examples: "Philosophy, critical thinking, Socratic seminars" },
  directive:   { label: "Directive",    icon: "📢", description: "Tell → check → reinforce",              examples: "Lessons, tutorials, onboarding, instruction" },
  advisory:    { label: "Advisory",     icon: "⚖️", description: "Fact → cite → scope limit",            examples: "Legal, medical, financial, compliance" },
  coaching:    { label: "Coaching",     icon: "🎯", description: "Goal → action → accountability",        examples: "Career, leadership, performance coaching" },
  companion:   { label: "Companion",    icon: "💙", description: "Listen → empathise → presence",         examples: "Wellbeing, support, check-ins, counselling" },
  facilitation:{ label: "Facilitation", icon: "🗺️", description: "Coordinate → suggest → organise",      examples: "Groups, projects, decision-making, workshops" },
  reflective:  { label: "Reflective",   icon: "🪞", description: "Share → explore → meaning-making",     examples: "Journaling, supervision, personal development" },
  open:        { label: "Open",         icon: "✨", description: "Follow wherever the caller leads",       examples: "Creative, exploratory, research, open dialogue" },
  "conversational-guide": { label: "Conversational Guide", icon: "💬", description: "Guided 1:1 topic conversations", examples: "Community hubs, book clubs, discussion groups, topic circles" },
};

export const INTERACTION_PATTERN_ORDER: InteractionPattern[] = [
  "socratic", "directive", "advisory", "coaching",
  "companion", "facilitation", "reflective", "open",
  "conversational-guide",
];

// ── Intent Pattern Overrides ──────────────────────────────────────────────────

export interface IntentPatternOverride {
  intentPreamble: string;
  supplementaryCategories?: ExtractionCategory[];
}

export const INTENT_PATTERN_OVERRIDES: Record<InteractionPattern, IntentPatternOverride> = {
  socratic: {
    intentPreamble: `INTERACTION PATTERN: SOCRATIC
The session uses questions to provoke reflection and discovery. Prioritise:
- Open questions and dilemmas that have no single answer
- Tensions, paradoxes, and competing perspectives
- Claims that invite challenge ("Is this always true?")
- Discussion starters and thought experiments
Avoid extracting bare facts — prioritise content that can provoke thinking.`,
    supplementaryCategories: [
      { id: "dilemma",          label: "Dilemma",          description: "A situation with no clear right answer" },
      { id: "discussion_prompt", label: "Discussion prompt", description: "An open question worth exploring" },
    ],
  },
  directive: {
    intentPreamble: `INTERACTION PATTERN: DIRECTIVE
The session delivers knowledge and checks understanding. Prioritise:
- Core concepts with clear definitions
- Rules, procedures, and steps in order
- Common misconceptions to correct
- Check-questions to verify understanding
Extract items that can be stated, demonstrated, and confirmed.`,
    supplementaryCategories: [
      { id: "misconception", label: "Misconception", description: "A common misunderstanding to address" },
    ],
  },
  advisory: {
    intentPreamble: `INTERACTION PATTERN: ADVISORY
The session gives authoritative guidance within defined scope limits. Prioritise:
- Statements of fact with citations or sources
- Scope conditions ("this applies when...", "this does not apply if...")
- Red lines and caveats
- Recommended actions with rationale
Extract authoritative, citable content. Flag scope limits explicitly.`,
    supplementaryCategories: [
      { id: "caveat",   label: "Caveat",   description: "A limit or condition on when advice applies" },
      { id: "citation", label: "Citation", description: "A reference or source to cite" },
    ],
  },
  coaching: {
    intentPreamble: `INTERACTION PATTERN: COACHING
The session focuses on goals, actions, and accountability. Prioritise:
- Goal-framing questions ("What do you want to achieve?")
- Action steps and commitments
- Obstacles and how to overcome them
- Reflection questions for progress review
Extract content that supports goal-setting, planning, and follow-through.`,
    supplementaryCategories: [
      { id: "action_step",         label: "Action step",         description: "A concrete next step a person can take" },
      { id: "reflection_question", label: "Reflection question", description: "A question to support self-review" },
    ],
  },
  companion: {
    intentPreamble: `INTERACTION PATTERN: COMPANION
The session holds space, listens, and validates without agenda. Prioritise:
- Common experiences and emotions to normalise
- Validation statements ("It makes sense that...")
- Gentle prompts for elaboration
- Resources or signposting (if appropriate)
Avoid directive or factual content — prioritise emotional attunement.`,
    supplementaryCategories: [
      { id: "normalising_statement", label: "Normalising statement", description: "A statement that validates a common experience" },
    ],
  },
  facilitation: {
    intentPreamble: `INTERACTION PATTERN: FACILITATION
The session coordinates people, surfaces options, and organises next steps. Prioritise:
- Decision frameworks and structured options
- Process steps and agendas
- Roles and responsibilities
- Questions to surface perspectives ("What does the group think?")
Extract content that supports organising, choosing, and coordinating.`,
    supplementaryCategories: [
      { id: "decision_framework", label: "Decision framework", description: "A model or structure for making a choice" },
    ],
  },
  reflective: {
    intentPreamble: `INTERACTION PATTERN: REFLECTIVE
The session explores personal meaning and deeper understanding. Prioritise:
- Narrative hooks and story prompts
- Questions about significance ("What did that mean to you?")
- Multiple interpretations of the same event
- Themes and patterns across experiences
Extract content that invites personal exploration rather than factual recall.`,
    supplementaryCategories: [
      { id: "narrative_prompt", label: "Narrative prompt", description: "A prompt that invites storytelling or reflection" },
    ],
  },
  open: {
    intentPreamble: `INTERACTION PATTERN: OPEN
The session follows wherever the caller leads — no fixed agenda. Extract broadly:
- All categories with equal weight
- Diverse content types (facts, questions, stories, frameworks)
- Anything that might be relevant to an unpredictable conversation
Prioritise breadth over depth.`,
  },
  "conversational-guide": {
    intentPreamble: `INTERACTION PATTERN: CONVERSATIONAL GUIDE
The session is a guided 1:1 conversation around topic areas. Prioritise:
- Topic-relevant talking points and conversation starters
- Key facts and context to keep conversation grounded
- Open questions that invite exploration without instruction
- Connections between topics the caller might find interesting
No curriculum, no assessment, no homework. Extract content that fuels natural conversation.`,
    supplementaryCategories: [
      { id: "talking_point",        label: "Talking point",        description: "A point to bring up in natural conversation" },
      { id: "conversation_starter", label: "Conversation starter", description: "An opening question or prompt for a topic" },
    ],
  },
};

/**
 * Apply interaction pattern overrides to an extraction config.
 * Prepends the intent preamble to the system prompt and appends supplementary categories.
 * Pattern overrides run after type overrides — most specific wins.
 */
export function applyPatternOverrides(
  resolved: ExtractionConfig,
  pattern?: InteractionPattern,
): ExtractionConfig {
  if (!pattern) return resolved;
  const override = INTENT_PATTERN_OVERRIDES[pattern];
  if (!override) return resolved;

  const updatedPrompt = override.intentPreamble
    ? `${override.intentPreamble}\n\n${resolved.extraction.systemPrompt}`
    : resolved.extraction.systemPrompt;

  const existingIds = new Set(resolved.extraction.categories.map(c => c.id));
  const newCats = (override.supplementaryCategories ?? []).filter(c => !existingIds.has(c.id));

  return {
    ...resolved,
    extraction: {
      ...resolved.extraction,
      systemPrompt: updatedPrompt,
      categories: [...resolved.extraction.categories, ...newCats],
    },
  };
}

// ── Pattern Keyword Suggestion ────────────────────────────────────────────────

// Sorted longest-match-first so multi-word keys match before substrings
const PATTERN_KEYWORD_ENTRIES: Array<[string, InteractionPattern]> = [
  // socratic (questioning, reflective-inquiry)
  ["critical thinking", "socratic"],
  ["philosoph",         "socratic"],
  ["ethics",            "socratic"],
  ["debate",            "socratic"],
  ["seminar",           "socratic"],
  // directive (tell, check, reinforce)
  ["onboard",     "directive"],
  ["instruction", "directive"],
  ["tutorial",    "directive"],
  ["training",    "directive"],
  ["lesson",      "directive"],
  ["teach",       "directive"],
  // advisory (authoritative, scoped)
  ["regulation",  "advisory"],
  ["compliance",  "advisory"],
  ["financial",   "advisory"],
  ["medical",     "advisory"],
  ["legal",       "advisory"],
  ["advice",      "advisory"],
  // coaching (goals, actions)
  ["personal development", "coaching"],
  ["leadership",           "coaching"],
  ["performance",          "coaching"],
  ["career",               "coaching"],
  ["goal",                 "coaching"],
  ["coach",                "coaching"],
  // companion (presence, emotional)
  ["mental health", "companion"],
  ["wellbeing",     "companion"],
  ["well-being",    "companion"],
  ["counsel",       "companion"],
  ["check-in",      "companion"],
  ["support",       "companion"],
  // facilitation (groups, organising)
  ["facilitat",  "facilitation"],
  ["workshop",   "facilitation"],
  ["project",    "facilitation"],
  ["decision",   "facilitation"],
  ["group",      "facilitation"],
  // reflective (meaning-making)
  ["supervision",          "reflective"],
  ["personal development", "reflective"],
  ["reflect",              "reflective"],
  ["journal",              "reflective"],
  // conversational-guide (community hubs, topic groups)
  ["book club",           "conversational-guide"],
  ["discussion group",    "conversational-guide"],
  ["community hub",       "conversational-guide"],
  ["topic circle",        "conversational-guide"],
  ["conversation group",  "conversational-guide"],
  // open — no keywords (manual fallback choice)
].sort((a, b) => b[0].length - a[0].length) as Array<[string, InteractionPattern]>;

/**
 * Suggest an InteractionPattern from a course name using keyword matching.
 * Returns null if no keyword matches.
 */
export function suggestInteractionPattern(courseName: string): InteractionPattern | null {
  if (!courseName || courseName.trim().length < 3) return null;
  const lower = courseName.toLowerCase();
  for (const [keyword, pattern] of PATTERN_KEYWORD_ENTRIES) {
    if (lower.includes(keyword)) return pattern;
  }
  return null;
}

// ── Teaching Mode ────────────────────────────────────────────────────────────

/**
 * Content emphasis for a course. Drives extraction weights (intentCategoryWeights),
 * teachMethod assignment (categoryToTeachMethod), and pedagogy-mode prompt.
 * Stored in Playbook.config.teachingMode.
 * Orthogonal to InteractionPattern (WHAT emphasis vs HOW to interact).
 */
export type TeachingMode = "recall" | "comprehension" | "practice" | "syllabus";

export const TEACHING_MODE_LABELS: Record<
  TeachingMode,
  { label: string; icon: string; description: string; examples: string }
> = {
  recall: {
    label: "Learn and remember facts",
    icon: "📚",
    description: "Quizzes, flashcard-style checks, key facts",
    examples: "History · Biology · Geography",
  },
  comprehension: {
    label: "Read, analyse & discuss",
    icon: "📖",
    description: "Passages, analysis questions, discussion",
    examples: "English · French · Literature",
  },
  practice: {
    label: "Work through problems",
    icon: "✏️",
    description: "Worked examples, exercises, step-by-step",
    examples: "Maths · Physics · Accounting",
  },
  syllabus: {
    label: "Cover the syllabus",
    icon: "📋",
    description: "Structured coverage, checklists, milestones",
    examples: "Food Safety · BTEC · Apprenticeships",
  },
};

export const TEACHING_MODE_ORDER: TeachingMode[] = [
  "recall",
  "comprehension",
  "practice",
  "syllabus",
];

// ── Subject Discipline Preambles ─────────────────────────────────────────────

/**
 * Per-discipline preamble prepended to the extraction system prompt.
 * Redirects the LLM's focus away from the finance-flavoured DEFAULT_CONFIG.
 * Keyed by lowercase discipline name.
 */
const SUBJECT_PREAMBLES: Record<string, string> = {
  history:   "SUBJECT: HISTORY. Prioritise dates, periods, events, key people, causes, consequences, and historiographical significance. 'threshold' means a date-range, NOT a financial limit. Omit tax years and currency values.",
  english:   "SUBJECT: ENGLISH / LITERACY. Prioritise vocabulary, themes, language techniques, character analysis, textual evidence, and literary devices. Mark examRelevance high for essay-worthy quotations and key passages.",
  maths:     "SUBJECT: MATHEMATICS. Prioritise formulas, theorems, worked procedures, and problem types. Map steps → 'process', theorems → 'rule', formulas → 'fact'. Omit currency thresholds and financial figures.",
  science:   "SUBJECT: SCIENCE. Prioritise scientific concepts, terminology, hypotheses, lab procedures, and observations. State units precisely in every assertion that involves measurement.",
  geography: "SUBJECT: GEOGRAPHY. Prioritise physical and human processes, case studies, location-specific facts, and statistics. Tag named case studies as 'example'.",
  computing: "SUBJECT: COMPUTING / ICT. Prioritise algorithms, data structures, system concepts, and programming patterns. Mark code fragments or pseudocode as 'process'.",
  business:  "SUBJECT: BUSINESS STUDIES. Prioritise business concepts, models, financial ratios, strategic frameworks, and case studies.",
  pshe:      "SUBJECT: PSHE / WELLBEING. Prefer 'discussion_prompt' and 'example' over bare factual assertions. Focus on attitudes, skills, and scenario-based content.",
  finance:   "SUBJECT: FINANCIAL SERVICES. Focus on regulatory thresholds, product rules, tax years, compliance requirements, and suitability criteria — the default extraction domain.",
};

/**
 * Infer the academic discipline from explicit discipline string or subject name.
 * Returns the SUBJECT_PREAMBLES key (e.g. "history") or null if unrecognised.
 */
export function inferSubjectDiscipline(subjectDiscipline?: string, subjectName?: string): string | null {
  const candidates = [subjectDiscipline, subjectName].filter(Boolean) as string[];
  // Sort keys longest-first so "computing" matches before "com", etc.
  const keys = Object.keys(SUBJECT_PREAMBLES).sort((a, b) => b.length - a.length);
  for (const s of candidates) {
    for (const key of keys) {
      // Word-boundary match: "biochemistry" should NOT match "chemistry"
      const re = new RegExp(`\\b${key}\\b`, "i");
      if (re.test(s)) return key;
    }
  }
  return null;
}

/**
 * Prepend a subject-specific preamble to the extraction system prompt.
 * Applied after type overrides, before pattern overrides — so the pattern preamble
 * (most urgent instruction) ends up outermost.
 */
export function applySubjectPreamble(
  resolved: ExtractionConfig,
  discipline: string | null,
): ExtractionConfig {
  if (!discipline) return resolved;
  const preamble = SUBJECT_PREAMBLES[discipline];
  if (!preamble) return resolved;
  return {
    ...resolved,
    extraction: {
      ...resolved.extraction,
      systemPrompt: `${preamble}\n\n${resolved.extraction.systemPrompt}`,
    },
  };
}

// ── Course Type Suggestion ───────────────────────────────────────────────────

/**
 * Keyword → TeachingMode map for instant client-side suggestion.
 * Multi-word keys are checked first (longest match wins).
 */
const TEACHING_MODE_KEYWORDS: Record<string, TeachingMode> = {
  // recall — fact-heavy subjects
  history: "recall", biology: "recall", geography: "recall",
  science: "recall", chemistry: "recall",
  anatomy: "recall", psychology: "recall", sociology: "recall",
  economics: "recall", politics: "recall", law: "recall",
  medicine: "recall", nursing: "recall", pharmacology: "recall",
  gcse: "recall", "a-level": "recall", "a level": "recall",
  revision: "recall", quiz: "recall", flashcard: "recall",
  // comprehension — reading / analysis / discussion
  english: "comprehension", literature: "comprehension",
  french: "comprehension", spanish: "comprehension", german: "comprehension",
  language: "comprehension", languages: "comprehension",
  philosophy: "comprehension", ethics: "comprehension", theology: "comprehension",
  negotiation: "comprehension", communication: "comprehension",
  leadership: "comprehension", management: "comprehension",
  marketing: "comprehension", sales: "comprehension",
  debate: "comprehension", rhetoric: "comprehension", writing: "comprehension",
  "creative writing": "comprehension", comprehension: "comprehension",
  // practice — problem-solving
  maths: "practice", math: "practice", mathematics: "practice",
  accounting: "practice", statistics: "practice", calculus: "practice",
  algebra: "practice", programming: "practice", coding: "practice",
  engineering: "practice", finance: "practice", physics: "practice",
  "problem solving": "practice",
  // syllabus — structured coverage / compliance
  "food safety": "syllabus", "health and safety": "syllabus",
  btec: "syllabus", apprenticeship: "syllabus", apprenticeships: "syllabus",
  compliance: "syllabus", certification: "syllabus",
  induction: "syllabus", onboarding: "syllabus",
  gdpr: "syllabus", safeguarding: "syllabus", "first aid": "syllabus",
};

/** Sorted entries — longest key first so multi-word keys match before substrings */
const KEYWORD_ENTRIES = Object.entries(TEACHING_MODE_KEYWORDS)
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Suggest a TeachingMode from a course name using keyword matching.
 * Returns null if no keyword matches — caller should fall back to AI.
 */
export function suggestTeachingMode(courseName: string): TeachingMode | null {
  if (!courseName || courseName.trim().length < 3) return null;
  const lower = courseName.toLowerCase();
  for (const [keyword, mode] of KEYWORD_ENTRIES) {
    if (lower.includes(keyword)) return mode;
  }
  return null;
}

// ── Teach Method ─────────────────────────────────────────────────────────────

/**
 * The micro-level activity type assigned to a group of teaching points.
 * Stored in ContentAssertion.teachMethod.
 */
export type TeachMethod =
  | "recall_quiz"
  | "definition_matching"
  | "close_reading"
  | "true_false"
  | "matching_task"
  | "guided_discussion"
  | "problem_solving"
  | "worked_example";

export const TEACH_METHOD_CONFIG: Record<
  TeachMethod,
  { label: string; icon: string; categories: string[] }
> = {
  recall_quiz: {
    label: "Recall quiz",
    icon: "🧠",
    // Default/TEXTBOOK + CURRICULUM (LOs/ACs to recall) + POLICY (safety/legal facts)
    // + ASSESSMENT (answers, misconceptions) + generic fact-like categories
    categories: [
      "fact", "concept", "rule", "threshold",
      // CURRICULUM
      "learning_outcome", "assessment_criterion", "range",
      // POLICY_DOCUMENT
      "safety_point", "legal_requirement", "hazard", "record_requirement", "key_fact",
      // ASSESSMENT
      "misconception", "mark_scheme", "answer",
      // WORKSHEET / COMPREHENSION
      "information", "answer_key_item",
      // EXAMPLE
      "observation", "context",
      // LESSON_PLAN (teacher-facing reference)
      "objective", "timing", "resource", "assessment_opportunity",
      // QUESTION_BANK (session-level reference)
      "session_metadata",
      // COMPANION pattern
      "normalising_statement",
    ],
  },
  definition_matching: {
    label: "Definition matching",
    icon: "🔤",
    // Default + WORKSHEET + COMPREHENSION + READING_PASSAGE vocabulary categories
    categories: [
      "vocabulary", "key_term", "definition",
      "vocabulary_exercise", "vocabulary_item", "vocabulary_highlight",
    ],
  },
  close_reading: {
    label: "Close reading",
    icon: "📄",
    // Default + READING_PASSAGE literary analysis categories
    categories: [
      "reading_passage",
      "key_event", "character", "language_feature", "key_quote", "setting", "theme",
    ],
  },
  true_false: {
    label: "True / False",
    icon: "✔️",
    // Generic + type-specific true_false category (WORKSHEET/ASSESSMENT/COMPREHENSION)
    categories: ["comprehension_task", "true_false"],
  },
  matching_task: {
    label: "Matching task",
    icon: "🔗",
    // Generic + WORKSHEET/COMPREHENSION/ASSESSMENT matching categories
    categories: ["comprehension_task", "matching_exercise", "matching_item"],
  },
  guided_discussion: {
    label: "Guided discussion",
    icon: "💬",
    // Default + discussion/question categories from all document types + pattern supplementary
    categories: [
      "open_task",
      // WORKSHEET / COMPREHENSION
      "discussion_prompt", "question", "comprehension_question",
      // EXAMPLE
      "discussion_point",
      // QUESTION_BANK
      "tutor_question", "skill_description", "assessment_guidance",
      // LESSON_PLAN
      "differentiation", "plenary", "starter",
      // Pattern supplementary (socratic, coaching, reflective, advisory, facilitation)
      "dilemma", "reflection_question", "narrative_prompt", "caveat", "decision_framework",
    ],
  },
  problem_solving: {
    label: "Problem solving",
    icon: "🔢",
    // Default + COACHING pattern
    categories: ["activity", "worksheet", "action_step"],
  },
  worked_example: {
    label: "Worked example",
    icon: "📝",
    // Default + POLICY_DOCUMENT procedural categories
    categories: [
      "worked_example", "example", "process",
      "procedure", "control_measure", "corrective_action",
    ],
  },
};

/**
 * Category → intent → weight (1=low, 2=medium, 3=high).
 * Higher weight = extracted more / checked by default in the content review step.
 */
export const intentCategoryWeights: Record<
  TeachingMode,
  Record<string, number>
> = {
  recall: {
    fact: 3,
    concept: 3,
    key_term: 3,
    vocabulary: 2,
    reading_passage: 1,
    comprehension_task: 1,
    open_task: 1,
    activity: 1,
    worksheet: 1,
    worked_example: 1,
  },
  comprehension: {
    fact: 1,
    concept: 2,
    key_term: 3,
    vocabulary: 3,
    reading_passage: 3,
    comprehension_task: 3,
    open_task: 3,
    activity: 1,
    worksheet: 1,
    worked_example: 1,
  },
  practice: {
    fact: 1,
    concept: 2,
    key_term: 1,
    vocabulary: 1,
    reading_passage: 1,
    comprehension_task: 2,
    open_task: 1,
    activity: 3,
    worksheet: 3,
    worked_example: 3,
  },
  syllabus: {
    fact: 2,
    concept: 2,
    key_term: 1,
    vocabulary: 1,
    reading_passage: 1,
    comprehension_task: 2,
    open_task: 1,
    activity: 2,
    worksheet: 2,
    worked_example: 1,
  },
};

/**
 * Return the default TeachMethod for a given extraction category and intent.
 * Falls back to the highest-weight method whose categories include the given category,
 * or "recall_quiz" if no match found.
 */
export function categoryToTeachMethod(
  category: string,
  intent: TeachingMode
): TeachMethod {
  // Find all methods whose categories list includes this category
  const candidates = (
    Object.entries(TEACH_METHOD_CONFIG) as [
      TeachMethod,
      (typeof TEACH_METHOD_CONFIG)[TeachMethod],
    ][]
  ).filter(([, cfg]) => cfg.categories.includes(category));

  if (candidates.length === 0) return "recall_quiz";
  if (candidates.length === 1) return candidates[0][0];

  // Among candidates, pick the one with the highest intent weight for this category
  const weights = intentCategoryWeights[intent];
  let bestMethod = candidates[0][0];
  let bestWeight = weights[candidates[0][1].categories[0]] ?? 1;
  for (const [method, cfg] of candidates) {
    const w = weights[cfg.categories[0]] ?? 1;
    if (w > bestWeight) {
      bestMethod = method;
      bestWeight = w;
    }
  }
  return bestMethod;
}

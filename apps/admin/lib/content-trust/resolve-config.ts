/**
 * Content Extraction Config Resolver
 *
 * Resolves extraction and structuring configuration by merging:
 * 1. System-level CONTENT-EXTRACT-001 spec (global defaults)
 * 2. Domain-level override spec (per-domain customization)
 *
 * Follows the same pattern as identity layer merging (mergeIdentitySpec).
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

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

export type DocumentType = "CURRICULUM" | "TEXTBOOK" | "WORKSHEET" | "EXAMPLE" | "ASSESSMENT" | "REFERENCE" | "COMPREHENSION" | "LESSON_PLAN" | "POLICY_DOCUMENT" | "READING_PASSAGE" | "QUESTION_BANK";

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
    llmConfig: { temperature: 0.1, maxTokens: 4000 },
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
- TEXTBOOK: A published study text, training manual, or dense reference material. Contains detailed explanations, chapters, worked examples. The primary teaching content. Examples: Sprenger food safety textbook, BFT study guide, insurance study text.
- COMPREHENSION: A reading passage or article with comprehension questions, vocabulary exercises, and/or answer keys. The learner reads the passage then answers questions to demonstrate understanding. The document is primarily READ-ONLY — the learner does not fill anything in. Examples: "The Black Death" reading worksheet, British Council LearnEnglish article, reading comprehension sheet with questions at the end.
- WORKSHEET: A fill-in / write-up / production sheet that the student COMPLETES. Contains blank spaces, tables to fill, exercises requiring written answers, lab sheets. The learner produces content ON the sheet. Examples: lab report template, math practice sheet, fill-in-the-blank grammar exercise, write-up template.
- ASSESSMENT: Formal test/exam material with mark schemes, rubrics, or grade boundaries. Contains questions with expected answers, past papers. Examples: mock exam paper, end-of-module test, past paper with mark scheme.
- REFERENCE: Quick reference card, glossary, cheat sheet, or summary table. Flat lookup material, no narrative or exercises. Examples: tax rate card, food temperature reference chart, glossary of terms.
- EXAMPLE: An illustrative or case-study document used as source material for discussion. Something the AI will talk ABOUT with the learner. Examples: sample cross-contamination report, case study document, sample complaint letter.
- LESSON_PLAN: A teacher-facing plan with objectives, activities, timing, differentiation strategies, and assessment opportunities. NOT a student document. Examples: lesson plan for "Introduction to Negotiation", scheme of work, teaching guide.
- POLICY_DOCUMENT: A regulatory, compliance, or safety procedure document. Defines required practices, hazards, control measures, legal requirements. Examples: Food Standards Agency pest control guide, HACCP procedures, health & safety policy, regulatory compliance manual.
- READING_PASSAGE: A standalone reading passage or text extract that the learner reads before or during a tutoring session. Contains narrative, descriptive, or informational prose but NO questions, exercises, or answer keys. Often has metadata headers (title, author, word count, text type). The document IS the text the learner reads — nothing more. Examples: chapter extract from The Secret Garden, a poem for analysis, a news article for discussion, a descriptive passage for comprehension practice.
- QUESTION_BANK: A tutor reference document containing questions mapped to skills or learning outcomes, with model answers at multiple proficiency tiers (e.g., Emerging / Developing / Secure), suggested tutor responses or "next moves" at each tier, and assessment guidance. NOT a learner-facing test — it is a teaching script or tutor playbook. The tutor uses this to guide conversation. Typically references a separate reading passage. Examples: comprehension question bank with tiered model responses, skill-mapped discussion guide, tutor playbook for a specific passage.

DISAMBIGUATION RULES (apply in order):
1. Has numbered LOs/ACs/Range statements → CURRICULUM (not TEXTBOOK)
2. Pure reading text with NO questions, exercises, or answer keys — just the passage → READING_PASSAGE (not TEXTBOOK or COMPREHENSION)
3. Questions with tiered model responses (Emerging/Developing/Secure) + tutor guidance + skill mappings → QUESTION_BANK (not ASSESSMENT or COMPREHENSION)
4. Has reading passage + comprehension questions + answers IN THE SAME DOCUMENT, learner reads but doesn't fill in → COMPREHENSION (not WORKSHEET or READING_PASSAGE)
5. Has blank spaces, fill-in tables, or requires learner to write/produce content → WORKSHEET (not COMPREHENSION)
6. Has mark scheme, grade boundaries, or is explicitly an exam/test → ASSESSMENT (not WORKSHEET)
7. Is teacher-facing with lesson timing, activities, differentiation → LESSON_PLAN (not TEXTBOOK)
8. Defines safety procedures, hazards, control measures, legal requirements → POLICY_DOCUMENT (not TEXTBOOK or REFERENCE)
9. Is flat lookup (glossary, chart, table) with no narrative → REFERENCE (not TEXTBOOK)

IMPORTANT: Look at ALL sections (start, middle, AND end) before classifying. Many teaching documents are COMPOSITE.

Return a JSON object:
{
  "documentType": "CURRICULUM" | "TEXTBOOK" | "COMPREHENSION" | "WORKSHEET" | "ASSESSMENT" | "REFERENCE" | "EXAMPLE" | "LESSON_PLAN" | "POLICY_DOCUMENT" | "READING_PASSAGE" | "QUESTION_BANK",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence explaining why"
}

Return ONLY valid JSON (no markdown code fences).`,
    llmConfig: { temperature: 0.1, maxTokens: 500 },
    sampleSize: 2000,
    fewShot: {
      enabled: true,
      maxExamples: 5,
      exampleSampleSize: 500,
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
and discussion points a tutor might raise about it.

Categories:
- concept: A key concept the example illustrates
- observation: Something notable about the document
- discussion_point: A question or point a tutor would raise about this example
- context: Background context about the document

Return a JSON array with: assertion, category, chapter, section, tags.
Return ONLY valid JSON.`,
        categories: [
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
      },
      structuring: {
        levels: [
          { depth: 0, label: "skill_group", maxChildren: 10, renderAs: "heading", description: "Comprehension skill (Retrieval, Inference, etc.)" },
          { depth: 1, label: "question", maxChildren: 5, renderAs: "bold", description: "Individual question with tiered responses" },
          { depth: 2, label: "detail", maxChildren: 4, renderAs: "bullet", description: "Model response or assessment note" },
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
): Promise<ExtractionConfig> {
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
    ? deepMerge(DEFAULT_CONFIG, systemConfig as Partial<ExtractionConfig>)
    : DEFAULT_CONFIG;

  // 2. If we have a sourceId, find the domain and check for overrides
  if (sourceId) {
    const domainOverride = await findDomainOverrideConfig(sourceId);
    if (domainOverride) {
      resolved = deepMerge(resolved, domainOverride as Partial<ExtractionConfig>);
    }
  }

  // 3. Apply document-type-specific overrides
  resolved = applyTypeOverrides(resolved, documentType);

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
    ? deepMerge(DEFAULT_CONFIG, systemConfig as Partial<ExtractionConfig>)
    : DEFAULT_CONFIG;

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
  // Look for domain-scoped EXTRACT specs in the domain's published playbook
  const playbook = await prisma.playbook.findFirst({
    where: {
      domainId,
      status: "PUBLISHED",
    },
    select: {
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

  const specConfig = playbook?.items?.[0]?.spec?.config as Record<string, any> | null;
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

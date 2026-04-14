/**
 * Meta Prompt Registry
 *
 * Central catalog of all system prompts that affect caller interactions.
 * Each entry contains metadata (label, category, source file) plus the
 * hardcoded default text. This is the single source of truth for defaults —
 * source files import from here instead of defining inline.
 *
 * Runtime values are stored in the SystemSetting table (key: prompts.<slug>).
 * See prompt-settings.ts for the read/write API.
 */

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface PromptRegistryEntry {
  /** Unique slug — maps to SystemSettings key: prompts.<slug> */
  slug: string;
  /** Human-readable label */
  label: string;
  /** One-sentence description of what this prompt controls */
  description: string;
  /** UI category for tab filtering */
  category: "voice" | "extraction" | "identity" | "sim" | "admin";
  /** Lucide icon name for the card */
  icon: string;
  /** Source file where the prompt was originally defined */
  sourceFile: string;
  /** Line range in source file (for reference) */
  sourceLines: string;
  /** Template variables available (empty = no templating) */
  templateVars: string[];
  /** Whether admins can edit this prompt */
  isEditable: boolean;
  /** The hardcoded default prompt text */
  defaultValue: string;
  /** Help text shown in the edit modal */
  editGuidance?: string;
}

// ------------------------------------------------------------------
// Default prompt texts (single source of truth)
// ------------------------------------------------------------------

export const DEFAULTS = {
  "sim-caller-persona": `You are role-playing as a caller named {{callerName}} in a {{domainName}} session.

RULES:
- You ARE the caller, NOT the AI assistant
- Respond naturally as a real person would
- Keep responses SHORT (1-3 sentences) — this simulates a phone/chat conversation
- Ask questions, express curiosity, sometimes be confused or unsure
- Do NOT be overly polite or perfect — be realistic and human
- React to what the assistant says, ask follow-ups
- If this is your first interaction, introduce yourself briefly
- Show some personality — maybe you're a bit nervous, or enthusiastic, or skeptical

You are talking to an AI assistant. Respond as yourself, the caller.`,

  "identity-generation": `You are generating a DOMAIN OVERLAY for an AI {{label}}'s identity.
This overlay will be MERGED with a base {{label}} archetype that already provides:
{{capabilities}}

Your job is to generate ONLY the domain-specific adaptations. Do NOT repeat generic {{label}} behaviors.

The configuration MUST include ALL of these fields:
- roleStatement: A 2-3 sentence description positioning the agent as an expert in this specific subject
- primaryGoal: The main objective (informed by the person's goals if provided)
- secondaryGoals: Array of 3-5 secondary goals specific to this subject
- techniques: Array of 3-5 DOMAIN-SPECIFIC techniques, each with { name, description, when }
  (e.g. for physics: "phenomena before equations"; for law: "case study analysis")
- domainVocabulary: Array of 10-20 key terms the agent should use naturally
- styleGuidelines: Array of 3-5 style guidelines SPECIFIC to this subject domain

IMPORTANT:
- The agent should sound like a genuine expert in this specific subject
- Use vocabulary and examples from the actual source material
- Do NOT include generic {{label}} behaviors — those come from the base
- Do NOT include generic boundaries — those come from the base
- Do NOT include session structure — that comes from the base
- Focus on what makes THIS subject different from any other
- Tailor everything to phone-based conversation (verbal, conversational)
- Return ONLY valid JSON (no markdown code fences)`,

  "content-classification": `You are a document classification specialist for an educational content system.
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

  "content-extraction": `You are a content extraction specialist. Your job is to parse educational/training material and extract atomic teaching points (assertions).

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

  "content-structuring": `You are organizing extracted teaching points into a pedagogical pyramid.

Given a set of raw teaching points (assertions), create a hierarchical structure following the configured pyramid levels. Each level should branch into approximately the target number of children.

Rules:
- Every existing assertion must appear as a leaf-level detail under exactly one parent
- Aim for the target child count per node (default: ~3 children)
- Topic slugs should be kebab-case (e.g., "temperature-control")
- Preserve the exact text of existing assertions at the leaf level
- Create new synthesized text for all higher levels
- Higher levels should summarize and frame their children pedagogically
- Return valid JSON matching the requested schema`,

  "document-segmentation": `You are a document structure analyst for an educational content system.

Given the text of an educational document, identify its distinct pedagogical sections. Many teaching documents are COMPOSITE — they contain reading passages, vocabulary exercises, comprehension questions, discussion prompts, and answer keys all in one file.

For each section, identify:
1. title: The section heading or a descriptive title
2. startText: The first ~30 characters of the section (for offset matching)
3. sectionType: The best extraction type for this section:
   - TEXTBOOK: Dense teaching content, explanatory text
   - COMPREHENSION: Reading passage with comprehension questions, vocab exercises
   - WORKSHEET: Fill-in activity, exercise requiring learner to write/produce
   - ASSESSMENT: Questions with expected answers, quizzes, tests
   - REFERENCE: Answer key, glossary, teacher notes, quick reference
   - CURRICULUM: Formal learning outcomes, assessment criteria
   - EXAMPLE: Case study, sample document for discussion
   - LESSON_PLAN: Teacher-facing plan with objectives, activities, timing
   - POLICY_DOCUMENT: Safety procedure, regulatory compliance, hazards
4. pedagogicalRole: The teaching purpose:
   - ACTIVATE: Pre-reading activity, warm-up, vocabulary prep
   - INPUT: Main teaching content, reading passage, core material
   - CHECK: Comprehension check, questions, matching, true/false
   - PRODUCE: Discussion prompt, writing task, role-play, production
   - REFLECT: Self-assessment, review, learning journal
   - REFERENCE: Answer key, teacher notes, solutions
   - META: Non-content metadata — table of contents, index, title page, copyright notice, acknowledgements, blank pages, publisher info. No teachable content.
5. hasQuestions: true if the section contains questions for the learner
6. hasAnswerKey: true if the section contains answers/solutions
7. figureRefs: Array of figure/diagram/image references found (e.g. ["Figure 1", "Diagram 2.3", "Table 1"]). Empty array if none.
8. hasFigures: true if the section contains figure captions, image descriptions, diagrams, or visual content references

Return a JSON object:
{
  "isComposite": true/false,
  "sections": [
    {
      "title": "string",
      "startText": "first ~30 chars of section",
      "sectionType": "TEXTBOOK|COMPREHENSION|WORKSHEET|ASSESSMENT|REFERENCE|CURRICULUM|EXAMPLE|LESSON_PLAN|POLICY_DOCUMENT",
      "pedagogicalRole": "ACTIVATE|INPUT|CHECK|PRODUCE|REFLECT|REFERENCE",
      "hasQuestions": true/false,
      "hasAnswerKey": true/false,
      "figureRefs": ["Figure 1", "Diagram 2.3"],
      "hasFigures": true/false
    }
  ]
}

Rules:
- If the document has only ONE section type throughout, set isComposite: false and return a single section
- Sections should be in document order
- Adjacent text of the same type can be merged into one section
- Be generous with section detection — even short sections (a few lines) count if they serve a different pedagogical purpose
- A document with reading + exercises + answers is ALWAYS composite
- Title pages, copyright pages, TOC, indexes, and blank pages should be labelled META with descriptive titles (e.g. "Table of Contents", "Copyright Notice")
- List any figure/diagram/table references found in each section's figureRefs array
- Return ONLY valid JSON (no markdown code fences)`,

  "measurement-default": `Analyze this call transcript for the agent behavior parameter: {{parameterId}}

Score how well the agent demonstrated this behavior from 0.0 to 1.0.
- 0.0 = behavior completely absent
- 0.5 = moderate demonstration
- 1.0 = exemplary demonstration

TRANSCRIPT:
{{transcript}}

Return a JSON object with:
- "actualValue": number 0.0-1.0 (the score)
- "confidence": number 0.0-1.0 (how confident you are in this score)
- "evidence": string[] (specific quotes or observations supporting the score)
- "reasoning": string (brief explanation of scoring rationale)`,

  "curriculum-extraction": `You are a curriculum design specialist. Given a set of teaching assertions extracted from a syllabus or educational document, your job is to organize them into a structured curriculum with modules, learning outcomes, and assessment criteria.

SCOPE — STUDENT-FACING LEARNING ONLY (CRITICAL)
Modules and learning outcomes describe what the STUDENT will know, understand, or be able to do.
They do NOT describe how the tutor teaches, manages sessions, or measures progress.

REJECT — do not include any assertion that describes:
  - Session structure, flow, or pacing ("Open with a warm-up", "Allow 10 minutes for...")
  - Scaffolding techniques or tutor moves ("Use the ACE framework", "Prompt for evidence before interpretation")
  - Assessment frameworks, success metrics, or rubrics ("Use Bloom L3 for inference questions")
  - Communication rules or tutor behaviour ("Avoid direct correction", "Rephrase student answers")
  - Differentiation strategies ("For struggling students, simplify...")
  - Any content about what the TUTOR does during a session
  - Meta-pedagogical content (content ABOUT teaching rather than content TO teach)

If an assertion describes teacher behaviour or tutor methodology, SKIP IT — do NOT invent a module to house it.
If you find yourself about to create a module titled "Session Structure", "Teaching Practice", "Assessment Framework", "Tutor Guidance", or similar — STOP. That content belongs in the tutor's instruction layer, not the student curriculum.

Rules:
1. Group related STUDENT-FACING assertions into logical modules
2. Each module should have 3-8 learning outcomes
3. Order modules from foundational to advanced
4. Preserve the source material's own structure if it has chapters/sections
5. Generate practical module IDs (MOD-1, MOD-2, etc.)
6. Target 3-5 modules for most courses. Only create more when the content volume genuinely demands it (e.g. 100+ student-facing assertions across very different topics). Prefer fewer, richer modules over more, thinner ones.

LEARNING OUTCOMES — STRICT FORMAT
Each learning outcome MUST be a single string in the EXACT format: "LOn: full descriptive sentence"
  - "LOn" is the structured ref (LO1, LO2, LO3, ...)
  - Followed by ": " (colon + space)
  - Followed by a COMPLETE descriptive sentence using measurable verbs (Identify, Explain, Analyse, Apply, Evaluate, Compare)
  - The descriptive sentence must be a REAL learning outcome about the subject matter — NEVER the word "Identify..." or "LO1" or a placeholder
  - Minimum 5 words after the colon
  - Wrong: "LO1" | "LO1:" | "LO1: Identify..." | "Character analysis"
  - Right: "LO1: Identify the main themes and recurring motifs in a literary passage"
  - Right: "LO2: Explain how sentence structure affects the reader's interpretation"

LO NUMBERING — GLOBAL UNIQUENESS (CRITICAL)
Number learning outcomes sequentially across the ENTIRE curriculum, NOT per module.
  - MOD-1's first LO is "LO1", MOD-1's last LO is the next integer (e.g. "LO3")
  - MOD-2's first LO continues from where MOD-1 left off (e.g. "LO4")
  - The ref namespace is globally unique — each "LOn" appears exactly once in the whole curriculum
  - Wrong: MOD-1 has LO1/LO2/LO3, MOD-2 has LO1/LO2/LO3 (ref collision)
  - Right: MOD-1 has LO1/LO2/LO3, MOD-2 has LO4/LO5/LO6 (continuous numbering)

ASSERTION TAGGING (REQUIRED)
Each input assertion was presented with a leading index in square brackets, e.g. [12] (chapter > section) [category] text.
You MUST also return an "assertionTags" array mapping every input assertion index to the LO ref it best supports.
  - "i" is the integer index shown in square brackets at the start of each assertion line.
  - "ref" is the LO ref string (e.g. "LO4") this assertion most directly supports, or null if no LO fits.
  - Include EVERY input assertion index exactly once. Index numbering starts at 1 (matches the brackets).
  - Prefer null over a weak match — don't force-tag assertions that are generic or off-topic.
  - Every ref you emit must be one you defined in a module's learningOutcomes list above; never invent new refs.

Return valid JSON only with this structure:
{
  "name": "Curriculum title",
  "description": "Brief description of what this curriculum covers",
  "modules": [
    {
      "id": "MOD-1",
      "title": "Module title",
      "description": "What this module covers",
      "learningOutcomes": [
        "LO1: Identify the main themes and recurring motifs in a literary passage",
        "LO2: Explain how sentence structure affects the reader's interpretation",
        "LO3: Apply close-reading techniques to a chosen passage"
      ],
      "assessmentCriteria": ["Can define X", "Can list Y"],
      "keyTerms": ["term1", "term2"],
      "estimatedDurationMinutes": 30,
      "sortOrder": 1
    },
    {
      "id": "MOD-2",
      "title": "Second module",
      "description": "What this module covers",
      "learningOutcomes": [
        "LO4: Analyse how figurative language shapes tone",
        "LO5: Compare multiple interpretations of the same passage"
      ],
      "assessmentCriteria": ["Can define X", "Can list Y"],
      "keyTerms": ["term1", "term2"],
      "estimatedDurationMinutes": 30,
      "sortOrder": 2
    }
  ],
  "assertionTags": [
    { "i": 1, "ref": "LO1" },
    { "i": 2, "ref": "LO1" },
    { "i": 3, "ref": null },
    { "i": 4, "ref": "LO4" }
  ],
  "deliveryConfig": {
    "sessionStructure": ["Opening review", "New content", "Practice activity", "Summary check"],
    "assessmentStrategy": "Spaced repetition with formative checks per module",
    "pedagogicalNotes": ["Start with real-world examples", "Use misconception correction"]
  }
}`,

  "curriculum-from-goals": `You are a curriculum design specialist. Given a subject, teaching style, and optional learning goals, generate a structured curriculum with modules, learning outcomes, and assessment criteria.

SCOPE — STUDENT-FACING LEARNING ONLY (CRITICAL)
Modules and learning outcomes describe what the STUDENT will know, understand, or be able to do.
They do NOT describe how the tutor teaches, manages sessions, or measures progress.

Never create modules named "Session Structure", "Teaching Practice", "Assessment Framework",
"Tutor Guidance", or similar meta-pedagogical titles. That content belongs in the tutor's
instruction layer, not the student curriculum.

Rules:
1. Generate 3-5 modules progressing from foundational to advanced (prefer fewer, richer modules)
2. Each module should have 3-8 learning outcomes (format below)
3. Include practical assessment criteria for each module
4. Adapt the pedagogical approach to the teaching style (e.g. tutor = structured, coach = goal-oriented, mentor = reflective)
5. If learning goals are provided, ensure the curriculum covers them
6. If no learning goals are provided, infer sensible goals for the subject
7. Generate practical module IDs (MOD-1, MOD-2, etc.)

LEARNING OUTCOMES — STRICT FORMAT
Each learning outcome MUST be a single string in the EXACT format: "LOn: full descriptive sentence"
  - "LOn" is the structured ref (LO1, LO2, LO3, ...)
  - Followed by ": " (colon + space)
  - Followed by a COMPLETE descriptive sentence using measurable verbs (Identify, Explain, Analyse, Apply, Evaluate, Compare)
  - The descriptive sentence must be a REAL learning outcome about the subject matter — NEVER the word "Identify..." or "LO1" or a placeholder
  - Minimum 5 words after the colon
  - Wrong: "LO1" | "LO1:" | "LO1: Identify..." | "Foundational concepts"
  - Right: "LO1: Identify the key components of a balanced investment portfolio"
  - Right: "LO2: Apply compound interest calculations to real-world savings scenarios"

LO NUMBERING — GLOBAL UNIQUENESS (CRITICAL)
Number learning outcomes sequentially across the ENTIRE curriculum, NOT per module.
  - MOD-1's first LO is "LO1", MOD-1's last LO is the next integer (e.g. "LO3")
  - MOD-2's first LO continues from where MOD-1 left off (e.g. "LO4")
  - The ref namespace is globally unique — each "LOn" appears exactly once in the whole curriculum
  - Wrong: MOD-1 has LO1/LO2/LO3, MOD-2 has LO1/LO2/LO3 (ref collision)
  - Right: MOD-1 has LO1/LO2/LO3, MOD-2 has LO4/LO5/LO6 (continuous numbering)

Return valid JSON only with this structure:
{
  "name": "Curriculum title",
  "description": "Brief description of what this curriculum covers",
  "modules": [
    {
      "id": "MOD-1",
      "title": "Module title",
      "description": "What this module covers",
      "learningOutcomes": [
        "LO1: Identify the key components of a balanced investment portfolio",
        "LO2: Apply compound interest calculations to real-world savings scenarios"
      ],
      "assessmentCriteria": ["Can define X", "Can list Y"],
      "keyTerms": ["term1", "term2"],
      "estimatedDurationMinutes": 30,
      "sortOrder": 1
    }
  ],
  "deliveryConfig": {
    "sessionStructure": ["Opening review", "New content", "Practice activity", "Summary check"],
    "assessmentStrategy": "Spaced repetition with formative checks per module",
    "pedagogicalNotes": ["Start with real-world examples", "Use misconception correction"]
  }
}`,

  "curriculum-skeleton": `You are a curriculum designer. Given teaching assertions from a syllabus, group them into logical modules.
Output ONLY module titles and one-sentence descriptions. Do NOT generate learning outcomes, assessment criteria, or key terms.

Return valid JSON only:
{
  "name": "Curriculum title",
  "description": "One-sentence summary",
  "modules": [
    { "id": "MOD-1", "title": "Module title", "description": "One sentence", "sortOrder": 1 }
  ]
}

Rules:
- Group related assertions into 4-8 modules
- Order from foundational to advanced
- Preserve the source material's chapter/section structure if present
- Use module IDs: MOD-1, MOD-2, etc.
- Return ONLY valid JSON, no explanation`,

  "prompt-analyzer": `You are a prompt composition analyst for an AI tutoring system.

You will receive:
1. The CURRENT composed prompt (generated by the system's composition pipeline)
2. A DESIRED prompt (edited by an administrator)
3. The structured llmPrompt JSON showing all named sections

Your job is to:
1. Identify which sections of the prompt have changed between current and desired
2. For each changed section, explain what specifically changed
3. Map each change to the correct admin surface where the change should be made

## SECTION → ADMIN SURFACE MAPPING

{{sectionMap}}

## RULES

- Only report sections that actually changed. Do not flag sections where the text is identical or semantically equivalent.
- Be specific about WHAT changed (not just "this section is different"). Quote the before/after text.
- Recommendations should be ordered by impact (most impactful change first).
- Each recommendation must include a concrete action ("Change X to Y in Z").
- If a change spans multiple sections (e.g., changing identity affects _quickStart.you_are AND identity.role), note all affected sections but trace to the SOURCE, not derived sections.
- Some sections are auto-computed from others (e.g., _quickStart assembles from identity, memories, targets). Always trace changes to their root source section.
- If the desired change is not achievable through admin surfaces (e.g., auto-computed from call data), say so and explain what would need to happen.
- Do not invent admin pages or settings that don't exist in the mapping above.

## OUTPUT FORMAT

Return valid JSON matching this schema:
{
  "summary": "1-2 sentence summary of the overall intent of the changes",
  "sections": [
    {
      "sectionKey": "the llmPrompt key (e.g. identity, _quickStart, memories)",
      "status": "changed|unchanged",
      "changes": ["specific change description 1", "specific change description 2"]
    }
  ],
  "recommendations": [
    {
      "priority": 1,
      "title": "Short title (e.g. Update Identity Spec)",
      "description": "What to change and why — be specific and actionable",
      "sectionKeys": ["affected section keys"]
    }
  ]
}

Return ONLY valid JSON (no markdown code fences, no explanation outside the JSON).`,

  "prompt-eval": `You are a prompt quality evaluator for an AI tutoring platform called HumanFirst.

You will receive a COMPOSED CALL PROMPT — a system prompt generated for an AI tutor agent. Your job is to evaluate its quality against 7 dimensions and suggest actionable improvements the educator can make within the platform.

## EVALUATION DIMENSIONS

Score each 0-100. Verdict: "strong" (75+), "adequate" (50-74), "weak" (<50).

1. **Identity** — Does the prompt define a clear persona? Role statement, primary goal, teaching techniques, boundaries (what the agent does/doesn't do), style guidelines.
2. **Curriculum** — Does it reference actual teaching content? Named modules, learning outcomes, progress tracking, teaching points, session flow. An empty or generic curriculum section is weak.
3. **Behavior Targets** — Are behavior parameters present, specific, and numeric? Look for named targets (warmth, pace, complexity, etc.) with actual values. Generic or absent targets = weak.
4. **Voice/Style** — Is tone, pacing, and response-length guidance present? Look for voice rules, speaking style, response length targets, Socratic/directive balance.
5. **Learner Personalization** — Does it reference this specific learner? Memories, personality traits, goals, call history, preferences. A prompt that could be for any learner = weak.
6. **Coherence** — Are there contradictions, redundancy, or conflicting instructions? E.g., "be concise" vs "explain in detail", or the same rule stated 3 times.
7. **Completeness** — Are sections missing that the composition pipeline can provide? Compare present sections against the full section map below.

## SECTION → ADMIN SURFACE MAPPING

{{sectionMap}}

## IMPROVEMENT RULES

- Each improvement must map to a specific admin surface from the section map above.
- Use educator-friendly language — never mention spec slugs, DB tables, or code.
- Focus on what the educator can DO, not what's technically wrong.
- Order by impact (biggest improvement first).
- Max 5 improvements.
- If the prompt is strong across all dimensions, say so — don't invent problems.

## OUTPUT FORMAT

Return valid JSON matching this schema:
{
  "overall": {
    "score": 72,
    "verdict": "strong|adequate|weak",
    "summary": "1-2 sentence overall assessment in educator-friendly language"
  },
  "dimensions": [
    {
      "name": "Identity",
      "score": 88,
      "verdict": "strong",
      "findings": ["Clear role as warm Socratic tutor", "Good boundary definitions"],
      "improvements": []
    },
    {
      "name": "Curriculum",
      "score": 45,
      "verdict": "weak",
      "findings": ["Only 3 teaching points loaded", "No module progress data"],
      "improvements": ["Upload more teaching content to build richer sessions"]
    }
  ],
  "topImprovements": [
    {
      "priority": 1,
      "title": "Upload more teaching content",
      "description": "The curriculum section has only 3 teaching points. Upload more documents to give the AI tutor richer material to draw from.",
      "sectionKeys": ["curriculum", "teachingContent"]
    }
  ]
}

Return ONLY valid JSON (no markdown code fences, no explanation outside the JSON).`,
} as const;

export type PromptSlug = keyof typeof DEFAULTS;

// ------------------------------------------------------------------
// Registry
// ------------------------------------------------------------------

const PROMPT_REGISTRY = new Map<string, PromptRegistryEntry>();

function register(entry: PromptRegistryEntry) {
  PROMPT_REGISTRY.set(entry.slug, entry);
}

// ── Sim ──────────────────────────────────────────────

register({
  slug: "sim-caller-persona",
  label: "Sim Caller Persona",
  description: "Controls how simulated callers behave in AI-vs-AI test calls. Defines personality, response length, and realism rules.",
  category: "sim",
  icon: "UserCircle",
  sourceFile: "lib/test-harness/sim-runner.ts",
  sourceLines: "59-71",
  templateVars: ["callerName", "domainName"],
  isEditable: true,
  defaultValue: DEFAULTS["sim-caller-persona"],
  editGuidance: "Template variables {{callerName}} and {{domainName}} are injected at runtime. Do not remove them.",
});

// ── Identity ────────────────────────────────────────

register({
  slug: "identity-generation",
  label: "Identity Generation",
  description: "System prompt for AI-generating domain-specific agent identity overlays (role, techniques, vocabulary).",
  category: "identity",
  icon: "Fingerprint",
  sourceFile: "lib/domain/generate-identity.ts",
  sourceLines: "134-161",
  templateVars: ["label", "capabilities"],
  isEditable: true,
  defaultValue: DEFAULTS["identity-generation"],
  editGuidance: "{{label}} is the archetype label (tutor/companion/coach). {{capabilities}} lists base archetype capabilities. Both are injected at runtime.",
});

// ── Extraction ──────────────────────────────────────

register({
  slug: "content-classification",
  label: "Content Classification",
  description: "Classifies uploaded documents into one of 12 types (CURRICULUM, TEXTBOOK, WORKSHEET, etc.) with disambiguation rules.",
  category: "extraction",
  icon: "FileType",
  sourceFile: "lib/content-trust/resolve-config.ts",
  sourceLines: "190-227",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["content-classification"],
  editGuidance: "This prompt must return JSON with documentType, confidence, and reasoning fields. Changing document type definitions may affect downstream extraction.",
});

register({
  slug: "content-extraction",
  label: "Content Extraction",
  description: "Extracts atomic teaching points (assertions) from educational content — facts, definitions, rules, processes, examples.",
  category: "extraction",
  icon: "FileOutput",
  sourceFile: "lib/content-trust/resolve-config.ts",
  sourceLines: "109-140",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["content-extraction"],
  editGuidance: "Must return a JSON array of assertion objects with category, chapter, section, tags, examRelevance, and learningOutcomeRef fields.",
});

register({
  slug: "content-structuring",
  label: "Content Structuring",
  description: "Organizes extracted assertions into a hierarchical pedagogical pyramid (overview → topic → key_point → detail).",
  category: "extraction",
  icon: "Network",
  sourceFile: "lib/content-trust/resolve-config.ts",
  sourceLines: "160-171",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["content-structuring"],
});

register({
  slug: "document-segmentation",
  label: "Document Segmentation",
  description: "Splits composite documents into pedagogical sections (reading, exercises, answer keys) before extraction.",
  category: "extraction",
  icon: "Scissors",
  sourceFile: "lib/content-trust/segment-document.ts",
  sourceLines: "92-147",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["document-segmentation"],
  editGuidance: "Must return JSON with isComposite boolean and sections array. Section types and pedagogical roles must match the extraction pipeline's expected values.",
});

// ── Voice ───────────────────────────────────────────

register({
  slug: "measurement-default",
  label: "Measurement Default",
  description: "Default prompt for scoring agent behaviour parameters from call transcripts. Used when no spec-level override exists.",
  category: "voice",
  icon: "Gauge",
  sourceFile: "lib/ops/measure-agent.ts",
  sourceLines: "70-84",
  templateVars: ["parameterId", "transcript"],
  isEditable: true,
  defaultValue: DEFAULTS["measurement-default"],
  editGuidance: "{{parameterId}} and {{transcript}} are injected at runtime. Must return JSON with actualValue, confidence, evidence, and reasoning fields.",
});

// ── Curriculum ──────────────────────────────────────

register({
  slug: "curriculum-extraction",
  label: "Curriculum Extraction",
  description: "Organizes syllabus assertions into structured curriculum modules with learning outcomes and assessment criteria.",
  category: "extraction",
  icon: "GraduationCap",
  sourceFile: "lib/content-trust/extract-curriculum.ts",
  sourceLines: "125-156",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["curriculum-extraction"],
  editGuidance: "Must return JSON with name, description, modules array, and deliveryConfig object.",
});

register({
  slug: "curriculum-from-goals",
  label: "Curriculum from Goals",
  description: "Generates structured curriculum from subject and learning goals when no document is uploaded.",
  category: "extraction",
  icon: "Target",
  sourceFile: "lib/content-trust/extract-curriculum.ts",
  sourceLines: "380-412",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["curriculum-from-goals"],
  editGuidance: "Same output format as Curriculum Extraction. Rule #1 may be dynamically modified at runtime when session count is set.",
});

register({
  slug: "curriculum-skeleton",
  label: "Curriculum Skeleton",
  description: "Fast lightweight extraction — module titles and descriptions only (no learning outcomes). Used as Phase 1 of two-phase generation.",
  category: "extraction",
  icon: "Layers",
  sourceFile: "lib/content-trust/extract-curriculum.ts",
  sourceLines: "289-306",
  templateVars: [],
  isEditable: true,
  defaultValue: DEFAULTS["curriculum-skeleton"],
  editGuidance: "Returns minimal JSON: name, description, and modules with id/title/description/sortOrder only.",
});

// ── Admin AI ──

register({
  slug: "prompt-analyzer",
  label: "Prompt Analyzer",
  description: "Analyses differences between current and desired prompts, mapping changes to admin surfaces and configuration settings.",
  category: "admin",
  icon: "Target",
  sourceFile: "app/api/prompt-analyzer/analyse/route.ts",
  sourceLines: "1-50",
  templateVars: ["sectionMap"],
  isEditable: true,
  defaultValue: DEFAULTS["prompt-analyzer"],
  editGuidance: "The {{sectionMap}} variable is injected at runtime with the current section-to-admin mapping table. Do not remove it. Output must be valid JSON matching the AnalyseResponse schema.",
});

register({
  slug: "prompt-eval",
  label: "Prompt Eval",
  description: "Evaluates a composed call prompt against a quality rubric (7 dimensions) and suggests actionable improvements educators can make.",
  category: "admin",
  icon: "ClipboardCheck",
  sourceFile: "app/api/callers/[callerId]/eval-prompt/route.ts",
  sourceLines: "1-50",
  templateVars: ["sectionMap"],
  isEditable: true,
  defaultValue: DEFAULTS["prompt-eval"],
  editGuidance: "The {{sectionMap}} variable is injected at runtime. Output must be valid JSON matching the EvalResponse schema (overall, dimensions, topImprovements).",
});

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/** Get all entries, optionally filtered by category */
export function getRegistryEntries(category?: string): PromptRegistryEntry[] {
  const all = Array.from(PROMPT_REGISTRY.values());
  return category ? all.filter((e) => e.category === category) : all;
}

/** Get a single entry by slug */
export function getRegistryEntry(slug: string): PromptRegistryEntry | undefined {
  return PROMPT_REGISTRY.get(slug);
}

/** Get all unique categories in registration order */
export function getCategories(): string[] {
  return [...new Set(Array.from(PROMPT_REGISTRY.values()).map((e) => e.category))];
}

export { PROMPT_REGISTRY };

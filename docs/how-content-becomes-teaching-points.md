# How Content Becomes Teaching Points

> From document upload to what the AI tutor says in a session.

---

## The Pipeline at a Glance

```
Upload PDF/DOCX
     |
  Classify            AI identifies document type (Textbook, Curriculum, Worksheet, etc.)
     |
  Extract             AI reads the document and pulls out individual knowledge items
     |                (facts, definitions, rules, processes, examples...)
     |                These are "Content Assertions" — the raw building blocks.
     |
  Build Curriculum    AI groups assertions into Modules and Learning Objectives (LOs)
     |                Then links every assertion back to its parent LO.
     |
  Create Lesson Plan  AI (or educator) distributes LOs and assertions across sessions
     |                "Session 1: introduce Module A, LO1 and LO2"
     |
  Compose Prompt      At call time, the system selects the right assertions
                      for THIS session and renders them into the AI tutor's prompt.
                      These are the Teaching Points (TPs).
```

---

## Step 1: Upload and Classify

When an educator uploads a document, the system:

1. **Extracts raw text** from the file (PDF, DOCX, etc.) — no AI needed yet.
2. **AI classifies** the document into one of 12 types:

| Document Type | What it is | Example |
|---|---|---|
| `CURRICULUM` | Syllabus, scheme of work | AQA GCSE History specification |
| `TEXTBOOK` | Study material, course notes | Chapter from a revision guide |
| `WORKSHEET` | Exercises, activities | Gap-fill or matching exercises |
| `COMPREHENSION` | Reading + questions | KS2 reading comprehension sheet |
| `READING_PASSAGE` | Narrative/literary text | Extract from a novel for study |
| `ASSESSMENT` | Test paper, exam | Past paper with mark scheme |
| `QUESTION_BANK` | Teacher's question set | Tiered questions with model answers |
| `LESSON_PLAN` | Teacher's session plan | Objectives, activities, timings |
| `COURSE_REFERENCE` | Teaching guide | Skills framework, session flow rules |
| `REFERENCE` | Glossary, lookup material | Key terms and definitions |
| `EXAMPLE` | Worked example, case study | Annotated sample answer |
| `POLICY_DOCUMENT` | Rules, procedures, safety | Health & safety policy |

The educator can correct the classification if the AI gets it wrong. Corrections improve future classifications (few-shot learning).

---

## Step 2: Extract Content Assertions

After confirming the document type, the educator triggers extraction. The AI reads the full document in chunks and pulls out structured **Content Assertions** — individual pieces of teachable knowledge.

Each assertion has:

| Field | Purpose |
|---|---|
| **assertion** | The teaching point text itself |
| **category** | What kind of knowledge (fact, definition, rule, process, example, threshold...) |
| **chapter / section** | Where it came from in the source document |
| **tags** | 2-5 keywords for retrieval |
| **learningOutcomeRef** | Structured reference like "LO2" or "AC2.3" (if detectable) |
| **examRelevance** | 0-1 score of how likely this appears in assessments |
| **trustLevel** | Inherited from the source document's trust level |
| **teachMethod** | How the AI should teach this (recall quiz, worked example, definition matching...) |

Different document types produce different categories. A Textbook yields facts, definitions, and rules. A Worksheet yields questions, exercises, and activities. A Curriculum yields learning outcomes and assessment criteria.

**Volume:** A typical textbook chapter produces 50-150 assertions. The system caps at 500 per source.

---

## Step 3: Build the Curriculum

Once content is extracted, the system builds a **Curriculum** — a structured hierarchy of what needs to be taught:

```
Curriculum
  |-- Module 1: "Victorian Society"
  |     |-- LO1: Understand class structure in Victorian Britain
  |     |-- LO2: Explain the impact of industrialisation on daily life
  |     +-- LO3: Evaluate reform movements of the period
  |
  +-- Module 2: "The British Empire"
        |-- LO4: Describe the extent of the Empire by 1900
        +-- LO5: Analyse perspectives on imperial expansion
```

**Modules** are thematic groupings. **Learning Objectives (LOs)** are measurable outcomes within each module.

### How assertions link to LOs

After the curriculum is generated, a **reconciler** runs two passes to connect every Content Assertion to its parent LO:

| Pass | Method | Example |
|---|---|---|
| **1. Structured ref** | Matches the assertion's `learningOutcomeRef` (e.g. "LO2") to an LO's ref. Deterministic, free, runs first. | Assertion tagged "LO2" during extraction links to LO2 |
| **2. AI retag** | For Pass-1 orphans, batch the assertion text + full LO list into a single AI call that returns the best LO ref per assertion. Replaces an earlier Jaccard keyword pass that scored 0 matches in practice. | An untagged assertion about "factory working conditions" is reclassified to LO2 by AI |

This creates a direct database link (`learningObjectiveId`) from every assertion to its LO. **Once reconciliation has run**, the FK is the canonical join — UI and analytics queries should use it. Before reconciliation runs, only the `learningOutcomeRef` string is reliable. The reconciler re-runs automatically when the curriculum is updated.

> See [`05-data/curriculum-content-split.md`](./05-data/curriculum-content-split.md) for the full data-model split between the curriculum layer (modules + LOs) and the content layer (sources + assertions + questions), and how the prompt-composition scheduler bridges them.

---

## Step 4: Create the Lesson Plan

The lesson plan distributes modules and LOs across **sessions** — the individual conversations a learner will have with the AI tutor.

```
Session 1:  [introduce]  Module 1 — Victorian Society (LO1, LO2)
Session 2:  [deepen]     Module 1 — Victorian Society (LO2, LO3)
Session 3:  [introduce]  Module 2 — The British Empire (LO4)
Session 4:  [deepen]     Module 2 — The British Empire (LO4, LO5)
Session 5:  [review]     Module 1 + Module 2 — Consolidation
Session 6:  [assess]     All modules — Assessment
```

Each session entry specifies:
- Which **module** it covers
- Which **LO refs** are in scope (e.g. LO1, LO2)
- The session **type** (introduce, deepen, review, assess, consolidate)
- Optionally, specific **assertion IDs** hand-picked by the educator

The AI generates an initial plan based on educator preferences (number of sessions, session length, emphasis on breadth vs. depth). The educator can then adjust it.

---

## Step 5: Teaching Points in the Prompt

When a learner starts a call, the system composes a prompt for the AI tutor. The **teaching-content** section selects the right assertions for this session using a priority chain:

| Priority | What it uses | When |
|---|---|---|
| **Highest** | Explicit assertion IDs from lesson plan | Educator hand-picked specific TPs |
| **High** | LO refs from lesson plan, resolved via database FK | Session has LO refs assigned |
| **Medium** | All LOs in the current module | Fallback when no specific LOs assigned |
| **Lowest** | All loaded assertions | No lesson plan or module context |

The selected assertions are then **rendered** into the prompt. The rendering format depends on the course structure:

| Format | When used | Structure |
|---|---|---|
| **LO-grouped** | Continuous/adaptive learning | TPs grouped under LO headings, review items labelled |
| **Source-grouped** | Multiple documents in scope | TPs grouped by source document |
| **Pyramid** | Structured content with depth | Hierarchical: overview > topics > key points > details |
| **Flat** | Legacy / simple courses | Grouped by category (DEFINITIONS, FACTS, RULES...) |

Each TP line in the prompt includes: the assertion text, a source citation (document name + page), the LO reference, and the teaching method hint.

---

## What the AI Tutor Sees

The final prompt section might look like:

```
[TEACHING CONTENT — Session 3]

MODULE: The British Empire

LO4: Describe the extent of the Empire by 1900

  - By 1900, the British Empire covered approximately 25% of the
    world's land surface and governed over 400 million people.
    [Revision Guide p.47] [LO4] [recall_quiz]

  - The phrase "the sun never sets on the British Empire" reflected
    the geographic spread across every time zone.
    [Revision Guide p.48] [LO4] [definition_matching]

  - Key territories included India (the "jewel in the crown"),
    large parts of Africa, Canada, Australia, and numerous
    Caribbean and Pacific islands.
    [Revision Guide p.49] [LO4] [worked_example]

PRACTICE QUESTIONS:
  Q1: Which territory was known as the "jewel in the crown"?
      [recall_quiz]
```

The AI tutor uses these teaching points to guide the conversation — it doesn't read them verbatim, but weaves them naturally into a Socratic dialogue with the learner.

---

## Key Concepts Summary

| Term | What it means |
|---|---|
| **Content Source** | An uploaded document (PDF, DOCX, etc.) |
| **Document Type** | AI-classified category (Textbook, Curriculum, Worksheet...) |
| **Content Assertion** | A single extracted piece of teachable knowledge |
| **Module** | A thematic grouping within the curriculum |
| **Learning Objective (LO)** | A measurable outcome within a module |
| **Lesson Plan** | Distribution of modules/LOs across sessions |
| **Teaching Point (TP)** | A Content Assertion selected for a specific session's prompt |
| **Teaching Method** | How the AI should deliver the TP (quiz, example, matching...) |

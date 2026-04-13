# KS2 SATs Course Materials

Official UK Key Stage 2 SATs materials from GOV.UK (Standards and Testing Agency).
Downloaded April 2026. Crown Copyright — free to use for educational purposes.

## Course Structure (HF mapping)

```
Domain: "KS2 SATs Prep"
├─ PlaybookGroup: "Year 6 SATs"
│   ├─ Playbook: "KS2 Maths"          → Subject: "KS2 Mathematics"
│   ├─ Playbook: "KS2 Reading"        → Subject: "KS2 English Reading"
│   └─ Playbook: "KS2 SPaG"           → Subject: "KS2 Grammar, Punctuation & Spelling"
```

## Upload Order & Document Type Mapping

### Phase 1: Curriculum Frameworks (upload FIRST — creates skill taxonomy)

| File | HF DocumentType | Trust Level | Notes |
|------|----------------|-------------|-------|
| `curriculum/ks2-maths-test-framework-2016.pdf` | CURRICULUM | L5 REGULATORY_STANDARD | Content domain refs (6C7, 6F5, etc.) — the maths skill taxonomy |
| `curriculum/ks2-reading-test-framework-2016.pdf` | CURRICULUM | L5 REGULATORY_STANDARD | Cognitive domain refs (2a-2h) — the reading skill taxonomy |
| `curriculum/ks2-maths-programmes-of-study.pdf` | CURRICULUM | L5 REGULATORY_STANDARD | Year-by-year objectives, complements test framework |
| `curriculum/primary-national-curriculum.pdf` | CURRICULUM | L5 REGULATORY_STANDARD | Full KS1+KS2 national curriculum (all subjects) |

### Phase 2: Teaching Guidance (upload as course instructions)

| File | HF DocumentType | Trust Level | Subject | Notes |
|------|----------------|-------------|---------|-------|
| `course-ref-maths.md` | COURSE_REFERENCE | L2 EXPERT_CURATED | KS2 Mathematics | Session structure, scaffolding, timing, emotional handling, misconceptions |
| `course-ref-reading.md` | COURSE_REFERENCE | L2 EXPERT_CURATED | KS2 English Reading | PEE chains, text types, stamina building, answer technique |
| `course-ref-spag.md` | COURSE_REFERENCE | L2 EXPERT_CURATED | KS2 Grammar, Punctuation & Spelling | Grammar teaching order, spelling strategies, paper technique |
| `curriculum/ks2-maths-guidance.pdf` | COURSE_REFERENCE | L4 ACCREDITED_MATERIAL | KS2 Mathematics | DfE teaching progression — loads into [COURSE RULES] not [TEACHING CONTENT] |

### Phase 3: Assessment Papers (upload per-subject)

#### Maths → Subject: "KS2 Mathematics"

| File | HF DocumentType | Trust Level |
|------|----------------|-------------|
| `maths/2024/paper1-arithmetic.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2024/paper2-reasoning.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2024/paper3-reasoning.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2024/mark-schemes.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2025/paper1-arithmetic.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2025/paper2-reasoning.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2025/paper3-reasoning.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `maths/2025/mark-schemes.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |

#### Reading → Subject: "KS2 English Reading"

| File | HF DocumentType | Trust Level | Notes |
|------|----------------|-------------|-------|
| `reading/2024/reading-booklet.pdf` | READING_PASSAGE | L5 REGULATORY_STANDARD | Pair with answer booklet via `linkedSourceId` |
| `reading/2024/answer-booklet.pdf` | COMPREHENSION | L5 REGULATORY_STANDARD | Linked to reading booklet |
| `reading/2024/mark-schemes.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD | |
| `reading/2025/reading-booklet.pdf` | READING_PASSAGE | L5 REGULATORY_STANDARD | Pair with answer booklet via `linkedSourceId` |
| `reading/2025/answer-booklet.pdf` | COMPREHENSION | L5 REGULATORY_STANDARD | Linked to reading booklet |
| `reading/2025/mark-schemes.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD | |

#### SPaG → Subject: "KS2 Grammar, Punctuation & Spelling"

| File | HF DocumentType | Trust Level |
|------|----------------|-------------|
| `spag/2024/paper1-questions.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `spag/2024/paper2-spelling.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `spag/2024/mark-schemes.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `spag/2025/paper1-questions.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `spag/2025/paper2-spelling.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |
| `spag/2025/mark-schemes.pdf` | ASSESSMENT | L5 REGULATORY_STANDARD |

## Content Domain References

These domain codes map to `ContentAssertion.learningOutcomeRef` for per-pupil skill tracking.

### Maths (from test framework)
- `6N*` — Number and place value
- `6C*` — Calculations (addition, subtraction, multiplication, division)
- `6F*` — Fractions, decimals, percentages
- `6R*` — Ratio and proportion
- `6A*` — Algebra
- `6M*` — Measurement
- `6G*` — Geometry (properties of shapes, position and direction)
- `6S*` — Statistics

### Reading (from test framework)
- `2a` — Give/explain the meaning of words in context
- `2b` — Retrieve and record information
- `2c` — Summarise main ideas
- `2d` — Make inferences from the text
- `2e` — Predict what might happen
- `2f` — Identify/explain how structure contributes to meaning
- `2g` — Identify/explain how language contributes to meaning
- `2h` — Make comparisons within the text

### SPaG
- `G3.*` — Grammar
- `G5.*` — Punctuation
- `G7.*` — Vocabulary

## Sources

- Past test materials: https://www.gov.uk/government/collections/national-curriculum-assessments-past-test-materials
- Maths test framework: https://www.gov.uk/government/publications/key-stage-2-mathematics-test-framework
- Reading test framework: https://www.gov.uk/government/publications/key-stage-2-english-reading-test-framework

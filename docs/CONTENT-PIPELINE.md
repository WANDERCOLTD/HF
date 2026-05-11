# Content Pipeline — Canonical Architecture Map

> **Read this before you change anything that affects how content is uploaded, classified, extracted, surfaced in the tutor prompt, or filtered by audience.**
>
> Owner: this document is the single source of truth for the classification taxonomy and data flow. When you introduce a new dimension (e.g. the Module picker introduced `progressionMode` + `modulesAuthored`), update this doc in the same PR.
>
> **Five-pillar canon — read the right doc before changing related code:**
>
> | Pillar | Doc | Covers |
> |--------|-----|--------|
> | Inputs | [`docs/WIZARD-DATA-BAG.md`](./WIZARD-DATA-BAG.md) | educator intent → `Playbook.config` |
> | **Classification** | **this doc** | **extraction, audience filters, compose-time gates** |
> | Model | [`docs/ENTITIES.md`](./ENTITIES.md) | hierarchy + content-boundary path |
> | Composition | [`docs/PROMPT-COMPOSITION.md`](./PROMPT-COMPOSITION.md) | loaders → transforms → assembly |
> | Specs | [`docs/SPEC-SYSTEM.md`](./SPEC-SYSTEM.md) | SpecRole, scaffold, systemSpecToggles, extendsAgent chain |
> | Adaptive loop | [`docs/PIPELINE.md`](./PIPELINE.md) | 7-stage post-call pipeline |
>
> Update peer canon docs in the same PR when changing how a wizard field maps to content classification or how content is scoped to a course.

---

## 1. Why this doc exists

Real incidents this doc would have prevented:

| Incident | Sprint | What broke |
|----------|--------|-----------|
| Module picker introduction (#242, May 6–7) | M5 | Code assumed all module selection was scheduler-driven. `progressionMode=learner-picks` bypassed `loadCurrentModuleContext`, silently breaking downstream consumers. |
| Curriculum-on-wrong-playbook race | M5 | Playbook resolution returned the wrong playbook when a subject was linked to 2+ playbooks. 3 sites had to be patched. |
| `progressionMode=learner-picks` + no Module Catalogue (#318, May 9) | M5 | Educator hit unrecoverable empty-picker state. Cross-field validator added. |
| AI tutor sent course-ref.md to learner (May 10) | M5 | `visualAids` loader had no `documentType` filter. Course-ref leaked as media attachment. **Fixed same day** — see L1 in §8. |
| Generic welcome fired instead of course-ref First-Call rules (May 10) | M5 | `course-ref.md` `**Session scope:** 1` sections extracted to `session_override` rows, but `pedagogy.ts` rendered them as an extra COURSE RULES block alongside `onboardingFlowPhases` — the welcome flow won the conversation. **Fixed same day** — `pedagogy.ts` now REPLACES `onboardingFlowPhases` when an override matches. |
| Wizard validator drops unknown keys silently | M5 | AI hallucinated `modulesAuthored` / `constraints` fields; validator rejected silently; wizard moved on as if writes succeeded. |

**Rule of thumb:** *if you're adding a column, an enum value, a filter, or a new audience, check the matrices in §5 and §6 first — and update them in the same PR.*

---

## 2. Entity glossary

| Acronym | DB model | Definition | Lives in |
|---------|----------|-----------|----------|
| **TP** Teaching Point | `ContentAssertion` | Atomic fact / rule / procedure pulled from a doc; pyramid-structured (parent/child) via `parentId` | Tutor's teaching content OR tutor's instructions, depending on `category` |
| **LO** Learning Objective | `LearningObjective` | "Learner should be able to X." Bound to a module. Audience controlled by `systemRole` | Module outcomes; some surface in courseInstructions |
| **LI** Learning Item | `ContentQuestion` | An MCQ / short-answer / open question. Maps to LO via `learningOutcomeRef` | Pre-test / post-test / formative / tutor-only |
| **TM** TeachingMode | `Playbook.config.teachingMode` | recall / comprehension / practice / syllabus — content emphasis | Scheduler preset selection, extraction weights |
| **InteractionPattern** | `Playbook.config.interactionPattern` | socratic / directive / advisory / coaching / companion / facilitation / reflective / open — conversational style | Tutor voice injection in prompt |
| **TeachingMaterial** | `ContentSource` + `MediaAsset` | Uploaded doc + rendered files. `documentType` classifies it | Source palette, media palette, extraction routing |

---

## 3. Classification dimensions — master table

All values authoritative as of 2026-05-11. Cite the file:line in any PR that changes them.

| Dimension | Values | Defined at | What it gates |
|-----------|--------|-----------|---------------|
| `ContentSource.documentType` | CURRICULUM / TEXTBOOK / WORKSHEET / EXAMPLE / ASSESSMENT / REFERENCE / COMPREHENSION / LESSON_PLAN / POLICY_DOCUMENT / READING_PASSAGE / QUESTION_BANK / COURSE_REFERENCE | `prisma/schema.prisma:38-54` | Extraction strategy. **Only hints — does NOT gate learner visibility on its own** (see §6) |
| `ContentSource.trustLevel` | REGULATORY_STANDARD / ACCREDITED_MATERIAL / PUBLISHED_REFERENCE / EXPERT_CURATED / AI_ASSISTED / UNVERIFIED | `prisma/schema.prisma:15-21` | Tutor cites authority; some loaders prefer higher-trust sources |
| `ContentAssertion.category` | 24 values (see §3.1) | `lib/content-trust/resolve-config.ts:41-56` | Routes assertion to courseInstructions vs learner content |
| `INSTRUCTION_CATEGORIES` (subset) | 14 of the 24 above | `lib/content-trust/resolve-config.ts:41-56` | **Authoritative gate for tutor-only assertions** |
| `LearningObjective.systemRole` | NONE / ASSESSOR_RUBRIC / ITEM_GENERATOR_SPEC / SCORE_EXPLAINER / TEACHING_INSTRUCTION | `prisma/schema.prisma:80-87` | LO audience. `NONE` = learner-visible; rest = tutor/scoring channels |
| `ContentQuestion.questionType` | MCQ / TRUE_FALSE / MATCHING / FILL_BLANK / SHORT_ANSWER / OPEN / UNSCRAMBLE / ORDERING / TUTOR_QUESTION | `prisma/schema.prisma:55-63` | Renderer selection. ⚠ **MATCHING / UNSCRAMBLE / ORDERING are extracted but never rendered** — see landmines §8 |
| `ContentQuestion.assessmentUse` | PRE_TEST / POST_TEST / BOTH / FORMATIVE / TUTOR_ONLY | `prisma/schema.prisma:73-78` | Test eligibility filter |
| `ContentQuestion.bloomLevel` | REMEMBER / UNDERSTAND / APPLY / ANALYZE / EVALUATE / CREATE | `prisma/schema.prisma:65-71` | Difficulty band |
| `Playbook.config.teachingMode` (TM) | recall / comprehension / practice / syllabus | `lib/types/json-fields.ts:145` | Scheduler preset, extraction weights |
| `Playbook.config.interactionPattern` | 8 values listed above | `lib/types/json-fields.ts:153` | Tutor voice |
| `Playbook.config.progressionMode` | ai-led / learner-picks | `lib/wizard/graph-nodes.ts` | Module selection: scheduler vs picker |
| `Playbook.config.modulesAuthored` | true / false / null | `lib/types/json-fields.ts` | Whether authored modules exist; null = derived from curriculum |
| `AuthoredModule.mode` | examiner / tutor / mixed | `lib/types/json-fields.ts:406` | Per-module behaviour (silent during answer vs supportive) |
| `AuthoredModule.frequency` | once / repeatable / cooldown | `lib/types/json-fields.ts:407` | Module picker filter |
| `AuthoredModule.learnerSelectable` | true / false | `lib/wizard/detect-authored-modules.ts` | Hide module from picker |
| `AuthoredModule.sessionTerminal` | true / false | `lib/wizard/detect-authored-modules.ts` | End session after module |
| `Playbook.audience` | string — higher-ed / k12-learner / k12-instructor / adult-learner / corporate / etc. | `prisma/schema.prisma:3090` | ⚠ **Currently stored, never filtered. Dead unless wired.** |
| `Caller.role` | LEARNER / TEACHER / TUTOR / PARENT / MENTOR | `prisma/schema.prisma:522-528` | Permission scoping. NOT used for content filtering. |
| `User.role` | SUPERADMIN / ADMIN / OPERATOR / EDUCATOR / SUPER_TESTER / TESTER / STUDENT / DEMO | `prisma/schema.prisma:653-661` | Admin RBAC. `VIEWER` is deprecated alias for TESTER. |
| `MemoryCategory` | FACT / PREFERENCE / CONTEXT / EVENT / TOPIC / RELATIONSHIP | `prisma/schema.prisma:1705-1711` | Routes caller memories into composition sections |
| `ConversationArtifactType` | SUMMARY / KEY_FACT / FORMULA / EXERCISE / RESOURCE_LINK / STUDY_NOTE / REMINDER / MEDIA | `prisma/schema.prisma:100-109` | Artifact delivery channel |
| `ParameterType` | TRAIT / STATE / ADAPT / GOAL / CONFIG / EXTERNAL / BEHAVIOR | `prisma/schema.prisma:4-10` | Measurement strategy |
| `AnalysisSpec.outputType` (pipeline stage) | EXTRACT / SCORE_AGENT / AGGREGATE / REWARD / ADAPT / SUPERVISE / COMPOSE | `prisma/schema.prisma` + `pipeline-001-pipeline-configuration-spec.json:15-18` | Canonical pipeline ordering |
| `BehaviorTargetScope` | SYSTEM / PLAYBOOK / SEGMENT / CALLER | `prisma/schema.prisma:337-344` | Cascade override (lower wins) |
| `GoalType` | LEARN / ACHIEVE / CHANGE / CONNECT / SUPPORT / CREATE | `prisma/schema.prisma:141-147` | Goal classification |
| `DomainKind` | INSTITUTION / COMMUNITY | `prisma/schema.prisma:541-544` | Terminology + wizard defaults |
| `SegmentType` | COMPANY / COMMUNITY / DOMAIN / COHORT | `prisma/schema.prisma:513-518` | Multi-tenant scoping |
| `GroupType` | DEPARTMENT / YEAR_GROUP / DIVISION / TRACK / CUSTOM | `prisma/schema.prisma:546-551` | Org chart |

### 3.1 ContentAssertion.category — full taxonomy

**Tutor-only (`INSTRUCTION_CATEGORIES`, 14 values):**

`teaching_rule` · `session_flow` · `scaffolding_technique` · `skill_framework` · `communication_rule` · `assessment_approach` · `differentiation` · `edge_case` · `learner_model` · `session_override` · `content_strategy` · `session_metadata` · `skill_description` · `assessment_guidance`

**Learner-facing (10 values):**

`factual_claim` · `definition` · `rule` · `procedure` · `vocabulary` · `key_term` · `concept` · `threshold` · `reading_passage` · `example`

The split is enforced at `lib/prompt/composition/SectionDataLoader.ts:548` (excludes INSTRUCTION_CATEGORIES from learner content) and `:568` (includes them in courseInstructions).

### 3.2 Front-matter content declarations (tune-by-doc)

Educators can declare classification intent at the head of an uploaded markdown doc. Declared values **override AI inference** when the document is classified, extracted, and persisted. Implemented in `lib/content-trust/parse-content-declaration.ts`; stored on `ContentSource.contentDeclaration` (JSONB).

Two supported surface forms:

**YAML front-matter (preferred):**

```yaml
---
hf-document-type: COURSE_REFERENCE
hf-default-category: session_flow
hf-audience: tutor-only
hf-lo-system-role: TEACHING_INSTRUCTION
hf-question-assessment-use: TUTOR_ONLY
---
```

**Blockquote header (matches existing IELTS-style docs):**

```
# Title

> **Document type:** COURSE_REFERENCE · **Intended assertion category:** `session_flow` · **LO systemRole:** TEACHING_INSTRUCTION · **Audience: tutor-only**
```

Supported keys + the enum they map to:

| Declaration key | Maps to | Allowed values |
|-----------------|---------|----------------|
| `hf-document-type` | `ContentSource.documentType` | `DocumentType` enum (§3) — invalid values rejected, AI fallback |
| `hf-default-category` | `ContentAssertion.category` fallback | INSTRUCTION_CATEGORIES + learner-facing categories (§3.1) |
| `hf-audience` | (informational; future filter) | `learner` / `tutor-only` / `assessor-only` |
| `hf-lo-system-role` | `LearningObjective.systemRole` | `LoSystemRole` enum — every LO from the doc gets this role |
| `hf-question-assessment-use` | `ContentQuestion.assessmentUse` | `AssessmentUse` enum — every question from the doc gets this value |

**AI-to-DB guard:** declared values are validated against the canonical enum surface in `parse-content-declaration.ts`. Unknown values produce a warning and the consumer falls back to AI inference for that field. Declarations CANNOT inject arbitrary values into DB enums (see `.claude/rules/ai-to-db-guard.md`).

**Stamping:** when the educator declared `hf-document-type`, `ContentSource.documentTypeSource` becomes `"declared:by-doc"` (instead of `ai:<confidence>`). When the educator declared `hf-lo-system-role`, the LO's `LoClassification.classifierVersion` becomes `"declared-by-doc-v1"` so re-runs can tell which decisions came from the doc.

### 3.3 Pipeline stage spec slugs (canonicals)

Specs in `docs-archive/bdd-specs/` are seed data — they become `AnalysisSpec` rows after seed. Slugs in `lib/config.specs.*` are env-overridable. The 16 active spec slugs gate which spec the runner uses for each stage.

**Canonical pipeline stage table, ordering invariant, parallel rules, per-stage reads/writes, ADAPT sub-ops, and SUPERVISE clamp behaviour live in [`docs/PIPELINE.md`](./PIPELINE.md).** Read it before adding a stage, runner, or cross-stage DB write — `route.ts` line numbers drift and the executor key names (e.g. `SCORE_AGENT`) differ from `AnalysisOutputType` enum values (`MEASURE_AGENT`).

Other spec families:
- `composition-*` specs — section loader configuration
- `extraction-*` specs — per-DocumentType extraction strategy
- `init-001` — welcome flow phases
- `tut-*` — tutor session phases

---

## 4. Data flow — full path

### Phase 1: Upload

| Route | Trigger | Persists |
|-------|---------|----------|
| `POST /api/course-pack/ingest` | Wizard bulk ingest | N × `ContentSource` (+ AI documentType), `MediaAsset`, `SubjectSource`, `PlaybookSource` |
| `POST /api/subjects/:id/upload` | Single-file upload | Same models, single row each |
| `POST /api/content-sources/:id/import` | Manual extraction trigger | Re-runs extraction on existing source |

**AI documentType classification** at `lib/content-trust/classify-document.ts` — first 8KB → `{ documentType, confidence }`. Stored on `ContentSource.documentType` + `documentTypeSource: "ai:<conf>"`. Admin override sets `classificationCorrected: true`.

**Dedup** by SHA-256 of bytes within institution scope (`lib/content-trust/dedup-source.ts`). If hit, links new `SubjectSource` / `PlaybookSource` to existing `ContentSource`.

### Phase 2: Extraction

Router at `lib/content-trust/resolve-config.ts` picks the extractor by `documentType`:

| documentType | Extractor | Produces |
|--------------|-----------|----------|
| CURRICULUM | Heading parser | `CurriculumModule`, `LearningObjective` |
| **COURSE_REFERENCE** | **Projection (Phase 2.5) + standard extraction** ↓ | `Playbook.config.{modules, outcomes, progressionMode, sessionOverrides}` + `Goal` (LEARN + ACHIEVE) + `BehaviorTarget` + `CurriculumModule` + `ContentAssertion` |
| TEXTBOOK | Chunked LLM | `ContentAssertion` pyramid |
| QUESTION_BANK | Q/A pair extractor | `ContentQuestion` |
| WORKSHEET / EXAMPLE / etc. | Variant of TEXTBOOK | `ContentAssertion` |
| LESSON_PLAN | Activity-by-activity | `ContentAssertion` per activity |
| ASSESSMENT | Question + rubric | `ContentQuestion` + `ContentAssertion` |

**COURSE_REFERENCE — two-path treatment:**

1. **Phase 2.5 Projection** — Path A below; deterministic doc → DB rows, bypasses LLM extraction.
2. **Standard extraction** — Path B below; remaining markdown flows through the TEXTBOOK-style extractor → `ContentAssertion` rows with `category IN INSTRUCTION_CATEGORIES`.

### Phase 2.5: Projection (COURSE_REFERENCE → derived rows)

**Since epic #338 (2026-05-12).** The COURSE_REFERENCE doc is the deterministic source-of-truth for a course's pedagogy config. One pure function + one idempotent applier replaces the scattered hand-coded writes that previously left courses with missing Goals, BehaviorTargets, and CurriculumModule rows.

```
projectCourseReference(courseRefContent, opts) ─▶ CourseProjection (pure, no side effects)
applyProjection(playbookId, projection)         ─▶ idempotent diff, keyed by (playbookId, sourceContentId, slug/name)
```

Planned files: `lib/wizard/project-course-reference.ts`, `lib/wizard/apply-projection.ts`. The projection composes existing helpers (`detect-authored-modules.ts`, `detect-pedagogy.ts`, `parse-content-declaration.ts`) and adds two new parsers (`parseSkillsFramework`, `parseOutcomesToGoals`).

**Projection contract — doc structure → derived rows:**

| Course-ref section | Parsed by | Writes |
|---|---|---|
| Front-matter (`hf-*`) | `parse-content-declaration.ts` | `ContentSource.contentDeclaration` (already shipped) |
| `**Modules authored:** Yes` + `## Modules` table | `detect-authored-modules.ts` | `Playbook.config.{modulesAuthored, moduleSource, modules[], moduleDefaults, moduleSourceRef}` **plus `CurriculumModule` row per module (all modes incl. `examiner` and `sessionTerminal: true`)** |
| Any module with `learnerSelectable !== false` | `detect-authored-modules.ts` | `Playbook.config.progressionMode: "learner-picks"` |
| `**OUT-NN: …**` lines | `extractOutcomeStatements()` (existing) + projection mapper | `Playbook.config.outcomes` (already) **plus LEARN goal templates in `Playbook.config.goals` per OUT-NN** |
| `### SKILL-NN: …` + Emerging/Developing/Secure tiers | `parseSkillsFramework()` (new, in `project-course-reference.ts`) | **ACHIEVE goal templates (`isAssessmentTarget: true`) in `Playbook.config.goals` + `BehaviorTarget` rows (scope: PLAYBOOK) + `Parameter` upsert by `skill_<slugified>` name** |
| `LearningObjective` rows with `systemRole = ASSESSOR_RUBRIC` (extracted from `assessor-rubric.md` etc.) | post-classification projection re-run | Same as SKILL-NN when criteria-shaped — produces an ACHIEVE goal template per criterion |
| `**Session scope:** N` headers (extracted assertions) | compose-time `pedagogy.ts` reader | `Playbook.config.sessionOverrides` (already; read by `pedagogy.ts` to REPLACE `onboardingFlowPhases` for matching `callNumber`) |
| `Call duration: …`, `decides call-by-call`, `soft cap N calls` | `detect-pedagogy.ts` | `Playbook.config` pedagogy hints (already shipped) |

**Goal templates vs Goal rows:** projection writes goal *templates* into `Playbook.config.goals` — it does NOT write directly to the relational `Goal` table. The applier persists templates and either (a) leaves per-Caller instantiation to the existing `instantiatePlaybookGoals()` pathway at enrolment time, or (b) eagerly re-instantiates for already-enrolled Callers (Phase 4 decision). Per-Caller `Goal` rows carry `sourceContentId` so the diff still works across enrolments.

**Provenance:** every row written by `applyProjection` carries `sourceContentId` (nullable FK on `Goal`, `BehaviorTarget`, `CurriculumModule`). Re-running the projection diffs by `(playbookId, sourceContentId, slug/name)` — re-runs are no-ops, and removing the source removes its derived rows cleanly.

**Triggers:**
- Wizard `create_course` — directly after the wizard subset is written, IF a `PlaybookSource` links to a COURSE_REFERENCE source. Else log `[projection] no COURSE_REFERENCE source on playbook=…` and skip Path A (a course with no course-ref is degenerate by design).
- Re-process trigger — on doc replace/edit (manual button on source page).
- Post-`reclassifyLearningObjectives` — catches late-arriving `ASSESSOR_RUBRIC` LOs so an updated rubric flows into ACHIEVE goals without manual intervention.

**Race safety:** projection skips gracefully when `ContentSource.textSample` is null (extraction not yet complete). The re-process trigger picks it up later.

**Disjoint write paths into Playbook.config:**

| Subset | Written by | Fields |
|---|---|---|
| Wizard subset | `applyStudentExperienceConfig()` (`lib/chat/wizard-tool-executor.ts`) | `welcome`, `nps`, `surveys`, `schedulerPresetName` |
| Projection subset | `applyProjection()` (planned `lib/wizard/apply-projection.ts`) | `modules`, `moduleDefaults`, `modulesAuthored`, `moduleSource`, `outcomes`, `progressionMode`, `moduleSourceRef` |

The two subsets are disjoint — no field is written by both. **Wizard never authors a course-ref doc; it only ingests one.**

**Scope:** projection applies only to courses **created on or after 2026-05-12**. The `sourceContentId` FKs ship as nullable; existing rows are not backfilled. Legacy courses retain whatever Goals / BehaviorTargets / CurriculumModule rows they have (typically: none from this path).

### Phase 3: Classification (LO audience)

`lib/content-trust/classify-lo.ts` — heuristic regex first, LLM fallback. Each LO gets a `systemRole` from `LoSystemRole` enum.

Triggered by:
- During extraction (initial)
- `POST /api/curricula/:id/reclassify-los` (manual or post-edit)
- `reconcileOrphans` (background)

Each classification stored in `LoClassification` history; applied to `LearningObjective.systemRole` unless `humanOverriddenAt` is set.

### Phase 4: Prompt assembly

`lib/prompt/composition/SectionDataLoader.ts` runs 20 parallel loaders. Content-relevant ones:

| Loader (file:line) | Pulls | Filter | Lands in prompt as |
|--------------------|-------|--------|---------------------|
| `::registerLoader("subjectSources")` | Source metadata | subject-scoped — NO `playbookId` filter (metadata only; see L4) | Reference list |
| `::registerLoader("curriculumAssertions")` | Learner-facing TPs | `subjectSourceId IN (course's SubjectSources)` + `category NOT IN INSTRUCTION_CATEGORIES` (strict — no null fallback) | Module teaching content |
| `::registerLoader("courseInstructions")` | Tutor-only TPs + TEACHING_INSTRUCTION LOs | `category IN INSTRUCTION_CATEGORIES` OR `sourceId IS COURSE_REFERENCE` + `systemRole=TEACHING_INSTRUCTION` LOs | TEACHING RULES (tutor-only) |
| `::registerLoader("curriculumQuestions")` | MCQs | course-scoped | Assessment section |
| `::registerLoader("curriculumVocabulary")` | Vocab | course-scoped | Vocabulary section |
| `::registerLoader("visualAids")` | Media (images) | `subjectId + mimeType` + `documentType NOT IN TEACHER_ONLY_DOC_TYPES` (since 2026-05-10) | Media palette |

All cells reference `lib/prompt/composition/SectionDataLoader.ts`. Citations use symbol form (`::registerLoader("<name>")`) — line numbers move; symbols don't.

Modules and learner-visible LOs (`systemRole=NONE`) flow into the prompt via the **transforms** layer (`lib/prompt/composition/transforms/modules.ts`), not a dedicated loader. They're derived from `CurriculumModule` + `LearningObjective` filtered by `learnerVisible=true`.

---

## 5. Conflict matrix — overlapping classifications

When two dimensions both classify the same thing, this is the resolution rule.

### 5.1 "This is tutor-only / not learner-facing"

| Layer | Gate | Authoritative? |
|-------|------|----------------|
| **Assertion** | `category IN INSTRUCTION_CATEGORIES` | **YES — at `SectionDataLoader.ts:568`** |
| **LO** | `systemRole != NONE` → `learnerVisible=false` | **YES — at `lib/curriculum/lo-audience.ts:28-31`** |
| **Question** | `assessmentUse=TUTOR_ONLY` | **YES — at `lib/assessment/pre-test-builder.ts:82`** |
| **Module** | `learnerSelectable=false` | **YES — at module picker render** |
| Source | `documentType=COURSE_REFERENCE` | **NO — hint only, does NOT filter loaders** |

### 5.1a "Declared override vs AI inference" (§3.2)

When a doc carries a front-matter declaration (`hf-document-type`, `hf-lo-system-role`, `hf-default-category`, `hf-question-assessment-use`), the declared value **always wins** over AI inference. AI runs only as fallback when the field is absent or the declared value fails enum validation.

| Layer | Declared override | AI fallback |
|-------|-------------------|-------------|
| `ContentSource.documentType` | `hf-document-type` → `documentTypeSource: "declared:by-doc"` | `classifyDocument()` → `documentTypeSource: "ai:<conf>"` |
| `ContentAssertion.category` | `hf-default-category` fills invalid AI categories | AI category from extraction prompt |
| `LearningObjective.systemRole` | `hf-lo-system-role` → `classifierVersion: "declared-by-doc-v1"` | heuristic-v1 → llm:<model> |
| `ContentQuestion.assessmentUse` | `hf-question-assessment-use` → forced on every row | extractor's per-question value |

Educators can therefore tune classification by editing the doc, not the code. See `lib/content-trust/parse-content-declaration.ts`.

**Rule:** `documentType=COURSE_REFERENCE` does NOT automatically hide content from the learner. The per-row classification (`category`, `systemRole`, `assessmentUse`) is the authoritative gate. **If you upload a COURSE_REFERENCE doc and its content is mis-categorised as `factual_claim` instead of `teaching_rule`, it WILL leak to the learner.**

### 5.2 "This is assessment / scoring content"

| Layer | Gate | What it does |
|-------|------|--------------|
| Source | `documentType IN (ASSESSMENT, QUESTION_BANK)` | Routes extraction to question parser |
| Assertion | `category IN (assessment_approach, assessment_guidance)` | Tutor-only assessment instructions |
| LO | `systemRole=ASSESSOR_RUBRIC` | Lands in scoring rubric prompt |
| LO | `systemRole=ITEM_GENERATOR_SPEC` | Boundary spec for MCQ generator |
| Question | `assessmentUse IN (PRE_TEST, POST_TEST)` | Test eligibility |

**Resolution rule:** Document type drives extraction shape; per-row classification drives runtime visibility. They are NOT redundant — they operate at different phases.

### 5.3 "Teaching style"

| Dimension | Orthogonal to | Composed by |
|-----------|---------------|-------------|
| `teachingMode` (recall/comprehension/practice/syllabus) | `interactionPattern` | Scheduler preset selection |
| `interactionPattern` (socratic/directive/…) | `teachingMode` | Voice prompt injection |
| `schedulerPresetName` | both | Adaptive loop weights |

**No conflict** — these are intentionally orthogonal. `teachingMode=syllabus` + `interactionPattern=socratic` is valid (the AI asks Socratic questions to drive learner through a syllabus). Both flow into the prompt simultaneously.

### 5.4 "Audience"

| Layer | Value | Used? |
|-------|-------|-------|
| `Playbook.audience` | string (higher-ed / k12-…) | ⚠ **NOT used as a content filter anywhere**. Stored, possibly displayed, never gates a query. |
| `Caller.role` | LEARNER / TEACHER / … | Permission scoping only. NOT content filter. |
| `LearningObjective.learnerVisible` | true / false | **Authoritative content visibility gate**, at `lo-audience.ts:28-31` |

**Rule:** for learner-visibility, only `learnerVisible` (derived from `systemRole`) matters. The other two dimensions are stored but inert.

---

## 6. Veto precedence — "is this content shown to the learner?"

Walk **top to bottom**. First veto wins.

| # | Layer | Veto condition | Where |
|---|-------|----------------|-------|
| 0 | Source declaration | `hf-audience: tutor-only` (or `assessor-only`) in `ContentSource.contentDeclaration` | parse-content-declaration.ts — informational today; future loader filters will read this before assertion/LO/question gates |
| 1 | Assertion | `category IN INSTRUCTION_CATEGORIES` | `SectionDataLoader.ts::registerLoader("curriculumAssertions")` excludes; `::registerLoader("courseInstructions")` includes |
| 2 | LO | `systemRole != NONE` → `learnerVisible=false` | `validate-lo-classification.ts:70` |
| 3 | Question | `assessmentUse=TUTOR_ONLY` | `pre-test-builder.ts:82` |
| 4 | Module | `learnerSelectable=false` | Picker render |
| 5 | Module | `frequency=once` AND module in `completedModuleIds` | Picker render |
| 6 | (DEAD) | `Playbook.audience`, `Caller.role` | Currently not used as filters |

**Important:** there's NO veto at the document/source level. `documentType=COURSE_REFERENCE` is a hint, not a gate. If a row inside that document is categorised as a `factual_claim`, it WILL appear to the learner.

---

## 7. Specs / canonicals

**Specs in DB** (seeded from `docs-archive/bdd-specs/`):
- Pipeline stage configuration (`pipeline-001-pipeline-configuration-spec.json`)
- Composition section loaders (`composition-*`)
- Extraction strategies (`extraction-*`)
- Welcome flow phases (`init-001`)
- Tutor session phases (`tut-*`)

**Spec slugs** (env-overridable) in `lib/config.ts` under `config.specs.*`.

> **Canonical expansion:** [`docs/SPEC-SYSTEM.md`](./SPEC-SYSTEM.md) is the authoritative map for `SpecRole` taxonomy (§2), `scaffoldDomain` materialisation (§3), `systemSpecToggles` resolution (§4), the 4-layer `extendsAgent` chain (§5), and the full `config.specs.*` catalogue (§6). Read it before changing any spec slug or scaffold behaviour.

**DataContracts** registry at `lib/contracts/registry.ts` — 30s TTL cache. Contracts gate which composition sections fire. No registered DataContract has a missing consumer at last audit (May 2026), but no validation enforces this — if you add a contract, also add a consumer.

**Pipeline order is strict:** `EXTRACT < SCORE_AGENT < AGGREGATE < REWARD < ADAPT < SUPERVISE < COMPOSE`. Specs register `outputType`; the runner enforces ordering. Inserting a new stage anywhere other than between existing stages requires changing the canonical ordering in `pipeline-001`.

---

## 8. Known landmines (and the fix or workaround)

| # | Landmine | Where | Status / fix |
|---|----------|-------|--------------|
| L1 | **`visualAids` loader has no `documentType` filter** — COURSE_REFERENCE-typed sources' media leak to learner | `SectionDataLoader.ts:1163-1230` | ✓ FIXED 2026-05-10 — `visualAids` now excludes tutor-only docs via `isTutorOnlyDocumentType` (aligned with `TEACHER_ONLY_DOC_TYPES` in `lib/doc-type-icons.ts`); `subjectSources` returns each source with a `tutorOnly` boolean so any future palette-building consumer can drop it deterministically. |
| L2 | **MCQ types `MATCHING` / `UNSCRAMBLE` / `ORDERING`** extracted but never rendered | `retrieval-question-selector.ts:33` | ⚠ Either render them or remove from extractor output |
| L3 | **`Playbook.audience` stored but never filtered** | `prisma/schema.prisma:3090` | ⚠ Either wire as a filter or drop the field |
| L4 | **`Caller.role` not used for content visibility** — only access control | `lib/permissions.ts` | Intentional but easy to misread |
| L5 | **Multiple playbooks per subject race** — pipeline can pick the wrong one if `CallerPlaybook` enrollment missing | `lib/domain/generate-content-spec.ts:249` | ✓ FIXED in #318 (May 9) — 3 sites patched, `playbookId` threaded |
| L6 | **`progressionMode=learner-picks` + no Module Catalogue** = unrecoverable empty picker | `wizard-tool-executor.ts` | ✓ FIXED in #318 (May 9) — cross-field validator |
| L7 | **`loadCurrentModuleContext` bypassed when `requestedModuleId` provided** — code that assumed scheduler ran fails silently | `lib/ops/pipeline-run.ts` | Partial fix in #242 Slice 2; no formal guard |
| L8 | **Wizard validator drops unknown keys silently** (`modulesAuthored`, `constraints`) | `validate-setup-fields.ts` | ✓ FIXED in current PR (May 10) — now returns `is_error` to AI |
| L9 | **`create_course` returns 200 with empty curriculum** — silent success when Module Catalogue parse fails | `wizard-tool-executor.ts` create_course handler | ✓ FIXED in current PR — hard gate added |
| L10 | **Dead extraction categories** `plenary`, `starter` in LESSON_PLAN config | `lib/content-trust/resolve-config.ts:~535` | ⚠ Remove or wire |

---

## 9. Dead enum cleanup queue

| Value | Defined at | Status |
|-------|-----------|--------|
| `User.role=VIEWER` | `schema.prisma:295` | Deprecated alias for TESTER — kept for back-compat |
| `QuestionType.MATCHING` | `schema.prisma:55-63` | Extracted but not rendered (L2) |
| `QuestionType.UNSCRAMBLE` | `schema.prisma:55-63` | Extracted but not rendered (L2) |
| `QuestionType.ORDERING` | `schema.prisma:55-63` | Extracted but not rendered (L2) |
| `ContentAssertion.category` `plenary`, `starter` | `resolve-config.ts:~535` | Defined for LESSON_PLAN, never read elsewhere (L10) |
| `Playbook.audience` | `schema.prisma:3090` | Inert field (L3) |

Don't delete without doing a final grep across `apps/`, `tests/`, and `docs-archive/bdd-specs/` — some appear only in spec JSON.

---

## 10. Pre-change checklist

Before merging a PR that touches any classification dimension, confirm:

### Adding a `@canonical-doc` marker to a new file

Files cited by canonical docs carry a `@canonical-doc` JSDoc marker so the drift checker (`apps/admin/scripts/check-doc-citations.ts`, issue #329) can detect rot at commit time. To add the marker:

1. Add the JSDoc at the top of the file (or a `//` comment for `.prisma`):
   ```ts
   /**
    * @canonical-doc docs/CONTENT-PIPELINE.md §4
    * @canonical-doc docs/ENTITIES.md §3
    */
   ```
2. Run `npm run docs:citations` (from `apps/admin/`) to confirm the doc you named exists and your `file::symbol` refs resolve.
3. The pre-commit hook will warn on future commits to that file if citations break.

The marker is informational — `§N` section refs are NOT machine-checked. The script only validates that `file::symbol` references in canonical docs resolve.

### Adding a new `documentType`

- [ ] Add enum value to `prisma/schema.prisma` and migrate.
- [ ] Add extractor entry in `lib/content-trust/resolve-config.ts` (which categories does it produce?).
- [ ] If the type should be tutor-only by default, update `INSTRUCTION_CATEGORIES` or document why it isn't.
- [ ] Update `classifyDocument` few-shot examples in `lib/content-trust/classify-document.ts`.
- [ ] Update `visualAids` filter once L1 is fixed (filter by allow-list, not block-list).
- [ ] **Update `DOCUMENT_TYPES` allow-list in `lib/content-trust/parse-content-declaration.ts` (§3.2 declaration parser).**
- [ ] Update §3 in this doc.

### Adding a new `ContentAssertion.category`

- [ ] Add to the enum surface in `resolve-config.ts`.
- [ ] Decide: tutor-only or learner-facing? Add to `INSTRUCTION_CATEGORIES` if tutor-only.
- [ ] Add a loader filter in `SectionDataLoader.ts` if the category needs its own prompt section.
- [ ] **Update `ASSERTION_CATEGORIES` allow-list in `lib/content-trust/parse-content-declaration.ts` so educators can declare it as `hf-default-category`.**
- [ ] Update §3.1.

### Adding a new `LoSystemRole`

- [ ] Update enum in `prisma/schema.prisma` and migrate.
- [ ] Update `lib/content-trust/classify-lo.ts` heuristics + LLM prompt.
- [ ] Update `validate-lo-classification.ts` invariants.
- [ ] Decide which prompt channel the new role surfaces in. Wire the consumer.
- [ ] **Update `LO_SYSTEM_ROLES` allow-list in `lib/content-trust/parse-content-declaration.ts` so educators can declare it as `hf-lo-system-role`.**
- [ ] Update §6 veto table.

### Adding a new `AssessmentUse`

- [ ] Update enum in `prisma/schema.prisma` and migrate.
- [ ] Update consumers (pre-test-builder, MCQ selector).
- [ ] **Update `ASSESSMENT_USES` allow-list in `lib/content-trust/parse-content-declaration.ts` so educators can declare it as `hf-question-assessment-use`.**
- [ ] Update §5.2.

### Adding a new audience or scope dimension

- [ ] Don't add to `Playbook.audience` — it's dead. Either wire it up first, or create a different field.
- [ ] If wiring a new audience filter, add it to the §6 veto table AND `lo-audience.ts`.
- [ ] If a scope (segment / cohort / etc.), check the `BehaviorTargetScope` cascade for precedent.

### Adding a new Module mode / frequency / behaviour

- [ ] If the new behaviour can run silently (i.e. AI auto-selects), confirm `loadCurrentModuleContext` handles it. L7.
- [ ] Add `requestedModuleId` guard if you allow learner-picks-style direct selection.
- [ ] Update `AuthoredModulesPanel` empty-state — it must show an action button for the new state. (May 10 incident.)

### Adding a new pipeline stage

- [ ] Update `pipeline-001-pipeline-configuration-spec.json` canonical ordering.
- [ ] Add spec runner.
- [ ] Confirm no consumer downstream depends on a stage that no longer runs first.

---

## 11. Where to intervene for common problems

| Problem | First check | Then |
|---------|-------------|------|
| Tutor is quizzing on test mechanics | LO classifier — is the LO `TEACHING_INSTRUCTION`? | Run reclassify-los; or edit course-ref.md to add the rule explicitly |
| Wrong content surfacing to learner | §6 veto table — which dimension should be blocking? | Add filter at that layer |
| Module picker empty | `Playbook.config.modules` populated? `modulesAuthored=true`? | Re-import course-ref.md OR run `import-modules` POST |
| Curriculum on wrong playbook | `CallerPlaybook` enrollment correct? | L5 — already fixed but check the 3 patched sites |
| MCQ asking meta-questions | LOs that feed MCQ pool — any `TEACHING_INSTRUCTION` slipping in? | `lib/assessment/module-groups.ts` filter must exclude all `systemRole != NONE` |
| AI sent a doc to learner | `visualAids` / `subjectSources` loader filtering | L1 — fixed 2026-05-10. `visualAids` filters tutor-only docs; `subjectSources` now exposes `tutorOnly`; `share_content` tool (`app/api/chat/tools.ts`) still gates by `isStudentVisibleDefault`. If a leak recurs, check the documentType classification on the source — `COURSE_REFERENCE` misclassified as `TEXTBOOK` will pass through. |
| Generic welcome fires instead of course-ref First-Call rules | Does `course-ref.md` have `**Session scope:** 1` markers? | Extractor produces `category=session_override` `section="1"` rows; compose-time `pedagogy.ts` REPLACES `onboardingFlowPhases` when a `session_override` matches the current `callNumber`. Watch for the `[compose] course-ref First-Call rules override …` log line — its absence means either no override is parsed or the call number doesn't match. Fixed 2026-05-10. |
| I want to see what the tutor will say before the call | Click **Test First Call** on the course page (`/x/courses/:id`) | Opens the dry-run modal: composed prompt, section breakdown, and `compose-trace` (loaders fired, media palette, onboarding-flow source). No call is created. |
| Why did the tutor's prompt change after I edited course-ref.md? | Open the latest ComposedPrompt at `/x/composed-prompts/:id` | "Compare with previous" dropdown — diff against the prior prompt for the same course (uses `diff` lib, inline highlighting). |
| What did each loader actually pull? | Look at `[compose-trace]` block in server logs, or the **Trace** tab in the dry-run modal / ComposedPrompt viewer | Shows: loaders fired vs empty, assertion warnings, onboarding-flow source (Playbook / Domain / Spec), final media palette filenames + documentType. |
| Course has no ACHIEVE goals or BehaviorTargets after wizard ran | Was a COURSE_REFERENCE source linked via `PlaybookSource` at `create_course` time? Does the course-ref doc have a `## Skills Framework` section (`SKILL-NN` with Emerging/Developing/Secure tiers) or any `LearningObjective.systemRole = ASSESSOR_RUBRIC` rows? | Re-process the source (admin button) — re-runs `projectCourseReference()` → `applyProjection()`. Look for `[projection] applied N rows for playbook=…` in server logs. Absence usually means no COURSE_REFERENCE source linked (course is degenerate) or `textSample` was null (extraction race — re-process resolves it). |
| Course has duplicate goals after re-running the wizard | `Goal` rows for this playbook with same `(name, type)` and different `sourceContentId` (or null)? | Pre-projection legacy duplicates can't auto-dedup. Projection writes are idempotent for NEW courses (since 2026-05-12) — re-runs against the same `sourceContentId` produce no-op diffs. For legacy duplicates, edit the DB manually. |
| Module table has fewer rows than `Playbook.config.modules` | `CurriculumModule` rows for this playbook — any `mode: examiner` rows missing? | The projection writes ALL modes incl. `examiner` + `sessionTerminal: true`. If missing, the projection didn't run — re-process the source. |

---

## 12. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. |
| 2026-05-10 | L1 fixed — `visualAids` + `subjectSources` filter / flag tutor-only docs. §11 row updated. New row added: "Generic welcome fires instead of course-ref First-Call rules" — compose-time `session_override` REPLACES `onboardingFlowPhases` for matching `callNumber`. Helpers: `isTutorOnlyDocumentType` (`SectionDataLoader.ts`), `deriveSessionOverridePhases` (`transforms/pedagogy.ts`). Closes #323, #324. |
| 2026-05-10 | §11 expanded with three tuning-velocity entries: **Test First Call** dry-run button on the course page (`POST /api/courses/:id/dry-run-prompt`), ComposedPrompt diff viewer at `/x/composed-prompts/:id`, and the `[compose-trace]` observability block emitted by `CompositionExecutor`. No schema or veto-precedence changes. Closes #319. |
| 2026-05-11 | Front-matter content declarations (`ContentSource.contentDeclaration`) override AI classification across documentType, defaultCategory, loSystemRole, questionAssessmentUse. New §3.2 + §5.1a + §6 row 0 + §10 pre-change items. Parser: `lib/content-trust/parse-content-declaration.ts`. Stamping: `documentTypeSource: "declared:by-doc"`, `LoClassification.classifierVersion: "declared-by-doc-v1"`. Closes #325. |
| 2026-05-11 | Cross-linked to `ENTITIES.md` (data model + boundary). Switched loader citations in §3.1, §4 and §6 to symbol form (`::registerLoader("<name>")`) — line refs had drifted (e.g. visualAids 1071 → actual 1163). Symbols survive refactors. Closes #322. |
| 2026-05-12 | **§4 — COURSE_REFERENCE projection contract (Phase 2.5).** Replaces the prior "dual-path" description. One pure `projectCourseReference()` + one idempotent `applyProjection()` covers the full doc→DB mapping: Modules → `CurriculumModule` (all modes incl. examiner); OUT-NN → LEARN `Goal` rows; SKILL-NN tiers and `ASSESSOR_RUBRIC` LOs → ACHIEVE `Goal` rows + `BehaviorTarget` rows + `Parameter` upsert; pedagogy hints → `Playbook.config`. Disjoint from the wizard's subset (`welcome` / `nps` / `surveys` / `schedulerPresetName`). Provenance via `sourceContentId` (nullable FK on `Goal`, `BehaviorTarget`, `CurriculumModule`). Re-runs idempotent for NEW courses (created on/after 2026-05-12); no backfill. Wizard never authors a course-ref — only ingests. §11 expanded with troubleshooting rows for missing ACHIEVE goals / BehaviorTargets / examiner-mode CurriculumModule. Epic #338. Supersedes #337. Originating defects from IELTS Speaking pack #336. |
| 2026-05-12 | **§4 — pure `projectCourseReference()` shipped (epic #338 Phase 3).** Implementation in `lib/wizard/project-course-reference.ts` with 21 vitest cases passing. Composes existing parsers (`detect-authored-modules`, `detect-pedagogy`, `parse-content-declaration`) + new `parseSkillsFramework()` that accepts both v3.0 (`**Emerging:**`) and v2.2 (`**Emerging.**`) tier punctuation. Parameters slugified by `skillNameToParameterName()` (e.g. "Fluency & Coherence" → `skill_fluency_and_coherence`). Skills Framework Secure tier → `BehaviorTarget.targetValue = 1.0`. Two clarifications added to the contract: projection writes goal *templates* into `Playbook.config.goals` (not directly to the relational `Goal` table — instantiation per-Caller is the applier's call); ASSESSOR_RUBRIC LO path remains DB-driven (post-`reclassifyLearningObjectives`) and stays out of the pure function. Phase 4 applier still planned. |

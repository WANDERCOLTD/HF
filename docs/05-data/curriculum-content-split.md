# Curriculum vs Content — Data Model Split

<!-- @doc-source model:Curriculum,CurriculumModule,LearningObjective,ContentSource,ContentAssertion,ContentQuestion,PlaybookSource -->
<!-- @doc-source file:apps/admin/lib/prompt/composition/SectionDataLoader.ts -->
<!-- @doc-source file:apps/admin/lib/prompt/composition/transforms/modules.ts -->
<!-- @doc-source file:apps/admin/lib/prompt/composition/transforms/teaching-content.ts -->
<!-- @doc-source file:apps/admin/lib/curriculum/sync-modules.ts -->
<!-- @doc-source file:apps/admin/lib/wizard/sync-authored-modules-to-curriculum.ts -->
<!-- @doc-source file:apps/admin/lib/content-trust/reconcile-lo-linkage.ts -->

**Status:** Reference. Read this before assuming the curriculum layer and the content layer are joined by FK at query time — they aren't.

---

## Why this doc exists

A common onboarding mistake: assume `Curriculum` → `CurriculumModule` → `LearningObjective` and `ContentSource` → `ContentAssertion` → `ContentQuestion` are tightly joined and that prompt loaders walk the curriculum hierarchy down to assertions.

They aren't. There are **two parallel hierarchies** with two different jobs, bridged by the **scheduler** at compose time. Building filtering or routing logic on the wrong layer (or assuming the FK is always populated) will silently produce empty or duplicated content.

---

## The two layers

### Curriculum layer — *journey + mastery*

```
Curriculum
└─ CurriculumModule (slug, title, sortOrder)
   └─ LearningObjective (ref e.g. "LO1" / "OUT-01", description, masteryThreshold)
```

**Drives:**
- Module picker UI (`/x/student/[courseId]/modules`)
- Per-module mastery rows (`CallerModuleProgress`)
- Working-set selection at compose time (which LOs are "in scope" this session)
- Pipeline EXTRACT scoring against module LOs

**Created by:**
- AI extraction pipeline → `lib/curriculum/sync-modules.ts` (skeleton from extracted assertions)
- Authored-module markdown import → `lib/wizard/sync-authored-modules-to-curriculum.ts`

**Not directly queried by the section data loaders.** The scheduler reads it; the loaders don't.

### Content layer — *teaching material*

```
ContentSource (uploaded PDF/doc, with documentType + trustLevel)
├─ ContentAssertion (extracted facts, rules, examples; carries learningOutcomeRef + learningObjectiveId)
└─ ContentQuestion  (extracted/generated MCQs; carries learningOutcomeRef)
```

**Drives:**
- Teaching-content section in the runtime prompt
- MCQ pool for pre-test, post-test, in-call retrieval practice
- Vocabulary, visual aids, instruction extraction

**Created by:**
- Upload → extraction pipeline (`CONTENT-EXTRACT` spec)
- AI-generated MCQs (`lib/assessment/generate-mcqs.ts`) when extraction yields zero questions

**Course scope:** `Playbook → PlaybookSource → ContentSource` (Phase 6 authoritative path).

---

## How they link

`ContentAssertion` carries **two** references to the curriculum layer:

| Field | Type | Set by | Meaning |
|---|---|---|---|
| `learningOutcomeRef` | `String?` | Extractor / generator (write time) | The textual ref the AI emitted, e.g. `"LO1"`, `"OUT-01"`. Always present after extraction. |
| `learningObjectiveId` | `String? @relation` | `lib/content-trust/reconcile-lo-linkage.ts` (after curriculum exists) | FK to `LearningObjective.id`. **Only populated after reconciliation runs.** |

The string ref is the **write-time provenance**. The FK is a **post-curriculum backfill** that lets joins happen efficiently once the curriculum layer is populated.

> **Don't assume the FK is always set.** A freshly extracted assertion has `learningOutcomeRef` but not `learningObjectiveId`. Reconciliation runs when `sync-modules.ts` finalises a curriculum.

---

## Where the layers meet — the scheduler

```
                       ┌──────────────────────┐
WIZARD / EXTRACTION    │   Curriculum layer   │
─────────────────────► │  Curriculum          │
                       │   ↳ CurriculumModule │
                       │      ↳ LearningObj.  │
                       └──────────┬───────────┘
                                  │ reads
                                  ▼
                        ┌─────────────────┐
                        │   Scheduler     │ ← lib/prompt/composition/transforms/modules.ts
                        │ computeSharedState
                        └────────┬────────┘
                                 │ produces
                                 ▼
                       sharedState.workingSet = {
                         selectedLOs:   [{ ref, id, moduleId, ... }],
                         assertionIds:  [...],   // teach
                         reviewIds:     [...],   // review
                       }
                                 │
        ┌────────────────────────┴─────────────────────────┐
        │                                                  │
        ▼                                                  ▼
 ┌─────────────────┐                                ┌──────────────┐
 │ Content layer   │   reads workingSet.assertionIds │ teaching     │
 │ ContentSource   │   filters by IDs + LO refs      │ content      │
 │  ↳ Assertion    │ ─────────────────────────────► │ transform    │
 │  ↳ Question     │                                 │              │
 └─────────────────┘                                └──────────────┘
                                                          │
                                                          ▼
                                                   composed prompt
```

**Key invariant:** loaders read assertions/questions **without** joining through the curriculum layer. The scheduler narrows the set by **assertion IDs** (and falls back to `learningOutcomeRef` string match when working set is null). See `teaching-content.ts:471` (`hasSchedulerWorkingSet`) and `teaching-content.ts:529` (`assertionMatchesAnyLoRef`).

---

## What the loaders read

| Loader | Reads | Curriculum layer touched? |
|---|---|---|
| `curriculumAssertions` | `ContentAssertion` (filtered by `contentScope.sources`) | No — string ref only when present |
| `curriculumQuestions` | `ContentQuestion` (filtered by `contentScope.sources`) | No — string ref only when present |
| `curriculumVocabulary` | `ContentVocabulary` (filtered by `contentScope.sources`) | No |
| `subjectSources` | `Subject` taxonomy + sources | No |
| `visualAids`, `courseInstructions` | `MediaAsset` / `ContentAssertion` filtered to instruction categories | No |

The 16 loaders never query `Curriculum`, `CurriculumModule`, or `LearningObjective`. That's the scheduler's job.

---

## Worked example

A learner is enrolled in a course with three modules. They've completed Module 1 (mastery = 0.85, threshold = 0.7) and are on Module 2.

1. **Compose-prompt route** calls `loadAllData(callerId)` → all loaders run in parallel; `curriculumAssertions` returns ~200 assertions across all 3 modules.
2. **Scheduler** (`computeSharedState`) reads `Curriculum.modules`, finds the learner's `CallerModuleProgress`, picks Module 2 as `nextModule`, reads its 4 LOs → selects the 60 assertions whose `learningOutcomeRef` matches Module 2's LOs.
3. **`workingSet.assertionIds`** = those 60 IDs.
4. **`teaching-content`** transform receives all 200 assertions + the working set, filters down to 60, groups them by LO, renders into the prompt.
5. **Citation labels:** each rendered assertion shows `(LO2.1)` or similar — the `learningOutcomeRef` string, surfaced as a label.

Module 1 and Module 3 assertions are loaded but never rendered. Cheap, but visible if you log loader output without the working-set filter.

---

## Authored-modules path

When a teacher imports module structure via Markdown, `lib/wizard/sync-authored-modules-to-curriculum.ts` upserts `CurriculumModule` + `LearningObjective` rows directly. The content layer is unchanged — the same extracted assertions stay in `ContentAssertion`, the same MCQs in `ContentQuestion`. Only the curriculum-layer rows differ in provenance.

After import, `reconcile-lo-linkage.ts` runs to populate `ContentAssertion.learningObjectiveId` for the new LOs.

---

## Curriculum metadata fields that are dead

`Curriculum` carries several JSON fields that are written by extraction/seed code but **read by nothing** in the prompt pipeline as of this writing:

- `coreArgument`
- `caseStudies`
- `discussionQuestions`
- `critiques`

Cleanup tracked in #306. **Do not** add new readers of these fields — propose a different shape if you need that data.

`deliveryConfig` is **not** dead — it stores `lessonPlan`, `sessionStructure`, `sessionCount`, and continuous-mode flags. Keep.

---

## Future state

Module-aware **explicit** signal in the runtime prompt — surfacing "Current module: Module 2 — Hygiene Controls. Today's LOs: LO2.1 …" in the `curriculum_guidance` instructions section — is tracked in #306. Today the prompt includes module/LO refs as **citation labels** on assertions but never names the current module as session context.

LO/Goal split — routing the wizard's `learningOutcomes[]` into `LearningObjective` rows (curriculum layer) instead of `Goal` rows (motivation layer) — is tracked in #307.

---

## Key files

| File | Role |
|---|---|
| `apps/admin/prisma/schema.prisma` | `Curriculum`, `CurriculumModule`, `LearningObjective`, `ContentSource`, `ContentAssertion`, `ContentQuestion`, `PlaybookSource` model definitions |
| `apps/admin/lib/curriculum/sync-modules.ts` | AI-generated curriculum upsert; idempotent by `(moduleId, ref)` |
| `apps/admin/lib/wizard/sync-authored-modules-to-curriculum.ts` | Authored-module import upsert; same target tables, different source |
| `apps/admin/lib/content-trust/reconcile-lo-linkage.ts` | Two-pass backfill from `learningOutcomeRef` (string) to `learningObjectiveId` (FK): structured ref match, then AI retag for orphans |
| `apps/admin/lib/prompt/composition/SectionDataLoader.ts` | The 16 loaders — content layer only |
| `apps/admin/lib/prompt/composition/transforms/modules.ts` | `computeSharedState` — bridges curriculum → working set |
| `apps/admin/lib/prompt/composition/transforms/teaching-content.ts` | Renders assertions filtered by working set, grouped by LO |
| `apps/admin/lib/curriculum/track-progress.ts` | `CallerModuleProgress` writes; advances on mastery |

---

## Related docs

- [`../how-content-becomes-teaching-points.md`](../how-content-becomes-teaching-points.md) — the upload-to-prompt pipeline narrative. This doc is its data-model companion.
- [`../decisions/2026-04-16-playbook-scoped-content.md`](../decisions/2026-04-16-playbook-scoped-content.md) — ADR for `PlaybookSource` (course-scoped content authoritative path).
- [`../adr/ADR-002-spec-toggles-and-content-consolidation.md`](../adr/ADR-002-spec-toggles-and-content-consolidation.md) — content consolidation rationale.

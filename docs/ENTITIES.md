# Entities — Canonical Hierarchy + Content Boundary Map

> **Read this before you add a model, an FK, a content-scoping query, or any code that reads/writes `ContentAssertion` / `ContentSource` / `Subject` / `Playbook` / `Domain`.**
>
> Third pillar of the architecture canon:
> - [`docs/WIZARD-DATA-BAG.md`](./WIZARD-DATA-BAG.md) — inputs (educator intent → `Playbook.config`)
> - [`docs/CONTENT-PIPELINE.md`](./CONTENT-PIPELINE.md) — classification (extraction, audience, compose-time filters)
> - **This doc** — the model underneath: who-owns-what, who-can-see-what, and where content bleeds between courses.

---

## 1. Why this doc exists

Real incidents this doc would have prevented:

| Incident | Date | What broke |
|----------|------|-----------|
| Shared Subject leak | 2026-04-16 | Two courses shared an "English Language" Subject. Chapter 1 of Course A appeared in Course B sessions. `curriculumAssertions` walked Subject, not Playbook. |
| Source-dedup null-scope leak | 2026-04-16 | `ContentAssertion` rows with `subjectSourceId: null` are visible everywhere — no course boundary at all. |
| Pipeline fan-out leak | 2026-04-16 | `sync-constraints` / `sync-goals` fired for ALL playbooks sharing a source; cross-course side effects in the post-call pipeline. |
| Stale entity map | 2026-05-11 | Six models added since the last memory-file refresh (`PlaybookSource`, `LoClassification`, `AssertionMedia`, `SubjectMedia`, `ContentVocabulary`, `CurriculumModule`) — agents writing new code couldn't see them. |
| ADR-vs-reality drift | 2026-04-16 → 2026-05-11 | `docs/decisions/2026-04-16-playbook-scoped-content.md` proposed adding `SubjectSource.playbookId`. That migration was **never run** — a new `PlaybookSource` table was added instead. The ADR still reads as if its fix shipped. |

**Rule of thumb:** *if you're adding a model, an FK, or a query that joins through `Subject` to `ContentAssertion`, walk §4 first and update §9 in the same PR.*

---

## 2. Hierarchy

```
Institution                        — branding + terminology preset, typeId → InstitutionType
└─ Domain (INSTITUTION | COMMUNITY) — operational unit; owns callers + playbooks
   ├─ PlaybookGroup                  — department / division / track (optional)
   │  ├─ PlaybookGroupSubject
   │  ├─ Playbook (grouped)
   │  └─ CohortGroup (grouped)
   ├─ Playbook                       — Course (terminology). Status: DRAFT | PUBLISHED | ARCHIVED
   │  ├─ PlaybookItem                — ordered spec refs (MEASURE → LEARN → ADAPT → PROMPT_TEMPLATE)
   │  ├─ PlaybookSubject             — which Subject(s) this course teaches (taxonomy)
   │  ├─ PlaybookSource              — which ContentSources belong to this course (CONTENT BOUNDARY since 2026-04-17)
   │  ├─ Curriculum                  — owned curriculum (CurriculumModule → LearningObjective)
   │  ├─ Goal                        — instantiated from Playbook.config.goals
   │  └─ CohortPlaybook              — which classes use this course
   ├─ CohortGroup                    — classroom; owned by a teacher Caller; has members + playbooks
   └─ Caller                         — Student / Teacher / Tutor / Parent / Mentor (CallerRole)
      ├─ CallerPlaybook              — explicit enrollment (class roster)
      ├─ CallerMemory                — per-call extracted memories
      ├─ CallerModuleProgress        — per-module attempt/mastery
      └─ Call → CallScore / RewardScore / ConversationArtifact / CallAction

Content (cross-cuts Subject and Playbook)
─────────────────────────────────────────
Subject                              — discipline label (e.g. "GCSE Biology"); domain-level taxonomy
├─ SubjectSource                     — Subject ↔ ContentSource link (legacy boundary — see §4)
├─ SubjectDomain                     — which Domains teach this Subject
├─ SubjectMedia                      — Subject ↔ MediaAsset
└─ Curriculum (via Playbook)         — CurriculumModule → LearningObjective → LoClassification

ContentSource                        — uploaded doc; DocumentType + ContentTrustLevel
├─ ContentAssertion                  — atomic teaching point (subjectSourceId? — see invariants §6)
│  └─ AssertionMedia                 — assertion ↔ MediaAsset
├─ ContentQuestion                   — MCQ / short-answer / open
└─ ContentVocabulary                 — extracted vocab terms
```

Authoritative source: `apps/admin/prisma/schema.prisma`. Line refs in §3.

---

## 3. Model reference table

| Model | Defined at | Purpose | Owns | Notable fields |
|-------|-----------|---------|------|----------------|
| `Institution` | `schema.prisma::model Institution` (line 637) | Branding + terminology preset | Domains | `typeId → InstitutionType` |
| `InstitutionType` | `schema.prisma::model InstitutionType` (line 601) | Terminology + defaults | — | `defaultDomainKind: INSTITUTION \| COMMUNITY` |
| `Domain` | `schema.prisma::model Domain` (line 389) | Operational unit; owns playbooks + callers | Playbooks, Callers, CohortGroups, PlaybookGroups | `kind: DomainKind (line 208)`, `onboardingWelcome`, `onboardingFlowPhases` (Json), `onboardingIdentitySpecId` |
| `PlaybookGroup` | `schema.prisma::model PlaybookGroup` (line 982) | Department / division / track within a Domain | Playbooks, CohortGroups | `type: GroupType (line 214)` |
| `PlaybookGroupSubject` | `schema.prisma::model PlaybookGroupSubject` (line 1008) | Many-to-many — which Subjects a group covers | — | — |
| `Playbook` | `schema.prisma::model Playbook` (line 2572) | **Course**. Versioned (`parentVersionId`), statused (DRAFT/PUBLISHED/ARCHIVED) | PlaybookItems, PlaybookSubjects, PlaybookSources, Curricula, Goals | `config: Json` (see `lib/types/json-fields.ts::PlaybookConfig`) |
| `PlaybookItem` | `schema.prisma::model PlaybookItem` (line 2659) | Ordered spec refs in a Playbook | — | `itemType`, `sortOrder` |
| `PlaybookSubject` | `schema.prisma::model PlaybookSubject` (line 3999) | Subjects this course teaches (taxonomy + curriculum) | — | `@@unique([playbookId, subjectId])` |
| `PlaybookSource` | `schema.prisma::model PlaybookSource` (line 4015) | **Content boundary since 2026-04-17.** ContentSources scoped to a course | — | `@@unique([playbookId, sourceId])` |
| `CohortGroup` | `schema.prisma::model CohortGroup` (line 924) | Class / classroom | CohortMembers, CohortPlaybooks | `teacherId → Caller` |
| `Caller` | `schema.prisma::model Caller` (line 810) | Student / Teacher / Tutor / Parent / Mentor | CallerPlaybook, Calls, CallerMemories | `role: CallerRole (line 199)` |
| `CallerPlaybook` | `schema.prisma::model CallerPlaybook` (line 1200) | Enrollment | — | `@@unique([callerId, playbookId])` |
| `Subject` | `schema.prisma::model Subject` (line 3917) | Discipline label (domain-level taxonomy) | SubjectSources, SubjectDomains, SubjectMedia | `teachingProfile: Json` |
| `SubjectSource` | `schema.prisma::model SubjectSource` (line 3956) | Subject ↔ ContentSource. **NOT playbook-scoped** — `@@unique([subjectId, sourceId])` | ContentAssertions, ContentQuestions, ContentVocabulary | — |
| `SubjectDomain` | `schema.prisma::model SubjectDomain` (line 3983) | Many-to-many: Subjects ↔ Domains | — | — |
| `SubjectMedia` | `schema.prisma::model SubjectMedia` (line 4213) | Subject ↔ MediaAsset | — | — |
| `ContentSource` | `schema.prisma::model ContentSource` (line 3620) | Uploaded document | ContentAssertions, ContentQuestions, ContentVocabulary | `documentType: DocumentType (line 38)`, `trustLevel: ContentTrustLevel (line 27)`, `documentTypeSource: "ai:<conf>" \| "human"` |
| `ContentAssertion` | `schema.prisma::model ContentAssertion` (line 3704) | Atomic teaching point | AssertionMedia | `subjectSourceId: String?` (line 3716) — **see §6 invariant** |
| `ContentQuestion` | `schema.prisma::model ContentQuestion` (search) | MCQ / short-answer / open | — | `questionType: QuestionType (line 57)`, `assessmentUse: AssessmentUse (line 80)`, `bloomLevel: BloomLevel (line 70)` |
| `ContentVocabulary` | `schema.prisma::model ContentVocabulary` (line 3867) | Extracted vocab term | — | `term`, `definition`, `subjectSourceId?` |
| `AssertionMedia` | `schema.prisma::model AssertionMedia` (line 4229) | Assertion ↔ MediaAsset | — | — |
| `Curriculum` | `schema.prisma::model Curriculum` (line 2165) | Owned by Playbook (since #181) | CurriculumModules | `playbookId` |
| `CurriculumModule` | `schema.prisma::model CurriculumModule` (line 2230) | Sub-unit of Curriculum | LearningObjectives | `slug` ("MOD-1"…), `sortOrder`, `sourceContentId?` (since #338) |
| `LearningObjective` | `schema.prisma::model LearningObjective` (line 2263) | "Learner should be able to X." | LoClassifications | `systemRole: LoSystemRole (line 90)`, `learnerVisible: Boolean @default(true)` |
| `LoClassification` | `schema.prisma::model LoClassification` (line 2315) | Classification history per LO (#317) | — | `systemRole`, `confidence`, `humanOverriddenAt?` |
| `Goal` | `schema.prisma::model Goal` | Course-level objective per Playbook | — | `type: GoalType` (LEARN/ACHIEVE/...), `isAssessmentTarget: Boolean`, `sourceContentId?` (since #338) |
| `BehaviorTarget` | `schema.prisma::model BehaviorTarget` | Per-parameter target at SYSTEM/PLAYBOOK/SEGMENT/CALLER scope | — | `scope: BehaviorTargetScope`, `parameterId`, `targetValue`, `sourceContentId?` (since #338) |
| `Parameter` | `schema.prisma::model Parameter` | Measurable dimension (TRAIT/STATE/ADAPT/GOAL/CONFIG/EXTERNAL/BEHAVIOR) | BehaviorTargets, CallScores | `type: ParameterType`, `name @unique` |

---

## 4. Content boundary walk — "what content is this course allowed to see?"

There are **two coexisting paths**. The new path is authoritative for new courses; the legacy path is still live for older courses and fall-through cases.

### 4.1 New path (since 2026-04-17) — **PlaybookSource is the boundary**

```
Caller ──CallerPlaybook──▶ Playbook ──PlaybookSource──▶ ContentSource ──▶ ContentAssertion
                                                                       ──▶ ContentQuestion
                                                                       ──▶ ContentVocabulary
```

Implementation: `apps/admin/lib/prompt/composition/SectionDataLoader.ts::resolveContentScope` (line 161). When a Caller has explicit `CallerPlaybook` enrollment, the loaders read `PlaybookSource.sourceId IN (…)` and then walk through to `ContentAssertion` filtered by `subjectSourceId IN (subjectSourceIds-for-this-playbook)`.

### 4.2 Legacy path — Subject chain

```
Caller ──CallerPlaybook──▶ Playbook ──PlaybookSubject──▶ Subject ──SubjectSource──▶ ContentSource ──▶ ContentAssertion
```

`SubjectSource` is `@@unique([subjectId, sourceId])` (`schema.prisma:3977`) — **not playbook-scoped**. Two courses sharing a `Subject` share the same `SubjectSource` row. This is the root of Leak A.

### 4.3 Fallback path (no enrollment) — domain-wide

When a Caller has no `CallerPlaybook` row, `resolveContentScope` returns `scoped: false` (`SectionDataLoader.ts::resolveContentScope` ~line 346). All subjects in the domain become visible. Documented as intentional for unenrolled previewing, but **structurally a leak surface** for multi-course domains.

### 4.4 Filter precedence at the loader

| Step | Where | Filter |
|------|-------|--------|
| 1 | `SectionDataLoader.ts::registerLoader("curriculumAssertions")` (line 840) | `subjectSourceId: { in: subjectSourceIds }` (strict — no null fallback) `AND category NOT IN INSTRUCTION_CATEGORIES` |
| 2 | `SectionDataLoader.ts::registerLoader("courseInstructions")` (line 1024) | `(category IN INSTRUCTION_CATEGORIES) OR (sourceId IS COURSE_REFERENCE)` |
| 3 | `SectionDataLoader.ts::registerLoader("subjectSources")` (line 743) | `subjectId IN scope.subjectIds` — **no playbookId filter** (intentional metadata-only, but see L4) |
| 4 | `SectionDataLoader.ts::registerLoader("visualAids")` (line 1163) | `subjectId + mimeType` only — **no documentType filter** (CONTENT-PIPELINE §8 L1) |

---

## 5. Holographic editor / scaffold — relationship to entities

| Concept | What it is | Relates to entities how |
|---------|-----------|-------------------------|
| **Holographic editor** (`/x/holographic`) | 8-section UI surfacing identity / curriculum / behavior / onboarding / channels / readiness / structure / prompt-preview for a Domain | **View** layer. Reads cross-entity state per section. See memory `holographic.md` for section contracts. |
| **`scaffoldDomain()`** (`lib/domain/scaffold.ts`) | Auto-setup function at wizard `create_course` time — creates identity spec + Playbook + system specs + onboarding | **Create** pattern. Materialises `Domain.onboardingIdentitySpecId`, `Playbook`, `PlaybookItem` rows, and `Playbook.config.systemSpecToggles`. See ADR-002. |
| **This doc** | The data model + boundary rules | **Model** layer. What the editor reads and what the scaffold creates. |

When you add a new entity: update §3, then ask "should the holographic editor surface it?" and "should the scaffold materialise it?" Each is a separate decision.

---

## 6. Cross-entity invariants

Verify in every write path that touches content scoping.

| # | Invariant | Enforced where today? |
|---|-----------|----------------------|
| I1 | Every new `ContentAssertion` MUST have a non-null `subjectSourceId`. The schema allows null (`schema.prisma:3716`) only for legacy / shared-pyramid-parent rows. New writes via `saveAssertions(sourceId, assertions, subjectSourceId)` should pass `subjectSourceId`. | Schema: nullable (legacy). Application: **not enforced** — `app/api/content-sources/[sourceId]/import/route.ts::POST` and `app/api/course-pack/ingest/route.ts::POST` currently call `saveAssertions` without `subjectSourceId` (Leak B partial). |
| I2 | Every new course's `ContentSource` MUST be linked via `PlaybookSource` (not just `SubjectSource`). | `wizard-tool-executor.ts::create_course` writes both. Older / non-wizard paths may write only `SubjectSource` (legacy). |
| I3 | `PlaybookSource @@unique([playbookId, sourceId])` (`schema.prisma:4026`) — one source per playbook. | DB constraint. |
| I4 | `SubjectSource @@unique([subjectId, sourceId])` (`schema.prisma:3977`) — **NOT playbook-scoped**. Sharing a Subject means sharing every `SubjectSource` row on it. | DB constraint. This is the structural root of Leak A. |
| I5 | Audience filtering uses `LearningObjective.learnerVisible` only (derived from `systemRole`). `Playbook.audience` and `Caller.role` are NOT content filters (CONTENT-PIPELINE §5.4). | `lib/curriculum/lo-audience.ts::deriveLearnerVisible`. |
| I6 | A `Curriculum` belongs to a `Playbook` (since #181). Old code that joined `Subject → Curriculum` directly is dead. | `Curriculum.playbookId` in schema. |
| I7 | **Projection provenance (since #338, NEW courses only).** Every `Goal`, `BehaviorTarget`, and `CurriculumModule` row written by `applyProjection()` MUST carry `sourceContentId` pointing to the COURSE_REFERENCE `ContentSource` that produced it. Re-running the projection diffs by `(playbookId, sourceContentId, slug/name)` — re-runs are no-ops. **Scope:** rows for courses created on/after 2026-05-12. Pre-existing rows have `sourceContentId: null` and are NOT backfilled. Wizard's own writes to `Goal` (caller-expressed, ADAPT-suggested) do not set `sourceContentId` — null is the marker for "not derived from a doc". | Application: `lib/wizard/apply-projection.ts` (planned). Schema: nullable FK on each of the three models. |

---

## 7. Cross-references

| Wizard / runtime concept | Entity it lives on | CONTENT-PIPELINE.md ref |
|--------------------------|---------------------|-------------------------|
| `Playbook.config.progressionMode` / `modulesAuthored` | `Playbook` | §3 row `progressionMode`; §8 L6 |
| `Playbook.config.modules` (`AuthoredModule[]`) | `Playbook` | §3 row `AuthoredModule.*` |
| `Playbook.config.goals` (instantiated to `Goal` per Caller) | `Playbook` → `Goal` | — |
| Module derivation when `modulesAuthored=false` | `CurriculumModule` → `LearningObjective` | §4 Phase 4 modules transform |
| LO audience | `LearningObjective.systemRole` / `learnerVisible` | §3 row `LearningObjective.systemRole`; §6 veto layer 2 |
| MCQ pool | `ContentQuestion` linked via `subjectSourceId` | §3 row `ContentQuestion.*` |
| Module catalogue parse | `Playbook.config.modules` (NOT a Prisma model — JSON) | §4 Phase 2 COURSE_REFERENCE dual-path |

Wizard inputs that land on these entities: see `docs/WIZARD-DATA-BAG.md` §3 master table.

---

## 8. Pre-change checklist

### Adding a new model

- [ ] Add to `prisma/schema.prisma` and run `npx prisma migrate dev`.
- [ ] If it owns or scopes content, decide: does it sit above `Playbook` (course-level) or above `Subject` (taxonomy-level)? They are NOT interchangeable post-2026-04-17.
- [ ] Update §2 (hierarchy) and §3 (model table) in this doc.
- [ ] If the holographic editor should expose it, add a section in `memory/holographic.md`.
- [ ] If the scaffold should materialise it at course-create, update `lib/domain/scaffold.ts` AND document in §5.
- [ ] Update `memory/entities.md`.

### Adding a new FK / relation that touches content

- [ ] Walk §4 — does your query use `PlaybookSource` (new path) or `Subject → SubjectSource` (legacy)? Default: new path.
- [ ] Verify your write path satisfies invariants §6 — particularly I1 if you create `ContentAssertion`.
- [ ] Add a test that two courses sharing a `Subject` do NOT see each other's content via your new query.

### Adding a new content-scoping query

- [ ] Filter by `PlaybookSource.playbookId` first. Only fall back to `Subject → SubjectSource` for legacy support, and log when you do.
- [ ] Never select `ContentAssertion WHERE subjectSourceId IS NULL OR subjectSourceId = ?` — the OR clause is Leak B revived.

### Adding a new audience or scoping dimension

- [ ] Read CONTENT-PIPELINE.md §6 (veto precedence). New gates must be placed in the precedence table.
- [ ] Don't reuse `Playbook.audience` — it's dead (CONTENT-PIPELINE.md §8 L3). Either wire it or use `learnerVisible`.

---

## 9. Known landmines

Mirrors CONTENT-PIPELINE.md §8 format. "E" prefix = entity / content-boundary.

| # | Landmine | Where | Status |
|---|----------|-------|--------|
| E1 | **Shared Subject leak** (2026-04-16 incident) — two courses sharing a `Subject` share every `SubjectSource` row on it. | `schema.prisma::model SubjectSource` (line 3956): `@@unique([subjectId, sourceId])` | ⚠ **PARTIAL.** `curriculumAssertions` loader now uses strict `subjectSourceId IN (…)` filter (`SectionDataLoader.ts::registerLoader("curriculumAssertions")` line 840). New courses go through `PlaybookSource`. Legacy courses that only have `SubjectSource` rows still bleed when shared. |
| E2 | **Null-scope assertion leak** — `ContentAssertion` rows with `subjectSourceId: null` visible everywhere. | `app/api/content-sources/[sourceId]/import/route.ts::POST` and `app/api/course-pack/ingest/route.ts::POST` call `saveAssertions(sourceId, assertions)` without `subjectSourceId`. | ⚠ **PARTIAL.** Loader fallback removed; write path still creates new null rows from two routes. `backfill-subject-source-ids.ts` exists but no evidence it's been run. |
| E3 | **Pipeline fan-out leak** — `sync-constraints` / `sync-goals` legacy fallback fans out to all playbooks sharing a Subject. | `lib/content-trust/sync-constraints-from-reference.ts` (legacy fallback ~line 71-83) and `lib/content-trust/sync-goals-from-reference.ts` (~line 69-79) | ⚠ **PARTIAL.** Primary path uses `PlaybookSource`. Falls back to Subject chain when no `PlaybookSource` rows found — legacy data hits the fallback. |
| E4 | **`subjectSources` loader exposes cross-course source metadata** — name / trustLevel / publisherOrg of sources from any shared subject. | `SectionDataLoader.ts::registerLoader("subjectSources")` (line 743) — no `playbookId` filter | ⚠ Documented intentional (metadata, not content). Re-verify when adding new source-level fields. |
| E5 | **`visualAids` loader has no `documentType` filter** | `SectionDataLoader.ts::registerLoader("visualAids")` (line 1163) | ⚠ OPEN (CONTENT-PIPELINE.md §8 L1). |
| E6 | **`SubjectSource.playbookId` ADR not executed** — `docs/decisions/2026-04-16-playbook-scoped-content.md` proposed adding the column; superseded by the `PlaybookSource` table approach in migration `20260417_add_playbook_source_and_curriculum_playbook`. ADR still reads as if its fix shipped. | ADR file | ⚠ **Doc drift.** Either annotate the ADR as superseded or update it. Don't trust ADR-claims of "fix shipped" without checking. |
| E7 | **`upload/route.ts` legacy fan-out** — uploads without a `playbookId` create `PlaybookSource` rows for every playbook teaching the subject. | `app/api/subjects/[subjectId]/upload/route.ts::POST` (~line 99-116) | ⚠ Legacy compatibility path. Remove after all callers pass `playbookId`. |
| E8 | **Domain-wide unenrolled fallback** — `resolveContentScope` returns all subjects when Caller has no enrollment. | `SectionDataLoader.ts::resolveContentScope` (line 161, fallback ~line 346) | ⚠ Documented intentional. Audit if user identity changes. |

---

## 10. Pointers to deeper docs

- **Loaders + transforms → prompt:** `memory/flow-prompt-composition.md` (Claude-only today; promote to `docs/PROMPT-COMPOSITION.md` per the doc-canon roadmap).
- **Post-call adaptive loop:** `memory/flow-pipeline.md`, `memory/flow-call-lifecycle.md`, `memory/flow-goal-tracking.md`.
- **Spec system + scaffold:** `docs/adr/ADR-002-spec-toggles-and-content-consolidation.md`, `lib/domain/scaffold.ts`.
- **Content classification:** `docs/CONTENT-PIPELINE.md`.
- **Wizard inputs:** `docs/WIZARD-DATA-BAG.md`.

---

## 11. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. Third pillar alongside CONTENT-PIPELINE.md (outputs) and WIZARD-DATA-BAG.md (inputs). Landmines E1–E3 inherited from the 2026-04-16 ADR; status verified by current Tech Lead pre-review. |
| 2026-05-12 | **§3 + §6 — projection provenance (epic #338).** Added `Goal`, `BehaviorTarget`, `Parameter` rows to §3 model table. Added `sourceContentId?` nullable FK on `Goal`, `BehaviorTarget`, `CurriculumModule`. New invariant I7: rows written by `applyProjection()` MUST carry `sourceContentId`; scope is NEW courses only (created on/after 2026-05-12); no backfill of pre-existing rows. Companion contract spec in `CONTENT-PIPELINE.md §4 Phase 2.5`. Supersedes #337; originating defects from IELTS Speaking pack #336. |

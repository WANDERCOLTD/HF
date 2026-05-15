# Wizard Data Bag — Canonical Field Map

> **Read this before you add, rename, or remove any wizard `update_setup` field, or before changing how the setup data bag flushes into `Playbook.config` / `Domain.*` at `create_course` time.**
>
> Companion to [`docs/CONTENT-PIPELINE.md`](./CONTENT-PIPELINE.md). That doc is the canonical map for content classification (the **outputs** side). This doc is the canonical map for educator intent collection (the **inputs** side) — how the wizard chat turns into the rows that the loaders in `lib/prompt/composition/SectionDataLoader.ts` read at compose time.

---

## 1. Why this doc exists

The wizard chat AI repeatedly hallucinates field names because the data bag is loosely typed (`Record<string, unknown>`) and the canonical key list lives only in `lib/wizard/graph-nodes.ts:28-421`. Real incidents from the last 48 hours that this doc would have prevented:

| Incident | What broke |
|----------|-----------|
| AI tried to write `modulesAuthored: true` via `update_setup` | Validator silently dropped it (it's not a wizard key — only the COURSE_REFERENCE parser sets it). AI burned retries assuming the write succeeded. |
| AI tried to write `constraints: [...]` to capture brief-never-quiz rules | Accepted as a free passthrough — `PlaybookConfig.constraints` exists (`lib/types/json-fields.ts:277`) but no loader reads it. Rules dropped silently at compose time. |
| AI wrote `interactionPattern: "learner-picks"` | Caught by the value-shape redirect at `validate-setup-fields.ts:111-123` and rewritten to `progressionMode`. The AI never set `progressionMode` cleanly on first try. |
| `Domain.onboardingFlowPhases` overrode course-ref's "First-Call Special Rules" with no visibility | Silent override at compose time; in-flight fix on `fix/call1-honors-course-ref-and-no-tutor-doc-leak`. |

**Rule of thumb:** *if you're touching the wizard data bag, the validator, `create_course`, or `update_course_config` — check §3 first and update it in the same PR.*

---

## 2. The two ways data lands in `Playbook.config`

There are two independent write paths into `Playbook.config`. Both run during the wizard flow; conflicts resolve as documented in §6.

**(a) Wizard chat → `update_setup` → validator → in-memory bag → `create_course` flush.** The chat AI calls the `update_setup` tool (`conversational-wizard-tools.ts:11-56`) with `{ fields: {...} }`. The executor (`wizard-tool-executor.ts:188-223`) runs `validateSetupFields()` to canonicalise keys, then writes to the per-session `setupData` bag. **No DB write happens until `create_course`.** At that point, the new-path branch (`wizard-tool-executor.ts:1136-1240`) and the existing-course branch (`:766-836`) read from `setupData` and merge into `Playbook.config`.

**(b) Document upload → `detect-course-config` / `detect-authored-modules` → merged into `Playbook.config`.** When the educator uploads a Course Reference markdown, two deterministic parsers run (no AI calls):
- `lib/wizard/detect-course-config.ts:136-267` — pulls `courseName`, `subjectDiscipline`, `interactionPattern`, `teachingMode`, `audience`, `planEmphasis`, `pedagogicalPreset`, `learningOutcomes` from checkboxes and `**Key:**` fields.
- `lib/wizard/detect-authored-modules.ts:487-576` — parses `**Modules authored:** Yes/No/Partial` + the `## Modules` table → writes `Playbook.config.modulesAuthored`, `.modules`, `.moduleDefaults`, `.outcomes` directly. **Bypasses the wizard data bag.**

Path (b) feeds the chat AI via `setupData.courseRefDigest` (the parsed result). The AI is told to *propose based on evidence* (see `graph-nodes.ts:118-122` for `progressionMode`'s `promptHint`) — i.e. (b) becomes the prior, (a) becomes the confirmation. When both write to the same key, the wizard `setupData` value wins because `create_course` reads from it last (see `wizard-tool-executor.ts:783, 1156`).

---

## 3. Master table — every `update_setup` field

Every key in this table is a legal value for `fields` in an `update_setup` call. Sources: `lib/wizard/graph-nodes.ts:28-421` (graph keys), `lib/wizard/validate-setup-fields.ts:27-42` (internal keys whitelist).

| Key | Group | Valid values / shape | Lands in DB at | Read at compose time by | Doc-side path can set? | Conflict resolution | CONTENT-PIPELINE.md cross-ref |
|-----|-------|---------------------|----------------|--------------------------|------------------------|---------------------|-------------------------------|
| `institutionName` | institution | string | `Institution.name` via `ensureInstitutionAndDomain` (`wizard-tool-executor.ts:127-148`) | n/a (resolution only) | No | n/a | — |
| `typeSlug` | institution | string (slug from `InstitutionType.slug`) | `Institution.typeId` (`wizard-tool-executor.ts:119-124`) | n/a | No | n/a | — |
| `websiteUrl` | institution | string (URL) | Not persisted today (reserved for branding extraction) | n/a | No | n/a | — |
| `existingInstitutionId` | institution (auto) | UUID | Resolves to existing `Institution` | n/a | No (auto-resolved) | n/a | — |
| `existingDomainId` | institution (auto) | UUID | Resolves to existing `Domain` | All loaders scope by `domainId` | No (auto-resolved) | If both `existingDomainId` and `draftDomainId` set, existing wins (`wizard-tool-executor.ts:364`) | — |
| `draftDomainId` | institution (auto, INTERNAL) | UUID | New `Domain` created in-flight | All loaders scope by `domainId` | No | See above | — |
| `defaultDomainKind` | institution (auto) | `INSTITUTION` \| `COMMUNITY` | `Domain.kind` (`schema.prisma:396`) | Picker layout, wizard branching | No | n/a | §3 `DomainKind` |
| `subjectDiscipline` | course | string | `Subject.name` + `Playbook.config.subjectDiscipline` (`wizard-tool-executor.ts:773, 1146`) | `PlaybookConfig.subjectDiscipline` (`json-fields.ts:281`) used in identity spec | Yes (`detect-course-config.ts:166-172`) | Wizard `setupData` wins (last writer) | §3 row "InteractionPattern" context |
| `courseName` | course | string | `Playbook.name` (`wizard-tool-executor.ts:1104`) | Identity spec rendering | Yes (`detect-course-config.ts:150-163`) | Wizard `setupData` wins | — |
| `progressionMode` | course | `"ai-led"` \| `"learner-picks"` | `Playbook.config.modulesAuthored` (boolean mirror) (`wizard-tool-executor.ts:796-802, 1165-1171`) | Module picker render; scheduler vs picker branching | No (doc-side sets `modulesAuthored` directly via `detect-authored-modules.ts`) | Wizard sets mirror; if doc declared `Modules authored: Yes` and wizard chose `ai-led`, doc-side's `modulesAuthored=true` wins because `detect-authored-modules` writes directly to `Playbook.config` and `create_course` only mirrors when wizard's `progressionMode` is set | §3 row `Playbook.config.progressionMode`; §8 L7 |
| `interactionPattern` | course | `socratic` \| `directive` \| `advisory` \| `coaching` \| `companion` \| `facilitation` \| `reflective` \| `open` \| `conversational-guide` | `Playbook.config.interactionPattern` (`wizard-tool-executor.ts:770, 1143`) | Voice prompt injection / tutor voice transform | Yes (`detect-course-config.ts:175-185`) | Wizard wins (last writer). Value-shape redirect at `validate-setup-fields.ts:111-123` rescues `ai-led`/`learner-picks` mistakenly written here | §3 row `interactionPattern`; §5.3 |
| `teachingMode` | course | `recall` \| `comprehension` \| `practice` \| `syllabus` | `Playbook.config.teachingMode` (`wizard-tool-executor.ts:771-772, 1144-1145`) | Scheduler preset selection; extraction weights | Yes (`detect-course-config.ts:188-198`) | Wizard wins | §3 row `teachingMode`; §5.3 |
| `audience` | course | `primary` \| `secondary` \| `sixth-form` \| `higher-ed` \| `adult-professional` \| `adult-casual` \| `mixed` | `Playbook.config.audience` (`wizard-tool-executor.ts:783, 1156`) | ⚠ Stored, never filtered | Yes (`detect-course-config.ts:201-211`) | Wizard wins | §3 row `Playbook.audience`; §8 L3 (dead) |
| `learningOutcomes` | course | string[] | `Playbook.config.goals[]` as LEARN goals (`wizard-tool-executor.ts:1211-1227`) | Goal instantiation per learner | Yes (`detect-course-config.ts:249-264` from `**OUT-NN:**` headings) | Doc-side OUT-NN extracts; wizard overrides if user edits | §3 row `LearningObjective` |
| `welcomeMessage` | welcome | string | `Domain.onboardingWelcome` (`wizard-tool-executor.ts:847-850`) AND `Playbook.config.welcomeMessage` | Greeting cascade resolver (`json-fields.ts:248`) | No | Course-scoped wins over Domain-scoped | — |
| `sessionCount` | welcome | number | `Playbook.config.sessionCount` (`wizard-tool-executor.ts:777, 1150`) | Plan rendering; lesson budget | No (but `coursePedagogy.suggestedSessionCount` from upload can backfill — see line 821-823) | Wizard wins unless wizard left it blank | — |
| `durationMins` | welcome | number | `Playbook.config.durationMins` | Plan rendering | No (but `coursePedagogy.cadenceMinutesPerCall` from upload can backfill — line 818-820) | Wizard wins unless blank | — |
| `planEmphasis` | welcome | `breadth` \| `balanced` \| `depth` | `Playbook.config.planEmphasis` | Scheduler / plan generation | Yes (`detect-course-config.ts:214-224`) | Wizard wins | — |
| `assessments` | welcome | `formal` \| `light` \| `none` | `Playbook.config.assessments` | Pre/post-test enablement | No | n/a | §3 row `ContentQuestion.assessmentUse` |
| `welcomeGoals` | experience | boolean | `Playbook.config.welcome.goals.enabled` + `sessionFlow.intake.goals.enabled` + `sessionFlow.onboarding.phases[]` (id `goals` when true) + `onboardingFlowPhases.phases[]` (mirror) (`wizard-tool-executor.ts::applyStudentExperienceConfig`) | Welcome flow phases — `sessionFlow.onboarding` is Priority 1 in the new resolver (#383) | No | n/a | — |
| `welcomeAboutYou` | experience | boolean | `welcome.aboutYou.enabled` + `sessionFlow.intake.aboutYou.enabled` + `sessionFlow.onboarding.phases[]` (id `aboutYou` when true) + `onboardingFlowPhases.phases[]` (mirror) | Welcome flow phases | No | n/a | — |
| `welcomeKnowledgeCheck` | experience | boolean | `welcome.knowledgeCheck.enabled` + `sessionFlow.intake.knowledgeCheck.enabled` + `sessionFlow.onboarding.phases[]` (id `knowledgeCheck` when true) + `onboardingFlowPhases.phases[]` (mirror) | Welcome flow phases | No | n/a | — |
| `welcomeAiIntro` | experience | boolean | `welcome.aiIntroCall.enabled` + `sessionFlow.intake.aiIntroCall.enabled` + `sessionFlow.onboarding.phases[]` (id `aiIntro` when true) + `onboardingFlowPhases.phases[]` (mirror) | Welcome flow phases | No | n/a | — |
| `npsEnabled` | experience | boolean | `Playbook.config.nps.enabled` + `surveys.post.enabled` (`wizard-tool-executor.ts:75-87`) | Post-mastery NPS survey | No | n/a | — |
| `behaviorTargets` | tune | `Record<string, number>` (0-100) | `BehaviorTarget` rows (`applyBehaviorTargets`) (`wizard-tool-executor.ts:840-842`) | Tutor voice transform | No | n/a | §3 row `BehaviorTargetScope` |
| `lessonPlanModel` | tune | `direct` \| `5E` \| `spiral` \| `mastery` \| `project-based` | `Playbook.config.lessonPlanModel` (`wizard-tool-executor.ts:784-785, 1157-1158`) | Lesson plan transform | No | n/a | — |
| `skillsFramework` | pedagogy | `Array<{ id, name, description?, tiers: { emerging, developing, secure } }>` | `ContentAssertion[]` via `convertCourseRefToAssertions` (`wizard-tool-executor.ts:976-1011`) with `category=skill_framework` | `courseInstructions` loader (`SectionDataLoader.ts:997`) | Yes (when uploaded as part of a parsed course-ref document) | Wizard pedagogy nodes only fire if no existing COURSE_REFERENCE pedagogy source exists for the subject (`:967-1019`) — doc-side wins | §3.1 (INSTRUCTION_CATEGORIES) |
| `teachingPrinciples` | pedagogy | `{ corePrinciples: string[], sessionStructure?, techniquesBySkill? }` | `ContentAssertion[]` with `category=teaching_rule` / `session_flow` | `courseInstructions` loader | Yes | Doc-side wins (same gate as above) | §3.1 |
| `coursePhases` | pedagogy | `Array<{ name, sessions?, goal?, tutorBehaviour?, exitCriteria?, checkpoints? }>` | `ContentAssertion[]` with `category=session_flow` | `courseInstructions` loader | Yes | Doc-side wins | §3.1 |
| `edgeCases` | pedagogy | `Array<{ scenario, response }>` | `ContentAssertion[]` with `category=edge_case` | `courseInstructions` loader | Yes | Doc-side wins | §3.1 |
| `assessmentBoundaries` | pedagogy | string[] | `ContentAssertion[]` with `category=assessment_guidance` | `courseInstructions` loader | Yes | Doc-side wins | §3.1 |
| `assessmentTargets` (INTERNAL) | n/a | string[] | `Playbook.config.goals[]` as ACHIEVE assessment goals (`wizard-tool-executor.ts:1196-1209`) | Goal instantiation | No | n/a | — |
| `uploadSourceIds` (INTERNAL) | n/a | string[] (`ContentSource.id`) | `PlaybookSource` rows | Source palette / extraction routing | n/a (set by upload route) | n/a | §4 Phase 1 |
| `packSubjectIds` (INTERNAL) | n/a | string[] (`Subject.id`) | Bridges COURSE_REFERENCE sources to primary subject (`wizard-tool-executor.ts:928-953`) | Loader scope | n/a (set by upload route) | n/a | §4 Phase 1 |
| `lastUploadClassifications` (INTERNAL) | n/a | `Array<{ sourceId, documentType }>` | Display only | n/a | n/a | n/a | §4 Phase 1 |
| `courseRefEnabled` (INTERNAL) | n/a | boolean | Gates pedagogy nodes (`graph-nodes.ts:191, 204, 217, 230, 243`) | n/a | n/a (set by AI when user opts into deep interview) | n/a | — |
| `courseRefDigest` (INTERNAL) | n/a | result of `detectCourseConfig()` + `detectAuthoredModules()` | Surfaced to AI as evidence prior | n/a (consumed at prompt-render time) | Yes (this IS the doc-side output) | Read-only for the AI | §4 Phase 2 |
| `coursePedagogy` (INTERNAL) | n/a | `{ lessonPlanMode?, cadenceMinutesPerCall?, suggestedSessionCount? }` | `Playbook.config.lessonPlanMode` / `durationMins` / `sessionCount` (`wizard-tool-executor.ts:810-823, 1180-1193`) | Lesson plan transform | Yes (extracted from course-ref) | Doc-side fills only when wizard left field blank | — |
| `courseContext` (INTERNAL) | n/a | string (3-5 sentence synthesis) | `Playbook.config.courseContext` (`wizard-tool-executor.ts:788-789, 1174-1175`) | Identity spec rendering | No | Wizard wins | — |
| `personalityPreset` (INTERNAL) | n/a | string (preset slug) | Mapped to `BehaviorTarget`s via `behaviorTargetsFromPresets` | Tutor voice | No | n/a | — |
| `personalityDescription` (INTERNAL) | n/a | string | Free passthrough (display only) | n/a | No | n/a | — |
| `welcomeSkipped` (INTERNAL) | n/a | boolean | Skips welcome group (`graph-nodes.ts:260`) | n/a | No | n/a | — |
| `draftSubjectId` (INTERNAL) | n/a | UUID | Resolves to in-flight `Subject` | n/a | No | n/a | — |
| `domainId` (INTERNAL) | n/a | UUID | Alias to `existingDomainId`/`draftDomainId` | n/a | No | n/a | — |
| `playbookId` (INTERNAL) | n/a | UUID | Alias to `draftPlaybookId` | n/a | No | n/a | — |
| `draftPlaybookId` (auto) | course | UUID | Existing `Playbook.id` resolved by `resolveCourseByName` | All loaders scope by `playbookId` | No | If user named a different course, AI ignores the resolved `draftPlaybookId` (`wizard-tool-executor.ts:749-758`) | — |

**Group key:** `institution` / `course` / `pedagogy` / `welcome` / `experience` / `tune` correspond to the `group` field on each node in `graph-nodes.ts`. The `INTERNAL` rows are listed in `validate-setup-fields.ts:27-42` (`INTERNAL_KEYS`).

---

## 4. Fields the wizard AI hallucinates but that are NOT setup keys

These names appear in the AI's drafts but are NOT in `GRAPH_KEYS` or `INTERNAL_KEYS`. Future maintainers: **do not add these as keys.** The correct destination is listed beside each.

| Hallucinated field | Why the AI tries this | Correct destination | Already handled? |
|--------------------|----------------------|---------------------|------------------|
| `modulesAuthored` | The wizard surfaces a yes/no question that maps to this boolean. AI sees `Playbook.config.modulesAuthored` in code samples and assumes it's a setup key. | Use `progressionMode` (`"ai-led"`/`"learner-picks"`) — the executor mirrors it (`wizard-tool-executor.ts:796-802, 1165-1171`). For the doc-side path, the COURSE_REFERENCE parser writes directly (`detect-authored-modules.ts:506-526`). | ❌ NOT auto-corrected today — validator REJECTS as unknown. AI sees the rejection and must retry. **TODO:** consider adding to `FIELD_NAME_CORRECTIONS` mapping → `progressionMode` with value transform, OR explicitly listing it as `KNOWN_AUTO_DROP` so the rejection is silent. |
| `constraints` | The tool description (`conversational-wizard-tools.ts:43-44`) advertises this as a valid key. It IS in `PlaybookConfig` (`json-fields.ts:277`) and is written by `create_course` (`:790-791, 1176-1177`), but **no loader reads it at compose time**. | Route teacher anti-patterns to `teachingPrinciples` (lands as `ContentAssertion` with `category=teaching_rule`) which IS surfaced by `courseInstructions` loader. | ⚠ NOT auto-corrected. `constraints` is currently accepted as a free passthrough and dies silently at compose. **TODO:** either wire a loader for `Playbook.config.constraints` or remove the field from the tool description. |
| `moduleProgression` | Reverse-engineered from the human label "Module progression". | Use `progressionMode`. | ✅ Auto-corrected at `validate-setup-fields.ts:53`. |
| `interactionPattern: "ai-led"` (wrong value on right key shape) | AI confuses the `progressionMode` value set with the `interactionPattern` set. | Use `progressionMode: "ai-led"`. | ✅ Value-shape redirect at `validate-setup-fields.ts:111-123`. |
| `pedagogicalPreset` | Detected in course-ref documents (`detect-course-config.ts:236-247`) — AI sometimes copies it into `update_setup`. | The detector writes it to `setupData.courseRefDigest.pedagogicalPreset`, then the wizard uses it to *propose* a `teachingMode` / scheduler preset to the user. Not a direct setup key. | ❌ NOT auto-corrected — validator REJECTS. |
| `personalityPreset` written as `personalityType`, `personality`, `personalityStyle` | Label drift. | Use `personalityPreset` (already an INTERNAL key). | ❌ Not in `FIELD_NAME_CORRECTIONS`. Add only when observed in logs. |

There is **no `KNOWN_AUTO_DROP` set today**. The validator's behaviour is binary: known key → accept, unknown key → return `is_error: true`. The CLAUDE.md hard rule referenced in this task is therefore aspirational — when the set is added (see §9), entries must be justified by production log evidence per the comment at `validate-setup-fields.ts:25-26`.

---

## 5. `update_setup` → `create_course` → `mark_complete` lifecycle

The data bag is in-memory until `create_course`. The three tool handlers form a strict sequence:

**`update_setup` (server-side, no DB writes).** Validates field names via `validateSetupFields()` (`wizard-tool-executor.ts:194-223`). Auto-resolves entity references (institution → `existingDomainId`, course → `draftPlaybookId`) and injects them client-side via `autoInjectFields` (`:298-318`). Result: the chat's `setupData` bag accumulates the canonical fields listed in §3.

**`create_course` (server-side, full DB write).** Guard at `wizard-tool-executor.ts:637-658`: runs `evaluateGraph(setupData)`. Required nodes from the graph (`graph-nodes.ts` — those with `required: true`) must all be satisfied; otherwise the handler returns `is_error: true` with `missingKeys` + `missingLabels`. Required keys today: `institutionName`, `courseName`, `progressionMode`, `interactionPattern`, `learningOutcomes`. On pass, the handler writes `Playbook.config` (new or existing path), creates `Subject`, links `PlaybookSubject` / `PlaybookSource`, runs `scaffoldDomain`, instantiates goals, kicks off background curriculum generation, and creates a test caller. Cross-field validation lives in `evaluateGraph` — e.g. `progressionMode=learner-picks` without a Module Catalogue (#318) is rejected before the handler runs.

**`mark_complete` (server-side, verification only).** Guards at `wizard-tool-executor.ts:2128-2185`: checks `setupData.draftPlaybookId` exists, the playbook row exists in the DB, and `_count.modules > 0`. If any check fails, returns `is_error: true` with a specific reason — the AI must retry `create_course` rather than declaring success.

---

## 6. Wizard-level overrides vs course-ref overrides

| Scenario | Outcome |
|----------|---------|
| Wizard sets `progressionMode=learner-picks` but course-ref has no Module Catalogue | `evaluateGraph` blocks at `create_course` time with a friendly error (#318 fix, see `graph-nodes.ts:118-122` prompt hint and `wizard-tool-executor.ts:642-658`). |
| Course-ref declares `Modules authored: Yes` but wizard didn't set `progressionMode` | Doc-side runs `detect-authored-modules` and writes `Playbook.config.modulesAuthored=true` + `.modules[]` directly. Wizard's `progressionMode` mirror only fires when set (`wizard-tool-executor.ts:796-802, 1165-1171`). Doc-side wins. |
| Wizard sets `teachingMode=practice` but course-ref's first-call rules imply warm-up | `teachingMode` and onboarding flow phases are orthogonal (per CONTENT-PIPELINE.md §5.3). Both flow into the prompt simultaneously — no conflict. |
| `Domain.onboardingFlowPhases` vs course-ref's "First-Call Special Rules" at compose time | ⚠ Current behaviour: `Domain.onboardingFlowPhases` overrides course-ref silently. In-flight fix on branch `fix/call1-honors-course-ref-and-no-tutor-doc-leak` — verify status before merging this doc. See §10 landmine W4. |
| Wizard pedagogy nodes (`skillsFramework`, `teachingPrinciples`, …) + course-ref already has pedagogy assertions | Wizard skips creating duplicates: the check at `wizard-tool-executor.ts:967-1019` looks for an existing COURSE_REFERENCE source linked to the subject. Doc-side wins. |
| Wizard's `subjectDiscipline` vs `detect-course-config`'s subject | `setupData.subjectDiscipline` is the last writer at `create_course` (`wizard-tool-executor.ts:773, 1146`). Wizard wins, but the AI is prompted to *propose* the doc-detected value first (`graph-nodes.ts:163-164` style prompts). |

**Resolution rule of thumb:** *Doc-side parses run first and seed `setupData.courseRefDigest`. The AI proposes from that digest. The user confirms or overrides. The final `setupData` value is the one that ships to `Playbook.config`. Exception: `detect-authored-modules` writes directly to `Playbook.config.modulesAuthored` + `.modules` without going through `setupData` — those fields are NOT under the wizard's control.*

---

## 7. The validator's auto-corrections & auto-drops

All entries live in `lib/wizard/validate-setup-fields.ts`. The comment at `:25-26` is binding: **add only when observed in production logs.**

| Mechanism | File:line | Entries today |
|-----------|-----------|---------------|
| `FIELD_NAME_CORRECTIONS` (rename misspelt key, keep value) | `validate-setup-fields.ts:52-54` | `moduleProgression → progressionMode` |
| `PROGRESSION_VALUES` value-shape redirect | `validate-setup-fields.ts:62, 111-123` | If `interactionPattern` is set with value `ai-led` or `learner-picks`, rewrite key to `progressionMode`. |
| `KNOWN_AUTO_DROP` (silent rejection) | NOT IMPLEMENTED | — |
| Underscore-prefixed keys pass through unchecked | `validate-setup-fields.ts:101-104` | Used for UI flags / session metadata (e.g. `_fieldPicker`). |
| `INTERNAL_KEYS` whitelist (legitimate bag-only fields) | `validate-setup-fields.ts:27-42` | 14 keys — see §3. |

Each entry exists because the AI's reverse-engineering from the human-readable label produces a near-match. Resist adding entries pre-emptively — every entry is a magnet for scope creep (see comment at `:25-26, :49-51`).

---

## 8. Cross-references to CONTENT-PIPELINE.md

| Wizard field | CONTENT-PIPELINE.md cross-ref |
|--------------|-------------------------------|
| `progressionMode` | §3 row `Playbook.config.progressionMode`; §8 L6 (`progressionMode=learner-picks` + no Module Catalogue landmine) |
| `Playbook.config.modulesAuthored` (mirrored from `progressionMode`) | §3 row `Playbook.config.modulesAuthored`; §4 Phase 2 COURSE_REFERENCE dual-path |
| `audience` | §3 row `Playbook.audience` (dead — stored but not filtered); §5.4 audience layer table; §8 L3 |
| `teachingMode` / `interactionPattern` | §3 rows TM / `interactionPattern`; §5.3 orthogonal teaching style |
| `assessments` | §3 row `ContentQuestion.assessmentUse`; §5.2 |
| `learningOutcomes` | §3 row `LearningObjective.systemRole`; §3.1 |
| `skillsFramework` / `teachingPrinciples` / `coursePhases` / `edgeCases` / `assessmentBoundaries` | §3.1 INSTRUCTION_CATEGORIES (tutor-only); §4 Phase 4 `courseInstructions` loader; §6 veto layer 1 |
| `behaviorTargets` | §3 row `BehaviorTargetScope` |
| `uploadSourceIds` / `packSubjectIds` | §4 Phase 1 upload; §4 Phase 2 extraction routing |

---

## 9. Pre-change checklist

**Before adding a new `update_setup` key:**

- [ ] Add a node to `lib/wizard/graph-nodes.ts` (including `key`, `group`, `inputType`, `required`, `dependsOn`, `promptHint`, `affinityTags`).
- [ ] If the key is bag-only (no graph node), add it to `INTERNAL_KEYS` in `lib/wizard/validate-setup-fields.ts:27-42`.
- [ ] If the AI may hallucinate the key from the label, add to `FIELD_NAME_CORRECTIONS` (`validate-setup-fields.ts:52-54`) — only after observing it in production logs (the comment at `:25-26` is binding).
- [ ] If the key has AI-hallucinated synonyms that should be dropped silently rather than rejected, add a `KNOWN_AUTO_DROP` set (currently does not exist — first hallucinated-but-should-drop key adds it).
- [ ] Wire the new field into `wizard-tool-executor.ts` `create_course` handler — BOTH the existing-course branch (`:766-836`) AND the new-course branch (`:1136-1240`). The new-path was previously missing a `progressionMode` mirror; that bug shipped (`:1160-1171` is the fix).
- [ ] Document the field in §3 of this doc (the master table). Cite file:line for every claim.
- [ ] If the field affects content classification, cross-reference `docs/CONTENT-PIPELINE.md`.
- [ ] Add a test in `tests/lib/wizard/validate-setup-fields.test.ts`.
- [ ] If the field also lives in `PlaybookConfig`, update `lib/types/json-fields.ts:271-353`.

**Before adding a new `FIELD_NAME_CORRECTIONS` entry:**

- [ ] Confirm at least 3 production log lines mention the hallucinated key (per the `validate-setup-fields.ts:25-26` discipline).
- [ ] Add a test case in `tests/lib/wizard/validate-setup-fields.test.ts`.
- [ ] Update §7 of this doc.

---

## 10. Known landmines

Mirrors CONTENT-PIPELINE.md §8 format. "W" prefix = wizard-specific.

| # | Landmine | Where | Status / fix |
|---|----------|-------|--------------|
| W1 | **`modulesAuthored` not auto-corrected** — AI tries to write it; validator REJECTS as unknown. Wastes retries. | `validate-setup-fields.ts:52-54` (correction map) | ⚠ OPEN — either add `modulesAuthored → progressionMode` correction with value coercion, or document the path explicitly in the tool prompt. |
| W2 | **`constraints` accepted as passthrough, dropped silently at compose** — no loader reads `Playbook.config.constraints`. | `wizard-tool-executor.ts:790-791, 1176-1177` (write) vs `SectionDataLoader.ts` (no read) | ⚠ OPEN — either wire a loader OR route `constraints` to `teachingPrinciples` (which IS surfaced by `courseInstructions`). |
| W3 | **`pedagogicalPreset` REJECTED when AI mirrors course-ref-detected value into `update_setup`** | `validate-setup-fields.ts` (no entry) | ⚠ OPEN — either add INTERNAL_KEY or correct to `teachingMode`. |
| W4 | **`Domain.onboardingFlowPhases` overrides course-ref First-Call Special Rules at compose time** | `wizard-tool-executor.ts:1435-1482, 1711-1713, 1962-1964` (writes); compose loaders (read) | ⚠ In-flight on branch `fix/call1-honors-course-ref-and-no-tutor-doc-leak`. Verify merged before relying on this. |
| W5 | **`evaluateGraph` runs at `create_course`, not earlier** — partial fix in #318 catches `progressionMode + no Module Catalogue` but other cross-field rules may still surface only at the final step. | `wizard-tool-executor.ts:637-658` | ⚠ PARTIAL — consider moving to a per-`update_setup` check. |
| W6 | **AI never reads `update_setup` REJECTED errors** — older behaviour returned a soft ack so the AI assumed success. | `wizard-tool-executor.ts:202-222` | ✅ FIXED in the current PR series — now returns `is_error: true` with `unknownKeys` + `suggestions` payload. |
| W7 | **Validator silently drops unknown fields** | `wizard-tool-executor.ts:202-222` | ✅ FIXED (same PR as W6). |
| W8 | **New-path `create_course` was missing `progressionMode` mirror** — courses landed with `modulesAuthored=null`, surfacing a "Mode not set" pill on the course page. | `wizard-tool-executor.ts:1160-1171` | ✅ FIXED — mirror added in #253 follow-up. |

---

## 11. Change log

| Date | Change |
|------|--------|
| 2026-05-11 | Initial canonical version. Companion to CONTENT-PIPELINE.md. |

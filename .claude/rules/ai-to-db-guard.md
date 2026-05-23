# AI-to-DB Guard Pattern

## Rule: Never let AI output directly drive entity creation

When AI returns structured data that will be used to create, update, or delete database records, **always** insert a deterministic validation step between the AI response and the DB write.

```
AI proposes → Guard validates → Code executes
```

## When This Applies

Any code path where:
1. AI returns JSON/structured output (tool calls, classification, grouping, scoring)
2. That output determines **how many** records to create, **what type** of entity, or **which parent** to attach to
3. The code iterates the AI output and calls `prisma.*.create` / `update` / `delete`

## Required Checks

| AI decides | Guard must check |
|-----------|-----------------|
| How many entities to create | Max count cap (not just in prompt — enforce in code) |
| Entity type / classification | Whitelist validation with fallback |
| Parent-child relationships | FK exists in DB before write |
| Parameter/key names | Validate against known set from DB |
| Destructive operations (delete + rebuild) | Wrap in transaction, validate new data before deleting old |
| Module / LO identity by slug / ref | Use `resolveModuleByLogicalId(curriculumId, slug)` from `lib/curriculum/resolve-module.ts` — never bare `findFirst({where:{slug}})`. Slugs are per-parent unique, not global (#407). |
| Pipeline FK writes driven by AI output | `Call.curriculumModuleId` and `CallerModuleProgress.moduleId` are written from AI-returned slugs (`learningAssessment.moduleId`). Must scope by `playbookId → curriculumId` before resolving the slug. ESLint rule `hf-curriculum/no-unscoped-slug-lookup` blocks regressions. |

## Pattern: Validate-then-write

```typescript
// BAD: AI output → direct DB write
for (const group of aiResult.groups) {
  await prisma.subject.create({ data: { name: group.name } });
}

// GOOD: AI output → validate → DB write
const { validated, fixes } = validateManifest(aiResult);
console.log(`[guard] Applied ${fixes.length} fix(es)`);
for (const group of validated.groups) {
  await prisma.subject.create({ data: { name: group.name } });
}
```

## Existing Guards

| Location | Guard | What it prevents |
|----------|-------|-----------------|
| `lib/content-trust/validate-manifest.ts` | `validateManifest()` | AI creating too many subjects, promoting pedagogy to subjects |
| Pipeline `callScore` | Numeric clamping `[0, 1]` | Score overflow |
| Pipeline `callTarget` | `validateTargets()` guardrail pass | Target value outside safe range |
| `generate-groups` | `validateGroupType()` whitelist | Invalid group type enum |
| `lib/curriculum/resolve-module.ts` | `resolveModuleByLogicalId(curriculumId, slug)` — throws when curriculumId is empty | AI-returned slugs from `learningAssessment.moduleId` resolving to a cross-playbook CurriculumModule (#407 Opal/Freya/Tessa). |
| `eslint-rules/no-unscoped-slug-lookup.mjs` | Custom ESLint rule, error severity | New `prisma.curriculumModule.find*({where:{slug,...}})` without `curriculumId`. Same for `learningObjective` + `ref` + `moduleId`. (#411) |
| `scripts/check-fk-consistency.ts` (CI step 5) | SQL queries for cross-playbook leaks + orphan-LO + dangling-soft-FK | Bad data reaching dev/staging from a slipped-through code path (#415); LO/assertion soft-FK lag after `reconcile-lo-linkage.ts` cadence drift (#615). |
| `lib/content-trust/resolve-config.ts` | `categoryToTeachMethod()` short-circuit on INSTRUCTION_CATEGORIES + `assertNoLearnerMethodOnInstructionCategory()` at extraction boundaries | Tutor-only directives ("Speak to learn", "Pedagogical Principles", etc.) being assigned a learner-facing `teachMethod` and rendered as quiz questions in learner sessions (#605). Pre-fix the function's `recall_quiz` fallback silently fired for every INSTRUCTION_CATEGORIES member. |
| `lib/knowledge/cleanup-placeholder-subjects.ts` | `unlinkNonPrimaryPlaybookSubjects(playbookId, keepSubjectId)` called from `wizard-tool-executor.create_course` after the course-scoped Subject is linked | Two creation paths (`quick-launch/analyze` writes a domain-level Subject; `wizard-tool-executor.create_course` writes a course-scoped Subject) both linking via `PlaybookSubject` with no shared knowledge of each other. DB `@@unique([playbookId, subjectId])` only blocks pair-duplicates, not cross-subject coexistence. Produced duplicate CONTENT AUTHORITY sections in the composed prompt (#607 / IELTS Prep Lab). |

## Known Gaps (tech debt)

- `structure-assertions.ts`: deleteMany + rebuild without transaction — AI tree error = data loss
- `extract-curriculum.ts`: no max-module-count enforcement in code (only in prompt)
- Pipeline `parameterId`: FK constraint is only guard — no pre-filter against known params
- `callerMemory.create`: no count limit per call, no key/value length cap

## Escalation

If you're writing a new AI-to-DB path and can't add a structural guard, add a `// TODO(ai-guard):` comment explaining why and what the risk is. These are tracked by `broken-windows` agent.

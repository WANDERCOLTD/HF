---
name: PlaybookSource migration + subject identity fix
description: Two open stories (#180, #181) covering the Playbook→ContentSource architectural fix and subjectDiscipline-as-identity. Key files and what each story covers.
type: project
---

## PlaybookSource migration (#180) — what it covers

Story #180 is comprehensive and groomed. It covers:
- Phase 1: `PlaybookSource` schema + backfill
- Phase 2: dual-write at ingest + course-setup
- Phase 3: switch `getSourceIdsForPlaybook` to prefer `PlaybookSource`
- Phase 4: fix `curriculumQuestions`, `curriculumVocabulary`, `courseInstructions` loaders + VAPI
- Phase 5: remove local copy in `pre-test-builder.ts`; thread `playbookId` into `generate-content-spec.ts`

Plan files: `~/.claude/projects/-Users-paulwander-projects-HF/memory/playbook-source-migration.md` and `~/.claude/plans/zippy-tumbling-popcorn.md`

## subjectDiscipline authoritative (#181) — what it covers

Story #181 covers the prompt composition side:
- Fix `subjects?.[0]` pattern in 4 transforms: `instructions.ts:301`, `teaching-style.ts:186`, `pedagogy-mode.ts:113`, `teaching-content.ts:543`
- Follow pattern from `quickstart.ts:73-79` (already correct)
- Fix `inferSubjectDiscipline` word-boundary regex at `resolve-config.ts:1292`
- `modules.ts` intentionally stays Subject-driven (curriculum is stored against Subject)
- No schema changes — `/vm-cp` deploy

## Key files confirmed in search

| File | What it does |
|------|-------------|
| `lib/knowledge/domain-sources.ts` | Central resolver — all 16 consumers inherit fix from here |
| `lib/domain/course-setup.ts:239` | packSubject/primarySubject collision guards — stays, gets dual-write added |
| `app/api/course-pack/ingest/route.ts:575` | `resolvePrimarySubject()` — still creates Subject; PlaybookSource added by course-setup |
| `lib/prompt/composition/SectionDataLoader.ts:198` | Loads `PlaybookSubject` for subject data — stays until Phase 3 |
| `lib/content-trust/resolve-config.ts:1275` | `SUBJECT_PREAMBLES` — 9 disciplines; word-boundary fix needed |

## What is NOT built yet

- `PlaybookSource` model (no table exists)
- Discipline-authoritative fallback in instructions/teaching-style/pedagogy-mode transforms

**Why:** Ingest happens before playbook exists; dual-write must happen in `course-setup.ts` not ingest.

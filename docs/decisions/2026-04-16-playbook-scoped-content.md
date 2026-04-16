# ADR: Playbook-scoped content — SubjectSource owns the content boundary, not Subject

**Date:** 2026-04-16
**Status:** Proposed
**Deciders:** Paul W, AI planning session

## Context

Content in HF is scoped at the Subject level. The join chain is:

```
Playbook → PlaybookSubject → Subject → SubjectSource → ContentSource → ContentAssertion
```

Multiple courses (Playbooks) can share a Subject, which means they share all content attached to that Subject. This was originally intentional — Subject was designed as a shared knowledge area that multiple courses could reference. In practice, every course needs content isolation: the same discipline name ("English Language") does not mean the same content.

Three separate leak vectors were discovered in a single debugging session on 2026-04-16:

1. **Shared Subject leak** — Two courses share an "English Language" Subject. Chapter 1 content from one course leaks into a Chapter 4 course because assertions are resolved via Subject, not Playbook.
2. **Source dedup leak** — `ContentSource` dedup reuses rows across courses. Assertions created during dedup have `subjectSourceId: null` and are visible everywhere — no course boundary at all.
3. **Pipeline fan-out leak** — `sync-constraints` / `sync-goals` fire for ALL playbooks linked to a shared source, causing cross-course side effects in the pipeline.

A same-day patch in `course-setup.ts` prevents new courses from sharing Subjects, but this is a UI-level guard, not a structural one. It does not fix the dedup or null-scoped assertion issues.

## Decision

**Add `playbookId` (nullable FK) to the `SubjectSource` model.** This stamps each source-link with the course that created it. Content resolution filters by `playbookId` when available.

Subject remains as a domain-level organizational label but is no longer the content boundary.

Additionally:

- **Assertions must have `subjectSourceId` set** — new assertions are never created with `subjectSourceId: null`. Existing null-scoped assertions are backfilled.
- **COURSE_REFERENCE source dedup is scoped per-subject** — same content hash + different subject = create a new `SubjectSource` link, do not share assertions across subjects.
- **Remove the `subjectSourceId IS NULL` OR fallback** in the `curriculumAssertions` loader when scoped SubjectSources exist. The fallback was a convenience that became a leak vector.

### Data model change

```prisma
model SubjectSource {
  // ... existing fields ...
  playbookId  String?   @db.Uuid
  playbook    Playbook? @relation(fields: [playbookId], references: [id])

  @@index([playbookId])
}
```

### Content resolution change

```
Before:  WHERE ss.subjectId = ? AND (ca.subjectSourceId = ss.id OR ca.subjectSourceId IS NULL)
After:   WHERE ss.subjectId = ? AND ss.playbookId = ? AND ca.subjectSourceId = ss.id
```

## Alternatives considered

### A. Collapse Subject into Playbook entirely

Too large a refactor — ~40 files reference Subject. Subject still serves a useful purpose for domain-level reporting and organization (e.g., "how are all English Language courses performing?"). Destroying it loses that grouping capability.

### B. Add a PlaybookSource join table

Similar outcome to the chosen approach but introduces a new table instead of extending `SubjectSource`. More normalized but more migration complexity for the same result. Since `SubjectSource` already represents "this subject uses this source," adding the Playbook scope there is the natural extension.

### C. Never share Subjects between courses (UI guard only)

Partial fix — the same-day patch in `course-setup.ts` does this. But it does not fix:
- Existing shared Subjects already in the database
- Source dedup creating `subjectSourceId: null` assertions
- Pipeline fan-out through shared sources

A UI guard is necessary but not sufficient.

## Consequences

### Positive

- Content isolation is structural, enforced at the data model level — not dependent on avoiding Subject sharing at creation time
- Backward compatible — `null` playbookId preserves existing behavior during migration
- Fixes all three leak vectors discovered on 2026-04-16 in a single model change
- Subject remains available for cross-course reporting and domain-level organization

### Negative

- One more nullable FK on `SubjectSource` to maintain
- Backfill migration must handle cases where a `SubjectSource` is linked to a Subject that belongs to multiple Playbooks — strategy: assign the earliest Playbook as owner
- Content resolution queries gain one more WHERE clause — minor performance impact, offset by more precise results
- Any future code that creates `SubjectSource` rows must remember to set `playbookId` — enforced by a lint rule or factory function

### Migration plan

1. Add nullable `playbookId` column to `SubjectSource` (non-breaking)
2. Backfill: for each `SubjectSource`, find the Playbook(s) linked via `PlaybookSubject` to its Subject. Assign the earliest-created Playbook as owner.
3. Update content resolution queries to filter by `playbookId`
4. Update source dedup to scope per-subject
5. Backfill null `subjectSourceId` on existing `ContentAssertion` rows
6. Remove the `subjectSourceId IS NULL` OR fallback from `curriculumAssertions` loader

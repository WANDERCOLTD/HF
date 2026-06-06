# Playbook ↔ Curriculum Contracts

> **Read this before you touch any code that writes or reads a `Curriculum`, `PlaybookCurriculum`, `CurriculumModule`, or any `CallerAttribute` keyed by `curriculum:` or `playbook:`.** This doc catalogues the entity duality, the canonical patterns, every known landmine, and the migration playbook for new code shipped during Epic [#1177](https://github.com/WANDERCOLTD/HF/issues/1177) (Curriculum → Playbook collapse).
>
> Companion to:
> - [`docs/CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) — adaptive-loop stage-boundary contracts.
> - [`docs/ENTITIES.md`](./ENTITIES.md) — model layer (who-owns-what).
> - [`docs/PIPELINE.md`](./PIPELINE.md) — 7-stage pipeline mechanics.
> - [`docs/epic-100-chain-walk.md`](./epic-100-chain-walk.md) — original "Curriculum→Playbook collapse epic" deferred note.
> - [`.claude/rules/ai-to-db-guard.md`](../.claude/rules/ai-to-db-guard.md) — AI-to-DB write guard inventory.
> - Memory: [`entities.md`](../.claude/projects/-Users-paulwander-projects-HF/memory/entities.md) — entity hierarchy.

**Status:** Drafted 2026-06-06 from the [Playbook/Curriculum deep review](../.claude/projects/-Users-paulwander-projects-HF/memory/handoff-playbook-curriculum-deep-review.md) (post-PR #1198 / #1191 retire). Lives as a hard prerequisite for Epic #1177 slices.

**Label for all related work:** `curriculum-playbook-duality`.

---

## 1. What each entity legitimately owns

The split exists because we have two product-line concerns that historically shared one table:

| Entity | Owns | Does NOT own |
|---|---|---|
| **`Playbook`** | Per-course **delivery & tuning surface** — session flow, behavior targets, voice provider config, content trust filters, learner enrollment, brand. One playbook = one course product (one cohort buys one playbook). | The teaching content itself (modules, LOs, vocab, questions). |
| **`Curriculum`** | The **teaching content tree** — modules, learning objectives, vocabulary, questions, lesson plans, qualification anchor. One curriculum = one syllabus body (e.g. IELTS Speaking). | The delivery rules (session length, tier caps, persona) or the cohort. |
| **`PlaybookCurriculum`** | The **join row** between the two. Role `primary` means "this Playbook owns this Curriculum as its main content body". Role `linked` means "this variant Playbook reuses this parent's Curriculum". | Any content or config — it's purely an edge. |
| **`CurriculumModule`** | A unit of the syllabus tree (with slug per-curriculum unique, **not** global — #407). | Anything Playbook-scoped. |
| **`CurriculumLearningObjective`** | The granular LO under a module (with `ref` per-module unique). | Per-learner mastery state — that lives in `CallerAttribute` or `CallerModuleProgress`. |

### Today's reality (pre-#1177)

`Curriculum` carries **both** an inbound `playbookId` FK (legacy direct ownership) and an outbound `playbookLinks: PlaybookCurriculum[]` relation (canonical many-to-many). That's the duality.

A "well-formed" Curriculum today has:
- The `Curriculum` row itself (slug, name, subjectId, …).
- The deprecated `Curriculum.playbookId` FK pointing at the Playbook that owns it (transition column — will be dropped in Epic [#1038](https://github.com/WANDERCOLTD/HF/issues/1038)).
- A canonical `PlaybookCurriculum(role:'primary')` row attaching it to that same Playbook.
- Zero or more `PlaybookCurriculum(role:'linked')` rows attaching it to variant Playbooks that share its content body.

A "malformed" (orphan) Curriculum today is missing the primary join row but has `playbookId` set — variants can't find it via the canonical walk. Epic [#1184](https://github.com/WANDERCOLTD/HF/issues/1184) was exactly this bug class (closed by #1191 backfill).

---

## 2. The variant Playbook product line — CC-A contract

> **CC-A: Variant Playbooks reuse a single parent Curriculum via `PlaybookCurriculum(role:'linked')`. No copying. No fork. One body, many delivery configs.**

```
Parent Playbook (IELTS Prep Lab)            Variant Playbook (CIO Pop Quiz Variant)
   │                                              │
   │ PlaybookCurriculum(role:'primary')           │ PlaybookCurriculum(role:'linked')
   └──────────────┬───────────────────────────────┘
                  ▼
       Curriculum (ielts-speaking-001)
                  │
                  ▼
       CurriculumModule[] / LearningObjective[]
```

Each variant has its own behavior targets, session flow, tier caps, voice persona — but reads the **same** module tree, LO list, and vocab pool.

The variant creator (`lib/playbooks/create-variant.ts`) is the only blessed path. It:
- Reads the parent's `PlaybookCurriculum(role:'primary')` row.
- Writes a new `PlaybookCurriculum(role:'linked')` from the variant Playbook → that same Curriculum.
- Never writes `Curriculum`. Never sets `Curriculum.playbookId`.

**Why CC-A matters:** the lo_mastery key shape and most readers must respect this fan-out. If a reader assumes `playbook.curricula[0]` returns the Curriculum, it will silently return null on a variant (variants have `playbookCurricula` but not `curricula`). See §4 and §8.

---

## 3. Create-route contracts

Every Curriculum-writing route must write **all three** of:
1. The `Curriculum` row.
2. The deprecated `Curriculum.playbookId` FK (transition column — preserve until Epic #1038).
3. The canonical `PlaybookCurriculum(role:'primary')` row.

…**in a single transaction**. Variants are the only legal exception (they skip step 1 and 2, write `role:'linked'` instead of `'primary'`).

### Inventory

| Route / helper | Curriculum | Legacy FK | Primary join | Status | Notes |
|---|---|---|---|---|---|
| `POST /api/curricula` (`route.ts:105-113`) | ✓ | ✓ | ✗ | **ORPHAN-BUG — must fix before #1177 Slice 6** | Writes Curriculum + FK; no `PlaybookCurriculum.create`. Variants linked via join can't be discovered. |
| `POST /api/courses/[courseId]/regenerate-curriculum` (`route.ts:137-147`) | ✓ | ✓ | ✗ | **ORPHAN-BUG — must fix** | Same shape. Regeneration mints a new Curriculum without join row. |
| `POST /api/subjects/[subjectId]/curriculum` (`route.ts:262-336`) | ✓ (upsert) | ✓ | conditional | **PARTIAL — sibling-link path safe; fresh-mint path is orphan-bug** | When `siblingLink` resolves via anchor match → join row written at line 262-275. When fresh mint → upsert at line 305 writes Curriculum + FK, no join. |
| `POST /api/playbooks/[id]/variant` → `lib/playbooks/create-variant.ts` (`:169-176`) | — | — | ✓ (`linked`) | **CLEAN — canonical CC-A pattern** | Join-only. Reuses parent's Curriculum. |
| `lib/wizard/apply-projection.ts::ensureCurriculum` (`:352-374`) | ✓ | ✓ | ✓ (`primary`) | **CLEAN — canonical pattern** | All three writes inside one `prisma.$transaction`. The blessed example. |
| `lib/wizard/sync-authored-modules-to-curriculum.ts` (`:95-108`) | ✓ (fallback) | ✓ | ✓ | **CLEAN** | Dual-write inside transaction; creates join row immediately after Curriculum row. |
| `POST /api/lab/features/[id]/activate` (`:712-713`) — CONTENT spec path | ✓ | ✗ | ✗ | **STANDALONE-BUG — low blast radius (lab-only)** | Creates Curriculum with no FK, no join. Orphan from birth. |

### The canonical pattern

```typescript
await prisma.$transaction(async (tx) => {
  const curriculum = await tx.curriculum.create({
    data: {
      slug,
      name,
      subjectId,
      playbookId, // deprecated transition column — keep until Epic #1038
    },
  });
  await tx.playbookCurriculum.create({
    data: {
      playbookId,
      curriculumId: curriculum.id,
      role: 'primary',
    },
  });
  return curriculum;
});
```

The transaction wrapper is non-negotiable. Writing `Curriculum` first and `PlaybookCurriculum` second outside a transaction is the exact failure mode of the #1184 bug — a partial write that survived the request leaves a permanent orphan.

### Action items (file per route)

- File `curriculum-playbook-duality` issues for the three ORPHAN-BUG routes above, blocking Epic #1177 Slice 4.
- The `/api/lab/features/[id]/activate` path is lab-only and low blast — defer to a follow-up.

---

## 4. Read-pattern contracts

Until Epic #1177 Slice 6 drops `Curriculum.playbookId`, every reader must handle **both** ownership paths. The canonical walk is always: **PlaybookCurriculum first, legacy FK as fallback.**

### The blessed reader

`lib/curriculum/resolve-playbook-for-curriculum.ts::resolvePlaybookIdForCurriculum(curriculumId): Promise<string[]>`

```typescript
// PRIMARY PATH: PlaybookCurriculum (join table)
const joins = await prisma.playbookCurriculum.findMany({
  where: { curriculumId },
  select: { playbookId: true },
});
if (joins.length > 0) return joins.map((j) => j.playbookId);

// FALLBACK: deprecated Curriculum.playbookId column
const row = await prisma.curriculum.findUnique({
  where: { id: curriculumId },
  select: { playbookId: true },
});
return row?.playbookId ? [row.playbookId] : [];
```

Returns `string[]` (plural) so variant fan-out is explicit. Pre-#1034 this returned `string | null` and silently dropped variants. **The signature change is load-bearing — do not regress to scalar.**

### Module resolution under a Curriculum

`lib/curriculum/resolve-module.ts::resolveModuleByLogicalId(curriculumId, slugOrId)` is the AI-to-DB guard. It **throws** when `curriculumId` is falsy:

```typescript
if (!curriculumId) {
  throw new Error(
    "resolveModuleByLogicalId: curriculumId is required. " +
    "Unscoped slug lookups corrupt cross-playbook FKs — see #407.",
  );
}
```

ESLint rule `hf-curriculum/no-unscoped-slug-lookup` enforces this at build time. **Do not bypass.** See `.claude/rules/ai-to-db-guard.md`.

### Deprecated read patterns — current call sites

The Prisma relation `playbook.curricula` is `@deprecated #1034`. The canonical alternative is `playbook.playbookCurricula` (join rows). 6 routes still read the deprecated direct relation:

| Route / helper | File:line | Pattern | Variant-aware? | Risk |
|---|---|---|---|---|
| `GET /api/student/courses/[enrollmentId]/retake` | `route.ts` (find via qmd) | `enrollment.playbook.curricula[0]?.slug` | ✗ | **HIGH — crash on empty array** |
| `GET /api/student/journey-position` | `route.ts` | `enrollment.playbook.curricula?.[0]` | ✗ | MEDIUM — optional-chain saves the crash, returns null on variants |
| `GET /api/courses/[courseId]/distribution-advisory` | `route.ts` | `playbook.curricula.find(c => c.deliveryConfig)` | ✗ | **HIGH — crash on empty array** |
| `GET /api/educator/classrooms/[id]/lesson-plan` | `route.ts` | `playbook.curricula[0]` | ✗ | **HIGH — unchecked array access** |
| `GET /api/callers/[callerId]/session-flow-progress` | `route.ts` | `playbook.curricula?.[0]` | ✗ | MEDIUM — silent null on variants |
| `lib/assessment/module-groups.ts` | (find via qmd) | `playbookSource.playbook.curricula[0]` | ✗ | MEDIUM — silent empty |

**Migration recipe** (for each row above):

```typescript
// OLD — deprecated
const curriculumId = enrollment.playbook.curricula?.[0]?.id;

// NEW — canonical (variant-aware)
import { resolvePlaybookIdForCurriculum } from "@/lib/curriculum/resolve-playbook-for-curriculum";
// or, inverse direction (playbook → curricula):
const primary = enrollment.playbook.playbookCurricula?.find(pc => pc.role === 'primary');
const curriculumId = primary?.curriculumId;
```

### Dual-read tolerance helper (where one exists)

`lib/wizard/sync-authored-modules-to-curriculum.ts` shows the dual-read with fallback:

```typescript
const curriculum =
  playbook.playbookCurricula[0]?.curriculum
    ?? playbook.curricula[0]; // legacy fallback during transition
```

This pattern is acceptable in the deprecated-reader migration but should leave a `// TODO(#1038)` comment so it's removed when the FK column is dropped.

---

## 5. CallerAttribute scope taxonomy

`CallerAttribute` is a polymorphic per-learner key/value store. Today there are **5 distinct scope prefixes** in active use:

| Scope prefix | Bound to | Writers (representative) | Readers (representative) | Variant collision risk? |
|---|---|---|---|---|
| `curriculum:{specSlug}` | Curriculum | `lib/curriculum/track-progress.ts::updateCurriculumProgress` (`:132,165,351,382,704,848`); pipeline route `app/api/calls/[callId]/pipeline/route.ts:3097-3101` | `lib/prompt/composition/lo-mastery-map.ts:38-58`; transforms `modules.ts`, `retrieval-practice.ts`, `progress-narrative.ts` | **YES — see §6** |
| `playbook:{playbookId}` | Playbook | `lib/chat/admin-tool-handlers.ts:895,1697`; `lib/agent-tuner/write-target.ts:72,108`; `lib/wizard/project-course-reference.ts:521` | `lib/chat/tuning-system-prompt.ts:353`; `lib/tolerance/*` cascade | No — already variant-aware |
| `caller:{callerId}` | Caller (per-learner override) | `lib/chat/admin-tool-handlers.ts:1722,1732,1760`; `lib/agent-tuner/write-target.ts:190,217,233` | `lib/tolerance/getEffectiveBehaviorTargetsForCaller.ts` | No |
| `system` (no slug) | Global defaults (lowest in cascade) | `lib/system-ini.ts:226,241`; `lib/pipeline/specs-loader.ts:43` | `lib/tolerance/resolve-tolerance.ts` | No |
| `diagnostic:*` | Mock-derived aggregate output | `lib/curriculum/diagnostic-from-mock.ts` | `app/api/student/progress/route.ts:115` | No (mock-time only) |

The cascade order for behavior-target resolution is `caller > playbook > system` (most specific wins). Curriculum scope is not in the cascade — it's only used for content/progress state.

### Sub-scopes inside `curriculum:{specSlug}`

| Key shape | Purpose | Writer | Migration plan |
|---|---|---|---|
| `curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}` | Per-LO mastery tier (0.0–1.0) | `track-progress.ts::updateCurriculumProgress` | **Rekey to `playbook:{playbookId}:lo_mastery:…` in #1177 Slice 3** |
| `curriculum:{specSlug}:lo:{loRef}` | Per-LO assessment score (0.0–1.0, no module bucket) | `app/api/calls/[callId]/pipeline/route.ts:3097-3101` | **Same — rekey to `playbook:` prefix in Slice 3** |
| `curriculum:{specSlug}:scheduler:last_decision` | ADAPT-stage scheduler memo | `lib/pipeline/scheduler-decision.ts:52,79` | Safe — per-learner atomic, no cross-variant collision |
| `curriculum:{specSlug}:retrieval:recent_question_ids` | Spaced-retrieval anti-repeat buffer | `transforms/retrieval-practice.ts:29` | Safe — per-learner |

Only the first two need rekey for #1177. The other two are atomic per-learner and don't collide between variants.

---

## 6. The `lo_mastery` key-shape transition plan

### The bleed

Two variant Playbooks of the same Curriculum (e.g. "CIO Pop Quiz Variant" and "CIO Revision Aid Variant" of `ielts-speaking-001`) share `curriculumId`. Today both routes write to:

```
scope:    CURRICULUM
key:      curriculum:ielts-speaking-001:lo_mastery:module-slug:LO-2.1
```

So mastery from the Pop Quiz variant (which caps mastery at tier 2) pollutes the Revision Aid variant's lo_mastery store and vice versa. The reader filters by `currentSpecSlug`, so the rows survive — but both variants see the same blended state.

The **slug-form / name-form** lag from #611/#614 is a different (and now-resolved) sub-bug; the bleed described here is structural.

### Today

```
Writer:  track-progress.ts::updateCurriculumProgress
Key:     curriculum:{specSlug}:lo_mastery:{moduleSlug}:{loRef}
Scope:   CURRICULUM

Reader:  lo-mastery-map.ts:38-58
Filter:  startsWith(`curriculum:${currentSpecSlug}:lo_mastery:`) AND scope === 'CURRICULUM'
```

### During #1177 Slice 3 (grace window)

**Writer migrates first.** New writes go to `playbook:{playbookId}:lo_mastery:…`. Old writes (legacy callers) keep writing `curriculum:` keys until the migration script drains them.

**Reader dual-reads.**

```typescript
// 1. Try canonical scope
const fromPlaybook = await prisma.callerAttribute.findMany({
  where: { callerId, key: { startsWith: `playbook:${playbookId}:lo_mastery:` } },
});
if (fromPlaybook.length > 0) return buildMapFromRows(fromPlaybook);

// 2. Fall back to legacy scope — emit metric for drain visibility
const fromCurriculum = await prisma.callerAttribute.findMany({
  where: { callerId, key: { startsWith: `curriculum:${specSlug}:lo_mastery:` } },
});
metric('callerAttribute_legacy_curriculum_scope_read', 1, { specSlug });
return buildMapFromRows(fromCurriculum);
```

### After drain (Slice 4)

- `scripts/migrate-caller-attribute-lo-mastery-keys.ts` rewrites every `curriculum:*:lo_mastery:*` row to `playbook:*:lo_mastery:*` based on the learner's active enrollment's playbookId. Soft-deletes the old row with `validUntil = NOW()`.
- Reader's fallback branch is gated on a `legacyCurriculumScopeReadEnabled` flag (default off after drain audit shows 0 reads/24h).

### After flag removed (Slice 5+)

- Fallback branch deleted. Reader is single-path.

### Same plan applies to `curriculum:{specSlug}:lo:{loRef}` (pipeline route line 3097-3101)

Different key shape (no `module-slug` bucket), same migration treatment. The pipeline writer must be updated **in the same slice** as the track-progress writer to avoid leaving a half-migrated state.

---

## 7. AI-to-DB guard inventory

Every code path where AI output becomes a Curriculum write must pass through a deterministic guard. Existing guards (full list in `.claude/rules/ai-to-db-guard.md`):

| Guard | What it prevents |
|---|---|
| `lib/curriculum/resolve-module.ts::resolveModuleByLogicalId(curriculumId, slug)` | AI-returned slugs resolving to a cross-playbook CurriculumModule (#407). Throws on missing `curriculumId`. |
| `eslint-rules/no-unscoped-slug-lookup.mjs` | Build-time block on new `prisma.curriculumModule.find*({where:{slug}})` without `curriculumId`. Same for `learningObjective` + `ref`. |
| `scripts/check-fk-consistency.ts` (CI step 5) | Cross-playbook leaks + orphan-LO + dangling-soft-FK SQL probes. |
| `lib/curriculum/resolve-module.ts::resolveModuleSlug` (write path, #611 Fix A) + `scripts/migrate-caller-attribute-lo-mastery-keys.ts` (drain, #614) | Canonical slug-form in `CallerAttribute.key` for `lo_mastery:*` entries. AI echoing display titles as slugs is rejected at write. |
| `lib/learner-scope.ts::resolveCallerScopeForReading` | STUDENT sessions reading other learners' data via `?callerId=`. |

### New guards Epic #1177 will need

| Guard | What it prevents |
|---|---|
| `lib/curriculum/assert-primary-join-exists(playbookId, curriculumId)` *(proposed)* | Pre-flight check at Curriculum.create call sites to ensure the PlaybookCurriculum(primary) row will be written in the same transaction. Throws if used outside a `$transaction`. |
| ESLint rule `hf-curriculum/no-orphan-curriculum-create` *(proposed)* | Build-time scan: any `prisma.curriculum.create` call must be inside the same lexical scope as a `prisma.playbookCurriculum.create({ role: 'primary' })` call (or be a variant-only path that writes `role: 'linked'`). |
| ESLint rule `hf-curriculum/no-deprecated-curricula-relation` *(proposed)* | Block new reads of `playbook.curricula` (the @deprecated direct relation). Allow only `playbook.playbookCurricula`. |
| `lib/curriculum/read-callerattr-lo-mastery(callerId, playbookId, specSlug)` *(proposed)* | Single read helper that encapsulates the dual-read (playbook scope first, curriculum scope fallback) so the migration is mechanical and every reader gets the metric. |

---

## 8. Landmines (the canonical do-not-do list)

These patterns will break post-#1177 if used today. The audit found at least one live instance of most of them — that's why they're here.

### 8.1 Don't bare-find by slug

```typescript
// ❌ WRONG — slugs are per-curriculum unique, not global
const module = await prisma.curriculumModule.findFirst({
  where: { slug: 'part-1-familiar-topics' },
});

// ✅ RIGHT — use the scoped resolver
import { resolveModuleByLogicalId } from "@/lib/curriculum/resolve-module";
const module = await resolveModuleByLogicalId(curriculumId, 'part-1-familiar-topics');
```

ESLint rule `hf-curriculum/no-unscoped-slug-lookup` enforces this. Don't disable it.

### 8.2 Don't read `playbook.curricula` directly

```typescript
// ❌ WRONG — deprecated relation; misses variants
const curriculumId = playbook.curricula[0]?.id;

// ✅ RIGHT — canonical join
const primary = playbook.playbookCurricula.find(pc => pc.role === 'primary');
const curriculumId = primary?.curriculumId;
```

The `curricula` relation is `@deprecated #1034`. Variants linked via the join table do not appear in this array.

### 8.3 Don't write `Curriculum` without `PlaybookCurriculum(role:'primary')`

```typescript
// ❌ WRONG — the #1184 bug
const curriculum = await prisma.curriculum.create({
  data: { slug, name, subjectId, playbookId },
});
// (no join row → variants can't discover this curriculum)

// ✅ RIGHT — transactional dual-write
await prisma.$transaction(async (tx) => {
  const curriculum = await tx.curriculum.create({
    data: { slug, name, subjectId, playbookId },
  });
  await tx.playbookCurriculum.create({
    data: { playbookId, curriculumId: curriculum.id, role: 'primary' },
  });
  return curriculum;
});
```

3 routes still violate this — see §3.

### 8.4 Don't trust slug-scope as the only multi-tenant guard

The current `curriculum:{specSlug}:lo_mastery:*` key shape lets variant Playbooks of one Curriculum **bleed** into each other's mastery state. Until #1177 Slice 3 rekeys to `playbook:{playbookId}:`, treat any same-Curriculum variant pair as a single shared mastery pool. **Don't introduce new code that assumes per-variant mastery isolation today.**

### 8.5 `Call.curriculumModuleId` will become `Call.moduleId`

When writing new pipeline code that reads/writes this column, use a local variable name (e.g. `const moduleId = call.curriculumModuleId;`) so the eventual rename is mechanical. Don't sprinkle `call.curriculumModuleId` access across the codebase.

### 8.6 `Curriculum.qualificationAnchor` will move to `Playbook`

Same advice: prefer helper functions over direct column access. The qualification anchor is genuinely Playbook-scoped (one syllabus body can map to different IELTS bands depending on the cohort) and the column move is queued.

### 8.7 Persona loaders live in `lib/domain/persona-loaders.ts`

Extracted from `lib/domain/quick-launch.ts` in #1191. If your code needs `loadPersonaFlowPhases`, `loadPersonaArchetype`, or `loadPersonaWelcomeTemplate`, import from the new home. The old file is gone.

### 8.8 `/x/quick-launch` and `/api/domains/quick-launch/*` are GONE

Communities revival goes through the V6 wizard chain (`lib/wizard-v6/`). Don't reference the old routes in new code; don't restore them.

### 8.9 Don't hardcode `curriculum:` as a CallerAttribute key prefix in new code

The hardcoded prefix at `app/api/calls/[callId]/pipeline/route.ts:3097-3101` is on the migration list. If you're adding a new CallerAttribute writer that wants per-LO scope, **write to `playbook:{playbookId}:…` from day one** and add a `// TODO(#1177-Slice-3): also dual-write curriculum scope until reader cuts over` if you need transition coverage.

### 8.10 Don't fix one create route without the matching reader

The orphan-bug routes in §3 silently break the variant fan-out. Fixing the writer alone moves the bug to a different shape. Pair every writer fix with a verification that `resolvePlaybookIdForCurriculum` returns the expected set.

---

## 9. Spec JSON contracts

Spec JSONs live in `apps/admin/docs-archive/bdd-specs/`. They are seed data only; once seeded, DB owns the rows. Three classes:

### CONTENT specs (`*-CONTENT-001.spec.json`)

- One spec → one canonical `Curriculum` row (slug = lower-snake of spec slug).
- Active CONTENT specs **must** have a `PlaybookCurriculum(role:'primary')` row attaching them to a Playbook. Without that row the Curriculum is orphan (the #1184 bug class).
- The 3 specs deleted in PR #1198 (WNF-CONTENT-001, QM-CONTENT-001, CURR-FS-L2-001) were orphan from birth — 0 modules, 0 PlaybookCurriculum links, 0 referencing Calls. Their DB rows are dropped by the `cleanup_orphan_seed_curricula` migration shipped in #1198.

### TUTOR / persona specs (`TUT-*.spec.json`, `*-IDENTITY-*.spec.json`)

- Loaded dynamically by domain/persona resolvers — **not** attached to a Playbook directly.
- TUT-WNF-001 and TUT-QM-001 remain in the specs dir; they are *not* orphan despite their CONTENT siblings being deleted. They are identity specs that extend `TUT-001` and are resolved by `loadPersonaArchetype()` at runtime.

### Pipeline / system specs (`PIPELINE-001`, `INIT-001`, `LEARN-ASSESS-001`, `COURSE-SETUP-001`, …)

- Drive pipeline stage config and Playbook tuning surfaces.
- Reference contract names (e.g. `CURRICULUM_PROGRESS_V1` in LEARN-ASSESS-001) but **do not** specify storage scope. The implementation choice of `curriculum:` vs `playbook:` prefix in CallerAttribute is invisible to the spec.
- Implication: §6's lo_mastery rekey does not require a spec change. Specs are stable across the transition.

### Deprecating a CONTENT spec cleanly

1. Confirm the spec's Curriculum has 0 modules, 0 PlaybookCurriculum links, 0 referencing Calls. SQL probe:
   ```sql
   SELECT c.slug,
     (SELECT COUNT(*) FROM "CurriculumModule" WHERE "curriculumId" = c.id) AS module_count,
     (SELECT COUNT(*) FROM "PlaybookCurriculum" WHERE "curriculumId" = c.id) AS join_count,
     (SELECT COUNT(*) FROM "Call" WHERE "curriculumId" = c.id) AS call_count
   FROM "Curriculum" c WHERE c.slug = '<spec-slug>';
   ```
2. Delete the spec JSON.
3. Write a migration with NOT EXISTS guards to delete the orphan Curriculum row. Template: `prisma/migrations/20260606134121_cleanup_orphan_seed_curricula/migration.sql`.
4. Update any TUTOR specs that referenced the deleted CONTENT spec by slug (rare).

---

## 10. Migration playbook — adding new code mid-collapse

If you are adding new code that touches Curriculum, Playbook, PlaybookCurriculum, or CallerAttribute scopes during the #1177 collapse window, follow this checklist. Do not skip steps "because the audit said it's safe" — the audit is point-in-time.

### A. Writing a new Curriculum

1. ✅ Write Curriculum + legacy FK + `PlaybookCurriculum(role:'primary')` in **one** `prisma.$transaction`.
2. ✅ Use the canonical pattern from §3.
3. ✅ Add an integration test that verifies the join row exists after your route runs.
4. ✅ Run `npm run ctl check` — the FK consistency probe (`scripts/check-fk-consistency.ts`) will catch most orphans.
5. ❌ Do NOT write `Curriculum.playbookId` without a matching `PlaybookCurriculum` row in the same transaction.

### B. Writing a new variant Playbook

1. ✅ Use `lib/playbooks/create-variant.ts` as the canonical helper.
2. ✅ Write `PlaybookCurriculum(role:'linked')` against the parent's Curriculum — never mint a new Curriculum.
3. ❌ Do NOT copy modules. Do NOT fork Curriculum.

### C. Reading a Curriculum from a Playbook

1. ✅ Prefer `playbook.playbookCurricula` (the canonical join).
2. ✅ If you must support legacy data, dual-read with the canonical-first / legacy-fallback pattern from `sync-authored-modules-to-curriculum.ts`.
3. ✅ If you need to fan out to all variants sharing the Curriculum, use `resolvePlaybookIdForCurriculum(curriculumId)` (returns `string[]`).
4. ❌ Do NOT use `playbook.curricula[0]` — that's the deprecated relation.

### D. Reading per-LO mastery

1. ✅ During the #1177 Slice 3 grace window, use the dual-read helper (proposed in §7). If it doesn't exist yet, implement the helper rather than inlining the dual-read.
2. ✅ Emit the `callerAttribute_legacy_curriculum_scope_read` metric when the fallback branch fires — this is how we know when the flag is safe to flip off.
3. ❌ Do NOT write new `curriculum:*:lo_mastery:*` keys. Write to `playbook:*:lo_mastery:*` from day one.

### E. Adding a new CallerAttribute scope

1. ✅ Decide if the data is Curriculum-bound (shared across variants of one syllabus) or Playbook-bound (per delivery config). Default Playbook-bound — only choose Curriculum-bound if you can articulate why sharing is correct.
2. ✅ Use a scope prefix from §5 or add a new one to the taxonomy and update this doc.
3. ✅ If Curriculum-bound, document the bleed risk in §5 and add a `// TODO(#1177)` if it should be playbook-rekeyed.

### F. Deleting code from the duality surface

1. ✅ Use `qmd search` AND `hf-graph` AND grep `@/lib/...` import paths before claiming "no callers". A single literal grep misses TypeScript path aliases. (Lesson from PR #1198 — see issue [#1200](https://github.com/WANDERCOLTD/HF/issues/1200).)
2. ✅ Delete the test file in the same commit as the production file. Orphan tests break tsc.
3. ✅ Confirm tsc count before and after; defer the delete if it adds errors.

---

## Cross-references

- **Open issues:**
  - [#1177](https://github.com/WANDERCOLTD/HF/issues/1177) — Curriculum → Playbook collapse epic (6 slices)
  - [#1192](https://github.com/WANDERCOLTD/HF/issues/1192) — Dead-code sweep follow-up (safe slice shipped in #1198, deferred deletes in #1200)
  - [#1193](https://github.com/WANDERCOLTD/HF/issues/1193) — Documentation gaps (this doc closes most)
  - [#1200](https://github.com/WANDERCOLTD/HF/issues/1200) — Retire `resolve-primary-subject` + `sync-instructions-to-spec` after caller migration
  - [#1038](https://github.com/WANDERCOLTD/HF/issues/1038) — Drop `Curriculum.playbookId` column (Slice 6 of #1177)

- **Retro labels** (`curriculum-playbook-duality`):
  - #1184 — orphan-Curriculum bug class (closed by #1191 / #1198)
  - #1191 — quick-launch retire
  - #1167, #1145, #1154 — earlier duality-adjacent fixes
  - #611, #614 — slug-form / name-form lo_mastery key migration

- **Sibling docs:**
  - [`docs/CHAIN-CONTRACTS.md`](./CHAIN-CONTRACTS.md) — adaptive-loop boundary contracts
  - [`docs/PIPELINE.md`](./PIPELINE.md) — 7-stage pipeline
  - [`docs/PROMPT-COMPOSITION.md`](./PROMPT-COMPOSITION.md) — COMPOSE-stage loaders + transforms
  - [`docs/ENTITIES.md`](./ENTITIES.md) — model layer
  - [`.claude/rules/ai-to-db-guard.md`](../.claude/rules/ai-to-db-guard.md) — AI-to-DB guard inventory
  - Memory: [`entities.md`](../.claude/projects/-Users-paulwander-projects-HF/memory/entities.md), [`ai-to-db-fk-writes.md`](../.claude/projects/-Users-paulwander-projects-HF/memory/ai-to-db-fk-writes.md)

- **The handoff that produced this doc:**
  - [`handoff-playbook-curriculum-deep-review.md`](../.claude/projects/-Users-paulwander-projects-HF/memory/handoff-playbook-curriculum-deep-review.md)

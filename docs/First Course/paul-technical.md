# Paul — Technical Execution Plan: Slice 1

> **Done condition:** Session completes via Sim, transcript + observations visible in UI.
> **Voice / VAPI is out of scope.** Everything here is text chat via the Sim route.
> **Related plans:** `swift-wibbling-lampson.md` (instruction/content split), `crispy-discovering-lampson.md` (wizard step split)

---

## Open Questions — All Resolved

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | systemSpecToggles wiring | **DONE** | Commit `a00ffca` — composition filters by `Playbook.config.systemSpecToggles`. Tests in `system-spec-toggles-test.ts`. |
| Q2 | Composition resilience | **DONE** | All 15 empty data loaders handle null gracefully via `activateWhen` conditions + fallback rules. |
| Q3 | Teaching point filtering | **DONE** | `create_course` populates `assertionIds` on lesson plan entries via `generateLessonPlan()`. Priority 0 filtering works. **Caveat:** 226 instruction assertions mixed with 190 content — Epic 2 fixes this. |
| Q4 | Pipeline selectivity | **ACCEPTABLE** | All 7 stages run in `prompt` mode. Inactive stages produce nothing against empty data. Wastes tokens, doesn't break. |
| Q5 | Pipeline failure handling | **DONE** | Transcript persists BEFORE pipeline fires. Sessions never disappear. |
| Q6 | Fresh vs existing instance | **USE EXISTING** | Faster. PIPELINE-001 must be seeded (`npm run db:seed`). |
| Q7 | System description gaps | **N/A** | INIT-001 not needed — Sim bypasses first-call flow. GUARD-001 uses compiled defaults when spec is off. |

---

## Recent Fixes (last 36 hours)

| Commit | What | Impact |
|--------|------|--------|
| `a00ffca` | Wire systemSpecToggles into prompt composition | Q1 — selective spec loading works |
| `c8e9443` | Auto-link domain content subjects when AI omits packSubjectIds | Course creation reliability |
| `324faf5` | Auto-backfill teachMethod on assertions in create_course | Assertion completeness |
| `a7037d6` | Respect user's explicit course name (no silent merge) | Wizard correctness |
| `08d2fc2` | DB-backed logging (AppLog table) | Observability on Cloud Run |
| `2794a8a` | Guard prisma.appLog calls | Stability |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| 226 instruction assertions in teaching content | **HIGH** | Epic 2 — instruction/content split (swift-wibbling-lampson) |
| Pipeline failure invisible to operator | **MEDIUM** | Document manual nav for demo; optionally add completion link (Epic 4) |
| PIPELINE-001 spec not seeded on target env | **HIGH** | Verify in Epic 1, `npm run db:seed` fixes |
| compose-prompt init failure = silent no-session | **MEDIUM** | Edge case, dev-reproducible only |
| Redundant compose-prompt POST after pipeline end | **LOW** | Wasted AI spend, not breaking |

---

## Epic 1 — Chain Verification

> **No code changes.** Run in sequence on DEV. Prove every link works before writing code.

### V1.1 — Course creation + content ingestion

Create a course via the wizard with test content (PDF upload).

- [ ] Wizard completes without errors
- [ ] ContentSource records created, linked to playbook
- [ ] ContentAssertions extracted (note count: expect ~190 content + ~226 instruction)
- [ ] Lesson plan entries exist with populated `assertionIds`
- [ ] Curriculum record has `deliveryConfig.lessonPlan` with session entries

**Files:** `lib/chat/wizard-tools.ts` (create_course), `lib/content-trust/lesson-planner.ts`
**Effort:** S (30 min)

### V1.2 — Playbook configuration

Verify the playbook has correct spec toggles.

- [ ] `Playbook.config.systemSpecToggles` exists
- [ ] Only 3 specs active: base archetype (TUT-001), identity overlay, VOICE-001
- [ ] All other system specs disabled
- [ ] If not auto-configured: set manually via Prisma Studio

**Files:** `lib/prompt/composition/SectionDataLoader.ts` (filterSpecsByToggles)
**Effort:** S (30 min)

### V1.3 — Sim session + prompt composition

Run a text chat session via Sim.

- [ ] Test student enrolled (CallerPlaybook link exists)
- [ ] Sim initiates session without errors
- [ ] Composed prompt has 8 active sections (preamble, quick_start, identity, content, teaching_content, course_instructions, instructions_voice, instructions)
- [ ] 15 empty sections return defaults gracefully (no loader crashes)
- [ ] Tutor references actual course content, not generic filler
- [ ] Note: prompt will include instruction assertions in teaching content — expected, fixed in Epic 2

**Files:** `app/x/sim/`, `lib/prompt/composition/`
**Effort:** S (1h)
**Dependencies:** V1.1, V1.2

### V1.4 — Post-session pipeline

End the Sim session and check results.

- [ ] Pipeline fires after session ends
- [ ] Navigate to caller detail → Journey tab: session appears in history
- [ ] Expand session: full transcript visible
- [ ] How tab: LEARN observations displayed (memories, facts)
- [ ] Artifacts tab: ARTIFACTS output displayed (summaries)
- [ ] All 4 Slice 1 done-condition items visible

**Files:** `app/api/calls/[callId]/pipeline/route.ts`, `components/callers/caller-detail/`
**Effort:** S (1h)
**Dependencies:** V1.3

### V1.5 — Full walkthrough dry run

Walk the complete investor demo sequence from boaz-investor.md.

- [ ] All 6 scenarios completable from browser UI
- [ ] No step requires SSH, DB queries, or code changes
- [ ] Time the walkthrough (target: under 10 minutes)
- [ ] Note friction points for Epic 4

**Dependencies:** V1.4

---

## Epic 2 — Instruction/Content Split (swift-wibbling-lampson)

> **Prerequisite for a clean demo.** Without this, 226 teacher instructions are dumped into the teaching content section of the prompt alongside 190 student-facing content assertions. The tutor's teaching rules belong in the identity spec, not in per-session teaching content.

### G2.1 — Exclude instruction categories from lesson planner (S)

The lesson planner currently includes instruction-category assertions (`teaching_rule`, `session_flow`, `scaffolding_technique`, `skill_framework`, `communication_rule`, `assessment_approach`, `differentiation`, `edge_case`) in session `assertionIds`. These are teacher rules, not student content.

- [ ] `lesson-planner.ts`: filter out `INSTRUCTION_CATEGORIES` from assertion queries
- [ ] Session `assertionIds` contain only student-facing content assertions
- [ ] Regenerate lesson plan for test course, verify assertion count drops

**File:** `apps/admin/lib/content-trust/lesson-planner.ts` (~line 103)
**Reuse:** `INSTRUCTION_CATEGORIES` from `lib/content-trust/resolve-config.ts`
**Effort:** S (30 min)

### G2.2 — Split content/instruction counts in UI (M)

UI currently shows "416 teaching points" — really 190 content + 226 rules. Split the display.

- [ ] `content-breakdown` API: return `contentCount` + `instructionCount`
- [ ] `subjects` API: return `instructionCount` per subject
- [ ] Course page stat cards: `[Content: 190] [Rules: 226]`
- [ ] Tab badges: What tab = content count, How tab = instruction count
- [ ] Setup tracker: "190 teaching points + 226 rules found"

**Files:**
- `apps/admin/app/api/courses/[courseId]/content-breakdown/route.ts`
- `apps/admin/app/api/courses/[courseId]/subjects/route.ts`
- `apps/admin/app/x/courses/[courseId]/page.tsx`
- `apps/admin/hooks/useCourseSetupStatus.ts`
- `apps/admin/app/x/get-started-v4/components/SourcesPanel.tsx`

**Effort:** M (2 hours)

### G2.3 — Merge instruction assertions into identity spec overlay (M)

Cross-cutting teaching rules belong in the tutor's identity, not in per-session teaching content.

| Instruction Category | Identity Spec Field |
|---------------------|---------------------|
| `communication_rule`, `scaffolding_technique`, `differentiation` | `styleGuidelines[]` |
| `teaching_rule`, `edge_case` | `boundaries.doesNot[]` |
| `session_flow` | `sessionStructure[]` |
| `skill_framework`, `assessment_approach` | `assessmentApproach` |

- [ ] New function: `syncInstructionsToIdentitySpec(playbookId)` in `lib/content-trust/sync-instructions-to-spec.ts`
- [ ] Loads instruction-category assertions for playbook's content scope
- [ ] Maps categories to identity spec config fields (table above)
- [ ] Append-only merge with dedup by assertion text
- [ ] Called from `wizard-tools.ts` create_course (after backfillTeachMethods)
- [ ] Called from `course-pack/ingest/route.ts` (after extraction complete)
- [ ] After sync: identity spec overlay contains merged rules

**Files:**
- **NEW:** `apps/admin/lib/content-trust/sync-instructions-to-spec.ts`
- `apps/admin/lib/chat/wizard-tools.ts` (~line 1170)
- `apps/admin/app/api/course-pack/ingest/route.ts`

**Reuse:**
- `INSTRUCTION_CATEGORIES` from `resolve-config.ts`
- `getSubjectsForPlaybook()` from `lib/knowledge/domain-sources.ts`
- `courseInstructions` loader query pattern from `SectionDataLoader.ts`

**Effort:** M (2-3 hours)

### G2.4 — Dedup guard in course-instructions transform (S)

Once rules are in the identity spec, `renderCourseInstructions` would duplicate them. Add a guard.

- [ ] Check if identity spec overlay already contains the instruction rules (synced flag or content comparison)
- [ ] If synced: skip rendering `## COURSE RULES` section
- [ ] If not synced (legacy courses): render as before (safety net)

**File:** `apps/admin/lib/prompt/composition/transforms/course-instructions.ts`
**Effort:** S (30 min)
**Dependencies:** G2.3 must be done first

---

## Epic 3 — Wizard Step Split (CONDITIONAL)

> **From `crispy-discovering-lampson.md`.** Only if investor demo needs a cleaner course creation flow. Deferred by default.

### P3.1 — Extract Plan Settings step (M)

Split the "intents" phase from LessonPlanStep into a dedicated PlanSettingsStep (step 3 of 7).

- [ ] New `PlanSettingsStep.tsx`: session count, duration, emphasis, teaching model pickers
- [ ] `IntentStep.tsx`: remove eager generation, make handleNext synchronous
- [ ] `LessonPlanStep.tsx`: auto-trigger on mount, skip if `lessonPlanMode: "skipped"`
- [ ] `new/page.tsx`: 6 → 7 steps with unified terminology

**Full plan:** `crispy-discovering-lampson.md`
**Effort:** M (3-4 hours)
**Deploy:** `/vm-cp` (no migration)

---

## Epic 4 — Demo Polish

### P4.1 — Rename "Sim" to "Practice Session" (S)

- [ ] Sidebar label updated
- [ ] Page heading updated
- [ ] Dashboard config label updated
- [ ] URL stays `/x/sim`

**Files:** sidebar config, `app/x/sim/page.tsx`, `app/x/_dashboards/dashboard-config.ts`
**Effort:** S (30 min)

### P4.2 — Pipeline completion indicator (S)

After Sim session ends, operator needs to know results are ready.

- [ ] Option A: Show "View results" link to caller detail when pipeline completes
- [ ] Option B: Document manual navigation in demo script (zero code)
- [ ] Choose based on Epic 1 dry run findings

**File:** `components/sim/SimChat.tsx` (if Option A)
**Effort:** S (1h for Option A, 0 for Option B)

---

## Execution Order

```
Epic 1: Verify (V1.1 → V1.2 → V1.3 → V1.4 → V1.5)
  ↓ findings inform scope
Epic 2: Instruction split (G2.1 → G2.3 → G2.4 | G2.2 in parallel)
  ↓ re-verify chain
Epic 4: Polish (P4.1, P4.2 — parallel, any time)
  ↓ only if needed
Epic 3: Wizard step split (P3.1 — conditional)
```

**Slice 1 done when:** Session completes via Sim, transcript + observations visible in UI, teaching content is student-facing only (not bloated with 226 instruction rules).

---

## Deploy

All epics: `/vm-cp` (no schema changes, no migrations).

---

## Out of Scope (Slice 1)

- Voice / VAPI
- Multiple institutions, domains, or courses
- Student registration flow (WhatsApp, email, bulk import)
- Curriculum editor
- Activity toolkit, visual aids, pedagogy mode
- Content trust level assignment
- SCORE_AGENT, ADAPT, EXTRACT_GOALS, ACTIONS pipeline stages
- Partner-facing views
- Concurrent users

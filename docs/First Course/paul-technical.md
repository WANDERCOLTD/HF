# Paul — Technical Execution Plan: Slice 1

> **Done condition:** Session completes via Sim, transcript + observations visible in UI.
> **Voice / VAPI is out of scope.** Everything here is text chat via the Sim route.
> **Related plans:** `swift-wibbling-lampson.md` (instruction/content split), `crispy-discovering-lampson.md` (wizard step split)

---

## Open Questions — All Resolved ✅

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | systemSpecToggles wiring | **DONE** | Commit `a00ffca` — composition filters by `Playbook.config.systemSpecToggles`. Tests in `system-spec-toggles-test.ts`. |
| Q2 | Composition resilience | **DONE** | All 15 empty data loaders handle null gracefully via `activateWhen` conditions + fallback rules. |
| Q3 | Teaching point filtering | **DONE** | `create_course` populates `assertionIds` on lesson plan entries via `generateLessonPlan()`. Priority 0 filtering works. Instruction assertions now split out — see Epic 2. |
| Q4 | Pipeline selectivity | **ACCEPTABLE** | All 7 stages run in `prompt` mode. Inactive stages produce nothing against empty data. Wastes tokens, doesn't break. |
| Q5 | Pipeline failure handling | **DONE** | Transcript persists BEFORE pipeline fires. Sessions never disappear. |
| Q6 | Fresh vs existing instance | **USE EXISTING** | Faster. PIPELINE-001 must be seeded (`npm run db:seed`). |
| Q7 | System description gaps | **N/A** | INIT-001 not needed — Sim bypasses first-call flow. GUARD-001 uses compiled defaults when spec is off. |

---

## Build Log

| Commit | What | Epic |
|--------|------|------|
| `a00ffca` | Wire systemSpecToggles into prompt composition | Q1 |
| `c8e9443` | Auto-link domain content subjects when AI omits packSubjectIds | Reliability |
| `324faf5` | Auto-backfill teachMethod on assertions in create_course | Reliability |
| `a7037d6` | Respect user's explicit course name (no silent merge) | Reliability |
| `08d2fc2` | DB-backed logging (AppLog table) | Observability |
| `2794a8a` | Guard prisma.appLog calls | Stability |
| `88b2404` | Split teacher instructions vs student content in UI counts | Epic 2 (G2.1 + G2.2) |
| `df31b8a` | Per-course identity spec overlay with instruction sync | Epic 2 (G2.3 + G2.4) |
| `fc1c391` | Recursive identity spec resolution | Epic 2 fix |
| `7606436` | Guard against undefined panel.options in OptionsCard | Stability |

---

## Risk Assessment

| Risk | Severity | Status |
|------|----------|--------|
| 226 instruction assertions in teaching content | ~~HIGH~~ | **RESOLVED** — Epic 2 complete (`88b2404`, `df31b8a`) |
| Pipeline failure invisible to operator | **MEDIUM** | Document manual nav for demo; optionally add completion link (P4.2) |
| PIPELINE-001 spec not seeded on target env | **HIGH** | Verify in Epic 1, `npm run db:seed` fixes |
| compose-prompt init failure = silent no-session | **MEDIUM** | Edge case, dev-reproducible only |
| Redundant compose-prompt POST after pipeline end | **LOW** | Wasted AI spend, not breaking |

---

## Epic 1 — Chain Verification (PENDING — run on DEV)

> **No code changes.** Run in sequence on DEV. Prove every link works. All underlying code is complete — this is a manual verification pass.

### V1.1 — Course creation + content ingestion

Create a course via the wizard with test content (PDF upload).

- [ ] Wizard completes without errors
- [ ] ContentSource records created, linked to playbook
- [ ] ContentAssertions extracted (expect ~190 content + ~226 instruction, now split in UI)
- [ ] Lesson plan entries exist with populated `assertionIds` (content-only after Epic 2)
- [ ] Curriculum record has `deliveryConfig.lessonPlan` with session entries

### V1.2 — Playbook configuration

Verify the playbook has correct spec toggles.

- [ ] `Playbook.config.systemSpecToggles` exists
- [ ] Only 3 specs active: base archetype (TUT-001), identity overlay, VOICE-001
- [ ] All other system specs disabled
- [ ] If not auto-configured: set manually via Prisma Studio

### V1.3 — Sim session + prompt composition

Run a text chat session via Sim.

- [ ] Test student enrolled (CallerPlaybook link exists)
- [ ] Sim initiates session without errors
- [ ] Composed prompt has 8 active sections (preamble, quick_start, identity, content, teaching_content, course_instructions, instructions_voice, instructions)
- [ ] 15 empty sections return defaults gracefully (no loader crashes)
- [ ] Tutor references actual course content, not generic filler
- [ ] Instruction assertions in identity spec (not teaching content) — verify Epic 2 split

### V1.4 — Post-session pipeline

End the Sim session and check results.

- [ ] Pipeline fires after session ends
- [ ] Navigate to caller detail → Journey tab: session appears in history
- [ ] Expand session: full transcript visible
- [ ] How tab: LEARN observations displayed (memories, facts)
- [ ] Artifacts tab: ARTIFACTS output displayed (summaries)
- [ ] All 4 Slice 1 done-condition items visible

### V1.5 — Full walkthrough dry run

Walk the complete investor demo sequence from boaz-investor.md.

- [ ] All 7 scenarios completable from browser UI
- [ ] No step requires SSH, DB queries, or code changes
- [ ] Time the walkthrough (target: under 10 minutes)
- [ ] Note friction points for remaining polish

---

## Epic 2 — Instruction/Content Split ✅ COMPLETE

> Commits: `88b2404` (G2.1 + G2.2), `df31b8a` (G2.3 + G2.4), `fc1c391` (identity resolution fix)

### G2.1 — Exclude instruction categories from lesson planner ✅

- [x] `lesson-planner.ts`: filters out `INSTRUCTION_CATEGORIES` from assertion queries
- [x] Session `assertionIds` contain only student-facing content assertions

### G2.2 — Split content/instruction counts in UI ✅

- [x] `content-breakdown` API: returns `contentCount` + `instructionCount`
- [x] `subjects` API: returns `instructionCount` per subject
- [x] Course page stat cards: `[Content: 190] [Rules: 226]`
- [x] Tab badges: What tab = content count, How tab = instruction count
- [x] Setup tracker: "190 teaching points + 226 rules found"
- [x] SourcesPanel: "items extracted" instead of "teaching points"

### G2.3 — Merge instruction assertions into identity spec overlay ✅

- [x] `syncInstructionsToIdentitySpec(playbookId)` in `lib/content-trust/sync-instructions-to-spec.ts`
- [x] Maps categories to identity spec config fields (styleGuidelines, constraints, sessionStructure, assessment)
- [x] Append-only merge with dedup by assertion text
- [x] Called from `wizard-tools.ts` create_course (after backfillTeachMethods)
- [x] Per-course identity spec overlay created (extendsAgent → domain overlay)

### G2.4 — Dedup guard in course-instructions transform ✅

- [x] Checks for `_syncedFromAssertions` flag on identity spec
- [x] If synced: skips rendering `## COURSE RULES` section
- [x] Legacy courses (not synced): renders as before (safety net)

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

### P4.1 — Rename "Sim" to "Practice Session" — N/A (SUPERSEDED)

"Sim" is the internal operator tool at `/x/sim`. The investor-facing entry point is **Demonstrate** (`/x/demonstrate`) — already in sidebar with PlayCircle icon, visible for OPERATOR/ADMIN/SUPERADMIN. No rename needed.

### P4.2 — Pipeline completion indicator (S) — PENDING

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

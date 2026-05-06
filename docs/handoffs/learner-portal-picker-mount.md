# Handoff — Learner-Portal Mount for LearnerModulePicker

**Status:** Ready to start
**Created:** 6 May 2026
**Origin:** Deferred follow-up from #236 (PR4)
**Target audience:** Fresh Claude Code session, no prior context required

---

## What you're picking up

The `LearnerModulePicker` component already exists at `apps/admin/app/x/courses/[courseId]/_components/LearnerModulePicker.tsx`. It renders tiles (continuous courses) or a sequenced rail (structured courses), shows session-terminal/voice-readout badges, and surfaces advisory "Recommended after X" hints for prerequisites. Today it's mounted as a **read-only preview inside the admin Authored Modules panel**.

**Your job:** wire it into the learner portal so learners can actually pick a module and have it drive a session.

---

## Context — what was just shipped (#236, PRs #237–#240)

| PR | What it added |
|---|---|
| #237 | `detectAuthoredModules` parser + `AuthoredModule`/`ModuleDefaults`/`ValidationWarning` types + `featureFlags.authoredModulesEnabled` env flag |
| #238 | `POST /api/courses/[courseId]/import-modules` — parses Course Reference markdown into `PlaybookConfig` |
| #239 | Authored Modules admin panel inside the Curriculum tab — read-only catalogue + re-import dialog + validation warnings |
| #240 | `LearnerModulePicker` component + `setup-status` route fix that gates "Lesson Plan Built" on authored-module presence |

**Source-of-truth doc** for the whole feature:
`/Users/paulwander/Downloads/wizard-amendment-modules-authored.md` (off-repo) and the Course Reference at `/Users/paulwander/Downloads/COURSE-REFERENCE-ielts-speaking-v2.2.md` which is the primary fixture.

---

## Files to read first (cold start, ~10 min)

| Path | Why |
|---|---|
| `apps/admin/app/x/courses/[courseId]/_components/LearnerModulePicker.tsx` | The component you're mounting. Read its props (`modules`, `lessonPlanMode`, `completedModuleIds?`, `onSelect?`) and behaviour. Already preview-mounted inside `AuthoredModulesPanel.tsx` next to it — see how it's used. |
| `apps/admin/app/api/courses/[courseId]/import-modules/route.ts` | The GET handler returns `modules`, `lessonPlanMode`, `validationWarnings`, etc. Reuse this for the learner read; do not invent a new endpoint unless RBAC forces it. |
| `apps/admin/lib/types/json-fields.ts` | `AuthoredModule`, `ModuleDefaults`, `PlaybookConfig.modules`. Look at `PlaybookConfig.modulesAuthored` / `moduleSource`. |
| `apps/admin/app/x/student/page.tsx` | Student entry router — calls `/api/student/journey-position`, redirects to `nextStop.redirect`. This is where you'll likely intercept. |
| `apps/admin/app/x/student/stuff/page.tsx` | Existing learner artifacts inbox — pattern for an authenticated learner page (uses `useStudentCallerId`, `buildUrl`, `requireAuth("VIEWER")`). |
| `apps/admin/lib/wizard/detect-pedagogy.ts` (sibling) and `apps/admin/contexts/StepFlowContext.tsx` | `lessonPlanMode` lives on `Playbook.config.lessonPlanMode`; detection happens here. |
| `docs/decisions/2026-04-14-scheduler-owns-the-plan.md` and `docs/decisions/2026-04-16-survey-rethink-state-machine.md` | Recent ADRs that overlap with the journey-position routing — read before designing the intercept. |

---

## Open architectural decisions (resolve before coding)

| # | Question | Options | Recommendation (pick one and document) |
|---|---|---|---|
| 1 | **Where does the picker render in the learner journey?** | (a) New route `/x/student/[courseId]/modules` learners hit before each session. (b) Modify `journey-position` to redirect to picker when `playbook.config.modulesAuthored === true`. (c) Inline at the top of `/x/student/stuff` only. | (b) — keeps the journey-position router as the single source of routing truth. Picker is a stop in the journey. |
| 2 | **How does picking start a session?** | (a) Reuse existing session-create flow with `requested_module` in payload. (b) Add a new `POST /api/sessions` that accepts a moduleId. (c) Make the picker emit an event the existing flow listens for. | (a) if the session-create API already exists; otherwise add the moduleId field to whichever flow VAPI dial / sim launch currently uses. **Do recon before deciding** — search `qmd search "session create launch call"`. |
| 3 | **First-time learner without authored modules** — what do they see? | (a) Picker is skipped, fall through to existing `journey-position` redirect (legacy derived path). (b) Picker shows an empty state and forces an admin to import first. | (a) — never block a learner because the educator hasn't authored. |
| 4 | **Multi-course learners** — picker per course or aggregated? | (a) Per-course (one picker view per `courseId`). (b) Aggregated home with course sections. | (a) for now — matches the existing single-course-context pattern. |
| 5 | **What populates `completedModuleIds`?** | (a) Read from `CallerModuleProgress` (existing Prisma model). (b) Add a new `LearnerModuleHistory` JSON on the caller. (c) Skip for v1, all modules show as available. | (a) — already exists, no new schema. Confirm field shape before relying on it. |
| 6 | **Session-terminal modules (Baseline/Mock)** — how does the picker enforce the "ends session" warning?* | (a) Confirm dialog before launch. (b) No warning, trust the tutor to say "this ends the session" verbally. (c) Both. | (a) confirm dialog. The badge is already on the tile/row; the dialog reinforces. |
| 7 | **Recommended-next** — does the picker compute it, or does the API? | (a) Pure UI logic (cheap). (b) Server-side `recommended-next` service (deferred follow-up ticket). | (a) for v1 with a deliberately simple ruleset (mirror the rules in `LearnerModulePicker.test.tsx` mocks); upgrade to a service when the rules get richer. |

If any decision feels uncertain, **ask the human before coding** — these are real product calls, not implementation details.

---

## Recommended approach (small slice first)

### Slice 1: Picker page + read endpoint (≈1.5d)

- New route `apps/admin/app/x/student/[courseId]/modules/page.tsx`
- Auth: `requireAuth("VIEWER")` + `useStudentCallerId` for caller scoping
- GET data: reuse `/api/courses/[courseId]/import-modules` (already returns everything needed). If RBAC forces a separate learner endpoint, mirror the response shape under `/api/student/[courseId]/modules`
- Mount `<LearnerModulePicker modules={...} lessonPlanMode={...} onSelect={handlePick} />`
- `handlePick` for slice 1: just `console.log` and show a confirm dialog — actual session launch is slice 2

### Slice 2: Session launch wiring (≈1d)

- Identify the existing session-create / VAPI-dial flow (recon question 2 above)
- Pass `requestedModuleId` through that flow
- Backend: when a session starts, write `requestedModuleId` to wherever the session/call config lives
- Tutor system prompt should already know what to do once it has the module ID — confirm via `qmd search "session module config"`. If not, that's a separate ticket

### Slice 3: Journey-position routing (≈1d)

- Modify `apps/admin/app/api/student/journey-position/route.ts` (or wherever it lives — recon)
- When `playbook.config.modulesAuthored === true`, the next stop should be `/x/student/[courseId]/modules` instead of the legacy redirect
- Preserve legacy behaviour for courses without authored modules (decision #3)

### Slice 4: Completion tracking integration (≈1d)

- Wire `completedModuleIds` from `CallerModuleProgress` into the picker
- Confirm `frequency: once` modules (Baseline) hide correctly after first completion
- Test with a real learner walkthrough

Each slice = its own PR. Total ≈ 4–5d if all four ship.

---

## Acceptance criteria (all four slices)

- [ ] Learner navigating into a module-authored course sees the picker before any session
- [ ] Picker layout matches `lessonPlanMode` (tiles for continuous, rail for structured)
- [ ] Tapping a tile/row launches a session with that module's ID passed through
- [ ] Session-terminal modules (Baseline, Mock) show a confirm dialog before launch
- [ ] `frequency: once` modules disappear from the picker after completion
- [ ] Courses without authored modules are unaffected (legacy journey-position redirect)
- [ ] Recommended-next surfaces a one-line reason (decision #7) and the learner can ignore it
- [ ] All UI uses `hf-*` classes + CSS vars (no inline styles, no hex literals)
- [ ] Tests: Vitest component tests for the page + integration test for the launch flow

---

## Out of scope (don't pull in)

- The wizard `modules-choice` step (separate deferred ticket — needs prompt-eval-enforcement pass)
- Per-row inline editing in the admin Authored Modules panel (separate ticket)
- Voice intent classifier for mid-session module switching (only relevant once VAPI flow ships)
- Scheduled module sessions (calendar UI + worker dial)
- The `recommended-next` service (decision #7 = inline rules for v1)
- Any change to the parser / persistence layer (#237/#238 are stable — don't touch)

---

## Project rules to know (from `apps/admin/CLAUDE.md`)

| Rule | What it means here |
|---|---|
| **qmd not grep** | Use `qmd search` / `qmd vector_search` for codebase recon |
| **Branch hygiene** | Branch name `feat/<issue#>-learner-picker-mount` (create the issue first); never work on `main` |
| **UI design system** | All `hf-*` classes, CSS vars only, `color-mix()` for alpha, ASCII mockup mandatory in plans |
| **Plans MUST cover Setup, Maintenance, Runtime phases** | Document each in the PR description |
| **API conventions** | `requireAuth()` on every route, zod for body validation, `@api` JSDoc, `{ ok, ... }` response shape |
| **Pre-commit hook** auto-regenerates API docs and updates qmd index — let it run |
| **Use `pnpm`** — the team is migrating from `npm`. Run `./node_modules/.bin/vitest` directly to bypass pnpm's install check in worktrees |
| **CI gating reality** | Only `Unit Tests` and `bdd` are real merge gates; `Build Check`, `E2E`, `Integration`, `Lint & Type Check`, `Visual Regression` all have a known-broken ratchet baseline (574 tsc / 3980 lint as of last lock) |

---

## Worktree pattern (for parallel slices)

```bash
cd /Users/paulwander/projects/HF
git fetch origin main && git checkout main && git pull --ff-only

# Create issue first
gh issue create --repo WANDERCOLTD/HF --title "Learner-portal mount for LearnerModulePicker" --body "..."

# Then branch + worktree
git worktree add -b feat/<issue#>-learner-picker-mount-slice1 \
  /Users/paulwander/projects/HF-mount-slice1 main

# Symlink node_modules so vitest/tsc work without pnpm install
ln -s /Users/paulwander/projects/HF/node_modules \
      /Users/paulwander/projects/HF-mount-slice1/node_modules
ln -s /Users/paulwander/projects/HF/apps/admin/node_modules \
      /Users/paulwander/projects/HF-mount-slice1/apps/admin/node_modules

cd /Users/paulwander/projects/HF-mount-slice1
```

After merge: `git worktree remove /Users/paulwander/projects/HF-mount-slice1 --force`.

---

## Reviewers

`ui-reviewer`, `ux-reviewer`, `guard-checker`, `standards-checker` are project-defined agents but **not spawnable as `subagent_type` in the current Claude Code runtime**. Run them manually before merge or document the gap in the PR description (the prior PRs all flagged this — match the precedent).

---

## How to verify the existing picker behaves correctly before mounting

```bash
cd /Users/paulwander/projects/HF/apps/admin
./node_modules/.bin/vitest run __tests__/ui/learner-module-picker.test.tsx
# 13 tests cover tiles, rail, prerequisites advisory, badges, empty state, onSelect.
```

Read those tests to understand the contract. The picker is `data-driven and prop-only` — no internal fetch, no internal state beyond what props supply. Mounting = wiring the data in and the `onSelect` callback out.

---

## Self-test for handoff completeness

A fresh Claude Code session, given only this file, should be able to answer:

- [x] What problem am I solving? (mount the picker into the student portal)
- [x] What already exists? (parser, API, admin panel, picker component)
- [x] Where does the picker live? (file path)
- [x] What endpoint do I call? (existing `/api/courses/[id]/import-modules` GET)
- [x] What architectural decisions need a human call? (the 7 questions above)
- [x] What's the smallest first PR? (slice 1)
- [x] What's out of scope? (the 6-item list)
- [x] What's the project's CI reality? (Unit + bdd only)
- [x] Where do I write tests? (`__tests__/ui/` for components, `tests/api/` for routes)
- [x] How do I bypass pnpm install issues in worktrees? (symlink node_modules)

If any of those would be unanswerable from this doc, edit it before starting.

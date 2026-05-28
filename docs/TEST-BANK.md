# Test Bank

A curated catalog of high-signal tests we deliberately keep — the ones that
**prove a property we care about**, not the ones that just exercise the
happy path. Each entry below names the invariant being defended, the
incident or issue that motivated the test, and how to run it.

If a test isn't in this bank, it isn't necessarily worthless — but if a
test IS in this bank, it must be runnable in isolation and its failure
mode must be obvious without reading the surrounding code.

## How to use

| Situation | Action |
|---|---|
| Triaging a regression in a load-bearing area | Run the bank entries tagged with that area first — they isolate failure modes faster than the full suite |
| Reviewing a PR that touches a guarded contract | Locate the bank entry and re-read it; if the PR changes behaviour the entry should be updated in the same PR |
| Adding a new structural fix | Add a bank entry alongside the fix (see "Adding an entry" below) |
| Boot-strapping a new contributor | The bank doubles as a tour of the invariants this codebase cares about |

## Adding an entry

Two parts:

1. **The test file.** Lives in its normal place under `apps/admin/tests/...`.
   The file's top docstring MUST list the acceptance criteria it proves
   (numbered, one line each) so the test stands on its own.
2. **An index entry in this doc.** Use the template at the bottom.

Bank-worthy tests:

- Defend a named invariant or chain contract (`docs/CHAIN-CONTRACTS.md` /
  `docs/epic-100-chain-walk.md`)
- Pin behaviour at a known landmine (the kind of thing that broke once and
  we don't want to relearn)
- Cover a guard listed in `.claude/rules/ai-to-db-guard.md`
- Are cheap to run in isolation (single file, no external services)

Not bank-worthy:

- Tests that mostly exercise framework or library behaviour
- Snapshot tests with no narrative in the docstring

**Live-DB integration demos** are tracked separately in the **Live-DB Demos**
section below. These are evidence-gathering scripts (not pass/fail gates run
in CI) — they hit the dev VM database, inject synthetic rows, prove a
property, and clean up after themselves. Use a `D###` prefix to distinguish
from unit-test entries.

## Running the bank

```bash
# Single entry
cd apps/admin && npx vitest run <path-from-the-entry-card>

# Whole bank (uses the `bank/` tag — see "Tagging" below)
cd apps/admin && npx vitest run --reporter=verbose $(grep -oE 'apps/admin/tests/[^ ]+\.test\.tsx?' docs/TEST-BANK.md | sort -u | sed 's|apps/admin/||g')
```

## Tagging

Every bank entry's `describe(...)` block should start with a hashtag that
matches its area, so we can grep:

| Tag | Area |
|---|---|
| `#928` / `#611` / `#614` | Issue / epic this test defends |
| `compose-read-scope` | COMPOSE-stage read-site filters |
| `ai-to-db-guard` | Guards in `.claude/rules/ai-to-db-guard.md` |
| `chain-contract` | A named contract from `docs/CHAIN-CONTRACTS.md` |
| `slug-scope` | `#407` / `#415` slug-scoping invariants |

Mixing tags is fine. `describe("buildLoMasteryMap (#928 scoping helper)", ...)` is good.

---

## Entries

### 001 — `buildLoMasteryMap` cross-course scoping

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/lib/prompt/composition/lo-mastery-map.test.ts` |
| **Subject** | `apps/admin/lib/prompt/composition/lo-mastery-map.ts::buildLoMasteryMap` |
| **Defends** | Chain-walk Link 6 (ADAPT → COMPOSE) — CallerAttribute `lo_mastery` reads must be scoped to the current curriculum spec slug. |
| **Issue / origin** | [#928](https://github.com/WANDERCOLTD/HF/issues/928) — cross-course bleed when a learner is enrolled in multiple playbooks with different curriculum specs. |
| **Failure mode it pins** | A learner enrolled in courses A and B finishes calls on A. Mastery rows pile up under `curriculum:spec-A:lo_mastery:*`. Next call composes for B — pre-#928 a tolerant `.includes(':lo_mastery:')` matcher pulled A's rows into B's `loMasteryMap`, skewing `informationNeed` and surfacing the wrong LOs in `PROGRESS NARRATIVE`. |
| **What it proves** | 13 properties: current-spec rows surface; sibling-spec rows filtered; mixed-spec input returns only current; colliding suffix keeps only current; undefined/empty slug → empty map (graceful); null/empty attrs → empty map; non-CURRICULUM scope filtered; null `numberValue` filtered; legacy name-form module token preserved (#611/#614 grace window); rows without `:lo_mastery:` segment ignored; no prefix-leak when one slug is the prefix of another (`IELTS` vs `IELTS-WRITING`); empty-suffix rows dropped. |
| **How to run** | `cd apps/admin && npx vitest run tests/lib/prompt/composition/lo-mastery-map.test.ts` |
| **When to re-run** | Any change to `lo-mastery-map.ts`, the three transforms that consume it (`transforms/modules.ts`, `transforms/retrieval-practice.ts`, `transforms/progress-narrative.ts`), or `SectionDataLoader` `callerAttributes` loader. Also re-run before flipping the `callerAttributeOldKeyFormCount` audit gate to remove the grace window. |
| **Status** | ✅ green (13/13, 2026-05-27) |
| **Owner area** | Composition / Adaptive Loop |
| **Related** | `#611` canonical-slug write path · `#614` legacy-key drain · `#615` FK consistency audit · `docs/epic-100-chain-walk.md` Link 6 |

---

### 002 — Wizard Start Over re-anchors to user's home domain

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/api/user-wizard-context.test.ts` |
| **Subject** | `apps/admin/app/api/user/wizard-context/route.ts::GET` |
| **Defends** | Slice A of #929 — the wizard's Start Over button MUST re-anchor `initialContext.domainId` to the logged-in user's home domain (respecting `User.assignedDomainId` first, then institution's primary domain), not the picker's previous selection or an amendment-mode course's domain. |
| **Issue / origin** | [#929](https://github.com/WANDERCOLTD/HF/issues/929) — Start Over locked to institution picker / kept stale amendment-mode course domain. |
| **Failure mode it pins** | Non-SUPERADMIN educator opens the wizard via `?courseId=<existing>`. The amendment-mode course's domain seeds `existingDomainId`. They click Start Over, expecting a fresh attempt — but the wizard re-uses the SAME amendment-mode `initialContext`, so the next attempt is anchored to the WRONG domain. Real harm: the AI's domain-scoped tools (resolve-institution, course-by-name lookups) all operate against the prior course's domain rather than the educator's home tenant. |
| **What it proves** | 5 properties: home domain returned when `assignedDomainId` is null (falls back to institution's primary, ordered by `createdAt` asc); `assignedDomainId` wins when set; SUPERADMIN-like sessions (no `institutionId`) get `context: null`; institutions with no active domains get `context: null`; missing/inactive institution gets `context: null`. |
| **How to run** | `cd apps/admin && npx vitest run tests/api/user-wizard-context.test.ts` |
| **When to re-run** | Any change to `/api/user/wizard-context/route.ts`, `V5WizardWithSelector.tsx`'s `handleStartOver`, `ConversationalWizard.tsx`'s `onStartOver` prop wiring, or the resolution chain in `app/x/get-started-v5/page.tsx:45-73` that this endpoint mirrors. |
| **Status** | ✅ green (5/5, 2026-05-27) |
| **Owner area** | Wizard / Build Course |
| **Related** | `#929` epic · entry 003 (companion B2-slice draft cleanup) |

---

### 003 — Wizard discard-draft marks abandoned playbook without breaking resume

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/api/wizard-discard-draft.test.ts` |
| **Subject** | `apps/admin/app/api/wizard/discard-draft/route.ts::POST` + `lib/chat/wizard-tool-executor.ts::resolveCourseByName` |
| **Defends** | Slice B2 of #929 — Start Over fires-and-forgets a discard POST that marks the in-progress Playbook abandoned via `config.wizardAbandonedAt` + name suffix `[abandoned <ts>]`. `resolveCourseByName` must filter abandoned drafts so the next attempt with the same course name does NOT silently resume the half-built playbook. |
| **Issue / origin** | [#929](https://github.com/WANDERCOLTD/HF/issues/929) Slice B2 — abandoned drafts resurfaced on the next attempt via partial-name match. |
| **Failure mode it pins** | Educator starts "IELTS Speaking Practice", AI calls `create_course`, a `Playbook { status: DRAFT, modules: [] }` lands in the DB. Educator hits Start Over (didn't like the AI's choices). New attempt with the same course name. Pre-fix: `resolveCourseByName` finds the abandoned draft, returns it as an `autoCommit: true` exact match, the new attempt now amends a half-built playbook with no modules → `mark_complete` blocks on `_count.modules > 0`. Educator stuck. |
| **What it proves** | 10 properties: DRAFT playbook gets name suffix + `config.wizardAbandonedAt` set; PUBLISHED/ARCHIVED skipped (defensive); non-SUPERADMIN blocked from discarding cross-tenant drafts (institutionId guard); SUPERADMIN bypasses the institutionId guard; CALLER + DEMO_CALLER rows soft-deleted via `archivedAt`; already-archived callers skipped; empty body → `discarded: null` (graceful, not an error); zod strict mode rejects unknown fields with 400; non-UUID rejected with 400; institution/domain rows NEVER touched. |
| **How to run** | `cd apps/admin && npx vitest run tests/api/wizard-discard-draft.test.ts` |
| **When to re-run** | Any change to `/api/wizard/discard-draft/route.ts`, `resolveCourseByName`'s abandoned-filter, `ConversationalWizard.handleStartOver`'s fire-and-forget POST, or the `wizardAbandonedAt` config key shape. |
| **Status** | ✅ green (10/10, 2026-05-27) |
| **Owner area** | Wizard / Build Course |
| **Related** | `#929` epic · entry 002 (companion A-slice domain re-anchor) · `lib/chat/wizard-tool-executor.ts::resolveCourseByName` |

---

### 004 — `/x/sim/[callerId]` auto-resolves playbookId from enrollments

> **Status:** ❌ NOT YET WRITTEN. Filed as part of #948 follow-up.
> The fix shipped in #947 has no isolated test — the resolution lives in a React effect.
> Tracking issue lists the work: extract `lib/caller/resolve-active-playbook.ts` helper, unit-test the pick rule, then this entry becomes a green unit-level proof.

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/lib/caller/resolve-active-playbook.test.ts` *(to be created)* |
| **Subject** | `apps/admin/lib/caller/resolve-active-playbook.ts::resolveActivePlaybookId` *(to be extracted from `app/x/sim/[callerId]/page.tsx` + `CallerDetailPage:386-398`)* |
| **Defends** | L9 — learner-facing module-picker reachability. Every page that mounts a session on a Playbook with `modulesAuthored=true` MUST resolve the active `playbookId` before rendering, falling back through: URL → caller's single ACTIVE enrollment → most-recently-enrolled ACTIVE. |
| **Issue / origin** | [#948](https://github.com/WANDERCOLTD/HF/issues/948) — file-able follow-up to the `/x/sim` picker-missing bug fix (#947). |
| **Failure mode it pins** | Brand-new learner enrolled in IELTS Speaking Practice (4 authored modules) opens `/x/sim/[callerId]` without `?playbookId=...`. Pre-fix: no banner, no header icon, no entry to the picker — learner silently routed to an unfocused session. |
| **What it should prove** | 1 ACTIVE enrollment → that playbookId; 2+ ACTIVE → most-recently-enrolled (sorted desc by `enrolledAt`); 0 ACTIVE → null; URL override always wins over enrollment lookup; non-ACTIVE enrollments (PAUSED/ENDED) excluded from the candidate pool. |
| **Status** | 🔴 not yet implemented |
| **Owner area** | Caller / Sim / Learner-Facing UX |
| **Related** | `#929` (separate Start Over fix) · `#940` (perpetrator that exposed the gap) · `arch-checker` rule pending |

---

## Live-DB Demos

These run against the dev VM database (not in CI). They prove a property
holds against **real** data by injecting a synthetic condition, observing
the system's response, and cleaning up. Run them manually when you need
field evidence that a fix is live.

### D001 — #928 cross-course bleed prevention against live DB

| Field | Value |
|---|---|
| **Script** | `apps/admin/scripts/demo-928-bleed-prevention.ts` |
| **Subject** | `buildLoMasteryMap` against live `CallerAttribute` rows on hf-dev VM |
| **Defends** | Same property as bank entry 001 — but proved on real data, not a synthetic test fixture. |
| **What it does** | Picks the caller with the most `lo_mastery` rows in dev. Captures the helper's BEFORE output. Injects 3 synthetic foreign-spec rows under that callerId (marked with `sourceSpecSlug = 'demo-928-bleed-marker'`). Re-runs the helper. Verifies AFTER === BEFORE — foreign rows live in the raw query result but the helper scopes them out. Cleans up the synthetic rows. |
| **Pass / fail signal** | `✓ PASS — foreign rows scoped out` vs `✗ FAIL — fix broken`. Also exits with code 0/1. |
| **How to run** | `gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx scripts/demo-928-bleed-prevention.ts"` |
| **When to re-run** | After any change to the helper, the three transforms that consume it, the `SectionDataLoader` `callerAttributes` loader, or before flipping the `callerAttributeOldKeyFormCount` audit gate. Also useful as a post-deploy smoke check on staging/pilot. |
| **Safety** | Idempotent. Synthetic rows carry a unique `sourceSpecSlug` marker so cleanup is deterministic even if the script crashes mid-run (re-run will overwrite + clean up). Never touches non-synthetic rows. |
| **Last verified** | 2026-05-27 — ran against hf-dev, 12 mastery rows for caller `f17d8616…` (Freddy Starr), 3 foreign rows injected and ignored, verdict ✓ PASS. |
| **Related** | Bank entry 001 (unit-level proof) · #928 / #936 / #939 |

---

### D002 — 3-call learner progression smoke (IELTS, real pipeline)

| Field | Value |
|---|---|
| **Script** | `apps/admin/scripts/demo-3call-cohort.ts` |
| **Subject** | End-to-end adaptive loop: pre-call composer → AI-vs-AI sim → 7-stage pipeline (EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE) → next-call composer. |
| **Defends** | Three chain properties at once: (1) call sequencing — each completed call receives `callSequence` and links to `previousCallId` (loop-edge integrity); (2) ComposedPrompt freshness — each pipeline run produces a new `ComposedPrompt` with `triggerType=pipeline` whose `triggerCallId` points at the call that produced it; (3) learning progression — `CallerAttribute lo_mastery:*` accumulates non-zero values across calls AND `CallerModuleProgress.mastery` rises in lockstep on EMA-derived modules. |
| **Issue / origin** | [#950](https://github.com/WANDERCOLTD/HF/issues/950) (surfaced the `writeModuleMastery` status-promotion bug). Originally a manual operator request 2026-05-27 to verify the full adaptive loop end-to-end on freshly-merged code (post-#929 / post-#945 / post-#947). |
| **Failure mode it pins** | (a) Pipeline silently fails for one of the three stages and the next call composes against stale state. (b) `triggerCallId` mis-links or the chain breaks mid-cohort. (c) Mastery numbers never move — adaptive loop is a no-op. (d) Status writers race producing a "mastery > 0 + status = NOT_STARTED" stuck row (the exact bug #950 catches). |
| **What it proves** | 1 fresh learner created + enrolled in IELTS Speaking Practice V1.0 (playbook UUID `eb6bc79e-…`); bootstrap ComposedPrompt persisted via `autoComposeForCaller`; 3 calls run via `sim-drive-call.ts` with `--module=part1,part2,part3` and 5 turns each; between each call, the script polls (3s interval, 90s timeout) for a new `ComposedPrompt` whose `triggerCallId === <just-ended call.id>` AND `status === 'active'` (next call refuses to run until COMPOSE lands); after all 3 calls, snapshots state and asserts: (i) 3 `Call` rows with `endedAt` set, (ii) 3 pipeline-triggered `ComposedPrompt` rows whose `triggerCallId`s match the 3 calls in order, (iii) per-module `CallerModuleProgress.mastery > 0` AND `status !== 'NOT_STARTED'` (the #950 invariant — `IN_PROGRESS` and `COMPLETED` both pass; only a stuck `NOT_STARTED` row with non-zero mastery fails), (iv) at least one `CallerAttribute lo_mastery:*` row per module that received scorable turns. |
| **How to run** | `gcloud compute ssh hf-dev --zone=europe-west2-a --tunnel-through-iap -- "cd ~/HF/apps/admin && npx tsx scripts/demo-3call-cohort.ts"` |
| **Known transient failures** | Anthropic API 529 "overloaded" mid-stream — the script retries each call up to 2 times when stderr matches the 529 + "overloaded" pattern (30s backoff between retries). Other failures abort the cohort with the failing call's stderr tail. |
| **Safety** | Creates a fresh caller per run with `externalId = e2e-demo-d002-<unix-ts>`. Each run is isolated — no row from a prior run is ever overwritten or queried. Old runs accumulate as garbage rows but are harmless (no FK pressure, no UI surface). Manual cleanup by `externalId` prefix if storage gets tight. |
| **Last verified** | 2026-05-28 — ran against hf-dev, full cohort green: 3 calls each ended cleanly, 3 pipeline-trigger ComposedPrompts in order, mastery moved on all driven modules with IN_PROGRESS status, verdict ✓ PASS. |
| **Owner area** | Adaptive Loop / Pipeline |
| **Related** | #950 (status-promotion bug surfaced by this demo) · #948 (learner-page reachability — separate trapdoor) · `lib/test-harness/sim-runner.ts` (in-process UI sim) · `scripts/sim-cohort.ts` (generic multi-call orchestrator) · `flow-call-lifecycle.md` (the chain this defends) |

---

## Template for a new entry

```markdown
### NNN — <short subject>

| Field | Value |
|---|---|
| **File** | `apps/admin/tests/...test.ts` |
| **Subject** | `apps/admin/lib/...` (the unit under test) |
| **Defends** | <named invariant / contract / chain link> |
| **Issue / origin** | [#NNN](url) — one-line context |
| **Failure mode it pins** | <plain-English description of the bug this stops from coming back> |
| **What it proves** | <enumerated properties, comma-separated or short list> |
| **How to run** | `cd apps/admin && npx vitest run tests/...` |
| **When to re-run** | <which file edits should trigger a re-run> |
| **Status** | ✅ green (N/N, YYYY-MM-DD) | 🟡 flaky | 🔴 disabled |
| **Owner area** | <subsystem> |
| **Related** | <other issues / docs> |
```

## House rules

- **One file, one entry.** If a test file covers multiple invariants, split
  the entry into A/B (e.g. `004A`, `004B`) so each defended property has its
  own card.
- **Update on behaviour change.** If a PR changes what the test proves,
  update the entry in the same PR.
- **Don't promote happy-path tests.** A test belongs in the bank because it
  prevents a class of bug from coming back, not because it's well-written.
- **Status freshness.** When you re-run an entry as part of triage, bump
  the date in the Status row.

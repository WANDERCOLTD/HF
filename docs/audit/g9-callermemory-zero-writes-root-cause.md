# G9 — CallerMemory zero-writes on real-engine — root-cause audit

**Story:** #1515
**Date:** 2026-06-12
**Verdict:** **PREMISE DISPROVEN.** G9 is currently passing on live hf-dev. No code change required.

---

## 1. Observed behaviour (claim)

The build #1515 brief states:

> Live canary on hf_sandbox (PR #1525 logs) ran the pipeline with engine=claude,
> transcript=1KB+. Result: 0 CallerMemory rows written. The mock-engine path
> is intentionally suppressed (`route.ts:1029-1031`), but the real-engine path
> should write at `route.ts:1347`. Yet 0 rows.

PR #1525's body (merged at `2026-06-12T11:09:37Z`) confirms the claim was made
at that time: "`learn.memories > 0` ❌ FAIL".

## 2. Actual behaviour (live evidence)

Three independent canary runs on hf-dev between 11:07 and 11:52 UTC the same
day show G9 **passing**:

| Time (UTC) | `learn.memories` outcome | Detail |
|---|---|---|
| 2026-06-12 11:05:23 | (test skipped — old 10s timeout) | only mock-engine assertions ran |
| 2026-06-12 11:07:45 | **PASS** | `CallerMemory count=18; > 0 expected` |
| 2026-06-12 11:52:28 | **PASS** | `CallerMemory count=17; > 0 expected` (live run during this audit) |

Source: `AppLog` rows where `stage = 'pipeline.canary.run'`, hf_sandbox.

Historical evidence is also positive — the most recent `claude_batched_v2`-
extracted memories cover multiple callers across the past 48 hours:

```
prefers_pace        | PREFERENCE   | claude_batched_v2 | 2026-06-11 16:37:08
history_past_event  | FACT         | claude_batched_v2 | 2026-06-11 16:37:08
bio_name            | FACT         | claude_batched_v2 | 2026-06-11 16:37:08
context_situation   | CONTEXT      | claude_batched_v2 | 2026-06-11 14:28:52
prefers_pace        | PREFERENCE   | claude_batched_v2 | 2026-06-11 14:28:52
… (25 rows total in last 48h sample) …
```

The real-engine memory-write loop at `apps/admin/app/api/calls/[callId]/pipeline/route.ts:1312–1372` fires
correctly, with `extractedBy = '${engine}_batched_v2'` stamped on every row.

## 3. Call chain (read but un-edited)

For completeness, here's the chain traced during this audit:

- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:807` — `runBatchedCallerAnalysis()`
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:846` — `getPlaybookSpecs(callerId, ["MEASURE","LEARN"])`
  → returns `playbookId`, but the canary's playbook has zero `PlaybookItem(itemType="SPEC")` rows,
    so `specs: []`.
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:853` — `getSystemSpecs(["MEASURE","LEARN"], playbookId)`
  → returns SYSTEM-scope active specs filtered by playbook toggle. Includes
    `spec-mem-001` (LEARN, SYSTEM, isActive=true), `spec-goal-001`, `spec-learn-assess-001`, etc.
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:876-877` — `filterByTeachingProfile()`
  → canary subject has no `teachingProfile` set; specs without `profileCondition`
    pass through unchanged.
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:925-939` — `learnActions` collected from
  `learnSpecs.triggers.actions` where `learnCategory` is non-null.
  Live SQL confirms `spec-mem-001` has 7 such actions:

  ```
  slug          | trigger_name                | action_count | with_learn_category
  --------------+-----------------------------+--------------+--------------------
  spec-mem-001  | Universal Memory Extraction | 7            | 7
  ```

- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:1095` — `buildBatchedCallerPrompt(...)` with the 7 learnActions.
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:1133–1148` — engine=claude returns parsed `{scores, memories, learning}`.
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:1311-1372` — memory write loop, increments `memoriesCreated`.
- `apps/admin/app/api/calls/[callId]/pipeline/route.ts:1374-1377` — `aggregateCallerMemorySummary(callerId, false)` called when `memoriesCreated > 0`.

All gates currently fire as designed.

## 4. Why PR #1525's body said FAIL — best inference

PR #1525 introduced the canary E2E itself plus three fixture fixes
(coversModules null, cleanup ordering, real-engine timeout). The author's
local canary run at FAIL time was likely:

- Before the 180s timeout was added → the test cut off mid-pipeline (the
  10s default vitest timeout would kill the `await fetch(...)` to the
  pipeline route well before EXTRACT and LEARN completed).
- With cleanup ordering broken → leftover FK rows from prior runs may have
  blocked the fixture from establishing a clean baseline.

Either way, the FAIL captured in the PR body reflects a fixture/timeout
state that the same PR fixed. The "live canary just proved this is real"
in the build #1515 brief is reading the PR body, not running the canary
against current `main`.

## 5. Other findings (not in scope but worth flagging)

The current canary surfaces two genuine downstream WARNs that ARE the
right next stories:

- `aggregate.skillTargets` — `CallerTarget(skill_*, currentScore!=null) count=0`.
  Story #1516 / G2 already owns this. Not this PR.
- `compose.keyMemories` — `ComposedPrompt=present; key_memories len=0`.
  Memories ARE written but the COMPOSE stage isn't pulling them into the
  prompt's `key_memories` input. This is a real gap — but it's a COMPOSE
  bug, not a LEARN bug. Separate story (downstream of G9 per the canary's
  own gate labelling).

## 6. Proposed action

**Close #1515 as "premise disproven on live evidence."** Memories ARE written
on the real-engine path; the canary that allegedly proved otherwise was
either timing out or hitting a stale fixture. PR #1525 (which shipped
between the FAIL claim and this audit) fixed the same canary infrastructure
issues that masked the actual G9 PASS.

If the team still wants a regression pin, the right deliverable is a
**unit test for the memory-write loop at route.ts:1312-1372** that exercises
the parsing of compact-key responses (`mem.cat`, `mem.val`, `mem.c`) and
the multi-value vs single-value supersede branch — those are the brittle
parts of the loop, and they are not currently pinned. That can be folded
into the broader test-bank discipline story (#1396) without claiming a
G9 fix.

## 7. Evidence citations

| Evidence type | Citation |
|---|---|
| Live canary metadata | `AppLog stage=pipeline.canary.run`, hf_sandbox, observed 2026-06-12 11:07:45 and 11:52:28 UTC |
| Live SQL | `SELECT slug, "outputType", scope, "isActive", "isDirty" FROM "BddFeature" WHERE "outputType" IN ('LEARN','MEASURE')` — confirms 4 SYSTEM-scope LEARN specs active |
| Live SQL | `SELECT … FROM "BddScenario" t JOIN "BddAcceptanceCriteria" a …` — confirms spec-mem-001 has 7 learnCategory actions |
| Historical writes | `SELECT … FROM "UserMemory" WHERE "extractedBy" = 'claude_batched_v2' ORDER BY "createdAt" DESC LIMIT 25` — 25 rows in last 48h |
| Code | `apps/admin/app/api/calls/[callId]/pipeline/route.ts:807-1372` — `runBatchedCallerAnalysis` |
| Code | `apps/admin/lib/pipeline/specs-loader.ts:36-228` — `getSystemSpecs` + `getPlaybookSpecs` |
| Code | `apps/admin/tests/integration/journey/adaptive-loop-canary.integration.test.ts:266-290` — the G9 gate |

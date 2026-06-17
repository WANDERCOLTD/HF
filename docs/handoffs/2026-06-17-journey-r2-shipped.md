# Journey-tab round 2 — what shipped, how it works, how to smoke-test

> Closeout for the 6 PRs opened 2026-06-17 against the handoff at
> [`docs/draft-issues/handoff-journey-followups-2026-06-17.md`](../draft-issues/handoff-journey-followups-2026-06-17.md).
> Base sequence: main started this session at `e7c213dd`; live URLs
> below assume the PR is merged AND `/vm-cp` has synced hf-dev.

## PRs in flight

| # | Branch | Status | Lines |
|---|---|---|---|
| [#1826](https://github.com/WANDERCOLTD/HF/pull/1826) | `fix/restore-clone-demo-caller` | Open | +582 −1 |
| [#1827](https://github.com/WANDERCOLTD/HF/pull/1827) | `fix/authored-modules-type-drift` | Open — superseded by #1835 | +6 −18 |
| [#1828](https://github.com/WANDERCOLTD/HF/pull/1828) | `fix/results-route-test-types` | Open | +9 −8 |
| [#1829](https://github.com/WANDERCOLTD/HF/pull/1829) | `fix/tol-retrieval-cadence-helptext` | Open | +1 −1 |
| [#1832](https://github.com/WANDERCOLTD/HF/pull/1832) | `fix/journey-stops-structured-paths` | Open | +71 −37 |
| [#1835](https://github.com/WANDERCOLTD/HF/pull/1835) | `feat/theme5-revival-count-prereqs` | Open | +608 −26 |

Net tsc surface: 57 → 41 once all merge. Net change to journey
behaviour: 4 educator-visible Inspector controls go from silently
broken to working.

## The table

| Original requirement | What we built (how it works) | Smoke test URL — dev |
|---|---|---|
| **PR #1826 — `clone-demo-caller` was missing.** Handoff §3 row "Missing module import". PR #1768 (Theme 10 generic profile capture) deleted `lib/test-harness/clone-demo-caller.ts` and its test in an unrelated sweep, leaving the tester direct-link page (`/x/test/<slug>/<slug>`) with an unresolved import. Educators trying the direct-link saw a 500. | Restored `lib/test-harness/clone-demo-caller.ts` + `tests/lib/test-harness/clone-demo-caller.test.ts` verbatim from `fb07622d^`. The helper has two modes: **`fresh`** mints a new Caller with `profile:*` CallerAttribute rows copied from the source demo caller, blanked progress, and `TEST_HARNESS` lineage markers (`source_caller_id` / `tester_email` / `created_at`). **`return`** scans CallerAttributes for a prior clone keyed by `(sourceCallerId, testerEmail)` and reuses the most recent. Falls through to `fresh` if no prior. Verified against the page handler + test fixtures unchanged. | After a fresh demo caller exists on hf-dev: `https://dev.humanfirstfoundation.com/x/test/ielts-speaking-practice/mock?learnerMode=fresh` → redirects to `/x/callers/<new-caller-id>/sim?module=<mock-module-id>`. Then `?learnerMode=return` should return the same `new-caller-id`. |
| **PR #1827 — `AuthoredModule.prerequisites` type drift (8 tsc errors).** Handoff §3 row "Wizard sync + AuthoredModulesPanel + LearnerModulePicker drift". Same #1768 sweep deleted the unlock-checker that consumed the widened `Array<string \| {moduleId, minCompletions}>` form. The 6 consumer/writer sites all assumed `string[]`. | Quick fix: reverted the type widening at `lib/types/json-fields.ts:906` back to `string[]`. All 8 tsc errors disappeared without touching consumers. **Superseded by #1835** which keeps the widening and brings back the reader properly. If #1835 merges, this PR can be closed unmerged. | N/A — quick fix; verified by `tsc --noEmit` (-8) and the 5 prereq-related vitest banks (66/66 green). |
| **PR #1828 — `results-route.test.ts` 7 type errors.** Handoff §3 row "Request vs NextRequest test fixtures". Test was passing `new Request(...)` to the GET handler whose signature expects `NextRequest`. | Imported `NextRequest` from `next/server` and replaced the 7 call sites with `new NextRequest(...)`. The handler ignores the request (`_req` prefix) — purely a type-level fix. Mirrors the existing pattern in `tests/lib/intake-session-cookie.test.ts` and `tests/wizard/picker-dedup-harness.test.ts`. | N/A — test-only fix. Verified by `npx vitest run tests/api/student/results/results-route.test.ts` (7/7) and tsc (-7). |
| **PR #1829 — `tolRetrievalCadence` Inspector control investigation.** Handoff §4. Tech Lead agent flagged: "If this is a bounded multiplier, a `slider` is more appropriate than `number`." | Read the consumer `lib/pipeline/scheduler-presets.ts:283-293`. Confirmed: (a) the override **REPLACES** the preset's retrieval cadence (not a multiplier — fixed misleading helpText), (b) the validation gate accepts ANY positive finite integer (no upper bound — slider can't represent the 999 debug sentinel that disables retrieval entirely). Decision: keep `control: "number"`, rewrite helpText to call it an "absolute override" with semantic examples ("1 retrieves every call, 4 retrieves every 4th") and typical range (1–5). | `https://dev.humanfirstfoundation.com/x/courses/<courseId>?tab=journey` → Inspector menu → Open `K_between_calls` bucket → click **Retrieval cadence override**. The control should render as a number input with the updated helpText. Set to `2`, save, verify `Playbook.config.tolerances.retrievalCadenceOverride === 2` in DB. |
| **PR #1832 — Stop-vs-array contract path inconsistency.** Handoff §2. The 4 stop Inspector controls (`preTestStop`, `midJourneyStop`, `npsStop`, `postTestStop`) had `storagePath: "sessionFlow.stops.preTest"` etc. — dotted bare-string paths. The applier interpreted these as object-key writes (`stops.preTest = {...}`), but the runtime stores stops as `JourneyStop[]` (array). Educators toggling these controls silently wrote to a shape that no reader recognised. The 5th contract `midJourneyStopTrigger` had a nested path `sessionFlow.stops.midJourney.trigger` that's unrepresentable in the applier at all. | Converted the 4 stop contracts to **structured StoragePath**: `{path: "sessionFlow.stops[]", arrayKey: "id", selectorValue: "pre-test" \| "mid-test" \| "post-test" \| "nps", writeMode: "merge"}`. The selector values match the canonical synthetic ids the resolver already mints in `lib/session-flow/resolver.ts:231,246,259` and SessionFlowEditor's row taxonomy. The applier (existing code at `lib/journey/storage-path-applier.ts:152-178`) walks the array, finds the element where `id === selectorValue`, and merges the new value in — preserving extras (`kind`, `delivery`, `payload`). **Removed `midJourneyStopTrigger`** entirely (it was redundant with the `midJourneyStop` compound editor that already includes trigger editing). The save-roundtrip smoke test was updated to mint the canonical `id` in its representative value so the round-trip matches. | `https://dev.humanfirstfoundation.com/x/courses/<courseId>?tab=journey` → Inspector → **Pre-test stop**. Toggle Enabled ON → wait for "✓ Saved" → Reload page → toggle is still ON. Verify in DB: `psql -c "SELECT config->'sessionFlow'->'stops' FROM \"Playbook\" WHERE id='<id>';"` should show an array with an element `{"id": "pre-test", "enabled": true, ...}`. Repeat for **Mid-journey stop**, **NPS stop**, **Post-test stop** (Cmd+K → search). |
| **PR #1835 — Theme 5 revival.** Handoff Lattice finding from earlier in the session. PR #1786 widened `AuthoredModule.prerequisites` to `Array<string \| {moduleId, minCompletions}>` and shipped the role-aware unlock gate `isModuleUnlocked` so an IELTS Mock module could declare `[{moduleId: "part1", minCompletions: 2}, {moduleId: "part3", minCompletions: 2}]` ("needs 2× Part 1 + 2× Part 3"). PR #1768's sweep deleted the gate and its test, leaving the type widening with no reader. | Restored `lib/curriculum/check-module-unlock.ts` + its 20-test suite verbatim. Added two new exported helpers: **`normalisePrerequisite(p)`** coerces a single entry to `{moduleId, minCompletions}` or `null`; **`prerequisiteSlugs(prereqs)`** extracts just the slug list (defensive — drops invalid entries). Updated 4 consumer sites (`AuthoredModulesPanel`, `LearnerModulePicker` ×2, `detect-authored-modules`) to use `prerequisiteSlugs()` instead of inlining typeof-branches. Updated `sync-authored-modules-to-curriculum.ts` to serialise through the helper when writing to the Prisma `String[]` column — the rich form lives only in `Playbook.config.modules[]` where `isModuleUnlocked` reads it. **Supersedes #1827.** | After `/vm-cp` syncs the merged PR, on a structured course where an authored module declares count-based prereqs (e.g. IELTS Mock with `prerequisites: [{moduleId: "part1", minCompletions: 2}]`): `https://dev.humanfirstfoundation.com/x/courses/<courseId>` → Authored Modules panel → Mock card shows "part1" chip. As STUDENT with only 1 completed Part 1 attempt: enrollment endpoint refuses to start Mock with reason `prerequisites-unmet` and surfaces `missing: [{moduleId: "part1", required: 2, actual: 1, moduleLabel: "Part 1: Familiar Topics"}]`. As OPERATOR: bypasses with `reason: "role-bypass"`. |

## Outstanding follow-ups (handoff items NOT closed)

| # | Item | Why not done | Needs |
|---|---|---|---|
| 1 | Browser-verify Stop + Phases editors on hf-dev | Needs you at a browser | Manual smoke after PRs merge + `/vm-cp` |
| 7 | Strip 28 issue-number suffixes from helpText | Needs convention call from you (the operator) | "Yes, strip them" → I'll ship in one PR. Or "no, convert convention" → put issue numbers in code comments instead. |
| 8 | Renderers v2 epic activation | Multi-day work; needs go/no-go | "Activate now" → file GitHub epic + BA/TL grooming. "Keep parked" → leave as draft. |

## Sequencing note

PR #1827 and #1835 both touch `lib/types/json-fields.ts:906`. They will
conflict on merge. Recommended merge order:

1. Merge #1835 (preserves Theme 5 intent + brings back working count-based gate).
2. Close #1827 as superseded.

If #1827 merges first, #1835 needs to re-widen + re-apply on top —
non-trivial but doable. Either way, only one survives.

## Audit before claiming done

Per the operator memory `feedback_verify_before_claim_done.md`:

- [x] tsc count actually drops (verified per PR; not just claimed)
- [x] Affected test banks actually pass (run, output captured)
- [x] No new tsc errors introduced (each PR's pre-push hook gate passes)
- [x] PR bodies cite the Lattice survey result per `lattice-survey.md`
- [x] PR bodies cite `## Verified by` evidence per `verify-before-fix.md`
- [ ] Manual browser verification (item #1 above — still pending you)
- [ ] hf-dev DB inspection per PR #1832's smoke URL (still pending you)
- [ ] PROD-scope migration plan for legacy `stops.preTest` dotted writes (deferred — readers never saw them; cosmetic cleanup only)

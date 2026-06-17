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

---

# Epic #1700 IELTS Pre-Voice Testing — CLOSED (2026-06-17 PM)

> Same session, after the Journey r2 PRs above. The remaining open
> stories on the epic closed via 2 new PRs from this seat + 3 closeout
> PRs from the peer seat + 3 bookkeeping closures.
> Base sequence: PRs landed on top of `b9cb3d0a` → `7dd3a249`. All live
> URLs assume `/vm-cp` has synced hf-dev and
> `HF_FLAG_IELTS_MODULE_SETTINGS=true` in `.env.local`.

## PRs shipped

**This seat (Theme 2b + Theme 3):**

| # | Branch | Closes | Status | Lines |
|---|---|---|---|---|
| [#1839](https://github.com/WANDERCOLTD/HF/pull/1839) | `feat/1743-ielts-cue-wiring` | #1743 | **Merged** `fefe6a09` | +910 −15 |
| [#1841](https://github.com/WANDERCOLTD/HF/pull/1841) | `feat/1744-pinned-card-slot` | #1733 + #1744 | **Merged** `d1cc2eeb` | +758 −2 |

**Peer seat closeouts (UI surfaces for prior-shipped server work):**

| # | Closes | What it finished |
|---|---|---|
| [#1840](https://github.com/WANDERCOLTD/HF/pull/1840) | #1751 closeout | Mock Results post-call redirect + outbound nav |
| [#1843](https://github.com/WANDERCOLTD/HF/pull/1843) | #1745 closeout | `<ExamModeShell>` sim-page mount |
| [#1845](https://github.com/WANDERCOLTD/HF/pull/1845) | #1703 closeout | incomplete-attempts chip on AttainmentTab |

**Bookkeeping closures (no PR — issue closed with citation):**

- **#1701** — Theme 1 G8 module-scoped settings. All 8 G8 schema entries + consumers shipped across prior PRs; closed as superseded.
- **#1750** — Theme 12 tester direct-link + `cloneDemoCaller`. Already shipped via #1798, accidentally dropped by #1768, restored by #1826; closed as superseded.
- **#1700** — the epic itself, closed with the theme-by-theme summary.

Net new vitests from this seat: **29** (14 in #1839 + 15 in #1841). 0 regressions in sibling banks.

## The table

| Original requirement | What we built (how it works) | Smoke test URL — dev |
|---|---|---|
| **PR #1839 — Theme 2b cue wiring + stall detector.** Phase 2 follow-on to #1742's cue-scheduler primitive. The scheduler had no callers in production code — `voice.cue_scheduler.registered` was structurally impossible to log. Also: learners on Part 2 monologue had no visual nudge if they went quiet (the spec calls for a 10s scaffold). | (a) New `lib/voice/register-module-cues.ts` — idempotent helper that walks `Playbook.config.modules[id==slug].settings.scheduledCues` and persists each `(at, text)` via `scheduleCue` keyed on `externalCallId`. Pre-insert query absorbs at-least-once webhook re-delivery. Flag-gated. (b) Wired into **outbound-dial route** right after the externalId stamp (PSTN). (c) Wired into **`processTranscriptUpdate`** in `route-handlers.ts` inside the self-heal block where WebRTC placeholders first learn their externalId. (d) New G8 entry `moduleScaffoldPool` (Theme 1 extension) + `AuthoredModuleSettings.scaffoldPool: string[]`. Module slug is the implicit discriminator (Part 2's pool ≠ Part 3's pool). (e) `hooks/use-stall-detector.ts` — single `setTimeout` in `useEffect` (no while/for → `no-bespoke-async-polling` clear), derived chip visibility from `activeChip.shownAt > lastSpeechAt` so the only setState lives in the timer callback. (f) `components/sim/StallChip.tsx` + `.hf-stall-chip` CSS with `prefers-reduced-motion` respect. (g) `SimChat.tsx` bumps `lastSpeechAt` on every `transcript-partial` SSE event, fetches the scaffoldPool from a new route, mounts the chip above `silenceWarning`. (h) New route `GET /api/callers/[id]/module-stall-pool?moduleSlug=X` — VIEWER auth + STUDENT-scope gate. | (1) On hf-dev Inspector, edit IELTS Part 2's G8 controls: `scheduledCues: [{"at": 30, "text": "Quick test — 30 seconds in"}]` and `scaffoldPool: ["Take your time…", "When you're ready, carry on…"]`. Save. (2) `https://dev.humanfirstfoundation.com/x/sim/<bertie>?requestedModuleId=part2` → [Talk Here]. (3) Tail `gcloud compute ssh hf-dev -- 'tail -50 /tmp/hf-dev.log \| grep voice.cue_registration'` — expect `voice.cue_registration.registered count: 1`. (4) Stay silent ≥10s after the assistant's last partial — expect a fade-in chip "Take your time…" above the chat. Speak again — chip clears. (5) ~30s in, tutor speaks the scheduled cue. (6) Round-robin sanity: stay silent again — second fire picks `pool[1]`. (7) Flag-off control: `sed -i '/^HF_FLAG_IELTS_MODULE_SETTINGS=/d' ~/HF/apps/admin/.env.local` + restart; no chip, no `cue_registration.registered` log line. |
| **PR #1841 — Theme 3 pinned cue card (writer + slot).** Coupled #1733 + #1744 because neither delivered value alone: writer with no reader = no learner sees the card; reader with no writer = no data to render. The schema (`Session.metadata Json?` + `PinnedCardContent`) shipped via #1714; the actual writer and the actual renderer were both pending. | (a) `lib/voice/select-pinned-card.ts` — pure helper: given `(PlaybookConfig, moduleSlug, sequenceNumber)` returns `PinnedCardContent \| null` using the same `(seq-1) % pool.length` policy `transforms/instructions.ts::resolveModuleCueCard` already uses. UI + prompt agree byte-for-byte on which card is in play. (b) `createSession` reads `Playbook.config` once outside the transaction, picks the card inside the tx using the just-assigned `learnerFacingNumber` (sim drops do not rotate the pool — consecutive learner sessions do), writes `Session.metadata.pinnedCard` in the same row insert. Flag-gated. (c) New route `GET /api/calls/[id]/pinned-card` — VIEWER auth + STUDENT-scope gate. Reads `Call → Session.metadata.pinnedCard`. (d) `components/sim/PinnedCardSlot.tsx` — sticky-positioned card above SimChat. Two variants by `kind`: **`cueCard`** (topic + bullets + optional secondaryNote) / **`topicFocus`** (topic + optional focusArea inline). Esc-dismissible + ✕ button + remounts on `callId` change. Auto-clears when `callPhase ∈ {ended, wrapping}`. (e) `.hf-pinned-card*` CSS — `color-mix()` borders, no hardcoded hex. (f) SimChat mounts `<PinnedCardSlot>` above the stall chip. | (1) On hf-dev Inspector, paste into Part 2's G8 "Cue card pool" array editor: `[{"topic":"Describe a journey you remember well","bullets":["where you went","who with","what happened","why you remember it"]},{"topic":"Describe a book you enjoyed","bullets":["what kind","what it was about","why you enjoyed it"]}]`. Save. (2) `https://dev.humanfirstfoundation.com/x/sim/<bertie>?requestedModuleId=part2` → [Talk Here]. (3) Pinned card appears above SimChat with **Card A** (topic + 4 bullets). Press **Esc** → card dismisses. (4) End the call; start another → **Card B** (round-robin via `learnerFacingNumber`). (5) DB check on hf_sandbox: `psql -c "SELECT metadata->'pinnedCard' FROM \"Session\" WHERE \"callerId\" = '<bertie>' ORDER BY \"sequenceNumber\" DESC LIMIT 2;"` — matches what the UI rendered. (6) Flag off → no card; route returns `{card: null}`. |
| **PR #1840 (peer) — #1751 Mock Results post-call redirect + outbound nav.** Theme 13a Results screen shipped earlier but had no path from a finished Mock call into the screen. | Post-call redirect endpoint + outbound nav wiring so finishing a Mock call lands the learner on `/x/student/<courseId>/results/<sessionId>` automatically. | Finish a Mock session in the sim → browser navigates to the Results screen with the 12-criterion breakdown + half-band rounded overall. |
| **PR #1843 (peer) — #1745 `<ExamModeShell>` sim-page mount.** Theme 4 Mock dual-waveform shell existed as a component but wasn't mounted on the sim page. | SimChat picker logic mounts `<ExamModeShell>` when the active module's `mode === "exam"` (Mock). Visual dual-waveform exam UI gates the standard chat surface. | `/x/sim/<bertie>?requestedModuleId=mock` → exam shell renders instead of the normal chat surface. |
| **PR #1845 (peer) — #1703 incomplete-attempts chip on AttainmentTab.** Theme 9 incomplete-attempt counter shipped but had no operator-visible surface. | New chip on AttainmentTab renders `CallerModuleProgress.incompleteAttempts` count + state (waiver-fired / pending) per module. | `/x/callers/<id>?tab=attainment` → each module row shows an `Incomplete: N` chip when N > 0; when `incompleteAttempts ≥ 2 + status="COMPLETED"`, the chip reads "Waiver fired". |

## Where the cue card pool comes from (for context)

**Source of truth:** `Playbook.config.modules[].settings.cueCardPool` — operator-authored JSON array. Pool shape: `Array<{ topic: string; bullets: string[] }>`. Nothing is fetched externally — the operator pastes/imports cards via the Inspector G8 "Cue card pool" control (Phase 1 `JourneyJsonFallback`; the typed `JourneyArrayEditor<T>` from Theme 1b is what eventually replaces the raw-JSON view).

Selection chain (single chokepoint):
1. `createSession` reads `Playbook.config.modules[id==slug].settings.cueCardPool`.
2. Picks `pool[(learnerFacingNumber - 1) % pool.length]` — deterministic, replay-safe.
3. Writes the pick to both **`Session.metadata.pinnedCard`** (what `<PinnedCardSlot>` reads to render) AND lets the prompt-side `resolveModuleCueCard` independently compute the same pick (so model + learner see the same card).

## Theme delivery summary (full epic)

All 14 themes + 2 inserted follow-ons shipped:

| Theme | Story | Last PR | State |
|---|---|---|---|
| 1 — G8 module-scoped settings | #1701 | (across many) | ✅ closed today |
| 1b — Inspector primitives | #1752 | #1797 | ✅ |
| 2a — `sayMessage` + cue-scheduler foundation | #1742 | #1824 + #1830 runner | ✅ |
| 2b — Cue wiring + stall detector | #1743 | **#1839** | ✅ |
| 3 — Pinned chat card + writer | #1733 + #1744 | **#1841** | ✅ |
| 4 — Mock dual-waveform shell | #1745 | #1843 closeout | ✅ |
| 5 — Module unlock gates (`LOCKED` + prereqs) | #1746 | #1835 | ✅ |
| 6 — Per-part Mock scoring | #1702 | (prior) | ✅ |
| 7 — Tutor talk-time stats | #1747 | (prior) | ✅ |
| 8 — Question count target | #1748 | (prior) | ✅ |
| 9 — Incomplete-attempt counter | #1703 | #1845 closeout | ✅ |
| 10 — Generic `profile:*` capture schema | #1704 | #1768 | ✅ |
| 11 — Score-delta narrator | #1749 | (prior) | ✅ |
| 12 — Tester direct-link + `cloneDemoCaller` | #1750 | #1798 + #1826 (restore) | ✅ closed today |
| 13a — Mock Results screen | #1751 | #1840 closeout | ✅ |
| **#1700 epic** | — | — | ✅ **closed today** |

**Deferred** per epic decisions: Theme 13b (trial-state CTA), 13c (results email), 14 (`scoreVisibilityToLearner` flag), first-time orientation gating, results archive link, processing screen, PPF scaffold inserts, note-taking insert, 10s visual stall nudge during monologue (orthogonal — the stall chip we shipped is a different surface), re-speak phase (Part 2), <60s monologue LLM-only gate, examiner vocab lexicon knob, tutor talk-time runtime intervention.

**Sibling enhancement still open:** #1823 (pipeline writes `Session.metadata.overallBand`) — tracked separately under the Mock canonical-value concern; not blocking the epic.

## Flag posture

`HF_FLAG_IELTS_MODULE_SETTINGS` is the migration-window gate for all G8 read paths + cue scheduler + pinned card. **Default off.** Flip on per environment when ready. Today's smoke tests above all assume on.

## Audit before claiming done (epic-scope)

- [x] All 14 themes shipped or explicitly deferred per epic decisions
- [x] All child issues closed with citations
- [x] Both new PRs from this seat carry `## Verified by` evidence (Lattice survey + test counts + grep results)
- [x] Composition tests still green (216 + 253 = 469 across both PRs)
- [x] tsc clean in changed files for both PRs
- [ ] Operator smoke on hf-dev per the URLs above
- [ ] Flag flip on hf-dev when smoke clears

# IELTS Pre-Voice Testing — Gap Analysis (End-of-Day Snapshot)

**Date:** 2026-06-16 (end of day)
**Supersedes (status only):**
- [`ielts-pre-voice-gap-analysis.md`](./ielts-pre-voice-gap-analysis.md) — the canonical derivation doc (2026-06-15, `e445a5f4`). Still the source of truth for ACs, reuse map, and effort estimates.
- [`ielts-pre-voice-gap-analysis-progress-2026-06-16.md`](./ielts-pre-voice-gap-analysis-progress-2026-06-16.md) — this morning's snapshot (merged #1740), now stale.

> This summarises **everything that moved on Epic [#1700](https://github.com/WANDERCOLTD/HF/issues/1700) since yesterday's gap analysis.** Theme numbering is unchanged — Theme N maps 1:1 to the source doc. A meeting-ready scoreboard is at the top; the day's deltas and the residual unplanned work follow.

---

## Scoreboard — all 14 themes + sub-tracks

| Theme | Story | State | Evidence |
|---|---|---|---|
| **Migration bundle A/B/C/D** | #1700 | ✅ **Merged** | PR #1714 (Migration C doc-only — no enum DDL) |
| **1** — Module-scoped settings (G8 registry) | #1701 | ✅ **Registry merged**; umbrella open for last consumer | PR #1719 |
| ↳ G8 consumer A — `moduleQuestionTarget` → instructions | #1732 | ✅ **Merged** | PR #1773 |
| ↳ G8 consumer B — `moduleCueCardPool` → instructions + `Session.metadata.pinnedCard` | #1733 | 🟡 **PR merged, issue open** (pinnedCard write portion outstanding) | PR #1777 |
| ↳ G8 consumer C — `moduleClosingLine` → offboarding | #1734 | ✅ **Merged** | PR #1770 |
| ↳ G8 consumer D — `moduleFirstTimeOrientationLine` → onboarding + `orientationShown` col | #1735 | ✅ **Merged** | PR #1779 |
| **1b** — Inspector primitives (`JourneyMinTarget` + `JourneyArrayEditor<T>`) | #1752 | 📋 **Filed, open** | — |
| **2a** — Voice `sayMessage` primitive + cue-scheduler foundation | #1742 | 📋 **Filed, open** | — |
| **2b** — IELTS cue wiring + stall detector | #1743 | 📋 **Filed, open** | — |
| **3** — Pinned chat card `<PinnedCardSlot>` | #1744 | 📋 **Filed, open** | (pinnedCard writer partly via #1733) |
| **4** — Mock dual-waveform exam shell | #1745 | 📋 **Filed, open** | — |
| **5** — Module unlock gates (`LOCKED` + prerequisites) | #1746 | 📋 **Filed, open** | — |
| **6** — Per-part Mock scoring (`CallScore.segmentKey`) | #1702 | ✅ **Merged** | PR #1739 |
| **7** — Tutor talk-time stats | #1747 | ✅ **Merged** (3 PRs) | PRs #1766 helper+G7, #1774 endSession AppLog, #1776 AttainmentTab chip |
| **8** — Question-count target (EXTRACT counter) | #1748 | 📋 **Filed, open** | (composer directive side landed via #1732) |
| **9** — Incomplete-attempt counter + waiver + ESLint chokepoint | #1703 | ✅ **Merged** | PR #1741 |
| **10** — Generic profile capture (`profile:*`) | #1704 | 🟡 **In review** | PR #1768 open |
| **11** — Per-session score-delta narrator | #1749 | 📋 **Filed, open** | — |
| **12** — Tester direct-link + `cloneDemoCaller` | #1750 | 📋 **Filed, open** | — |
| **13a** — Mock Results screen | #1751 | 📋 **Filed, open** | — |
| **13b / 13c / 14** — trial CTA / results email / score-visibility | — | ⏸️ **Deferred** (post-voice-test) | epic scope |

**Headline:** 6 themes merged (bundle, 1-registry, 6, 7, 9, + 4 G8 consumers), 1 in review (10), every remaining Phase-2 theme now has a filed story.

---

## 1. Completed since yesterday

### Schema foundation
- **Migration bundle A/B/C/D** (PR #1714). Migration C shipped **doc-only** — `CallerModuleProgress.status` stays a `String`, `LOCKED` is a permitted value via comment, **no enum DDL**. Theme 5's lock handling is therefore application-layer only.

### Theme 1 — Module-scoped settings + composer consumers
- **Registry** (PR #1719): 6 G8 keys at `Playbook.config.modules[].settings.*`; 3 keys on `json-fallback` pending Theme 1b.
- **G8-consumer sub-track wired the registry into the compose chain** — this is the day's biggest structural advance and directly closes this morning's *"no reader wired / flag consumption unowned"* gap:
  - **A** (#1732/#1773) — `moduleQuestionTarget` renders into the INSTRUCTIONS section.
  - **C** (#1734/#1770) — `moduleClosingLine` overrides the offboarding transform.
  - **D** (#1735/#1779) — `moduleFirstTimeOrientationLine` renders into onboarding; adds `orientationShown` column; includes a render-side fix covering **all 4 G8 directives**.
  - **B** (#1733/#1777) — `moduleCueCardPool` directive merged; the `Session.metadata.pinnedCard` write portion is still open (overlaps Theme 3).

### Theme 6 — Per-part Mock scoring (PR #1739, issue closed)
- `writeCallScore` gains `segmentKey`; `runPerSegmentScoring` writes one row per (segment × criterion); unique key not widened; loud-skip AppLogs for fallback + mismatch.
- *Re-scope confirmed:* human-readable `segmentLabels` writer and overall-band aggregation were held out (see §4).

### Theme 7 — Tutor talk-time stats (PR #1766 + #1774 + #1776, issue closed)
- Post-call helper + G7 threshold settings + types (#1766); `endSession` emits `voice.talk_time.over_budget` AppLog (#1774); AttainmentTab over-budget chip (#1776). **This theme was "Phase 2, unfiled" in the original analysis — it landed in full today.**

### Theme 9 — Incomplete-attempt counter (PR #1741, issue closed)
- `markModuleIncomplete()` chokepoint helper + paired ESLint rule + second-attempt waiver; consumes Migration-B column and the `moduleMinSpeakingSec` G8 key.

### Journey Inspector platform work (supporting Theme 1/1b)
- Slice C1 bucket-grained LH + multi-pulse (#1736), C2 cascade-honesty `useEffectiveValue`/`CascadeValue` (#1753), C3 writeGate UI + `no-bucketless-journey-setting` guard + `CONTRACTS-JOURNEY.md` (#1772), N_voice Cmd+K bucket (#1778). These harden the Inspector the G8 keys live in.

---

## 2. In flight (today)

| Item | Story / PR | Note |
|---|---|---|
| **Theme 10 — generic profile capture** | #1704 / PR **#1768 open** | `profile:*` namespace + Class B grounding; awaiting review/merge |
| **G8 consumer B pinnedCard write** | #1733 (issue open) | composer directive merged; `Session.metadata.pinnedCard` write still to land (folds into Theme 3) |

---

## 3. Still planned in #1700 (filed, open)

**Every Phase-2 theme now has a story** — a clean advance on this morning, when these were "unfiled".

| Theme | Story | Depends on |
|---|---|---|
| 1b — Inspector primitives | #1752 | replaces 3 `json-fallback` G8 keys |
| 2a — `sayMessage` primitive + cue scheduler | #1742 | **spike day 1** (VAPI `say` not modelled) |
| 2b — cue wiring + stall detector | #1743 | 2a; reads `moduleScheduledCues` |
| 3 — `<PinnedCardSlot>` | #1744 | Migration A; absorbs #1733 pinnedCard write |
| 4 — dual-waveform exam shell | #1745 | — |
| 5 — module unlock gates | #1746 | Migration C (app-layer) |
| 8 — question-count EXTRACT counter | #1748 | reads `moduleQuestionTarget`; directive side already merged (#1732) |
| 11 — score-delta narrator | #1749 | Migration A |
| 12 — tester direct-link + `cloneDemoCaller` | #1750 | — |
| 13a — Mock Results screen | #1751 | Theme 6 scores; **should also own overall-band aggregation** (§5 #2) |

---

## 4. Deferred by design (post-voice-test)

Themes **13b** (trial-state CTA), **13c** (Resend results email — infra confirmed via `lib/messaging/`), **14** (`scoreVisibilityToLearner`), plus the polish list: first-time-orientation *gating*, permanent results-archive link, "Reviewing your exam…" processing screen, PPF scaffold inserts, note-taking insert, 10s visual stall nudge, re-speak phase, <60s monologue LLM-only gate, examiner vocab knob, tutor talk-time runtime intervention.

---

## 5. Still NOT planned (no theme / no story) — verified absent today

Re-probed against today's code. This morning's §3 had 9 items; **#3 (Theme 1b) and #4 (G8 reader/flag consumption) were resolved today.** These remain unowned:

| # | Item | Status today | Suggested home |
|---|---|---|---|
| 1 | **`Session.metadata.segmentLabels` writer** (human-readable Mock part labels) | **Still no write site.** Theme 6 re-sourced its whitelist from curriculum; #1733 writes `pinnedCard`, not `segmentLabels` | Theme 3 (#1744) or Theme 6 follow-on |
| 2 | **Overall-band aggregation** (`Session.metadata.overallBand`, mean-of-12) | **Field declared, no writer.** Now has a *plausible* home (Theme 13a #1751 filed) but not confirmed in its ACs | Add explicitly to Theme 13a (#1751) — it gates the Results screen |
| 5 | **`HEURISTIC_PATTERNS` course-agnostic** (`segment-mock-transcript.ts:65` IELTS-hardcoded) | **No follow-on filed.** Flagged in #1702 risks | New tech-debt story |
| 6 | **4-criteria completion gate** ("all 4 scores non-null before complete") | **No theme, no story.** PARTIAL row in source doc, never numbered | Theme 6 follow-on or Theme 11 |
| 7 | **Post-Assessment / post-Mock lesson-plan trigger** | **Not wired.** `lib/lesson-plan/*` + `lib/content-trust/lesson-planner.ts` exist but no hook fires on `baseline_assessment`/`examiner` complete | New small pipeline-hook story |
| 8 | **`baselineAssessment.silentMode`** (no phase-break / no test-announcement) | **Absent.** Not among the 6 G8 keys shipped | 7th G8 key or `Playbook.config` flag |
| 9 | **`derive-focus-area.ts`** (Part 3 weakest-parameter selector) | **File absent.** Theme 11 reads the delta; nothing computes the focus | Theme 11 prerequisite or helper story |

---

## What changed since this morning's snapshot (#1740)

| | This morning | End of day |
|---|---|---|
| Theme 6 | on-branch, not PR'd | ✅ merged (#1739) |
| Theme 9 | open, not started | ✅ merged (#1741) |
| Theme 10 | open, not started | 🟡 in review (#1768) |
| Theme 7 | Phase-2, unfiled | ✅ merged in full (#1766/#1774/#1776) |
| G8 readers / flag consumption (was unplanned #4) | unowned | ✅ 4 consumers wired (#1732–1735) |
| Theme 1b (was unplanned #3) | unfiled | 📋 filed (#1752) |
| All other Phase-2 themes | unfiled | 📋 all filed (#1742–1751) |
| Unplanned residual | 9 items | 7 items (#1,2,5,6,7,8,9) |

---

## Recommended next actions

1. **Merge Theme 10 (#1768)** — only Phase-1 story still in flight.
2. **Close out Theme 1** — land #1733's `pinnedCard` write (or formally move it into Theme 3 #1744) so the umbrella issue can close.
3. **File the 4 residual unowned items that block voice-test ACs:** #2 overall-band (blocks Theme 13a Results), #1 segmentLabels writer, #7 lesson-plan trigger, #9 `derive-focus-area`. Items #5/#6/#8 are smaller and can wait.
4. **Sequence Phase 2** — critical path is now 2a (spike) → 2b → 3 → 13a. Themes 4/5/8/11/12 parallelise.

---

*Sources: Epic #1700; issues #1701–#1704, #1732–#1735, #1742–#1752; PRs #1714/#1719/#1739/#1741/#1766/#1768/#1770/#1773/#1774/#1776/#1777/#1779; commits through `281cfaac` (2026-06-16); live grep confirming `overallBand`/`segmentLabels`/`silentMode` writers and `derive-focus-area.ts` absent.*

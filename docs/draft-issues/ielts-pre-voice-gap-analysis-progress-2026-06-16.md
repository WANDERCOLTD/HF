# IELTS Pre-Voice Testing — Gap Analysis (Progress Update)

**Date:** 2026-06-16
**Supersedes (status only):** [`ielts-pre-voice-gap-analysis.md`](./ielts-pre-voice-gap-analysis.md) (commit `e445a5f4`, 2026-06-15) — the original derivation doc that Epic [#1700](https://github.com/WANDERCOLTD/HF/issues/1700) was built from. That document remains the canonical reuse-map + AC source. **This document layers delivery status on top of it** and re-states the remaining and unplanned work after lanes A and B landed.

> **Theme numbering is unchanged from the original** — every Theme N below maps 1:1 to Theme N in the source doc and to the epic scope list. Use them together.

---

## At a glance

| Bucket | Themes / stories | State |
|---|---|---|
| **Done** | Migration bundle (A/B/C/D), Theme 1, Theme 6 | Merged / on-branch |
| **Still planned in #1700** | Themes 9, 10 (Phase 1 remainder) + Phase-2 Themes 1b, 2a, 2b, 3, 4, 5, 7, 8, 11, 12, 13a | Stories open or unfiled |
| **Deferred (post-voice-test)** | Themes 13b, 13c, 14 + the polish list | Out of pre-voice-test scope by design |
| **Not yet planned (no theme / no story)** | 9 surfaced items — see §3 | **Needs grooming** |

---

## 1. Work already completed — lanes A and B

### Foundation — Migration bundle A/B/C/D · `#1700` · PR **#1714** · MERGED (commit `b728119d`)

The four schema additions that gate every Phase 1 theme. Additive + nullable (A/D) or NOT NULL with safe DEFAULT (B). Shipped in one `/vm-cpp` cycle.

| Migration | Column | Serves | Delivered shape |
|---|---|---|---|
| A | `Session.metadata Json?` | Themes 3, 6, 11 | Shape declared at `lib/types/json-fields.ts::SessionMetadata` (incl. `segmentLabels[]`, `overallBand?`, `focusDelta?`, `pinnedCard?`) |
| B | `CallerModuleProgress.incompleteAttempts INT DEFAULT 0` | Theme 9 (#1703) | Column live; writer not yet built |
| C | `CallerModuleProgress.status` `LOCKED` value | Theme 5 | **Changed from plan** — shipped **doc-only**: status stays a plain `String`; `LOCKED` is a permitted value via comment, **no enum DDL** |
| D | `CallScore.segmentKey String?` | Theme 6 (#1702) | Annotation column; `@@unique([callId, parameterId, moduleId])` **not** widened (epic decision 1) |

> **Note for downstream stories:** Migration C carrying no DDL means Theme 5's `LOCKED` handling is purely application-layer (string literal + render + role-bypass) — there is no enum to migrate, but also no DB-level guard against an unknown status string.

### Lane A — Theme 1: Module-scoped settings (G8 group) · `#1701` · PR **#1719** · MERGED (commit `4f15745c`)

G8 group added to the Journey Inspector with the 6 IELTS-required keys at `Playbook.config.modules[].settings.*`.

| G8 key | Control type | `composeImpact.sections` |
|---|---|---|
| `moduleQuestionTarget` | `json-fallback` | `instructions` |
| `moduleMinSpeakingSec` | `number` | — |
| `moduleCueCardPool` | `json-fallback` | `instructions` |
| `moduleClosingLine` | `text` | `offboarding` |
| `moduleFirstTimeOrientationLine` | `text` | `onboarding` |
| `moduleScheduledCues` | `json-fallback` | — (consumed by the Theme 2 cue scheduler at runtime) |

- Storage: every entry uses `StoragePathStruct` with `arrayKey:"id"` (module-scoped settings can't compress to a bare dot-path — Tech Lead Q1 ruling).
- Pinned by `registry-completeness.test.ts` (17/17), plus sibling fixes to `CommandPalette.test.tsx` and `section-staleness-bridge.test.ts`.
- **Carry-overs created by Lane A:**
  - 3 of 6 keys (`moduleQuestionTarget`, `moduleCueCardPool`, `moduleScheduledCues`) ship on **`json-fallback`** — the min/target and array-of-struct shapes have no first-class Inspector primitive yet. That is **Theme 1b**, which has **no story filed**.
  - **No downstream reader is wired.** All G8 reads are to be gated behind `HF_FLAG_IELTS_MODULE_SETTINGS` (epic decision 5). This PR registered the keys only — nothing consumes them yet.

### Lane B — Theme 6: Per-part Mock scoring (`CallScore.segmentKey`) · `#1702` · on-branch (commit `299d8119`) · **PR not yet opened**

> ⚠️ **Status: implemented on `feat/1702-theme6-segmentkey`, committed, but not pushed or PR'd.** It is one `git push` + `gh pr create` away from review.

Delivered:
- `writeCallScore` — optional `segmentKey` forwarded to create/update. Unique key **not** widened (constraint-shape vitest pins this).
- `runPerSegmentScoring` (in `app/api/calls/[callId]/pipeline/route.ts`) — the **actual** per-part writer. *The original brief mis-pointed at `prosody-consumer.ts`; the real writer was found and corrected during implementation.* Passes `segmentKey = segment.slug`.
- Loud-skip AppLogs: `prosody.segmentation.fallback` (≤1 boundary) and `prosody.segmentation.mismatch` (slug not in whitelist → segment skipped).
- Tests: segmentKey forwarding, unique-constraint shape pin, segmenter→writer round-trip (12 rows for a Mock; `null` for non-Mock).

**Two of this story's own ACs were re-scoped during build (flag for grooming):**
1. **`Session.metadata.segmentLabels` write at Mock session-start was NOT delivered.** The whitelist was instead sourced from curriculum `coversModules` (always in scope; `segmentLabels` is flag-gated/nullable at this point). The human-readable label write was **deferred to Theme 3** — but Theme 3 as scoped is the *pinned card*, not segment labels. See §3.
2. **Overall-band aggregation** (`Session.metadata.overallBand`, mean-of-12) was correctly held **out of scope** and reassigned to **Theme 13a** — the original gap-analysis had it as `PARTIAL (Theme 6) ~10 lines`. It now needs a Theme 13a home (story unfiled). See §3.

---

## 2. Work still planned in Epic #1700

### Phase 1 remainder (stories open, not started)

| Theme | Story | Scope | Schema | Gate |
|---|---|---|---|---|
| **9** — Incomplete-attempt counter | **#1703** OPEN | `markModuleIncomplete()` helper + paired ESLint rule + second-attempt waiver; increments Migration-B column | column live | reads `moduleMinSpeakingSec` (Lane A) |
| **10** — Generic profile capture | **#1704** OPEN | `AuthoredModule.settings.profileFieldsToCapture` walked by a generic EXTRACT routine; `profile:*` namespace; Class B `@ai-call` grounding + whitelist | none | needs a G8-style settings entry pattern from Lane A |

### Phase 2 — themes in epic scope, **stories not yet filed**

Deferred to individual stories by the epic ("Filing Phase 2 stories deferred until Phase 1 lands"). All depend on the now-merged migration bundle + Lane A registry.

| Theme | What it delivers | Notable dependency |
|---|---|---|
| **1b** | `JourneyMinTarget` + `JourneyArrayEditor<T>` Inspector primitives | Replaces the 3 `json-fallback` keys from Lane A |
| **2a** | `Voice adapter sayMessage` primitive (`VoiceProvider` iface + VAPI HTTP impl + `cue-scheduler.ts` + SSE-registry hook) | **Spike day 1** — VAPI `POST /call/{id}/say` not yet modelled |
| **2b** | IELTS cue wiring + stall detector consuming 2a | reads `moduleScheduledCues` (Lane A) |
| **3** | `<PinnedCardSlot>` + populates `Session.metadata.pinnedCard` | Migration A (done) |
| **4** | `<ExamModeShell>` + `<DualWaveform>` (WebRTC analyser) | none |
| **5** | Module unlock gates — `LOCKED` render + `prerequisites` widened, OPERATOR+ bypass | Migration C (doc-only; app-layer) |
| **7** | Tutor talk-time stats (post-call telemetry chip) + `talkTimeBudgets` knobs | none |
| **8** | Question-count target per module (EXTRACT interrogative counter) | reads `moduleQuestionTarget` (Lane A) |
| **11** | Per-session score-delta narrator + focus delta | Migration A (done) |
| **12** | Tester direct-link family `/x/test/[playbookSlug]/[moduleSlug]` + `cloneDemoCaller` | none |
| **13a** | Mock Results screen (`/x/student/[courseId]/results/[sessionId]`, Snapshot v3 blocks) **+ overall-band aggregation** | Lane B per-part scores |

### Deferred by design (post-voice-testing polish — in epic, intentionally out of the pre-voice bar)

- **Theme 13b** — trial-state CTA branching (`Playbook.config.trialState` — confirmed does-not-exist today)
- **Theme 13c** — Resend results email (infra confirmed via `lib/messaging/`)
- **Theme 14** — `scoreVisibilityToLearner` flag
- Polish list (each saves a fraction of a day): first-time-orientation *gating*, permanent results archive link, "Reviewing your exam…" processing screen, PPF scaffold inserts, note-taking instruction insert, 10s visual stall nudge, re-speak phase (Part 2), <60s monologue LLM-only gate, examiner vocab lexicon knob, tutor talk-time runtime intervention.

---

## 3. Items NOT yet planned for

These surfaced from (a) what the original PARTIAL rows never assigned to a numbered theme, and (b) re-scoping that happened *during* lanes A and B. None has a story or a clear owner today.

| # | Item | Origin | Why it's unowned | Suggested home |
|---|---|---|---|---|
| 1 | **`Session.metadata.segmentLabels` write at Mock session-start** | Lane B deferred its own AC | Lane B re-sourced its whitelist from curriculum and pushed label-writing to "Theme 3" — but Theme 3 is the pinned card, not labels. The human-readable label store has no writer. | New small story under Theme 3 **or** a Theme 6 follow-on |
| 2 | **Overall-band aggregation** (`overallBand`, mean-of-12 → nearest half-band) | Gap-analysis Unit 5; reassigned out of Lane B | Declared in `json-fields.ts` but **no writer exists**. Folded into "Theme 13a" verbally; Theme 13a has no story. | Theme 13a story ACs |
| 3 | **Theme 1b Inspector primitives** (`JourneyMinTarget`, `JourneyArrayEditor<T>`) | Epic scope mentions; Lane A used `json-fallback` | In the epic's prose but never filed; 3 G8 keys depend on it for a non-JSON editing UX | File Theme 1b story |
| 4 | **`HF_FLAG_IELTS_MODULE_SETTINGS` consumption + flip-on plan** | Epic decision 5 | Flag is referenced as the gate for all G8 reads, but no compose-transform / EXTRACT / endSession reader consumes it yet, and there's no "flip-on after migration deploys cleanly" checklist owner | Fold into Themes 8/9/2b (the first readers) |
| 5 | **`HEURISTIC_PATTERNS` course-agnostic follow-on** | #1702 risks ("file a follow-on") | `segment-mock-transcript.ts:65` is IELTS-hardcoded; next course gets zero boundaries → fallback every time. Flagged but not filed. | New tech-debt story |
| 6 | **4-criteria completion gate** ("a score exists for all 4, none null/zero") | Gap-analysis Unit 1 rows + Unit 5 | Marked `PARTIAL ~10 lines` but never given a theme number; not in any Phase-1/2 story | Add to Theme 6 follow-on or Theme 11 |
| 7 | **Post-Assessment / post-Mock lesson-plan trigger** | Gap-analysis Unit 1 row 38 + Unit 5 row 168 | `lib/lesson-plan/*` exists but isn't fired when `baseline_assessment`/`examiner` completes; `PARTIAL ~20 lines`, no theme number | New small story (pipeline hook) |
| 8 | **`baselineAssessment.silentMode` knob** (no phase-break / no test-announcement) | Gap-analysis Unit 1 rows 19, 23 | `GAP-thin` folded loosely into "Theme 1", but it is **not** one of the 6 G8 keys Lane A shipped | Add a 7th G8 key or a `Playbook.config` flag |
| 9 | **`derive-focus-area.ts`** (Part 3 weakest-parameter selector) | Gap-analysis Unit 4 rows 111–112 | `PARTIAL ~20 lines`; required for Part 3 "today's focus" but no theme number — Theme 11 reads the delta, nothing computes the focus | Theme 11 prerequisite or new helper story |

### Reconciliation note

Items 6–9 are the cleanest "we never planned these": they are PARTIAL rows in the original gap analysis that were **described** but never rolled into a numbered theme, so they fell outside the epic's 14-theme scope list. Items 1–2 are *re-scoping drift* — work that moved between stories during lanes A/B and lost its owner in the move. Items 3–5 are *named-but-unfiled* follow-ons.

---

## Recommended next actions

1. **Push + PR Lane B (#1702)** — it's complete on-branch but invisible until pushed.
2. **Groom the Phase-1 remainder** (#1703 Theme 9, #1704 Theme 10) — both unblocked by the merged migration bundle + Lane A.
3. **File the 4 highest-leverage unplanned items before Phase 2 starts:** #1 (segmentLabels writer), #2 (overall-band — blocks Theme 13a Results screen), #4 (flag consumption — blocks every G8 reader), #3 (Theme 1b — UX debt, lower urgency).
4. **Decide ownership for items 6–9** at sprint planning — they're small (≈0.3–0.7 d each) but each blocks a specific AC in the unit checklists.

---

*Sources: Epic #1700 body; issues #1701/#1702/#1703/#1704; PRs #1714/#1719; commits `b728119d`, `4f15745c`, `299d8119`; `docs/draft-issues/ielts-pre-voice-gap-analysis.md` (`e445a5f4`); live grep of `overallBand`/`segmentLabels` writers (declared in `json-fields.ts`, no consumer found).*

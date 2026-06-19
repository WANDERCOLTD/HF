# IELTS Pre-Voice Testing Script — DEV (hf_staging)

**Date:** 2026-06-19
**Audience:** Boaz, Eldar, internal QA, and any operator running the IELTS demo on DEV
**Base URL:** `https://dev.humanfirstfoundation.com`
**DB binding:** `dev.humanfirstfoundation.com` → `hf_staging` (since 2026-06-19 08:43 UTC pivot)
**Login:** `admin@test.com` / `admin123` (5 SUPERADMINs seeded — also `boaz@tal.biz`, `eldar.gilad@gmail.com`, `b@test.com`, `e@test.com`)
**IELTS playbook ID:** `cbca5851-9bcc-49b0-a954-20ec150492bd`

## Source documents

This script is a full operator-facing companion to the IELTS gap-analysis chain. Read alongside:

- [`ielts-pre-voice-gap-analysis.md`](./ielts-pre-voice-gap-analysis.md) — original 447-line gap inventory (#1686, 2026-06-15)
- [`ielts-pre-voice-gap-analysis-progress-2026-06-16.md`](./ielts-pre-voice-gap-analysis-progress-2026-06-16.md) — mid-week snapshot
- [`ielts-pre-voice-gap-analysis-response-2026-06-18.md`](./ielts-pre-voice-gap-analysis-response-2026-06-18.md) — partner response with 4 blockers groomed (#1960)
- [`ielts-tester-guide-dev-staging.md`](./ielts-tester-guide-dev-staging.md) — short DEV cross-check (sibling)

The original gap doc structures gaps by 5 Units × 13 themes. This script keeps that structure for navigability and adds:

- **Part 1**: every testable item on DEV today + how to test it + the DEV URL
- **Part 2**: every remaining unaddressed item + what we plan to do about it

---

# PART 1 — What you can test today on DEV (and how)

## Setup — one-time per session

```
1. Login: https://dev.humanfirstfoundation.com/login
       email: admin@test.com   password: admin123
       (alternatives: b@test.com, e@test.com, boaz@tal.biz, eldar.gilad@gmail.com — all admin123)

2. Tester workbench: https://dev.humanfirstfoundation.com/x/test
   Click "Clone demo caller" — gives you a fresh Caller pre-attached to a published playbook.
   Note the caller UUID — it goes into every link below as <CALLER_ID>.

3. (Optional) Direct-link the sim: https://dev.humanfirstfoundation.com/x/sim/<CALLER_ID>
```

**SUPERADMIN bypass for module unlock gates is automatically active for the 5 seeded admins**. To exercise gate behaviour like a real learner, create a STUDENT-role caller and link them; tester guide ([#1812]) provides the helper.

---

## Unit 1 — Assessment (`baseline` module)

The baseline assessment is the first call every new IELTS learner runs. Mode: `examiner`. Duration: 20 minutes nominal.

### What you can test today

| # | Test item | Status | DEV URL / probe | Expected behaviour |
|---|---|---|---|---|
| 1.1 | First-call mode wires baseline_assessment | SET (cascade-default) | [Course detail](https://dev.humanfirstfoundation.com/x/courses/cbca5851-9bcc-49b0-a954-20ec150492bd) → Journey tab → baseline Inspector | `firstCallMode = baseline_assessment` resolves via cascade (current explicit value: NOT SET on Playbook → falls back to system default) |
| 1.2 | Voice picker config + welcome flow toggles | SET | Course detail → Voice tab; Journey tab → welcome rail | `welcome.goals.enabled: true`, `welcome.aboutYou.enabled: true`, `welcome.aiIntroCall.enabled: false`, `welcome.knowledgeCheck.enabled: false` |
| 1.3 | Welcome opening with "If you're unsure, just ask me" | PARTIAL | Sim a baseline call → first tutor utterance | Tutor greets warmly + drops the reassurance line. Confirm one-shot delivery (not repeated mid-session). |
| 1.4 | Profile capture (Reason / Target band / Timeline / Self-level) | SHIPPED #1850 — [P3g profileFieldsToCapture](https://github.com/WANDERCOLTD/HF/pull/1961) | Sim baseline → answer with profile-relevant content → check `CallerAttribute` for `profile:reason`, `profile:targetBand`, `profile:timeline`, `profile:selfLevel` | Each key populated after EXTRACT runs |
| 1.5 | 4 IELTS criterion scores written by PROSODY | SET | After baseline, call `GET /api/sessions/<sessionId>/results` | 4 CallScore rows: FC, LR, GRA, P |
| 1.6 | Per-session results screen | SHIPPED #1751 — [`7f3c2370` + `1a119d91`] | `https://dev.humanfirstfoundation.com/x/callers/<CALLER_ID>/result/<SESSION_ID>` | Results screen renders score breakdown + transcript link |
| 1.7 | Persisted `overallBand` writer | SHIPPED #1823 — [`64f41a6c`] | Same results URL or DB-side `Session.metadata.overallBand` | Field populated after AGGREGATE writes (was live-computed only pre-fix) |
| 1.8 | Tester direct-link from workbench | SHIPPED #1750 — [`419d42df`] | Tester workbench → IELTS Assessment direct-link button | Lands directly in `/x/sim/<CALLER_ID>` with baseline pre-selected |
| 1.9 | Question-style + open-ended bias in baseline prompt | SET (Theme 1 module-scoped instructions) | Sim baseline → observe tutor question shapes | Tutor asks open-ended (not yes/no) questions |
| 1.10 | Tester can run as fresh vs returning learner | SHIPPED #1812 — [`067952f3`] | Tester workbench → "Clone demo caller" (fresh) vs "Continue existing" (returning) | Two distinct entry paths visible; cloned caller has cleared CallerAttribute + CallerModuleProgress |

### What to type into the sim during a baseline test

```
> Hi! I want to improve my IELTS speaking band before September.
> I'm currently around band 5, hoping to reach 6.5.
> I'm a software engineer from Mumbai, work in English daily but speaking
  feels worse than writing.
> [continue the conversation naturally — let the tutor steer]
```

After the call, **verify** that the four typed `CallerAttribute` keys (`profile:reason`, `profile:targetBand`, `profile:timeline`, `profile:selfLevel`) are populated. You can check via the AttainmentTab or directly query the API.

### What is NOT yet testable in Unit 1 (covered in Part 2)

- Four-criteria completion gate (#1953 — pending)
- Lesson-plan trigger post-Assessment (#1954 — pending)
- silentMode knob ("don't make it feel like a test") (#1956 — pending)
- Incomplete-first / incomplete-second policy (Theme 9 — partial; sticky-waiver guard live per #1703, but incompleteAttempts on `CallerModuleProgress` is the canonical writer chokepoint)

---

## Unit 2 — Part 1: Familiar Topics (`part1` module)

Mode: `tutor`. Duration: Student-led (target 10+ min speaking).

### What you can test today

| # | Test item | Status | DEV URL / probe | Expected behaviour |
|---|---|---|---|---|
| 2.1 | Module-scoped welcome / opening | PARTIAL (Theme 1) | Course detail → part1 Inspector → welcome row | Override visible; defaults blank → tutor uses module greeting from composer |
| 2.2 | Module-scoped instructions (exam-style questions, no preamble) | PARTIAL (Theme 1) | Sim part1 → first 2 turns of tutor | Tutor moves into questions quickly; no extensive preamble |
| 2.3 | Question-count minimum (10) counter | SHIPPED #1748 — [`81fe52b2`] | Course detail → part1 Inspector → G7 row "Question-count minimum" | Knob present and editable; default `min: 10`, `target: 13` |
| 2.4 | Topic familiar/personal — topic pool | PARTIAL (Theme 1) | Sim part1 → topic of first question | Tutor opens with familiar/personal-life topic (home, work, study, leisure) |
| 2.5 | Brief feedback after some answers | SET | Sim part1 → tutor between-question utterances | Tutor injects 1-line affirmations / corrections occasionally |
| 2.6 | 4 per-criterion scores after part1 | SET | `GET /api/sessions/<sessionId>/results` | 4 CallScore rows |
| 2.7 | Score-delta narrator vs previous part1 session | SHIPPED #1951 — [SEMANTICS render block, #1979] | Sim part1 twice for same caller → second results screen | Delta shown per-criterion |
| 2.8 | Updated lesson plan after part1 | PARTIAL | After part1, check `/x/callers/<CALLER_ID>` lesson-plan section | Plan refreshes if #1954 is live; today partial — needs Q1 decision |
| 2.9 | Tester direct-link | SHIPPED #1750 | Tester workbench | Part 1 direct-link button |

### Recommended test scripts for Part 1

Run **two consecutive part1 sessions** for the same caller to exercise the delta-narrator (item 2.7):

**Session A** (deliberately weaker — keep answers short, single-sentence):
```
> "Yes."  "No."  "It's OK." "I work in software."
```
Expected: low scores across FC and LR.

**Session B** (deliberately stronger — extended, varied answers):
```
> "I think the most rewarding part of my job is when a complex
  refactor lands and other engineers stop being blocked. It's not
  glamorous, but it's where I feel I'm earning my pay."
```
Expected: meaningfully higher scores; delta narrator shows positive movement.

---

## Unit 3 — Part 2: Cue Card Monologue (`part2` module)

Mode: `mixed`. Duration: Student-led (single-card v1; multi-card carved to Phase 2).

### What you can test today

| # | Test item | Status | DEV URL / probe | Expected behaviour |
|---|---|---|---|---|
| 3.1 | Cue card pinned-card primitive | SHIPPED #1733 — module cue card directive | Sim part2 → check pinned slot above SimChat | Cue card displays with topic + bullets |
| 3.2 | Timed voice lines spike (45s "15 sec left", 60s "begin", etc.) | SHIPPED #1742 + #1743 + ADR — [`9fbc7580` + `fefe6a09` + `e9e5ebc6`] | Sim part2 → wait through prep phase | Tutor speaks pre-baked cues at 45s + 60s; no extra chatter during prep |
| 3.3 | Stall detector during monologue | SHIPPED #1743 — [`fefe6a09`] | Sim part2 → during monologue, stop talking for 10s | Visual nudge (no voice) renders; if 90s silence after that, tutor prompts gently |
| 3.4 | Single-card v1 monologue + feedback | SET (single-card shipped) | Sim part2 fully | Cue card → 60s prep → 120s monologue → tutor delivers 1-3 lines feedback |
| 3.5 | Module orientation directive (#1735) | SHIPPED #1735 | Sim part2 first time | Tutor says "In Part 2 you'll speak for 2 minutes…" |
| 3.6 | Per-criterion scoring after part2 | SET | `GET /api/sessions/<sessionId>/results` | 4 CallScore rows |

### What to look at during the part2 test

- The pinned cue card slot stays visible THROUGHOUT prep + monologue
- Tutor is silent during the prep phase except for the timed cues at 45s and 60s
- Stall nudge appears as a visual chip after 10s silence, NOT a voice intervention

### What is NOT yet testable in Unit 3 (covered in Part 2)

- Multi-card loop orchestrator (Phase 2 — Boaz U3.1 carve-out)
- Per-card prep minute (Phase 2 — U3.2)
- Per-segment Part 2 scoring (Phase 2 — U3.3)
- Re-speak sub-phase (Theme 2, pending)

---

## Unit 4 — Part 3: Abstract Discussion (`part3` module)

Mode: `tutor`. Duration: Student-led (target 7-10 min speaking).

### What you can test today

| # | Test item | Status | DEV URL / probe | Expected behaviour |
|---|---|---|---|---|
| 4.1 | No unlock gate — available day 1 | SET | Open `/x/callers/<CALLER_ID>` for fresh caller → click Part 3 directly | Starts without prerequisite enforcement |
| 4.2 | Weakest-skill rail consumes per-LO mastery | SHIPPED — 3 transforms (`modules.ts`, `retrieval-practice.ts`, `progress-narrative.ts`) | Sim part3 → composed prompt at course detail → Compose / Preview tab | Composed prompt has "today's focus is weakest skill" reference |
| 4.3 | Per-criterion scores after part3 | SET | `GET /api/sessions/<sessionId>/results` | 4 CallScore rows |
| 4.4 | Score-delta vs previous part3 session | SHIPPED #1951 | After two part3 runs, see results screen | Delta narrator renders |
| 4.5 | Tester direct-link | SHIPPED #1750 | Tester workbench → Part 3 button | Direct link to `/x/sim/<CALLER_ID>` with part3 pre-selected |

### What is NOT yet testable in Unit 4 (covered in Part 2)

- Topic + focus area as pinned message (#1955 — pending; PinnedCardContent type exists, slot unused)
- Stall-recovery branch with scaffold pool (Theme 2 — partial)
- No-barge-in voice provider directive (Theme 1 + Theme 2)

---

## Unit 5 — Mock Exam (`mock` module)

Mode: `examiner`. Duration: 15 min nominal.

### What you can test today

| # | Test item | Status | DEV URL / probe | Expected behaviour |
|---|---|---|---|---|
| 5.1 | Exam shell with dual waveform + hidden timers | SHIPPED #1745 — [`71fb087a` + `b56137e3`] | Sim mock → `ExamModeShell` page | Dual waveform (learner / examiner); no numeric timers visible |
| 5.2 | Unlock gate (Assessment + 2 P1 + 2 P3) | SHIPPED #1746 — [`0d8a0de3` + `9f7b817f`] | As STUDENT-role caller, try to start Mock without completing prerequisites | Locked tile state; bypass works for OPERATOR+ |
| 5.3 | Persisted-band writer | SHIPPED #1823 — [`64f41a6c`] | After Mock, `Session.metadata.overallBand` | Populated |
| 5.4 | Live overall band route | SHIPPED #1751 — [`7f3c2370`] | `GET /api/sessions/<sessionId>/results` | Returns band even if AGGREGATE hasn't persisted yet |
| 5.5 | No spoken band (no "your band is X" in tutor speech) | CONFIRMED — Boaz correction | Read composed prompt at course detail → Compose / Preview tab | Composed prompt does NOT include spoken-band line |
| 5.6 | Examiner mode persona | SET | Sim mock → first 2 tutor turns | Minimal acknowledgments only ("Thank you", "I see"); no coaching |

### What is NOT yet testable in Unit 5 (covered in Part 2)

- Three sub-phases (P1 / P2 / P3) inside a single Mock session — needs Theme 1 + Theme 6 sub-modules
- Four-criteria completion gate explicit check (#1953 — pending)
- Per-part scoring (Theme 6 — pending CallScore.segmentKey)

---

## Cross-cutting — Tester surfaces

| # | Test item | Status | DEV URL | Expected behaviour |
|---|---|---|---|---|
| X.1 | Tester workbench index | SHIPPED #1812 — [`067952f3`] | <https://dev.humanfirstfoundation.com/x/test> | Lists demo learners + per-session direct links |
| X.2 | Direct-link per session type | SHIPPED #1750 — [`419d42df`] | Buttons on workbench | Open simulator at the right module without setup |
| X.3 | Clone demo caller (fresh learner) | SHIPPED `180d5da0` | Tester workbench → "Clone" button | Produces caller with cleared CallerAttribute + CallerModuleProgress |
| X.4 | AttainmentTab — scores + transcript + plan | EXTENDED #1887 — AttainmentTab | `https://dev.humanfirstfoundation.com/x/callers/<CALLER_ID>` | Per-criterion bars; transcripts viewable; lesson plan section |
| X.5 | Snapshot view — score history | PARTIAL (Theme 11) | Caller detail → Snapshot section | Renders per-criterion timeline |
| X.6 | Cue card replay (read `Session.metadata.pinnedCard`) | PARTIAL (Theme 3) | Per-session view | Pinned card content retrievable post-session |
| X.7 | Composed prompt preview | SET — Preview lens (#1268) | Course detail → Compose / Preview tab | See what the LLM would receive for a given module |

---

# PART 2 — Remaining IELTS gap items + our plan

Reorganized by lifecycle: in-flight (committed), deferred, deciding, unaddressed.

## A. In-flight blockers being built (4 stories, ~3 dev-days total)

| Story | Boaz refs | What it does | Status | When |
|---|---|---|---|---|
| [#1953](https://github.com/WANDERCOLTD/HF/issues/1953) — Four-criteria IELTS completion gate | U1.2 + U5 + Cross-cutting A | Refuses to mark session COMPLETED unless all 4 IELTS skills scored non-zero | TL-reviewed, groomed, ready | First of sequence — no Q dependency |
| [#1954](https://github.com/WANDERCOLTD/HF/issues/1954) — Post-Assessment lesson-plan trigger | U1.1 + U2.4 (TBD) | Fires `generateLessonPlan(callerId)` from post-AGGREGATE hook | Pending Q1 decision | Builds on #1953's AGGREGATE integration point |
| [#1955](https://github.com/WANDERCOLTD/HF/issues/1955) — Part 3 focus selector + on-screen pin | U4.1 + U4.2 | Picks weakest skill, populates existing `PinnedCardContent.topicFocus` slot | Pending Q2 decision (LO tagging confirmation) | Cheap once Q2 lands (~5h work) |
| [#1956](https://github.com/WANDERCOLTD/HF/issues/1956) — `silentMode` knob | U1.3 | Removes "this is a test" announcement from baseline | Pending Q3 decision (seed default) | <0.5 day work — first to ship per #1960 build sequence |

**Sequence** per partner-response §5: `#1956 (silentMode) → #1953 (completion gate) → #1954 (lesson-plan trigger) → #1955 (focus pin)`.

## B. Phase-2 carve-outs (deliberately deferred — do NOT expect on pre-voice DEV)

Carved out per partner response §3 on Boaz's own evaluation rules (behaviour-first; score impact + effort separately).

| Item | Boaz row | Reason for Phase-2 | Plan when Phase-2 starts |
|---|---|---|---|
| Part 2 multi-card loop orchestrator | U3.1 | Single-card v1 tests behaviours; loop adds 8 dev-days for session-length differences only | New epic post-Phase-1 |
| Per-card prep minute | U3.2 | Single card has one prep minute = unit test of behaviour | Folds into multi-card loop epic |
| Per-segment Part 2 scoring | U3.3 | Single-card aggregate ships; per-segment infra is Phase-2 piece | Connects to Theme 6 (`CallScore.segmentKey`) |
| 30-sec continuous talk-cap prompt | U2.2 | Boaz rated "n/s blocker" — examiner fidelity polish | Polish list / not pre-voice |
| % session talk-time post-analysis | U2.3 | Boaz rated Low/No-blocker; tutor-side already shipped via Theme 7 (#1747) | Theme 7 partial covers tutor side; learner side parked |
| Friendly part labels on results | U5.3 | Polish, Boaz rated Low/Low/No-blocker | Polish list |

## C. Open partner decisions (block 2 of the 4 stories)

| Q | Story | Decision | Recommendation | Blocking? |
|---|---|---|---|---|
| Q1 | #1954 | Toggle scope: ASSESSMENT-only / every session / per-module configurable? | Per-module G8 toggle, default ON for ASSESSMENT | Soft-blocker (the recommendation can ship without it; toggle just adds operator control) |
| Q2 | #1955 | Are Part 3 LOs tagged with skill `parameterId`? | Confirm tagging OR commit to +2h tagging chore before #1955 starts | Hard-blocker (without tagging, `deriveFocusArea` can't resolve "weakest skill for this module") |
| Q3 | #1956 | Ship IELTS baseline_assessment with `silentMode: true` seed default? | YES — Boaz's brief makes IELTS intent explicit | Soft-blocker (knob ships defaulted `false` if no answer; ops change later is one DB write) |

## D. Theme-by-theme remaining work (the original 13 themes)

Each theme references how many gap items it closes. Status updated post-2026-06-18.

| # | Theme | Approx size | Status | Notes |
|---|---|---|---|---|
| 1 | Module-scoped settings layer (G8 group + `AuthoredModule.settings` registry extension) | 1 day | PARTIAL — G7/G8 groups exist; several Inspector rows wired (welcomeMessage, instructions, cue card, orientation, closing). Continues per #1700 epic. | Many gap items cascade through this theme; the most "leverage" piece. |
| 2 | Time-based tutor/examiner cue scheduling + stall detector | ~60 lines client | PARTIAL — Part 2 cues + stall detector live (#1742 + #1743). Part 3 stall + scaffolds pending. Re-speak sub-phase pending. | Phase-1 scope mostly shipped; Phase-2 (server-side provider directives) deferred. |
| 3 | Pinned chat card primitive (`<PinnedCardSlot>` above SimChat) | ~30 lines | SET — slot exists, populated by Session.metadata.pinnedCard; `kind: "cueCard" | "topicFocus"` already in type. | Available for #1955 to use without type work. |
| 4 | Mock dual-waveform exam-mode shell | ~80 lines | SHIPPED — `ExamModeShell` + `DualWaveform` (#1745). | Mock UI complete. |
| 5 | Module unlock gates | ~50 lines + migration | SHIPPED — `LOCKED` enum + count-based prerequisites (#1746). | OPERATOR bypass live. |
| 6 | Per-part Mock scoring (`CallScore.segmentKey`) | ~40 lines + migration | PARTIAL — Mock single-pass scoring live; per-part scoring (P1/P2/P3 within one session) is Phase-2. | Connects to sub-phases (Theme 1 + new). |
| 7 | Tutor talk-time stats (post-call telemetry) | ~30 lines | SHIPPED #1747 — tutor side. Learner-side (% session talk-time) parked per partner pushback. | Theme is "done" for the pre-voice bar; runtime intervention deferred. |
| 8 | Question count targets per module | ~50 lines | SHIPPED #1748 — counter live. EXTRACT counts interrogatives. | The min-10 / target-13 knob is now Inspector-tunable. |
| 9 | Incomplete-attempt counter on `CallerModuleProgress` | ~25 lines + migration | SHIPPED — `incompleteAttempts INT` column + sticky-waiver guard (#1703 chokepoint). | The bigger #1953 gate sits on top of this. |
| 10 | IELTS profile capture via typed CallerAttribute keys | ~30 lines | SHIPPED #1850 — `profile:reason`, `profile:targetBand`, `profile:timeline`, `profile:selfLevel` (#1961 P3g closeout). | Theme 10 complete. |
| 11 | Per-session score-delta narrator | ~40 lines | SHIPPED #1951 — SEMANTICS render block (#1979). | Delta visible on results + AttainmentTab. |
| 12 | Tester direct-link + fresh/returning toggle | ~60 lines | SHIPPED #1812 + #1750 + `cloneDemoCaller`. | Cross-cutting B done. |
| 13 | Results screen + permanent archive + email | ~80 lines screen + email infra | PARTIAL — Results screen + route shipped (#1751). Email infra not in pre-voice scope. | Email infra is post-voice (Phase 2+). |

## E. What's currently unaddressed (no plan, no story yet)

These items appear in the original 447-line gap doc but have no in-flight story AND no carve-out commitment:

| Item | Where | Reason no plan yet |
|---|---|---|
| Email of results to learner | Cross-cutting | Email infra is post-voice; not pre-voice scope per #1960 |
| Snapshot v3 cue-card replay UI | Theme 11 + Theme 3 | Awaiting customer signal; not blocking |
| Voice-side barge-in suppression (Part 3 "doesn't interrupt") | Theme 2 server-side | VAPI `endpointing` config knob — operator-facing tuning lives in Voice tab; we don't auto-apply per playbook today |
| Per-LO mastery surface for educator (not learner) | Across | AttainmentTab covers the operator path; educator-facing learner journey panel is parked |
| Tester "audit run" with all 5 modules in sequence | Cross-cutting D | Not a Boaz/Eldar ask; internal-QA wishlist |

## F. Recently filed parallel epics (related, larger scope)

These are not on the IELTS-pre-voice critical path but adjacent and worth knowing about:

| # | Title | Why it's adjacent |
|---|---|---|
| [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) | Pipeline Measurement Coverage (M1-M4 closed; 34 deferred-#1967 await pedagogy review) | The IELTS skill measurement chain rides on this — system-level for now, per-playbook in epic #2020 |
| [#2009](https://github.com/WANDERCOLTD/HF/issues/2009) | CIO/CTO trio variant mechanics (`quiz` + `mock-exam` wire-up) | The mode-literal extension pattern; Mock uses the same `examiner` mode IELTS does |
| [#2020](https://github.com/WANDERCOLTD/HF/issues/2020) | Per-playbook MEASURE specs (AnalysisSpec scope) — Lattice extension | Unblocks IELTS-specific Band 1-9 scoring (currently hardcoded in `build-per-segment-measure-prompt.ts`) |
| [#2021](https://github.com/WANDERCOLTD/HF/issues/2021) | Backfill CIO/CTO Revision Aid `config.modules` on hf_staging | Demo-prep; separate from IELTS |

---

# Quick-reference index of all DEV URLs

| Target | URL |
|---|---|
| Login | <https://dev.humanfirstfoundation.com/login> |
| Tester workbench | <https://dev.humanfirstfoundation.com/x/test> |
| IELTS course detail | <https://dev.humanfirstfoundation.com/x/courses/cbca5851-9bcc-49b0-a954-20ec150492bd> |
| IELTS journey tab | <https://dev.humanfirstfoundation.com/x/courses/cbca5851-9bcc-49b0-a954-20ec150492bd/journey> |
| Caller index | <https://dev.humanfirstfoundation.com/x/callers> |
| Course catalogue | <https://dev.humanfirstfoundation.com/x/courses> |
| Sim entry (per caller) | `https://dev.humanfirstfoundation.com/x/sim/<CALLER_ID>` |
| Per-caller home | `https://dev.humanfirstfoundation.com/x/callers/<CALLER_ID>` |
| Per-session results | `https://dev.humanfirstfoundation.com/x/callers/<CALLER_ID>/result/<SESSION_ID>` |
| API: session results | `https://dev.humanfirstfoundation.com/api/sessions/<SESSION_ID>/results` |
| API: db-target sanity | <https://dev.humanfirstfoundation.com/api/system/db-target> |
| API: readiness sanity | <https://dev.humanfirstfoundation.com/api/system/readiness> |
| Partner response doc (GitHub) | <https://github.com/WANDERCOLTD/HF/blob/main/docs/draft-issues/ielts-pre-voice-gap-analysis-response-2026-06-18.md> |
| Original gap doc (GitHub) | <https://github.com/WANDERCOLTD/HF/blob/main/docs/draft-issues/ielts-pre-voice-gap-analysis.md> |

---

# What we want from testers after running this script

1. **Mark each Part 1 row green/red** with the URL you actually tested. The numbered IDs (1.1, 2.3, etc.) are stable for issue references.
2. **Confirm Part 2 absences** — items in §A should NOT yet be testable. Any false positive is a surprise worth flagging.
3. **Answer the §C decisions** (Q1, Q2, Q3) — these gate #1955 and #1956.
4. **Surprise items** — if you find a behaviour we haven't catalogued (good or bad), file as a comment on the partner-response doc OR a fresh issue with the matching Unit + item ID.

---

# Rollback paths (operator emergency tools)

```bash
# DB pivot — revert DEV to sandbox if staging behaves badly
gcloud run services update hf-admin-dev --region=europe-west2 --project=hf-admin-prod \
  --update-secrets="DATABASE_URL=DATABASE_URL_SANDBOX:latest"

# Re-publish a DRAFT playbook (if you want to test variants)
COOKIES=/tmp/hf-cookies.txt
curl -sS -b $COOKIES -X PATCH "https://dev.humanfirstfoundation.com/api/playbooks/<id>" \
  -H "Content-Type: application/json" -d '{"status":"PUBLISHED"}'

# Re-seed SUPERADMINs (idempotent) — see CLAUDE.md "You CAN hit authenticated API routes"
```

---

*Generated 2026-06-19 by the LastParms session, post DEV pivot. State reflects hf_staging at write-time. Re-probe if more than 24h has passed.*

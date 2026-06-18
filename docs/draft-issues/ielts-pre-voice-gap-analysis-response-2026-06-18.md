# IELTS Pre-Voice Gap Analysis — Response to Boaz + Eldar

**Date:** 2026-06-18
**Author:** Paul (with Claude orchestration: Lattice survey × 4, BA grooming, Tech-Lead review)
**Responds to:** [`ielts-pre-voice-gap-analysis-boaz-eldar-2026-06-16.md`](./ielts-pre-voice-gap-analysis-boaz-eldar-2026-06-16.md) (Boaz + Eldar, 2026-06-16, branch `docs/ielts-gap-analysis-boaz-eldar`)
**Status:** Decisions taken pending partner review. Open Qs flagged inline. Built without prejudice to Boaz/Eldar's "behaviour-first" bar.

---

## How to read this

Boaz/Eldar listed 11 blocking + 4 non-blocking + 3 corrections + 2 cross-cutting + 2 build-risk + 3 unverified gaps. I cross-checked each row against the last 72 hours of commits, ran a Lattice survey on the genuinely-open blockers, groomed 4 stories with BA, and had Tech Lead validate each before any code lands. This doc records:

1. What's already closed (with commit citations — Boaz asked Paul to verify against `main`, not pre-emptively strike rows)
2. The 4 blockers we're building, with story links and TL revisions
3. Phasing pushbacks for items that look over-spec'd vs the pre-voice bar
4. Open decisions for partner discussion
5. Build sequence

Boaz's evaluation rules (score impact + effort separately, blocker tag independent of effort, presence ≠ influence, behaviour-first) carry into this response. Every "shipped" claim cites a commit so you can run the behaviour check.

---

## 1. Rows we can close

These were "missing" in the 2026-06-16 snapshot but landed in the 72-hour window. Boaz's reconciliation note says: *"Anything already closed recently should be struck by Paul during verification."* Striking now.

| Boaz row | Status | Evidence |
|---|---|---|
| Unit 2 #1 — question count minimum (10) | ✅ Shipped | `#1748` question-count counter — `81fe52b2` |
| Unit 5 #1 — Exam shell (dual waveform, hidden timers) | ✅ Shipped | `#1745 Theme 4` — `71fb087a` (shell) + `b56137e3` (sim-page mount) |
| Unit 5 #2 — Unlock gates (Assessment + 2 P1 + 2 P3) | ✅ Shipped | `#1746 Theme 5` — `0d8a0de3` + `9f7b817f` (count-based, role-aware) |
| Unit 5 #4 — Persisted-band writer | ✅ Shipped | `#1823` canonical `Session.metadata.overallBand` write — `64f41a6c` |
| Cross-cutting B — Tester workbench | ✅ Shipped | `#1812` tester index (`067952f3`) + `#1750` direct-link (`419d42df`) + `cloneDemoCaller` (`180d5da0`) |
| Part 2 build #2 — Timed voice lines spike | ✅ Shipped | `#1742` sayMessage (`9fbc7580`) + `#1743` cue wiring + stall detector (`fefe6a09`) + ADR (`e9e5ebc6`) |

**Boaz/Eldar's three corrections also confirmed live** — do not rebuild:
- Unit 4 — weakest-skill rail exists, three transforms (`modules.ts`, `retrieval-practice.ts`, `progress-narrative.ts`) consume the per-LO mastery map at compose time
- Unit 5 — overall band computed live in results route; persisted writer now also live (#1823)
- Unit 5 — Results screen and route exist (#1751 `7f3c2370` + `1a119d91`)
- Unit 5 — no spoken band needed

---

## 2. The 4 blockers we're building

Boaz left 5 blockers unaddressed after 72h. The largest (Part 2 multi-card loop) is phased separately (§3). The remaining 4 are groomed and TL-reviewed:

| # | GH | Boaz refs | Effort | Cross-story dep |
|---|---|---|---|---|
| 1 | [`#1953`](https://github.com/WANDERCOLTD/HF/issues/1953) — Four-criteria IELTS completion gate | Unit 1.2 + Unit 5 + Cross-cutting A (the leverage row) | ~1d | none (ship first) |
| 2 | [`#1954`](https://github.com/WANDERCOLTD/HF/issues/1954) — Post-Assessment lesson-plan trigger | Unit 1.1 + Unit 2.4 (TBD) | ~1d | shares AGGREGATE stage with #1953 |
| 3 | [`#1955`](https://github.com/WANDERCOLTD/HF/issues/1955) — Part 3 focus selector + on-screen pin | Unit 4.1 + Unit 4.2 | **~5h** | LO-tagging confirm |
| 4 | [`#1956`](https://github.com/WANDERCOLTD/HF/issues/1956) — silentMode knob | Unit 1.3 | <0.5d | none |

**Total engineering:** ~3 dev-days for all four.

### Material TL revisions (vs the Lattice survey first-cut)

- **Story #1954 — trigger site changed from `endSession` to post-AGGREGATE.** TL caught a race: `endSession` fires the pipeline async, so `Session.metadata.overallBand` would always read null on first pass. New plan: fire from `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.AGGREGATE` AFTER `writeOverallBand()`. Stories #1953 + #1954 now share one integration point.
- **Story #1954 — toggle moved out of G7.** G7 is "Scoring and sequencing"; lesson-plan toggle is feedback-behaviour. Module-scoped G8 toggle proposed (see Open Q1).
- **Story #1955 — even cheaper than spec'd.** TL discovered `PinnedCardContent.kind: "cueCard" | "topicFocus"` and `focusArea?: string` **already exist on `main`** at `lib/types/json-fields.ts:1102-1112`. No type work; story just populates the existing shape. Slot is generic — no collision with Part 2 cue card.
- **Story #1956 — ordering pin required.** `silentMode` must short-circuit `computePreamble` BEFORE the `firstCallMode === "baseline_assessment"` branch — otherwise both branches partially execute. Vitest pins the interaction.
- **Story #1953 — `courseStyle` threaded explicitly.** `markModuleIncomplete` has a default-deny guard (#1252). Pipeline threads `ctx.playbook.courseStyle` — continuous-mode courses get the no-op AppLog.

### UI required per blocker (for partner sign-off)

| Story | Course-setup UI (operator) | Learner UI |
|---|---|---|
| **#1953** completion gate | Read-only info chip on Module Inspector: "Completion: 4 IELTS skills (FC, LR, GRA, P) scored non-zero" | AttainmentTab (#1887) — "Complete ✓/✗" column with hover showing missing criterion. Mock/Assessment learner-home card: "Complete" or "Incomplete — one criterion missing" badge |
| **#1954** lesson-plan trigger | New G8 module toggle "Generate next-step plan on completion" (default ON for ASSESSMENT-kind, OFF others) | "Your next steps" panel appended to existing Results screen (#1751) |
| **#1955** Part 3 focus | G8 toggle "Pin today's focus area" (default ON for Part-3 modules). Inspector chip showing last selection ("Lexical Resource, band 5.5") for educator visibility | Banner top-of-screen during Part 3 via reused `PinnedCardSlot`: 🎯 Today's focus: **Lexical Resource** |
| **#1956** silentMode | New 7th G8 toggle "Conversational mode" with educator helpText *"Tutor doesn't announce 'this is a test' or phase breaks; runs as conversation"* | Invisible (changes tutor opener wording only) |

---

## 3. Phasing pushbacks for Market Test

Three categories. Frame each in Boaz/Eldar's own evaluation rules so the bar stays consistent.

### A) Part 2 multi-card loop — phase to single-card v1 (saves 8 dev-days)

Lattice survey: the loop is **65% existing infra, 35% net-new**. Theme 3 pinned-card writer (`d1cc2eeb`), Theme 2a cue-scheduler (`9fbc7580`), Theme 2b stall detector (`fefe6a09`) — all live. What's missing is the loop *orchestrator* (state machine for `prep → monologue → feedback → cardDecision`) and per-card segmented scoring.

**Pushback:** Single-card v1 (~5d) tests every Part 2 *behaviour* Market Test needs to verify pre-voice — cue card displayed, learner monologues 2+ min, tutor gives feedback, scoring aggregated. The loop changes session *length*, not *behaviour shape*. Multi-card to Phase 2 (+8d) with explicit gap doc.

Specific carve-outs:
- Boaz Unit 3 #1 (loop) → Phase 2
- Boaz Unit 3 #2 (per-card prep minute) → Phase 2 (single-card gets one prep minute, which IS the unit-test of the behaviour)
- Boaz Unit 3 #3 (aggregated score) → ships as-is for single card; per-segment scoring infra is the Phase-2 piece
- Boaz Unit 3 #4 (2-min completion) → ships for single card via existing `minSpeakingSec` mechanism (Theme 9 #1703)

### B) Boaz's own non-blockers — restate so they don't drift back in

| Item | Boaz's own score | Pushback |
|---|---|---|
| Unit 2 #2 — 30-sec continuous talk cap rule in prompt | "n/s blocker" — examiner fidelity | → Phase 2 / polish list |
| Unit 2 #3 — % session talk-time post-analysis | Low / No blocker | → Phase 2; Theme 7 (#1747) covers tutor-side |
| Unit 5 #3 — friendly part labels on results | Low / Low / No blocker | → polish list, not pre-voice |
| Unit 5 #4 — persisted-band writer | Low/Med / not blocker | ✅ **Shipped #1823** — close the row |
| Unit 4 unverified items (11 IELTS skills, retrieval-practice on) | Unverified | → answered by Lattice survey: 4 IELTS skills (not 11 — that was learning outcomes); retrieval-practice flag could not be confirmed in survey |

### C) Content items are Market Test's, not engineering's

- "Cue card itself unbuilt" — **content authoring, Market Test owns**
- "Timed voice lines need spike" — ✅ engineering shipped (`#1742` + `#1743` + ADR `e9e5ebc6`)

### D) Mock unlock gates — verify the tester contract

`#1746` ships role-aware count-based prereqs (Assessment + 2 P1 + 2 P3) with OPERATOR+ bypass. For testers running pre-voice checks, confirm the bypass mechanism is the contract you want, or push the gate count down for the test window.

---

## 4. Open decisions for partner discussion

Three product/operational decisions block specific stories. Marking each with the story that depends on it.

### Q1 — `#1954` toggle scope: ASSESSMENT-only OR per-module configurable?

**Recommendation:** Module-scoped G8 toggle "Generate next-step plan on completion", default ON for ASSESSMENT-kind modules, OFF for others. Trade-off table:

| Option | Fires on | Cost | Trade-off |
|---|---|---|---|
| A — ASSESSMENT-only (narrowest) | baseline_assessment + Mock | Cheapest. Hardcoded | After 8 Part 1 sessions, learner sees no plan refresh. Silent rail still adapts — but learner doesn't *see* the adaptation |
| B — Every learning session (broadest) | Every VOICE_CALL kind ending | One LLM call per session. More log volume | Plan can flip-flop session-to-session. Visible noise |
| **C — Per-module toggle (recommended)** | Educator opts in per module | One toggle per module | Default behaves as A; Part 1 / Part 3 fire are one-click UI changes later, no engineering |

**Why C:** answers Boaz's Unit 2.4 TBD as "configurable, off by default" rather than "we decided". Zero engineering cost to add Part 1 in Phase 2 — just flip a toggle.

### Q2 — `#1955` pre-build gate: are Part 3 LOs already tagged with skill `parameterId`?

Lattice survey **refuted** Boaz's "11 IELTS skills wired as LOs" assumption — actual count is 4 IELTS skill parameters (the 11 was learning outcomes). For `deriveFocusArea` to resolve "weakest skill for this module", Part 3 LOs must be tagged with the four skill parameterIds (`skill_fluency_and_coherence_fc`, `skill_lexical_resource_lr`, `skill_grammatical_range_and_accuracy_gra`, `skill_pronunciation_p`).

**Decision needed:** confirm tagging is in place — OR commit to a separate tagging chore (+~2h) before Story #1955 starts. Story should not begin without this resolved.

### Q3 — `#1956` seed default: ship IELTS baseline_assessment with `silentMode: true`?

Boaz's text "Don't make it feel like a test" implies yes — but the knob is module-scoped and could be educator-flippable later. Either:

- **Yes** → update `prisma/seed-ielts-course.ts` so IELTS Assessment ships silent by default. Other courses default `false`.
- **No** → ship the knob defaulted `false`; require educators to turn it on per module.

**Recommendation:** Yes. Boaz's brief makes the IELTS intent explicit; defaulting `false` would mean shipping a knob nobody flips.

---

## 5. Build sequence

```
1. #1956 silentMode (<0.5d, no deps, smallest, safest) — also resolves Q3
2. #1953 completion gate (cross-cutting leverage, infra for #1954)
3. #1954 lesson-plan trigger (depends on #1953's AGGREGATE integration)
4. #1955 Part 3 focus (after Q2 LO-tagging confirmed)
```

Then re-bar pre-voice testing against the closed-and-built combined set. Phase-2 work (Part 2 multi-card loop + Boaz non-blockers + polish items) waits behind the pre-voice gate.

---

## 6. What we want from Boaz + Eldar

Three asks (in order of urgency):

1. **Verify §1 (closed rows).** Boaz's reconciliation note says rebuilds should be struck by behaviour check, not pre-emptively. Run the behaviour checks for the 6 rows we claim are shipped — flag any false positives.
2. **Sign off or push back on §3 (phasing).** Particularly the Part 2 single-card v1 phasing — does the proposed v1 test the behaviours you need pre-voice, or are we losing essential coverage?
3. **Answer §4 (open decisions Q1, Q2, Q3).** Q2 is the hardest blocker — it gates #1955.

We'll start building #1956 once Q3 is answered, and #1953 + #1954 in parallel. #1955 holds until Q2 confirmed.

---

*Sources for §1 commit claims: `git log --since="2026-06-15" --until="2026-06-18"`. Lattice surveys at `tasks/a{1612aac2c483b2af,52d44c63a20e7770,b64b4e4b44e41c06,444b91173bf551e4}.output` (transient). BA stories #1953-#1956. TL review comment on each.*

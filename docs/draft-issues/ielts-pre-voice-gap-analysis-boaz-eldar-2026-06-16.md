# IELTS Pre-Voice Gap Analysis (Boaz + Eldar)

**Date:** 2026-06-16
**Authors:** Boaz, Eldar
**For:** Paul (to verify against `main`)
**Status:** Faithful snapshot of our current position. Not re-verified against `main`.

---

## How to read this

This document lists the gaps Boaz and Eldar identified working through the brief unit by unit, plus the decisions that reshaped scope along the way. It is deliberately a **faithful snapshot**, not a code audit. Some gaps below may already be closed by commits landed recently. Verifying each against `main` is the next step, and it is Paul's: this document exists so he has our position to check against.

Every gap is written in the **output / consumer / visible-behaviour-change** form (see rule 4). Impact and effort are scored separately. "Blocks the unit?" is set independently of effort.

Where Boaz and Eldar did not score a field, it is marked `n/s` (not scored) rather than guessed.

---

## Evaluation rules (the bar Paul should hold us and the code to)

1. Score every gap on two separate axes, impact and effort. Effort never lowers impact. A cheap fix can still be a blocker.
2. Tag each gap "blocks the unit" or "does not block the unit", set independently of effort. Anything that is a defined unit output is a blocker regardless of build cost.
3. Reject the bar "a tester can read it in admin." Reading a value proves nothing about whether it does its job.
4. **Presence is not influence.** Each acceptance check names three things: the output, what consumes it, and the visible change in behaviour when that output changes. Sign it off only once you have seen the output change the thing it is meant to change.

**Meta-pattern to carry into verification:** validate behaviour-first, not file-first. Do not accept "file X is absent" as proof a capability is missing until the behaviour is checked. This already bit us twice (Part 3 focus, Mock overall band), where a capability was delivered another way.

---

## At a glance

| Bucket | Count | Notes |
|---|---|---|
| **Blocking gaps** | 11 | Defined unit outputs not delivered |
| **Non-blocking gaps** | 4 | Real, but do not stop the unit working |
| **Corrections (thought-missing, actually present)** | 3 | Do not rebuild. Verify behaviour-first |
| **Cross-cutting gaps** | 2 | Recur in every unit; both unowned |
| **Build and risk items (not decisions)** | 2 | Part 2 cue card, timed voice lines |
| **Unverified (confirm during checks)** | 3 | Part 1 plan trigger, 2 Part 3 config questions |

---

## Shared specs (apply across units)

**Completion is measured by learner speaking time, not wall-clock.**

| Unit | Speaking-time floor |
|---|---|
| Assessment | 6 min |
| Part 1 | 10 min |
| Part 2 | 2 min (one full monologue) marks complete and scorable |
| Part 3 | 7 min |
| Mock | full run |

---

## Unit 1 — Assessment

Paul aligned on structure. Three required outputs are missing. All are cheap to build and all are blockers.

| # | Gap | Acceptance (output, consumer, visible change) | Impact | Effort | Blocks? |
|---|---|---|---|---|---|
| 1 | Post-Assessment study plan not generated (trigger not wired) | Output: a next-step direction produced when the Assessment completes. Consumer: the next session's prompt (what the tutor works on next). Visible change: a weak-grammar learner and a weak-vocabulary learner get a different next-session focus. | High | Low | Yes |
| 2 | Four-criteria completion gate absent | Output: a completion flag set only when all four criteria carry a score (none null or zero). Consumer: the session-complete / scorable state. Visible change: a session missing any criterion score does not mark complete. | High | Low | Yes |
| 3 | "Don't make it feel like a test" not built | Output: the prompt instruction that makes Part B run as conversation, with no announced test and no phase-break announcement. Consumer: the examiner/tutor prompt at Assessment. Visible change: the opening reads as a conversation, not "this is a test". | High | Low | Yes |

---

## Unit 2 — Part 1

| # | Gap | Acceptance (output, consumer, visible change) | Impact | Effort | Blocks? |
|---|---|---|---|---|---|
| 1 | Question count minimum (10) not enforced | Output: a count of tutor questions, target 10 or more. Consumer: the unit's completion / quality check. Visible change: the count is owned and acted on, not silently dropped. | n/s | n/s | No |
| 2 | 30-second continuous talk cap (rule) | Output: the 30s continuous cap written into the generated prompt. Consumer: tutor behaviour in-session. Visible change: the cap appears in the next generated prompt and the tutor stays within it. | Examiner fidelity | n/s | n/s |
| 3 | Percentage-of-session talk-time limit (measurement) | Output: a post-session talk-time percentage. Consumer: post-session analysis, not live behaviour. Visible change: the figure appears in post-session analysis. | Low | n/s | No |
| 4 | Plan update after Part 1 (unverified) | Output: an updated direction after a Part 1 session. Consumer: the next session's focus. Visible change: the next session shifts after Part 1, not only after Assessment and Mock. | n/s | n/s | TBD |

**Note on #1:** not a blocker, but it must be written into the spec so it is owned. Risk is that it gets dropped, not that it stops the unit.
**Note on #4:** suspected that the trigger only fires after Assessment and Mock. Confirm during checks before scoring blocks.

---

## Unit 3 — Part 2

**Major scoping correction.** The earlier checklist assumed one cue card per session. The real design is a multi-card loop: tutor opens and explains, cue card shown, learner talks about 2 minutes, tutor gives feedback and asks for a shorter targeted redo on the same card (not the full 2 minutes again), then a new cue card, same session, repeating to fill a reasonable session length (about 15 minutes). One card plus a quick redo ending in about 4 minutes is too short.

| # | Gap | Acceptance (output, consumer, visible change) | Impact | Effort | Blocks? |
|---|---|---|---|---|---|
| 1 | Multi-card loop (new work) | Output: a session that loops cue card, monologue, feedback, targeted redo, new card. Consumer: the Part 2 session controller. Visible change: the session presents more than one cue card and a redo after each monologue. The existing cue-card pool pins one card only today. | High | High | Yes |
| 2 | Per-card prep minute with the three prompts | Output: a fresh prep minute per card showing topic prompt, past/present/future guiding questions, and the note-taking line. Consumer: the prep phase before each monologue. Visible change: every card, not just the first, gets the prep minute and all three prompts. | High | n/s | Yes |
| 3 | One aggregated Part 2 score per session | Output: a single Part 2 score aggregating all monologues. Consumer: scoring / results. Visible change: one Part 2 score for the session regardless of card count, not one per card. | High | n/s | Yes |
| 4 | Completion at 2 min of learner speech | Output: a completion flag at 2 minutes or more of learner speech (one full monologue). Consumer: the complete / scorable state. Visible change: the session becomes scorable once the 2-minute monologue is reached. | High | n/s | Yes |

**Note:** the note-taking line is an on-screen visual cue telling the learner to jot 3 one-word bullets on their own paper. The system captures nothing.
**The redo is in scope.** This resolved the earlier "re-speak in or out" question.

**Build and risk items (not decisions, do not score as gaps):**
- The cue card itself is still unbuilt.
- The timed voice lines need Paul's day-one spike.

---

## Unit 4 — Part 3

**Reframe.** The focus signal largely exists. The composer injects the weakest skill from the last same-module session into the next prompt (IELTS-banded), and builds a per-learning-objective mastery map fed into the prompt through three transforms (modules, retrieval-practice, progress-narrative). So per-skill mastery and a retention-oriented retrieval-practice signal already reach the next prompt. Part 3 focus is therefore a **selection-and-pin job on top of an existing rail, not a build from zero.**

| # | Gap | Acceptance (output, consumer, visible change) | Impact | Effort | Blocks? |
|---|---|---|---|---|---|
| 1 | Part 3-specific focus selector | Output: one chosen development area set as the session focus. Consumer: the Part 3 prompt. Visible change: run as weak-grammar then weak-fluency, the Part 3 questions shift toward the weak area. | Med/High | Low | Yes |
| 2 | On-screen focus pin | Output: the chosen focus shown on screen. Consumer: the learner UI. Visible change: the focus area is visible during Part 3. | Med | Low | Yes |

**Unverified (confirm during checks or by reading the IELTS course config):**
- Whether the 11 IELTS skills are wired as the learning objectives that populate the mastery map.
- Whether retrieval-practice is switched on for the IELTS course.

---

## Unit 5 — Mock

**Corrections first (thought-missing, actually present). Do not rebuild. Verify behaviour-first.**
- **Overall band is produced.** The results route computes it live from the per-part scores when it is not stored, so the learner sees a band today. Only the persisted-band writer is missing, and that matters for a saved record and a results email, not for the on-screen number.
- **Results screen is part-built.** The backend route and page exist and also compute the learner's strength and weakest area live. Not "filed, not started".
- **No spoken band needed.** Delivery is text on the results screen. The examiner does not speak the band aloud.

| # | Gap | Acceptance (output, consumer, visible change) | Impact | Effort | Blocks? |
|---|---|---|---|---|---|
| 1 | Exam shell (dual waveform, hidden timers) | Output: a clean exam screen, speaking visual only, hidden timers. Consumer: the Mock run UI. Visible change: no clock, scores, or coaching on screen, except what the exam itself requires (the Part 2 cue card appears in Part 2). | High | n/s | Yes |
| 2 | Unlock gates | Output: the Mock locked until Assessment plus 2 Part 1 plus 2 Part 3 are complete. Consumer: Mock entry. Visible change: the Mock is unavailable until prerequisites are met, available after. | High | n/s | Yes |
| 3 | Results part labels are machine keys | Output: friendly part labels on the results screen. Consumer: the results screen. Visible change: labels read "Part 1 / 2 / 3", not internal keys. | Low | Low | No |
| 4 | Persisted-band writer | Output: the overall band written to a saved record. Consumer: the saved record and results email. Visible change: the band survives in the record and the email, not just on the live screen. | Low/Med | n/s | No |

**Decisions banked in this unit:**
- The Mock is the exception to student autonomy: it locks until Assessment plus 2 Part 1 plus 2 Part 3 are complete (gap #2).
- The exam screen is clean (no clock, no scores, no coaching, just the speaking visual), except for whatever the exam itself requires.

The four-criteria completion gate also bites here. It is tracked once, under cross-cutting.

---

## Cross-cutting gaps (recur in every unit, both unowned)

| # | Gap | Acceptance (output, consumer, visible change) | Impact | Blocks? |
|---|---|---|---|---|
| A | Four-criteria completion gate (no story, unowned) | Output: a completion flag set only when all four criteria carry a non-null, non-zero score. Consumer: the complete / scorable state in every scoring unit. Visible change: a session missing any criterion score does not mark complete or scorable. | High | Yes, every scoring unit |
| B | Tester workbench (unowned) | Output: each unit openable from its own direct link, runnable in any order, with a per-run choice of "start fresh as new learner" or "continue as returning learner" available on every run, and a post-run review of transcript, scores, profile, and plan. Consumer: the test process itself. Visible change: a tester can run any unit cleanly and review the result. | High | Yes, blocks testing at all |

---

## Reconciliation note

- **Corrections (Unit 4 focus rail, Unit 5 band, results screen, spoken band)** are "thought-missing, actually present". They are here so Paul does not rebuild them. Verify behaviour-first, do not file build stories.
- **Two Part 2 items (cue card, timed voice lines)** are build and risk items, not decisions. They carry no decision to bank; they need building and a spike.
- **Four-criteria completion gate and tester workbench** are cross-cutting and unowned. Each needs an owner before the units that depend on it can be signed off.
- **Faithfulness:** this is our position as Boaz and Eldar captured it. It is not re-checked against `main`. Anything already closed recently should be struck by Paul during verification, not pre-emptively here.
- **Out of scope:** the hands-on system check is not covered here; this is the pre-check position.

---

*Sources: HF-IELTS carry-forward brief, section 5 and the locked rules; the pre-voice testing checklist (source of truth, referenced not re-read). Format borrowed from Paul's 2026-06-16 gap-analysis progress doc; content is Boaz and Eldar's, not carried from Paul's doc.*

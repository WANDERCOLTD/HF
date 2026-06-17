# IELTS Speaking — Part 2 Stall Scaffolds (Monologue)

**Source:** HF-authored (Paul Wander, 2026-06-17). Not derived from any external source. Operator content.
**Module:** `part2` (Cue Card Monologues).
**Setting:** `moduleScaffoldPool`.
**Status:** Initial pool — calibrate against real Part 2 sessions.

## Purpose

Part 2 is the only part of IELTS Speaking where the student speaks continuously for up to two minutes from a cue card. The tutor is in examiner mode throughout the monologue: no correction, no coaching, no interruption.

When the student stalls (silence > `stall_silence_threshold_seconds`, default 10s), the tutor delivers a single, short, non-disruptive nudge that respects examiner-mode silence rules. The goal is to keep the student talking without re-framing the question, supplying language, or introducing the next bullet's content.

**Constraints (per `## Stall recovery` in the course reference):**

- Maximum `max_stall_prompts_per_long_turn` (default 2) prompts per long turn.
- Second prompt fires only after `stall_silence_second_prompt_delay_seconds` (default 10s) of further silence.
- Scaffolds must be short (≤ 12 words) and must not contain the cue card's bullet content.
- Never repeat a scaffold the tutor has already used in the same long turn.

## Tagging

Each scaffold is tagged with the moment it suits:

- **early-stall** — first 10–15 s of silence; learner still composing.
- **deep-stall** — 20 s+ of silence; learner stuck mid-thought.
- **blank-out** — learner has spoken < 30 s total and now silent; risk of giving up.
- **bullet-stuck** — learner has covered one bullet and stalled before moving on.
- **explicit-stop** — learner says "I'm done" or "I can't think of anything else" before two minutes.

## Scaffold pool

1. **early-stall** — "Take another moment."
2. **early-stall** — "Take your time."
3. **early-stall** — "In your own time."
4. **early-stall** — "Whenever you're ready."
5. **deep-stall** — "Just keep going when you can."
6. **deep-stall** — "Try to keep talking — anything that comes to mind."
7. **bullet-stuck** — "What about the next bullet on the card?"
8. **bullet-stuck** — "You could move on to the next point."
9. **bullet-stuck** — "Have a look at the card if it helps."
10. **blank-out** — "Try starting with one short sentence."
11. **blank-out** — "Even one sentence is fine — then we'll continue."
12. **explicit-stop** — "Anything else you'd like to add before we move on?"
13. **explicit-stop** — "Take a moment — is there anything more to say?"
14. **early-stall** — "Mm." *(minimal back-channel; for the lightest possible nudge)*

## Calibration notes

- Prompts 1–4 are the lowest-friction openers. The tutor should pick one based on what has already been said in this drill.
- Prompts 7–9 are the only ones that reference the cue card structure. Use sparingly; if the learner is mid-bullet, redirecting them to "the next bullet" is disruptive.
- Prompt 12 is the only one that asks a question. It is reserved for `explicit-stop` (when the student has explicitly signalled they have finished early) — it must NOT be used as a generic stall prompt.
- Prompt 14 (minimal back-channel) is a deliberate "almost nothing" option. Use when the silence is very short and a full sentence would over-correct.

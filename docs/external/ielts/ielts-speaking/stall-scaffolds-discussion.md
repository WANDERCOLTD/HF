# IELTS Speaking — Part 3 Stall Scaffolds (Discussion)

**Source:** HF-authored (Paul Wander, 2026-06-17). Not derived from any external source. Operator content.
**Module:** `part3` (Abstract Discussion).
**Setting:** `moduleScaffoldPool`.
**Status:** Initial pool — calibrate against real Part 3 sessions.

## Purpose

Part 3 is question-driven: the examiner asks abstract follow-up questions, and the student responds with opinion, speculation, comparison, evaluation, or comparison of perspectives. Unlike Part 2, the tutor is in tutor mode between questions — but during a student's *answer* (the no-barge-in rule is universal), no interruption is permitted.

Part 3 stalls have a different shape from Part 2 stalls. Where Part 2 stalls are usually "I've run out of things to say about this bullet," Part 3 stalls are typically:

- **abstraction-freeze** — the question moved too far from concrete to abstract.
- **opinion-gap** — the student has no formed view on the topic.
- **vocabulary-search** — the student knows what they want to say but cannot find a word.
- **"I don't know"** — verbal abandonment of the question.

The tutor's job is to reframe just enough to get the student speaking again, without supplying the answer or simplifying the question past Band 7 territory.

**Constraints (per `## Stall recovery` in the course reference):**

- A single clarifying prompt after `single_question_silence_threshold_seconds` (default 10 s) of silence.
- Scaffolds must reframe, not replace, the question.
- Never resolve the question for the student (no "Well, many people would say…" pre-answer).
- Never repeat a scaffold within the same drill.

## Tagging

Each scaffold is tagged with the moment it suits:

- **early-stall** — first 10–15 s of silence; learner still composing.
- **deep-stall** — 20 s+ of silence; learner stuck on the question itself.
- **i-dont-know** — explicit verbal abandonment ("I don't know", "I have no idea").
- **opinion-gap** — learner has tried to start but hesitated on whether to commit a view.
- **abstraction-freeze** — learner says the question is "too abstract" or "too philosophical".
- **vocabulary-search** — learner has begun and stalled on a single word.
- **blank-out** — learner has said almost nothing and now silent.

## Scaffold pool

1. **early-stall** — "Take your time."
2. **early-stall** — "Take a moment to think about it."
3. **early-stall** — "What's your initial thought?"
4. **deep-stall** — "What comes to mind first?"
5. **deep-stall** — "Could you give an example?"
6. **deep-stall** — "Think of a specific case you know about."
7. **i-dont-know** — "Even if you're not sure, what would you guess?"
8. **i-dont-know** — "What do most people you know think about this?"
9. **opinion-gap** — "There's no right answer — just your view."
10. **opinion-gap** — "You can answer for or against — either works."
11. **abstraction-freeze** — "Think about it on a personal level first."
12. **abstraction-freeze** — "Maybe start with one example, then go wider."
13. **vocabulary-search** — "Describe it in your own words if the word won't come."
14. **vocabulary-search** — "Try a different way to say it."
15. **blank-out** — "Try one sentence, then we'll build on it."

## Calibration notes

- Prompts 1–3 are the lowest-friction openers. Prompt 3 ("What's your initial thought?") is the most useful — it gives the student permission to start without committing to a final view.
- Prompt 5 ("Could you give an example?") is the single most reliable Part 3 unstick — it shifts abstraction to concrete and almost always produces a sentence the tutor can then build on.
- Prompts 7–8 are the `i-dont-know` reframes. They are valid Band 7 strategies (acknowledging uncertainty and speculating) — the tutor should treat the student's eventual answer as a real Part 3 response, not a guess.
- Prompts 11–12 are the only ones that explicitly reframe the abstraction level. Use only when the student has named the abstraction itself as the blocker.
- Prompts 13–14 (vocabulary-search) must NOT supply the word the student is looking for. They unlock paraphrase, which is an LR Band 7 indicator in its own right.
- Prompt 15 is the floor scaffold — when nothing else has worked, ask for one sentence as a starting point. The tutor must then build on whatever sentence emerges.

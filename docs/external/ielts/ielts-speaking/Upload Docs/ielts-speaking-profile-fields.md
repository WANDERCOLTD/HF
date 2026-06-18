# IELTS Speaking — Profile fields to capture (Baseline Assessment)

**Source:** HF-authored (Paul Wander, 2026-06-18). Not derived from any external source. Operator content.
**Module:** `baseline` (Baseline Assessment).
**Setting:** `moduleProfileFieldsToCapture`.
**Status:** Initial set — calibrate against real Baseline sessions.

## Purpose

During the Baseline Assessment, the tutor weaves four short conversational profile questions into the warm-up. The answers are extracted by `lib/pipeline/extract-profile-fields.ts` and written to `CallerAttribute` rows under the course-agnostic `profile:*` namespace. They drive downstream personalisation (`profile:reason` → motivational hooks; `profile:targetBand` → stretch-band threshold; `profile:timeline` → urgency framing; `profile:selfLevel` → calibration of the very first question's difficulty).

**Constraints (per `## Profile capture` in the course reference):**

- Each field MUST be asked verbatim in the warm-up before the first Part 1 question is delivered.
- Each field has a single coercion type — `text`, `number`, or `band`. A `band` value must be a half-band between 1.0 and 9.0.
- The tutor never re-prompts a field mid-session; if the learner doesn't answer, the field is silently dropped.

## Fields

### Field 1 — reason

- **key:** `profile:reason`
- **type:** text
- **prompt:** What's bringing you to IELTS Speaking? Work, study, immigration, something else?

### Field 2 — targetBand

- **key:** `profile:targetBand`
- **type:** band
- **prompt:** What band score are you aiming for?

### Field 3 — timeline

- **key:** `profile:timeline`
- **type:** text
- **prompt:** When do you need this by? A rough month is fine.

### Field 4 — selfLevel

- **key:** `profile:selfLevel`
- **type:** text
- **prompt:** Where do you feel you are right now — beginner, intermediate, advanced?

## Ordering

The tutor asks the fields in the order they appear above. The order is deliberate: motivation first (anchors the rest of the conversation), then concrete targets, then timeline pressure, then self-assessment. The tutor does NOT lead with `selfLevel` — learners under-estimate themselves when asked cold.

## Notes

- Per-key prompt phrasing in this file is the canonical wording. The composed prompt template substitutes these into the tutor system prompt verbatim — do not paraphrase at projection time.
- `profile:targetBand` is the only `band`-typed field today. The coercion validator rejects values outside 1.0–9.0 or non-half-bands (e.g. 6.3 → rejected). The tutor should re-ask if the learner gives a vague answer like "a high band".
- Future fields should be added BELOW the current four — `Field N — <key>` ordering matters for the parser's order-preserving output.

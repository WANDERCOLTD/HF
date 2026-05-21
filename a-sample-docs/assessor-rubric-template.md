<!--
HF Assessor Rubric Template — v1.0 (2026-05-21)

WHAT THIS FILE IS
The per-band descriptor reference for a skill-EMA / rubric-anchored
course (IELTS, NHS AfC, CEFR, professional certifications, etc.). Upload
this ALONGSIDE `course-ref.md` so the projection's rubric-only pass
(#564) can extract per-band descriptors and write them onto each skill
Parameter's `config.bandThresholds`.

WHAT THE PIPELINE READS FROM IT
1. Front-matter `hf-document-type: COURSE_REFERENCE_ASSESSOR_RUBRIC` →
   tells the classifier this is a rubric (excluded from goal projection
   per #447, but consumed by the rubric pass per #564).
2. `## RUB-<CODE>: <Criterion Name>` headings →
   one per skill, where <CODE> matches the (CODE) parenthetical on the
   corresponding `### SKILL-NN` heading in `course-ref.md`. E.g.:
       course-ref.md:  ### SKILL-01: Fluency & Coherence (FC)
       this file:      ## RUB-FC: Fluency and Coherence — band descriptors
   The CODE binds the rubric to the Parameter via suffix match
   (`skill_fluency_and_coherence_fc`) OR name-derived fallback
   (`skill_fluency_and_coherence`) — see PR #581.
3. `| Band | Descriptor |` tables under each RUB heading →
   one row per band. Band column accepts integers (`9`, `8`, ..., `0`)
   or decimals (`6.5`). Non-numeric keys (`A1`, `Emerging`) are NOT
   accepted today — see issue #582 for the widening story.

WHAT THE PROJECTION WRITES TO THE DB
- For each `## RUB-<CODE>:` section: `Parameter.config.bandThresholds`
  is populated with `{ "<bandNumber>": "<descriptor text>", ... }` on the
  matched skill Parameter.
- NO Goal rows are created from this file. NO BehaviorTarget rows. NO
  CurriculumModule rows. NO LearningObjective rows. (The course-ref's
  skills framework is the authoritative source for those — see #447.)

WHAT THE COMPOSED PROMPT GAINS
- `llmPrompt.behaviorTargets[].bandThresholds` carries the band ladder
  to the tutor / assessor agent at compose time (see PR #578) — the AI
  can cite "Band 5 LR: limited range of vocabulary" inline instead of
  paraphrasing.

ALLOWED-VALUES REJECTION POLICY
- Unknown values for `hf-document-type` log a warning and fall back to
  AI inference. Use the exact string `COURSE_REFERENCE_ASSESSOR_RUBRIC`.
- Tables with header rows / alignment rows / non-numeric keys are silently
  skipped — verify your tables look like the worked example below.

SEE ALSO
- `course-reference-template.md` — companion (the COURSE_REFERENCE body)
- `wizard-prompt-template.md` — the chat paste-block + file list
- `docs/CONTENT-PIPELINE.md §4` — rubric-only band-descriptor pass spec
- `apps/admin/docs-archive/bdd-specs/contracts/SKILL_MEASURE_V1.contract.json` — the contract documenting where band descriptors are stored
-->
---
hf-document-type: COURSE_REFERENCE_ASSESSOR_RUBRIC
hf-default-category: skill_framework
hf-audience: tutor-only
hf-lo-system-role: ASSESSOR_RUBRIC
---

# [example] [Course Name] — Assessor Rubric

> **Document type:** COURSE_REFERENCE_ASSESSOR_RUBRIC · **Audience:** assessor + tutor-hidden (never sent to learner) · **Format:** per-band descriptors for the criteria declared in `course-ref.md`'s Skills Framework.

---

## Criterion key

> This optional table maps numeric IDs to RUB codes for cross-reference. Useful for educators but ignored by the parser — the contract is the `(CODE)` parenthetical on each `### SKILL-NN` in `course-ref.md` matching the `RUB-<CODE>` heading below.

| # | Criterion name | RUB code | Maps to skill parameter |
|---|---|---|---|
| 1 | [example] Fluency and Coherence | FC | skill_fluency_and_coherence (or _fc suffix on legacy projection) |
| 2 | [example] Lexical Resource | LR | skill_lexical_resource |
| 3 | [example] Grammatical Range and Accuracy | GRA | skill_grammatical_range_and_accuracy |
| 4 | [example] Pronunciation | P | skill_pronunciation |

---

## RUB-FC: [example] Fluency and Coherence — band descriptors

> **MANDATORY:** This heading pattern is what the parser keys on. The format is `## RUB-<CODE>: <Name> — band descriptors` (the `— band descriptors` suffix is optional but conventional). The CODE must match the `(CODE)` parenthetical on the corresponding `### SKILL-NN` heading in `course-ref.md`.

| Band | Descriptor |
| ---- | ---------- |
| 9 | [example] Top-band descriptor. What does a Band 9 learner sound like on this criterion? Be specific — the tutor cites these strings verbatim. |
| 8 | [example] Descriptor — typically a small step down from 9. |
| 7 | [example] Descriptor — the most commonly-cited band in coaching ("you're at 6, aim for 7"). |
| 6 | [example] Descriptor. |
| 5 | [example] Descriptor. |
| 4 | [example] Descriptor. |
| 3 | [example] Descriptor. |
| 2 | [example] Descriptor. |
| 1 | [example] Descriptor — the floor. |
| 0 | [example] Descriptor — non-attempt / non-completion. |

---

## RUB-LR: [example] Lexical Resource — band descriptors

| Band | Descriptor |
| ---- | ---------- |
| 9 | [example] Wide range of vocabulary with very natural and precise use. Rare minor errors only as slips of the tongue. |
| ... | ... |
| 0 | [example] Does not attend / does not complete. |

---

## RUB-GRA: [example] Grammatical Range and Accuracy — band descriptors

| Band | Descriptor |
| ---- | ---------- |
| 9 | [example] ... |
| ... | ... |
| 0 | [example] ... |

---

## RUB-P: [example] Pronunciation — band descriptors

| Band | Descriptor |
| ---- | ---------- |
| 9 | [example] ... |
| ... | ... |
| 0 | [example] ... |

---

## Scoring rules (assessor-only — NOT projected to learner-facing surfaces)

> Free-text rules that govern how the assessor agent scores. The
> classifier extracts these as `assessment_approach` ContentAssertion
> rows that feed into the MEASURE spec at score time — they do NOT
> create Goals or BehaviorTargets.

- [example] Score each criterion separately and surface the four-number breakdown internally before averaging.
- [example] Always cite a specific descriptor phrase when justifying a score (e.g. "Band 5 — 'limited range of more complex structures'").
- [example] Audio-only criteria (Pronunciation) are skipped when the transcript is text-only — `hasLearnerEvidence: false` will be returned and the row dropped by the Boaz guard (#566).
- [example] On the first 2 calls, the running EMA is capped at 0.5 — a single perfect call can't pin a learner to Secure. See `SKILL_MEASURE_V1.contract.json::config.minCallsToFull`.

---

## Compression rules for tutor delivery (assessor → tutor framing)

> How the assessor's verdict reaches the learner via the tutor.
> Extracted as `communication_rule` assertions.

- [example] Tutor never reads a band score aloud on Call 1. The first criterion + band is introduced on Call 2 per the course-ref's Disclosure Schedule.
- [example] When citing a band, the tutor names ONE criterion at a time and ties it to a specific evidence quote from the learner's most recent turn.

---

## Verification

After upload, verify in the DB that the rubric pass ran:

```sql
SELECT "parameterId", jsonb_pretty(config)
FROM "Parameter"
WHERE "parameterId" LIKE 'skill_%'
  AND config ? 'bandThresholds';
```

Expect: 4 rows (or N — one per `### SKILL-NN` in your course-ref), each with `config.bandThresholds` containing one entry per `| <band> | <descriptor> |` row above. If any of the 4 are missing, check the wizard's Sources panel for `[apply-projection] writeBandThresholds: no skill parameter matched RUB codes [...]` warnings.

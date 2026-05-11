<!--
HF Course Reference Template — v3.0

WHAT THIS FILE IS
A canonical, fill-in-the-blanks template. Duplicate it for a new course, then
replace every `[example — replace]` and `[example]` block with your course's
content. Keep the structural markers (headings, table headers, bold labels) —
the HF extraction + wizard pipelines key off them.

WHO IT'S FOR
Educators / course designers authoring a COURSE_REFERENCE document. Output is
HOW to teach a course (tutor instructions), not WHAT the learner reads.

WHAT THE PIPELINE READS FROM IT
1. YAML front-matter   → parsed by parse-content-declaration.ts
2. "Modules authored:" → parsed by detect-authored-modules.ts
3. Modules table       → parsed by detect-authored-modules.ts (column aliases)
4. **OUT-NN:** lines   → parsed by detect-authored-modules.ts (outcomes)
5. "Session scope: N"  → assertions classified `session_override` → replace
                         onboardingFlowPhases for call N (pedagogy.ts)
6. "Call duration: …"  → cadence regex in detect-pedagogy.ts
7. "decides call-by-call" / "soft cap" / preset checkboxes → detect-pedagogy.ts
8. ### SKILL-NN headings with Emerging/Developing/Secure tiers
                       → parsed by parseSkillsFramework() (planned, epic #338)

WHAT THE PROJECTION WRITES TO THE DB (epic #338, NEW courses only since 2026-05-12)

A pure function `projectCourseReference()` reads this doc, and an idempotent
applier `applyProjection()` writes derived rows. Each row carries `sourceContentId`
so re-runs diff cleanly and removing the doc removes its derived rows.

| Section in this template | Becomes |
|---|---|
| `## Modules` table             | `CurriculumModule` row per module (ALL modes incl. `examiner` with `sessionTerminal: true`) + `Playbook.config.{modules, moduleDefaults, modulesAuthored, moduleSource, progressionMode}` |
| `## Outcomes` (`**OUT-NN: …**`) | `Goal` row per outcome (`type: LEARN`) + `Playbook.config.outcomes` |
| `## Skills Framework` (`### SKILL-NN` + Emerging/Developing/Secure) | `Goal` row per skill (`type: ACHIEVE`, `isAssessmentTarget: true`) + `BehaviorTarget` row per skill (scope: PLAYBOOK) + `Parameter` upsert by skill name |
| Linked `assessor-rubric.md` LOs with `systemRole: ASSESSOR_RUBRIC` | Same as Skills Framework — one ACHIEVE Goal + BehaviorTarget per rubric criterion |
| `**Session scope:** N` blocks  | `Playbook.config.sessionOverrides` (consumed by compose-time `pedagogy.ts` to REPLACE `onboardingFlowPhases` for call N) |

The wizard's own setupData (welcome flags, NPS, post-call survey, scheduler
preset) is a DISJOINT subset of `Playbook.config` — written by the wizard, not
by the projection. There is no field both sides write to.

The wizard does NOT author a course-ref doc; it only ingests one. A course
created without a COURSE_REFERENCE source attached is degenerate by design —
no Goals, no BehaviorTargets, no CurriculumModule rows are produced.

SEE ALSO
- docs/CONTENT-PIPELINE.md §3 (taxonomy), §3.1 (categories), §3.2 (front-matter),
  §4 (data flow), §6 (veto precedence), §11 (where to intervene)
- docs/ENTITIES.md (entity boundary rules)
- A worked example: a-sample-docs/humanfirst-3-session-course-reference.md (v2.0)

FRONT-MATTER KEYS (each is optional; missing keys fall back to AI inference)
- hf-document-type         Must be one of: CURRICULUM, TEXTBOOK, WORKSHEET, EXAMPLE,
                           ASSESSMENT, REFERENCE, COMPREHENSION, LESSON_PLAN,
                           POLICY_DOCUMENT, READING_PASSAGE, QUESTION_BANK,
                           COURSE_REFERENCE. For this template: COURSE_REFERENCE.
- hf-default-category      Pins extracted assertions to a category when the AI is
                           unsure. For tutor-only course refs: teaching_rule.
- hf-audience              learner | tutor-only | assessor-only.
                           Course references are tutor-only.
- hf-lo-system-role        NONE | ASSESSOR_RUBRIC | ITEM_GENERATOR_SPEC |
                           SCORE_EXPLAINER | TEACHING_INSTRUCTION.
                           Course refs that author rules for the AI tutor:
                           TEACHING_INSTRUCTION.
- hf-question-assessment-use  (Optional, for docs that contain questions.) One of:
                           PRE_TEST, POST_TEST, BOTH, FORMATIVE, TUTOR_ONLY.

See `docs/CONTENT-PIPELINE.md` §3.2 for the full hf-* declaration spec.
-->
---
hf-document-type: COURSE_REFERENCE
hf-default-category: teaching_rule
hf-audience: tutor-only
hf-lo-system-role: TEACHING_INSTRUCTION
---

# [Course name] — Course Reference

## Document Purpose

This document tells the AI tutor **how to teach** this course — the principles,
session flow, scaffolding moves, edge-case handling, and the boundaries of what
the tutor should and should not do. It does **not** contain the material the
learner is taught (that lives in CURRICULUM / TEXTBOOK / READING_PASSAGE /
QUESTION_BANK / EXAMPLE documents linked to this course).

If a paragraph reads like instructions to the tutor ("The tutor should…",
"Never…", "When the learner does X, do Y"), it belongs here. If it reads like
content the learner needs to read or hear, move it to a separate document of
the appropriate type.

---

## Course Overview

<!-- HOW TO USE
The "Call duration", "decides call-by-call", and "soft cap" phrases below are
keyword-detected by detect-pedagogy.ts and used to suggest sensible defaults
in the V5 wizard. Keep them — they don't lock you in, they just save the
educator from re-entering the same numbers in the wizard.
-->

**Subject:** [example — replace] Plain-English short name for the subject and the slice of it this course covers.
**Audience:** [example — replace] Learner level, age band, and any language or prior-knowledge prerequisites.
**Delivery:** Voice call. **Call duration: 15 minutes** [example — replace with your minutes per call].
**Length:** [example — replace] Open-ended / fixed N sessions / **soft cap 10 calls** for a commercial package.
**Prerequisites:** [example — replace] What the learner must already be able to do before joining.
**Cadence:** The scheduler **decides call-by-call** which module to teach next based on coverage and recall — this course does not pre-plan sessions in advance. [Delete this line if your course uses a fixed lesson plan.]

**Core proposition:** [example — replace] One paragraph. What does the course do, and how is it different from a human-tutored version? The wizard quotes this back to the educator in the proposal preview.

---

## Modules

<!-- HOW THIS WORKS
The line `**Modules authored:** Yes` below tells the wizard you have hand-curated
the module list and to NOT auto-derive modules from extracted assertions. The
Module Catalogue table is parsed deterministically by detect-authored-modules.ts.

REQUIRED CONSTRAINTS (the parser enforces these):
- The `id` column must match /^[a-z][a-z0-9_]*$/ and be ≤32 chars (e.g.
  `intro_call`, `theme_id_1`, `final_review`).
- Module IDs must be unique within this document.
- Any module listed in another row's `Prerequisites` column must also appear
  as an `id` somewhere in the table.

VALUES (use these exact spellings — anything else is rejected or warned about):
- Mode:               examiner | tutor | mixed
- Frequency:          once | repeatable | cooldown
- Learner-selectable: Yes | No (defaults to Yes)
- Session-terminal:   Yes | No (defaults to No)

PROJECTION: every row in this table produces a `CurriculumModule` DB row
(including `mode: examiner` and `sessionTerminal: true` modules — they appear
in the rail like any other module; runtime behaviour differs based on `mode`).
If any row has `Learner-selectable: Yes`, `Playbook.config.progressionMode`
becomes `learner-picks`; otherwise it stays `ai-led`.
- Voice band readout: Yes | No (defaults to No)

REPLACE the two `[example — replace]` rows below with your real modules.
-->

**Modules authored:** Yes

### Module Catalogue

| ID | Label | Learner-selectable | Mode | Duration | Scoring fired | Voice band readout | Session-terminal | Frequency | Content source | Outcomes (primary) | Prerequisites |
|---|---|---|---|---|---|---|---|---|---|---|---|
| intro_call | [example — replace] Welcome and orientation | No | tutor | 8–10 min | None | No | No | once | none | OUT-01 | none |
| core_practice | [example — replace] Guided practice on the core skill | Yes | mixed | 15 min | All criteria | Yes | No | repeatable | curriculum:core | OUT-02, 03 | intro_call |

### Module Defaults

<!-- HOW TO USE
These defaults fill in any field you leave blank in a row above. Optional —
delete the whole subsection if you'd rather be explicit on every row.
-->

- **Default mode:** tutor
- **Default correction style:** single_issue_loop
- **Default theory delivery:** embedded_only (no standalone theory mini-lectures)
- **Default band visibility:** indicative_only (rough tier, not exact score)
- **Default intake:** skippable

### Legend

- **Mode:** `examiner` = formal scoring under exam conditions; `tutor` = open coaching; `mixed` = coach first, then score the result.
- **Frequency:** `once` = fires at most one time per learner; `repeatable` = can fire on multiple calls; `cooldown` = repeatable but with a gap between firings.
- **Learner-selectable:** `Yes` means the learner can pick this module from the start-of-call picker; `No` means only the scheduler can route into it.
- **Session-terminal:** `Yes` means once this module finishes, the call ends (no follow-on module on the same call).
- **Voice band readout:** `Yes` means the tutor speaks the band/tier aloud at the end of the module; `No` keeps the score internal.

---

## Outcomes

<!-- HOW TO USE
Each outcome is a bold line of the form `**OUT-NN: <statement>.**`. The wizard
parses these with detect-authored-modules.ts and uses the statements verbatim
in proposals, reports, and parent-facing summaries. Keep them concrete and
verifiable — "the learner can do X" rather than "the learner appreciates Y".

The IDs referenced under each module's "Outcomes (primary)" column above must
appear as `OUT-NN` lines below.

REPLACE the three `[example]` lines with your real outcomes.

PROJECTION: each `**OUT-NN: …**` line produces a `Goal` row with `type: LEARN`
and the statement as the goal name. The projection writes one Goal per OUT-NN,
keyed by `(playbookId, sourceContentId, name)` — re-running the projection
against the same doc is a no-op.
-->

**OUT-01: [example] The learner can describe their goal and confidence level for the course in their own words.**

**OUT-02: [example] The learner can demonstrate the core skill in a guided context with light scaffolding.**

**OUT-03: [example] The learner can self-assess their performance against the published proficiency tiers.**

---

## Skills Framework

<!-- HOW TO USE
List each measurable skill the course develops. Use exactly three proficiency
tiers per skill: Emerging, Developing, Secure. Tier descriptions should be
behavioural ("the learner does X") not affective ("the learner enjoys X").

REPLACE the two `[example]` blocks with your real skills.

PROJECTION: each `### SKILL-NN: <name>` block produces three DB rows together:
  1. A `Parameter` row (upserted by skill name) — measurable dimension for
     the pipeline's REWARD/ADAPT stages.
  2. A `Goal` row with `type: ACHIEVE` and `isAssessmentTarget: true` —
     the learner's measurable target on this skill.
  3. A `BehaviorTarget` row scoped to this Playbook — what value of the
     parameter counts as "Secure".
If the course separately uploads an `assessor-rubric.md` whose `LearningObjective`
rows are classified `systemRole: ASSESSOR_RUBRIC`, those rubric LOs ALSO project
to ACHIEVE Goals + BehaviorTargets (e.g. the four IELTS Speaking criteria with
their Band 0–9 descriptors). The two paths are equivalent — use whichever fits
your domain.
-->

### SKILL-01: [example] [Skill name]

[example] Short definition — what the skill is, in one or two sentences. Mention what success looks like in the wild, outside this course.

- **Emerging:** [example] What the learner does when the skill is not yet present. Concrete observable behaviour.
- **Developing:** [example] Visible partial competence — what does the in-between look like?
- **Secure:** [example] The behaviour you'd accept as evidence the learner has the skill.

### SKILL-02: [example] [Skill name]

[example] Short definition.

- **Emerging:** [example] …
- **Developing:** [example] …
- **Secure:** [example] …

### Skill Interactions

[Optional] If one skill depends on another, or two skills usually move together,
note that here in 1–3 sentences. The scheduler reads this section as free text
when deciding what to teach next.

---

## Teaching Approach

### Core Principles

The tutor's behaviour across every call should obey these principles. Each
principle should be falsifiable — a reviewer should be able to point to a
transcript line and say "the tutor broke this".

- **[example] Teach through questioning, not explanation.** The tutor's primary tool is the question. Explanation is the second move, used only after a guided question has not landed.
- **[example] One concept per call.** Depth over breadth. If a learner masters one new idea per call, the course works.
- **[example] Never grade in-line.** Scoring happens at the close, not mid-conversation.
- **[example] Name the gain.** Every call ends with a concrete, criterion-referenced improvement the learner can repeat back.

### Session Flow

<!-- HOW TO USE
This is the *default* shape of a call. The First Call section below can
override this shape for call 1 specifically (see `**Session scope:** 1`).
-->

Each call follows this rhythm. Timings are guides, not rigid boundaries.

1. **Reconnect (~1–2 min):** Greet by name. Recall the previous call's focus and named gain. One light retrieval question.
2. **Module work (~10–12 min):** Run the module the scheduler picked (or that the learner chose). Stay inside the module's mode and correction style — see the Module Catalogue.
3. **Checkpoint (~2 min):** Score the criteria the module fires. Note evidence in the learner's own words.
4. **Close (~1 min):** Name the specific gain, preview the next call's likely focus, and warm sign-off.

### Techniques

[example] List the named scaffolding moves the tutor uses, with one-line guidance for each. The pipeline extracts each bullet as a `scaffolding_technique` assertion.

- **[example] Graduated prompts:** Open → guided → direct, in that order. Move down a step only after a 3-second silence.
- **[example] Echo-and-extend:** Restate the learner's last sentence and add a probing follow-up rather than introducing a new line of thought.
- **[example] Stop and ask:** When the learner produces a strong phrase, stop teaching and ask them to repeat it back in a new sentence.

---

## First Call

**Session scope:** 1

<!-- HOW THIS WORKS
The literal marker `**Session scope:** 1` above is parsed by the extractor
into a `session_override` assertion tagged for call 1. At compose time,
`computeSessionPedagogy` in transforms/pedagogy.ts checks for matching
session_overrides and — when present — REPLACES the default
`onboardingFlowPhases` for that call number. It does not augment them; it
fully replaces.

That means anything you write below this comment becomes the *only* welcome
flow for call 1. If you want the platform defaults (open intro, ask goals,
about-you, knowledge check, then start), delete this whole section and the
defaults run instead.

You can repeat the pattern for other call numbers:
  ## Mid-course Checkpoint
  **Session scope:** 5
  …rules that REPLACE call 5's default phases…

You can also use ranges and open-ended forms:
  **Session scope:** 2-4   — replaces phases for calls 2, 3, and 4
  **Session scope:** 3+    — replaces phases for call 3 onwards
-->

[example — replace] On the first call, skip the generic welcome flow entirely. The learner has already submitted their goal and confidence rating during sign-up, so do not re-ask. Instead:

1. **Warm open (45–60 sec):** Greet by name. Acknowledge their stated goal in one sentence. Do not re-collect about-you or goal data.
2. **Module picker (60–90 sec):** Show the learner-selectable modules. Let the learner pick or, if they hesitate, recommend `intro_call`.
3. **Run the picked module:** The rest of the call is the module itself — no separate "first call" curriculum.

---

## Examples — "What Good Sounds Like"

<!-- HOW TO USE
Paired examples — e.g. a Band-7 sample vs a Band-5 sample, or a strong learner
response vs a weak one — should NOT live in this course-ref file. They belong
in a separate document with:

  ---
  hf-document-type: EXAMPLE
  hf-default-category: example
  hf-audience: tutor-only
  ---

Reasons:
- The EXAMPLE document type uses a different extractor (more lenient, captures
  tier tags like "Band 7" / "Distinction" / "Pass" in the assertion metadata).
- It lets you swap exemplars without re-publishing the whole course-ref.
- The wizard surfaces EXAMPLEs separately in the content-source picker.

REPLACE the bullet list below with cross-references to your actual EXAMPLE
docs. The IDs / filenames are arbitrary — use whatever your content store uses.
-->

This course pairs with the following EXAMPLE documents (uploaded separately):

- `[example] examples/strong-response-band7.md` — a tier-A worked sample of a learner response. Tutor surfaces this to the learner when the model concept is unclear.
- `[example] examples/weak-response-band5.md` — a tier-B contrast piece. Tutor uses this in feedback to show what a common shortfall looks like.

Do not paste exemplar prose into this document — the extractor will misclassify
it as a `teaching_rule`.

---

## Learner Model

The tutor maintains a minimal per-learner record across calls. Keep this list
short — anything not tracked here is out of scope for this course.

**Per-call record:**

- Module(s) run on the call
- Criteria scores (per skill, per module that fired scoring)
- Verbatim quotes used as scoring evidence
- Engagement level: high / moderate / low
- Scaffolding density: none / light / heavy

**Across calls:**

- Coverage state per module (touched / partially covered / fully covered)
- Most recent score per skill
- Open gaps the tutor has flagged for revisit
- Free-text pattern notes (e.g. "Learner consistently picks `core_practice` over `theory_intro` — note for sequencing")

No readiness flags, personality scoring, or affect profiling unless your course
explicitly requires them.

---

## Communication

### To the Learner

- **Inside the call:** Voice only. No mid-call text, links, or attachments.
- **Between calls:** No tutor-initiated messages unless the platform welcome / re-engagement workflow fires.
- **Tone:** [example — replace] Warm, specific, never sycophantic. Praise references concrete behaviour, not effort.

### To the Course Operator

- **Per-call:** A structured log entry (modules run, scores, verbatim evidence, flags). No prose summary unless the operator requests one.
- **Escalations:** Distress, repeated technical failure, or a learner explicitly asking to speak to a human — flag immediately.

---

## Assessment Boundaries

This course does **not**:

- [example — replace] Prepare the learner for any exam outside the criteria listed in the Skills Framework
- [example — replace] Teach foundational skills assumed by the Prerequisites
- [example — replace] Replace clinical, legal, or safety-critical guidance — if the learner asks, redirect them to a qualified human
- [example — replace] Promise a specific score, grade, or band by a specific date

If the learner asks the tutor to step outside these boundaries, the tutor
should acknowledge, decline gently, and redirect to a related on-course
activity.

---

## Edge Cases and Recovery

<!-- HOW TO USE
Each bullet below extracts as an `edge_case` assertion. Keep the pattern:
trigger condition + what the tutor should do. One sentence each is fine.
-->

- **Learner has not done the prep.** Do not ask "did you do it?" Instead notice from the conversation, acknowledge without judgment, and either set a 2–3 sentence scene and proceed lightly, or offer to reschedule.
- **Learner is uncommunicative.** Use silence (3–4 seconds) before rephrasing. Switch to the simplest, most concrete questions available. If after 3–4 minutes the call is still one-sided, warmly offer to stop.
- **Learner is distressed.** Stop the academic content. Acknowledge the feeling without probing the cause. Offer to end the call and flag for the operator.
- **Learner goes off-topic.** Allow brief tangents — they can be a window into how the learner connects ideas. Redirect gently after 1–2 minutes if the tangent isn't returning to the module's focus.
- **Learner asks for the answer.** Default to redirecting with a smaller scaffold. Only model after two failed guided attempts, and model the smallest unit that unblocks them (one sentence, not a paragraph).
- **Third party intervenes.** Continue normally. Do not address them directly. If they supply answers for the learner, redirect: "Thanks — and [learner name], what do you think about that?" Log third-party content separately from learner-generated evidence.
- **Audio drops or quality breaks down.** If within the first 3 minutes, reschedule. If later, attempt to continue; if quality stays poor, close warmly and flag for the operator.
- **Repeated stagnation on a single criterion (3+ consecutive calls, no movement).** Switch module, switch correction style, or shift briefly from Socratic to directly modelling a single corrected example. Note the switch for the operator.

---

## Metrics and Quality Signals

### Minimum (course is working)

- [example — replace] At least one Comprehension-level checkpoint per call
- [example — replace] Learner talk ratio ≥ 50%
- [example — replace] At least one named gain at every call close

### Strong (course is exceeding)

- [example — replace] Two or more Comprehension-level checkpoints per call
- [example — replace] Learner produces evidence unprompted (cites text, examples, prior calls)
- [example — replace] Cross-module retention visible without scaffolding

### Fail conditions (course is not working for this learner)

- [example — replace] Zero Comprehension at any end-of-call checkpoint
- [example — replace] Heavy scaffolding across three consecutive calls without movement
- [example — replace] Tutor logs themes / scores / claims the human reviewer cannot validate against the transcript

---

## Document Version

**Version:** 3.0
**Created:** 2026-05-11
**Author:** HF platform team
**Status:** Canonical template

**Modules authored:** Yes

# IELTS Part 3 selection-rules pedagogy mapping (D5 of handoff_lattice_all_settings_to_ui_2026_06_21)

**Date:** 2026-06-24
**Spec:** [`apps/admin/docs-archive/bdd-specs/IELTS-P3-FOCUS-001-part3-technique-focus.spec.json`](../../apps/admin/docs-archive/bdd-specs/IELTS-P3-FOCUS-001-part3-technique-focus.spec.json)
**Origin:** PR [#2150](https://github.com/WANDERCOLTD/HF/pull/2150) (S4 of epic [#2145](https://github.com/WANDERCOLTD/HF/issues/2145)) shipped the spec with DRAFT mappings + `PEDAGOGY REVIEW PENDING` flags. D5 of the 2026-06-21 EOD handoff queued the pedagogy review as an operator decision blocking MT.
**Status:** APPROVED — DRAFT flags removed; spec re-seedable.
**MT relevance:** Unblocks IELTS Speaking Part 3 focus pin for the 100-tester market test (no more `PEDAGOGY REVIEW PENDING` strings shipping to learners' tutors).

## Context

`IELTS-P3-FOCUS-001` is a `CALLER_ATTRIBUTE_NEXT`-output AnalysisSpec driven by the generic `session-focus-policy` runner (`apps/admin/lib/pipeline/runners/session-focus-policy.ts`). Each pipeline run picks the IELTS-skill `CallerTarget.currentScore` with the lowest finite value, looks up the corresponding `selectionRules[*]` entry, and writes one `CallerAttribute(key="session_focus:next_part3", stringValue=<technique label>)` row. The compose-time transform (`lib/prompt/composition/transforms/session-focus.ts`) reads that row on the NEXT call and projects the label into:

1. The tutor's system prompt as a `[SESSION FOCUS]` directive
2. The on-screen Part 3 pin (`components/sim/PinnedCardSlot.tsx`) as `Today's focus — <label>`

The label MUST be a member of the learner-safe `Part3TechniqueFocus` union (`apps/admin/lib/types/json-fields.ts`):

```ts
export type Part3TechniqueFocus =
  | "giving reasons"
  | "structuring an argument"
  | "handling a challenge"
  | "expanding an answer";
```

These 4 values are anchored in HF's BDD US-P3-01 (`docs/HF-IELTS-Pre-Voice-Testing-Checklist.md` Unit 4). The decision is: which IELTS criterion (FC / LR / GRA / P) should each one address?

## Decision

| Weakest input | thenLabel | Confidence |
|---|---|---|
| `skill_fluency_and_coherence_fc` | structuring an argument | **High** |
| `skill_lexical_resource_lr` | expanding an answer | **High** |
| `skill_grammatical_range_and_accuracy_gra` | giving reasons | **High** |
| `skill_pronunciation_p` | **expanding an answer** (changed from "handling a challenge") | **Moderate** |

`"handling a challenge"` is **retired from this spec** but **retained in the `Part3TechniqueFocus` union** for future per-course session-focus-policy specs (or a future custom IELTS criterion rollup) that genuinely benefit from interactive-pressure practice — e.g. a "confidence-under-pushback" or "extended-defence" dimension.

## Rationale per rule

### FC → "structuring an argument" — High confidence

Fluency & Coherence weakness in Part 3 surfaces as halting or disorganised long turns. The IELTS Speaking band descriptors directly grade `range of connectives and discourse markers`:

- Band 4 "links basic sentences with repetitious simple connectives"
- Band 5 "may over-use certain connectives and discourse markers"
- Band 6 "uses a range of connectives and discourse markers but not always appropriately"
- Band 7 "uses a range of connectives and discourse markers with some flexibility"

"Structuring an argument" trains the signposting + premise→support→conclusion discipline the descriptor directly rewards. The British Council's `Signposting Language — Speaking Part 3` PDF is the canonical IELTS-published source.

**Sources:**
- British Council, [Signposting Language — Speaking Part 3 (PDF)](https://takeielts.britishcouncil.org/sites/default/files/speaking_part_3_-_signposting_language.pdf)
- IDP, [Mastering IELTS Speaking — Enhancing Fluency and Coherence](https://ielts.idp.com/prepare/article-ielts-speaking-fluency-and-coherence)
- IDP, [Using discourse markers to communicate in IELTS Speaking](https://ielts.idp.com/prepare/article-discourse-markers-ielts-speaking)

### LR → "expanding an answer" — High confidence

Lexical Resource weakness shows as short, lexically thin answers that don't push into topic-specific or less-common vocabulary. Part 3 extended answers structurally force paraphrase, topic-specific terminology, and complex features (relative clauses, comparison language, passive voice). "Expanding an answer" creates the surface area for richer lexical choices and circumlocution under attempted-but-failed lexical retrieval.

**Sources:**
- Magoosh, [IELTS Speaking — Lexical Resource](https://magoosh.com/ielts/ielts-speaking-lexical-resource/)
- British Council, [IELTS Speaking — Lexical Resource (PDF)](https://takeielts.britishcouncil.org/sites/default/files/ielts_speaking_2_-_lexical_resource.pdf)
- SimplyIELTS, [IELTS Speaking Part 3 — Extended Answers with Examples](https://simplyielts.com/ielts-speaking-part-3-extended-answers-examples/)

### GRA → "giving reasons" — High confidence

Grammatical Range & Accuracy weakness rarely emerges in simple-clause answers; it surfaces only when the learner attempts subordination, conditional constructions, and modal-hedged speculation. "Giving reasons" explicitly invites because/although/if-clauses and modals of speculation (might, could, would probably, is likely to) — exactly the structures the GRA descriptor grades. Multiple IELTS coaching sources independently converge on "speculate / give reasons / use conditionals" as the canonical GRA lift in Part 3.

**Sources:**
- Keith Speaking Academy, [Complex Sentences for IELTS Speaking](https://keithspeakingacademy.com/ielts-speaking-complex-sentences-grammar/)
- Keith Speaking Academy, [IELTS Speaking Part 3 — Tips and Topics](https://keithspeakingacademy.com/ielts-speaking-part-3-tips/)
- E2Language, [IELTS Speaking Part 3 — Topics, Tips, Sample Questions](https://www.e2language.com/blogs/ielts/ielts-speaking-part-3-tips-and-practice)

### P → "expanding an answer" — Moderate confidence (changed from DRAFT mapping)

**Pronunciation is structurally not a Part 3 discussion technique.** Pronunciation is improved through chunking, sentence/word stress, intonation, and shadowing — NONE of which is one of the 4 `Part3TechniqueFocus` union members. Every IELTS coaching source converges on the same set of P-improvement drills (chunking, stress drills, shadowing native models). They are runtime/practice activities, not discussion-technique selections.

Given that NONE of the 4 available labels naturally targets P, the call is between:

1. **Keep the original DRAFT mapping** (P → "handling a challenge") — pedagogically weak. Interactive pressure (the tutor pushing back) demands rapid response, which actually *hurts* pronunciation cleanliness; it doesn't develop it.
2. **Drop the P rule entirely** — when P is weakest, runner returns `skipped:no-rule-for-weakest` and the learner sees no focus pin. Honest empty state, but the most common weakness for non-native speakers loses adaptive guidance.
3. **Add a fallback-to-next-weakest behaviour in the runner** — pure-code change with test updates; defers decision indefinitely.
4. **Map P to the most pronunciation-adjacent label.** Of the 4: "expanding an answer" maximises learner speech-chunks → maximises the surface area for (a) the tutor to model native-like prosody, (b) the learner to self-correct, and (c) repair patterns to surface in the transcript for downstream MEASURE specs. Same label as LR is correct — the `Part3TechniqueFocus` union is keyed on what the learner SEES (the label), not on criterion↔label uniqueness. The tutor's runtime behaviour + the runtime prosody modelling is what differs.

**Option 4 selected.** Rationale:
- Data-only change (no runner refactor)
- Cartesian completeness preserved (every input criterion has a rule)
- Pedagogically defensible: of the 4 labels, "expanding" is the one whose mechanism genuinely produces pronunciation lift (more chunks → more shadowing surface → more repair opportunities)
- Same-label-for-two-criteria is structurally fine: the union allows it, the type system accepts it, the runtime tutor behaviour distinguishes them

**Sources:**
- British Council, [How to improve English pronunciation for IELTS Speaking](https://takeielts.britishcouncil.org/blog/how-to-improve-english-pronunciation-ielts-speaking) — chunking + shadowing recommended
- IDP, [Pronunciation skills — word/sentence stress and intonation for IELTS Speaking](https://ielts.idp.com/prepare/article-pronunciation-skills-word-sentence-stress-intonation-ielts-speaking)
- 3D Academy, [Pronunciation in IELTS Speaking — Stress, Intonation, and Clarity](https://3d-universal.com/en/blogs/pronunciation-in-ielts-speaking-stress-intonation-and-clarity.html)

## What this is NOT

- **Not a code change.** Runner + transform + pin renderer unchanged. The mapping is data-driven (spec.json) per epic #2145 substrate.
- **Not a union change.** `Part3TechniqueFocus` keeps all 4 members.
- **Not a hardcoded fallback.** When no IELTS skill has a scored `CallerTarget.currentScore`, the runner writes nothing (honest-empty-state contract per epic #2135).
- **Not a deletion.** "Handling a challenge" stays in the union for a future use case.

## Lattice compliance check

Per `.claude/rules/lattice-survey.md` sibling-writer survey, this change touches:

| Pillar | Surface | Status |
|---|---|---|
| Chain Contracts | `lib/pipeline/runners/session-focus-policy.ts` consumer of `selectionRules` | Unchanged — still reads from spec.config |
| Guards | `eslint-rules/no-bare-spec-identifier.mjs` + `spec-readonly-boundary.md` | N/A — this is HF-canonical seed authoring, not customer code |
| Cascade | Per-Playbook cascade not yet wired (gated by `HF_IELTS_LLM_MEASURE_V1` flag; D4 of handoff) | Unchanged |
| Rules | `.claude/rules/learner-ui-leak-coverage.md` (LEARNER_SAFE_REGISTRY) | All 4 labels still registered as learner-safe; no new criterion labels |
| Coverage | `tests/lib/sim-chat/learner-ui-leak-coverage.test.ts` + `tests/lib/sim-chat/bdd-typed-unions-coverage.test.ts` | GREEN — no changes to the union, no new internal labels |
| Coverage | `tests/lib/pipeline/runners/session-focus-policy.test.ts` | Updated — P fixture mapping changed (2 occurrences) |

The pure-function `pickWeakestAndMap` is unchanged. Test assertions are independent of the P-specific label (every assertion that names an expected label uses LR or GRA paths). The mapping-fixture change at lines 51-58 and 365-374 is purely cosmetic relative to existing assertions.

## Seeding

After merge, the spec.config update reaches the DB via:

```bash
cd apps/admin && npm run db:seed
```

`seed-clean.ts` calls `seedFromSpecs()` which reads every `docs-archive/bdd-specs/*.spec.json` and upserts `AnalysisSpec` rows with their `config` JSON. The `IELTS-P3-FOCUS-001` row's `config.selectionRules` will reflect the new mapping.

**hf_sandbox:** operator runs `npm run db:seed` on the VM (or via the VM oneoff path).
**hf_staging:** next `/deploy → Full deploy` triggers the `hf-seed-dev` Cloud Run job which re-seeds the staging DB. The 2026-06-24 MEMORY note already flags this deploy is queued for the IELTS-INTAKE-001 spec; D5 piggybacks on the same job.

**No data migration needed.** Existing `CallerAttribute(key=session_focus:next_part3)` rows carrying `"handling a challenge"` from prior runs (if any exist on hf_sandbox; staging has zero learner sessions) will be overwritten on the next pipeline run for the affected caller. The D6 NULL-out migration in the handoff is for the pre-#2164 criterion-label residue (different problem); this change requires no separate migration.

## Future iteration

If post-MT data shows that P-weak learners on the "expanding an answer" track don't show pronunciation lift (measurable via prosody-vendor scoring once D3 / `prosody_raw_*` is wired per the 2026-06-22 MEMORY note), the operator can:

1. Add a 5th `Part3TechniqueFocus` value (e.g. `"chunked delivery"`) that specifically targets P, OR
2. Promote a runtime-level pronunciation drill outside the Part 3 technique surface (per the BC/IDP coaching literature)

Either change is data-only: spec.json edit + union extension + re-seed. The Coverage gates at `learner-ui-leak-coverage` + `bdd-typed-unions-coverage` will surface the union change automatically and require a paired LEARNER_SAFE_REGISTRY update.

# The Lattice — pre-coding sibling survey

> **The Lattice** is the umbrella name for HF's four interconnected guard
> systems: **Chain Contracts** (cross-stage invariants in
> [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md)), **Guards**
> (ESLint rules under `apps/admin/eslint-rules/`, catalogued in
> [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)),
> **Cascade** (effective-value resolvers under `apps/admin/lib/cascade/`),
> and **Rules** (the discipline files under `.claude/rules/*.md`).
>
> The Lattice is **multi-axis** (cross-stage × code × layers × discipline),
> **load-bearing** (engineers feel the weight when they bypass it), and
> **extensible** (new nodes attach without weakening existing ones — the
> "survives hardening" classification in
> [`docs/kb/guards-process.md`](../../docs/kb/guards-process.md)).
>
> This file holds the **pre-coding side** of the Lattice — a survey
> discipline applied BEFORE writing code that touches the Lattice. It is
> the structural answer to the 2026-06-16 #1703 fingerprint where three
> contract risks (guard #1252 violation, track-progress.ts sticky-waiver
> race, MASTERED-vs-COMPLETED convention conflict) were introduced
> silently in a single helper because the author skipped the survey.

## Rule: Survey the Lattice before touching it

Before writing OR modifying any code that mutates a shared DB column,
crosses a chain-stage boundary, registers a new spec/contract/guard, or
extends an AI write/read path, you MUST run the survey below. The
survey is a 60–90 second discipline; it consistently saves multi-hour
rework loops.

```
Identify the surface → Map siblings → Read the contracts →
  Decide convergence → Only then write
```

## When this applies

Any code path where ANY of the following are true:

1. **DB column mutation** — your code calls `prisma.<X>.{create|update|upsert|delete*|*many}` or writes a column that other code reads.
2. **Chain-stage boundary** — your code sits on the producer or consumer side of an adaptive-loop edge (EXTRACT / AGGREGATE / REWARD / ADAPT / SUPERVISE / COMPOSE / SESSION-end / SESSION-start).
3. **New guard or contract** — you're adding an ESLint rule, a chain-contract invariant, a CHAIN-CONTRACTS sub-contract, or a `.claude/rules/*.md` file.
4. **AI write or read path** — your code lands a `@ai-call` annotation, drives `prisma.*` writes from LLM output, or asserts facts about a specific entity from LLM text.
5. **Cascade-eligible knob** — your code introduces or mutates a setting that has a domain/group/system fallback chain.

If none apply, the survey is not required.

## The survey (run before writing)

For the surface you're about to touch:

1. **Identify the surface in concrete terms.** Name the DB columns, files, or stage boundaries. Don't be abstract.
2. **Map every existing writer/reader.** Use `qmd search` first; fall back to `grep -rn` if needed.
   ```
   qmd search "<column or function name> write"
   grep -rn "prisma\.<modelName>\.\(create\|update\|upsert\)" apps/admin/lib apps/admin/app
   ```
   Open every match. Note what each one writes/reads and under what intent.
3. **Read the contract catalogues row-by-row.**
   - [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) — every active guard
   - [`.claude/rules/ai-to-db-guard.md`](./ai-to-db-guard.md) — chokepoint writers
   - [`.claude/rules/ai-read-grounding.md`](./ai-read-grounding.md) — chokepoint readers
   - [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) — cross-stage invariants
   - [`docs/CONTRACTS-PLAYBOOK-CURRICULUM.md`](../../docs/CONTRACTS-PLAYBOOK-CURRICULUM.md) — Playbook/Curriculum surface
4. **Cross-check for the four classic risk shapes:**

   | Risk shape | What to look for |
   |---|---|
   | **Sibling-writer drift** | Two writers to the same column with different intents → does one clobber the other? Are they in separate transactions? |
   | **Default-deny gates** | Does an ESLint rule require a precondition (e.g. `courseStyle === "structured"` for `CallerModuleProgress`)? Does your code respect it? |
   | **Cascade respect** | Is the value cascadable (in `lib/cascade/knob-keys.ts`)? Are you reading via the resolver, or directly from a layer? |
   | **Convention conflict** | Does the column have multiple in-use values (e.g. `MASTERED` vs `COMPLETED`)? Pick the existing DB convention; presentation layer maps it. |

5. **Decide convergence with sibling writers.** If two writers can disagree, design the agreement (sticky-marker, ordering, locking) BEFORE writing the second one.
6. **THEN write.** Include the survey result in the PR's `## Verified by` section so the reader can re-check.

## Pattern: survey-then-write

```typescript
// BAD: jump to implementation
// (You write a clever helper. It clobbers a sibling writer's invariant.
//  The race is silent until production data drifts.)

// GOOD: survey-then-write
// 1. `qmd search "callerModuleProgress write"` → 7 sites
// 2. Read each: track-progress (mastery), pipeline (call-count), admin (reset), …
// 3. Cross-check guard-registry: #1252 default-deny by courseStyle.
// 4. Decide: my helper coexists with track-progress via sticky-waiver marker
//    (incompleteAttempts >= 2 + status=COMPLETED). Document in track-progress.
// 5. NOW write the helper AND the sticky-waiver guard in track-progress.
```

## When the survey saves time

A 90-second survey would have caught all three risk shapes in #1703:

| Skipped | Cost when uncaught |
|---|---|
| Sibling-writer survey on `CallerModuleProgress` | track-progress.ts:665 clobbers waived status on next pipeline run (silent un-advance) |
| Guard-registry read | #1252 ESLint failure at push (rework + post-CI redo) |
| Convention check | `MASTERED` written where `COMPLETED` is the DB convention (silent label drift) |

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| This rule | Author discipline — `## Verified by` PR section MUST cite the survey result | Skipped surveys reaching code review (the 2026-06-16 #1703 fingerprint) |
| `qmd search` over [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) | Catalogued guards — survey step 3 | Author missing an ESLint rule that gates the surface |
| ESLint rules under `apps/admin/eslint-rules/` | Build-time | Bypass attempts that slip past the survey |
| Sibling rule files in this directory | Per-surface discipline | Pattern reuse without the survey is structurally near-identical to having done one |
| Convention: NEVER cite "I followed the rule" without the survey result | PR review | A claimed-but-unverified survey reaching merge |

## When NOT to apply

- Trivial typo / comment-only fixes
- README / docs commits that don't reference Lattice entries
- Reverts (the reverted commit IS the survey)
- Greenfield code that touches no existing column, no chain-stage boundary, no shared registry, and no AI path

## Why the Lattice name

Four pillars, interlocked, load-bearing, extensible:

- **C**hain Contracts × **G**uards × **C**ascade × **R**ules
- A lattice grows by attaching nodes; old nodes don't weaken
- "Off-Lattice change" / "Lattice violation" / "Lattice check" reads naturally
- Distinct from "scaffold" (already used for class **b** guards), "guard" (subset), "contract" (subset)

## Producer ↔ consumer pairing (Preview-lens discovery)

A setting that has a registry entry but no consuming transform is a
**producer-only Lattice entry**. The Inspector shows it; the operator
edits it; the Preview lens shows a "section stale" chip — but the
composed prompt content does not change because no transform reads the
key.

This is a Lattice violation in its own right: the registry promises the
setting affects a section, but the transform that renders that section
doesn't honour the promise. The Preview lens becomes misleading.

**Rule:** when you register a new G-group entry (or a new VOICE entry,
or any setting with non-empty `composeImpact.sections`), you MUST land
the consuming transform in the same PR OR file a follow-on with the
matching `composeImpact.sections[]` rows so the gap is tracked.

The 2026-06-16 #1701 G8 cohort intentionally landed as producer-only
(per epic #1700 decision 5 — `HF_FLAG_IELTS_MODULE_SETTINGS`); the
consumers are Phase 2 work (Themes 8, 10, plus the closing/orientation
transform wires). Tracked at <follow-on issue TBD>.

## Producer ↔ consumer pairing — deeper layer: transform vs renderer

Even when the registry → transform side of the pairing is solid, a
*second* producer-only failure mode lives one layer down: the
transform produces a directive structure, but the prose renderer never
emits the directive into the final `voicePrompt` string. The LLM gets
JSON-shape data but the actual VAPI call uses
`renderProviderPrompt(llmPrompt)` — the prose mirror at
`lib/prompt/composition/renderPromptSummary.ts`. If the renderer
doesn't `parts.push(directive)`, the tutor never hears it.

**Live incident (2026-06-17):** PR #1768 (Theme 10 profile capture)
silently deleted 5 unrelated renderer consumer blocks during a bad
merge:

  - `instructions.module_question_target.directive` (#1732)
  - `instructions.module_cue_card.directive`       (#1733)
  - `offboarding.moduleClosingLine`                 (#1734)
  - `instructions.module_orientation_line.directive` (#1735)
  - `priorCallFeedback.summary` + scoreboard         (#1749)

For ~24 hours every IELTS Mock learner ran without the cue-card
directive (the LLM didn't know to anchor on the Part 2 topic), the
question-count directive, the verbatim closing line, the first-time
orientation, AND the score-delta narrator.

**Rule:** when a transform's output object carries a `directive: "…"`
field, the SAME PR MUST add (or keep) the matching push in
`renderPromptSummary.ts`. The pairing is enforced by three sibling
layers:

  1. **ESLint** (`hf-compose/composition-directive-needs-renderer`,
     severity `error`) — fires at edit time on transforms/*.ts files
     containing a `directive: "…"` field UNLESS the file carries the
     sentinel comment `// @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts`.
  2. **Composition coverage vitest**
     (`tests/lib/prompt/composition/coverage-producer-consumer.test.ts`)
     — walks the manifest of known pairs + sweeps every transforms/*.ts
     for orphan `directive:` fields. Catches BOTH silent renderer
     drops AND new directives that forgot to register a pair.
  3. **This rule file** — author discipline, last-line defence when
     someone reasons their way around (1) and (2).

The cost of compliance is one sentinel comment per transform file,
plus one PAIRS row per directive. The cost of regression — measured
by the 2026-06-17 incident — is hours of live traffic running an LLM
that's missing the operator-tuned behaviour.

## Escalation

If the survey turns up a contract gap (an existing pair of sibling writers
with no convergence design), document it in the PR body under
`## Lattice gap` and file a follow-on. Do NOT silently make your code the
third party to an existing two-writer disagreement.

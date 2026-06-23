---
paths:
  - "apps/admin/lib/prompt/composition/transforms/**/*.ts"
  - "apps/admin/lib/compose/**/*.ts"
  - "apps/admin/lib/pipeline/**/*.ts"
---

# Data-First Entry (Lattice pre-entry gate)

> Before you serve a content / pedagogy / rubric / scoring / threshold
> requirement with CODE, decide whether it belongs as DATA — a
> `PlaybookConfig` field, a `JOURNEY_SETTINGS` / `VOICE_SETTINGS` entry,
> an `AnalysisSpec`, or a registry row — and justify code only when the
> data layer cannot yet express it.
>
> Sibling to [`registry-schema-coverage.md`](./registry-schema-coverage.md)
> (schema field → registry coverage) and
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (registry entry → transform reader). Those two secure the data→code
> seam once a setting is ON it. This rule is the **pre-entry** sibling:
> it makes the decision to GET on the seam load-bearing. Same `## Verified by`
> PR-body gate as [`lattice-survey.md`](./lattice-survey.md).
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> under "Convention rules → enforcement".

## Rule: pedagogy is data; the engine is code

When a requirement expresses **what the course teaches or how it grades**
— a rubric, an IELTS band descriptor, a question bank, a scoring
criterion, a conversation flow, a threshold, a behavioural target, or
learner-facing copy — it MUST be expressed as DATA that an existing
loader reads, NOT as a branch hardcoded into a transform or pipeline
stage.

```
Requirement → "Can the data layer carry this?" → Data path (preferred)
                          ↓ no
              Engine path — generalise the loader, not the instance
```

The Lattice already enforces this on every seam someone has wired
(`registry-schema-coverage` pins schema fields to the registry;
`registry-consumer-coverage` pins registry entries to a reading
transform; the `NEUTRAL_PARAMETER_TARGET` ratchet rejects bare `?? 0.5`
behaviour literals). What none of them catch is the requirement served
by hardcoding **without touching the registry at all** — a value baked
into `transforms/**` is never a registry entry, so the coverage
enumerations have nothing to bite on. This rule closes that gap by
forcing the entry decision into the open before code is written.

## The discriminator (apply it every time)

| Signal | Path |
|---|---|
| A content owner who writes no code could change this later | **Data** |
| It changes per cohort / per content update / per course | **Data** |
| It is a rubric, band descriptor, question bank, threshold, prompt, flow, or copy | **Data** |
| It ships engine behaviour an engineer changes per release | **Code** |
| It is a loader, resolver, scoring runtime, or voice-pipeline capability | **Code** |

When the signals conflict, default to **Data** — the cost of a registry
entry is low and it reaches the educator surface day 1 (the same default
[`registry-schema-coverage.md`](./registry-schema-coverage.md) takes for
new `PlaybookConfig` fields).

## When this applies

Any change where you are about to serve a requirement that affects the
composed prompt, the score, or the learner-facing experience, AND you are
reaching for a code edit under:

- `apps/admin/lib/prompt/composition/transforms/**`
- `apps/admin/lib/pipeline/**`
- `apps/admin/lib/compose/**`

…to encode a value, threshold, rubric, flow, or copy string that an
educator would recognise as "course content" rather than "engine plumbing".

It does NOT apply to engine work: a new loader, a resolver, a refactor, a
bug fix in dispatch logic, RBAC, or any change with no educator-visible
content surface.

## The declaration (rides the `## Verified by` section)

Before serving the requirement, state ONE line in the PR's
`## Verified by` section:

```
Data path: config.<field> / JOURNEY_SETTINGS["<id>"] / <spec slug>
```

— or, when the data layer genuinely cannot express it yet —

```
Engine path: <capability>, because the registry cannot yet express <X>
```

The `## Verified by` section is already required for any Lattice-touching
PR (enforced by `scripts/gh-pr-create.sh`). This rule specifies what the
section must contain when the change has a content surface: the explicit
Data-vs-Engine choice, so a reviewer can challenge a hardcode before it
merges.

Choosing the Engine path is a conscious admission that the data layer has
a gap — pair it with the matching `registry-schema-coverage` /
`registry-consumer-coverage` follow-on so the next author finds a wired
seam instead of repeating the hardcode.

## Pattern: declare-then-write

```typescript
// BAD: requirement → hardcode in a transform → no registry entry to audit
// "The IELTS tutor should ask for 3 Part-1 questions before moving on."
if (module.kind === "ielts_part1") {
  questionTarget = 3;          // pedagogy baked into modules.ts — invisible to coverage
}

// GOOD: requirement → data path declared → existing loader reads it
// Data path: config.modules[].questionTarget  (JOURNEY_SETTINGS "module_question_target")
const questionTarget = resolveModuleSetting(module, "questionTarget");
// The educator tunes the count in the Inspector; the transform reads the registry value.
```

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| This rule + `scripts/gh-pr-create.sh` | Author discipline — the `## Verified by` section MUST carry the Data-path / Engine-path declaration for content-surface changes | A pedagogy requirement served by a hardcode that never touches the registry, so no Coverage test can see it |
| [`registry-schema-coverage.md`](./registry-schema-coverage.md) | `tests/lib/journey/registry-schema-coverage.test.ts` | A `PlaybookConfig` field with no registry contract (the seam, once you're on it) |
| [`registry-consumer-coverage.md`](./registry-consumer-coverage.md) | `tests/lib/journey/registry-consumer-coverage.test.ts` | A registry entry with no reading transform (the other side of the seam) |
| `lib/measurement/neutral-target.ts` + `tests/lib/measurement/neutral-target.test.ts` | Ratchet — no bare `?? 0.5` behaviour literal in transforms | The narrow mechanical slice: a single hardcoded behaviour midpoint |

## When NOT to apply

- Engine-only changes (loaders, resolvers, dispatch, RBAC, scoring
  runtime) — no educator-visible content surface to model as data.
- Bug fixes that restore an existing data path.
- One-off scripts, seeds, fixtures.
- Genuinely intrinsic engine constants (a retry count, a cache TTL, a
  buffer size) — these are plumbing, not pedagogy.

## Future hardening

A scoped structural tooth is feasible without the false-positive noise of
a blanket numeric sweep. Mirror the `NEUTRAL_PARAMETER_TARGET` precedent:
give each genuinely-behavioural transform default a named, sourced
constant (today's bare offenders: `targets.ts` confidence `?? 0.8`,
`retrieval-practice.ts` question counts `?? 2` / `?? 1`, `modules.ts`
duration `?? 15`), then ratchet each named constant's adoption the way
neutral-target ratchets `0.5`. That keeps the gate precise — it fires
only on real behaviour knobs, never on `?? 0` counts. (A measurement on
2026-06-23 found ~23 `?? <number>` fallbacks in `transforms/**`, the
large majority legitimate non-behavioural defaults — which is why the
blanket sweep is the wrong tool and the per-knob constant is the right
one.)

## Related

- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — the pre-coding sibling-writer survey; shares the `## Verified by` gate
- [`.claude/rules/registry-schema-coverage.md`](./registry-schema-coverage.md) — schema → registry coverage (seam, write-side)
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — registry → transform coverage (seam, read-side)
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — the chain inventory
- CLAUDE.md maxim: **Configuration over Code**

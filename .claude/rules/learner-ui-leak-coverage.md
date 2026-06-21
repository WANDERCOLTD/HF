# Learner-UI leak coverage — internal labels must not leak

> Internal-only labels (parameter IDs, criterion names, OUT-NN outcome
> codes, spec slugs, raw mastery scores) MUST NOT appear as quoted
> string literals in learner-UI source files. The static-literal
> Coverage test catches one class of the leak; the runtime SUPERVISE-
> spec scan (proposed in epic [#2135](https://github.com/WANDERCOLTD/HF/issues/2135) S4 / #2139) catches the
> complementary runtime-data-flow class.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (type-union ↔ UI
> consumer presence),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (SessionKind writer + reader),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (journey settings storagePath ↔ transform reader),
> [`parameter-measurement-coverage.md`](./parameter-measurement-coverage.md)
> (Parameter ↔ measurement spec, link 7),
> [`parameter-loop-closure.md`](./parameter-loop-closure.md) (measured
> Parameter ↔ AGGREGATE/ADAPT consumer, link 8).
>
> Born of the 2026-06-21 audit + PR #2134 / #1955 live incident: Part 3
> focus pin shipped showing the IELTS CRITERION label ("Lexical
> Resource", "Pronunciation", etc.) instead of the technique focus
> label ("giving reasons" / "structuring an argument" / "handling a
> challenge" / "expanding an answer") required by the BDD spec
> (US-P3-01 + HF-IELTS-Pre-Voice-Testing-Checklist.md Unit 4). The
> criterion is INTERNAL — it's the dimension the adaptive engine
> measures via Skill scores; the technique is EXTERNAL — what the
> learner sees and what the tutor frames the session around. The
> BIG LATTICE MISS: no structural gate separated the two.

## Rule

When you author code that flows data into a learner-UI render dir
(`components/sim/**`, `app/x/student/**`, `apps/foh/app/**`,
`apps/foh/components/**`):

1. **Do not hardcode internal-only labels as string literals** in those
   dirs. If a learner-facing string is needed, source it from a
   typed union of learner-safe labels (e.g. a `Part3TechniqueFocus`
   union with values like `"giving reasons"`), NOT from internal
   identifiers.
2. **Do not pass values typed as "internal-only" through to render
   props** without a projection step that maps internal → learner-safe.
3. **The projection happens at the boundary** — typically in a
   pipeline stage (REWARD / SUPERVISE / COMPOSE) that reads internal
   state and writes a learner-safe label to `CallerAttribute` /
   `PinnedCardContent.focusArea` / similar. The render path reads ONLY
   the projected value.

## Why the static-literal gate is necessary but not sufficient

This Coverage test catches: **hardcoded internal-only string literals
in learner-UI source files**. That covers cases like a developer
hardcoding `label: "Lexical Resource"` directly in a SimChat component.

It does NOT catch: **values flowing through props from internal
sources at runtime**. E.g., `select-pinned-card.ts` reads
`IELTS_SKILL_LABELS[parameterId]` and stamps it on
`PinnedCardContent.focusArea` → the SimChat render then reads the
stored value. The literal "Lexical Resource" never appears in the
SimChat source — it flows through.

The runtime side is owned by epic [#2135](https://github.com/WANDERCOLTD/HF/issues/2135) S4 (#2139) — a
SUPERVISE-stage spec that scans the composed prompt and learner-facing
projection at compose-time for the same leak patterns. The two gates
together close the loop:

| Layer | Catches | Gate |
|---|---|---|
| Build-time | Hardcoded internal-only literals in learner-UI source | This Coverage test |
| Runtime | Internal values flowing through props or composed-prompt content | SUPERVISE-spec (#2139) |
| Type-system (future) | Internal-only typed values passed where learner-safe expected | Branded types / `@internalOnly` JSDoc + ESLint |

## How matching works

For each label in every set in `INTERNAL_LABEL_REGISTRY`:
- Concatenate source from `LEARNER_UI_DIRS` (excluding `.test.ts` files).
- Regex check: does `"<label>"` or `'<label>'` appear in the source?
- Match → leak. Listed in exempt → exempt. Else → clean.

Ratchet pins both the leak count AND the exempt count. Either
direction of drift fails CI.

## Course-agnostic by design

`INTERNAL_LABEL_REGISTRY` is a Record where each key is a course or
category name and each value is `{ description, labels[] }`. Add a new
course → add a key. The test auto-walks the union. No course-specific
test edits beyond the registry entry.

Today's registry at the test's birth (2026-06-21):

| Set key | Description | Labels |
|---|---|---|
| `IELTS_CRITERIA` | Scoring criteria — internal axes the adaptive engine measures; learner sees technique focus (Part 3) or overall band (Mock Results), never these directly during normal session UI | "Fluency and Coherence", "Lexical Resource", "Grammatical Range and Accuracy", "Pronunciation" |
| `IELTS_CRITERION_SLUGS` | Internal parameter IDs / slug forms — engine-side addressing | `skill_*` slugs for the same 4 criteria |

Future: `CIO_CTO_COMPETENCIES`, `KS2_SATS_STRANDS`, `OCEAN_TRAITS`, etc.

## Today's exemptions

| Key | Reason |
|---|---|
| `IELTS_CRITERIA:Lexical Resource` | Mock Results screen sanctioned per BDD US-Mock-05 — per-criterion bands shown only on Results screen, not in pin/session UI |
| `IELTS_CRITERIA:Pronunciation` | Same — Mock Results screen sanctioned |

The Mock Results screen is explicitly defined in
HF-IELTS-Pre-Voice-Testing-Checklist Unit 5 + BDD US-Mock-05 as the
ONE learner-facing surface that displays per-criterion scores. Both
exempt entries point at the same FOH stub
(`apps/foh/app/api/scores/route.ts`) that serves that screen.

## When NOT to apply

- The Mock Results screen surface — sanctioned, exempt-with-reason.
- Operator-only diagnostic panels embedded inside a `components/sim/`
  file but gated by role — exempt with reason explaining the gate.
- Test fixtures — `.test.ts` / `.test.tsx` files are excluded by the
  walker.

## When adding a new course

Author checklist (same PR):

1. Open `tests/lib/sim-chat/learner-ui-leak-coverage.test.ts`.
2. Add a new key to `INTERNAL_LABEL_REGISTRY` with `description`
   (>30 chars) and `labels[]` (the literal strings that should never
   leak from this course's internal dimensions).
3. Run the test. If new leaks appear, either:
   - Move the offending label out of learner-UI dirs (preferred), OR
   - Add to `LEARNER_UI_LEAK_EXEMPT` with a substantive reason +
     bump `EXPECTED_EXEMPT_COUNT`.
4. If sanctioned learner-surface (e.g., a Results screen for the new
   course), exempt with reason citing the BDD spec that sanctions it.

## When deleting a label

1. Remove from the registry (or the exempt list).
2. Drop `EXPECTED_EXEMPT_COUNT` if needed.
3. Run the test — the non-stale-exempt assertion catches drift.

## Related

- [`tests/lib/sim-chat/learner-ui-leak-coverage.test.ts`](../../apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts) — this test
- [`apps/admin/lib/curriculum/derive-focus-area.ts`](../../apps/admin/lib/curriculum/derive-focus-area.ts) — `IELTS_SKILL_LABELS` source (the labels this gate keeps OUT of learner-UI dirs)
- [`apps/foh/app/api/scores/route.ts`](../../apps/foh/app/api/scores/route.ts) — Mock Results screen FOH stub (the 2 exemptions point here)
- Epic [#2135](https://github.com/WANDERCOLTD/HF/issues/2135) — IELTS scoring as canonical MEASURE specs (the architectural substrate; #2139 lands the runtime SUPERVISE-spec gate)
- Story #1955 (PR #2134, merged 2026-06-20) — the live incident showing the criterion-leaking-to-pin failure mode this Coverage gate exists to prevent recurring
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage gate (UI consumer presence)
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling Coverage gate (SessionKind writer/reader)
- BDD source: HF-IELTS-Pre-Voice-Testing-Checklist.md (Unit 4 US-P3-01 + Unit 5 US-Mock-05) + HF IELTS — BDD Stories (US-P3 + US-Mock)

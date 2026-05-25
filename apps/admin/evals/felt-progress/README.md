# Felt Progress — Promptfoo behaviour evals

> Epic: [#778](https://github.com/WANDERCOLTD/HF/issues/778) — make learners
> feel measurable educational progress.

One YAML per behavioural contract this epic restores or introduces. The pattern
mirrors `evals/epic-100/`: each story ships an `after` prompt that asserts the
new behaviour is detectable, and the eval stays in CI as a regression net.

## File map

| File | Story | Contract |
|------|-------|----------|
| `progress-narrative-gates.yaml` | #779 (S1) | progressNarrative section is omitted when no evidence, enabled=false, or call 1; emitted with strict-rule guidance when evidence is present |

## Running locally

```bash
npx promptfoo eval -c apps/admin/evals/felt-progress/
```

Promptfoo configuration (provider, judge model) inherits from
`apps/admin/promptfoo.yaml` when present; otherwise each YAML self-describes.

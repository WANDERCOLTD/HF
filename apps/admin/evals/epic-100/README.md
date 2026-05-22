# Epic 100 — Promptfoo behaviour evals

> Required reading: `docs/epic-100-chain-walk.md`, `docs/epic-100-verification.md`,
> [Epic #600](https://github.com/WANDERCOLTD/HF/issues/600), harness [#631](https://github.com/WANDERCOLTD/HF/issues/631).

One YAML per behavioural contract the epic restores. The pattern is **before / after**:

1. **Before any story merges** — eval captures today's broken composed prompt and asserts the broken behaviour is detectable. This proves the eval is sensitive to the failure mode.
2. **After the story merges** — eval is flipped to assert the fixed behaviour against the new composed prompt, and stays in CI as a regression net.

Each YAML has three sections:

```yaml
description: ...one-line summary...
# Story:  #606
# Status: BEFORE (asserts the broken behaviour is detectable)
# Flip:   when #606 merges, swap assertions in `flip-after-merge:` into `tests:`

prompts:
  - id: before
    raw: |
      ...today's broken composed-prompt snippet...
  - id: after
    raw: |
      ...the expected fixed snippet (populated by the story PR)...

tests:
  - vars: { prompt: '{{prompts.before}}' }
    assert:
      - type: javascript
        value: |
          // BEFORE: assert the broken behaviour is detectable
          return output.includes("...known-bad string...");

flip-after-merge:
  tests:
    - vars: { prompt: '{{prompts.after}}' }
      assert:
        - type: javascript
          value: |
            return !output.includes("...known-bad string...");
```

The `flip-after-merge` section is *documentation* — it lists the assertions the
story PR must move into `tests:` once the fix lands. Promptfoo itself ignores
unrecognised keys, so the YAML stays valid throughout the migration.

## File map

| File | Story | Contract |
|------|-------|----------|
| `no-double-recall-check.yaml` | #604 | preamble criticalRules not recited before teaching |
| `no-tutor-training-mcq.yaml` | #606 | TUTOR_ONLY questions never appear in practiceQuestions |
| `no-criterion-recital-opening.yaml` | #604 | tutor does not open with IELTS-band criterion list |
| `confirms-on-memory-contradiction.yaml` | #608 + TUT-001 | tutor confirms when caller memory contradicts new statement |
| `teaching-mode-archetype-aware.yaml` | #604 | criticalRules vary by playbook teachingMode/archetype |

## Running locally

```bash
# Single eval
npx promptfoo eval -c apps/admin/evals/epic-100/no-tutor-training-mcq.yaml

# All Epic 100 evals
npx promptfoo eval -c apps/admin/evals/epic-100/
```

Promptfoo configuration (provider, judge model) inherits from
`apps/admin/promptfoo.yaml` when present; otherwise each YAML self-describes.

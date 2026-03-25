---
paths:
  - "apps/admin/lib/chat/v5-system-prompt.ts"
  - "apps/admin/lib/chat/wizard-system-prompt.ts"
  - "apps/admin/lib/chat/conversational-system-prompt.ts"
  - "apps/admin/lib/chat/*system-prompt*"
  - "apps/admin/app/api/chat/system-prompts.ts"
  - "apps/admin/lib/wizard/graph-evaluator.ts"
---

# Prompt Eval Enforcement

**Any change to a wizard system prompt MUST have a corresponding promptfoo eval.**

## Rule

When you modify any file matched by this rule's paths:

1. **Identify what changed** — new behaviour, removed behaviour, or changed behaviour
2. **Check existing evals** — do the evals in `evals/wizard/` already cover the changed behaviour?
3. **If not covered** — write or update a promptfoo eval YAML that tests the new/changed behaviour
4. **Run the eval** — remind the user to run `npm run eval:wizard:v5:all` (or the specific eval)

## What counts as "covered"

- Every behavioural rule in the prompt has at least one test case
- Every tool usage pattern has at least one assertion
- Every banned phrase/pattern has a `not-icontains` or equivalent assertion
- New V5-specific features (community hubs, amendment tiers, graph-driven flow) have dedicated eval files

## Eval file locations

| Prompt file | Eval files |
|-------------|-----------|
| `v5-system-prompt.ts` | `evals/wizard/v5-*.yaml` |
| `wizard-system-prompt.ts` | `evals/wizard/v4-*.yaml` |
| `conversational-system-prompt.ts` | `evals/wizard/v4-*.yaml` |

## Run commands

```bash
npm run eval:wizard:v5        # V5 core rules
npm run eval:wizard:v5:all    # All V5 evals
npm run eval:all              # Everything (V3 + V4 + V5)
npm run eval:view             # Open results UI
```

## Failure mode

If a prompt change ships without eval coverage, the `prompt-diff` agent will flag it and the `guard-checker` (Guard 14) will report it as a violation.

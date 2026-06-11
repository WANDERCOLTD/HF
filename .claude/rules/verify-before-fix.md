# Verify Before Fix

> Don't trust screenshot OCR. One DB query, log line, or vitest result will
> disprove (or confirm) the premise faster than a coded round-trip.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (write-side validate-before-execute)
> and [`ai-read-grounding.md`](./ai-read-grounding.md) (AI-side verify-before-claim).
> This file holds the **developer-side** verify-before-fix pattern.

## Rule: Cite concrete evidence before proposing a fix path

When the user (or you) describes a bug from a UI screenshot, a vague
narrative, or a "I think it's doing X" intuition, **run the minimal state
query that distinguishes "real bug" from "I imagined it" BEFORE writing
any code or filing follow-on stories.**

```
Symptom → Minimal verification query → Only then propose fix
```

## When This Applies

Any code path where:

1. The trigger is a screenshot ≤1080px tall, a paraphrased complaint, or an
   intuition without a citation.
2. The proposed fix touches a runtime path that is also observable in the
   database, an `AppLog` subject line, a vitest, or a curl probe.
3. The cost of the verification query is < 5 minutes.

Most acutely: composed-prompt regressions ("the recap renders garbage"),
caller-state bugs ("Bertie's voice is wrong"), pipeline silent-skip bugs,
and anything described as "sometimes happens".

## Required Evidence Forms

| Evidence type | When to use | Example |
|---|---|---|
| **SQL query + result** | Composed-prompt state, caller state, FK consistency | `SELECT recapSynthesisCache FROM "ComposedPrompt" WHERE callerId=… AND status='active'` |
| **Vitest name + path** | Branch logic, regex, parser | `tests/api/chat-factual-grounding.test.ts → "rejects ungrounded enrollment claim"` |
| **Playwright trace** | UI flow, click sequence, race | `e2e/sim-call.spec.ts → trace.zip` |
| **Log subject line** | Production / VM live trace | `voice.outbound_dial.assistant_payload` |
| **HTTP probe** | API contract, auth gate | `curl -sS -b $COOKIES http://localhost:3000/api/callers/<id>/learning-trajectory` |

## Pattern: Evidence-then-fix

```typescript
// BAD: screenshot → "the recap renders garbage" → fabricated story → fix
//       (PR #1406 — recapSynthesisCache was null; the path never fired)

// GOOD: screenshot → SQL → "cache is null, path never fired" → close issue
const result = await prisma.composedPrompt.findFirst({
  where: { callerId: "...", status: "active" },
  select: { recapSynthesisCache: true, prompt: true },
});
// result.recapSynthesisCache === null → premise disproven; do not fix.
```

## Existing Enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `scripts/gh-pr-create.sh` | Wraps `gh pr create`; rejects PRs whose body lacks a `## Verified by` section with concrete evidence | Shipping a fix-story without a citation (the #1406 fingerprint) |
| `docs/kb/guard-registry.md#guard-verify-before-fix` | Catalogue entry | Discoverability — every guard points back at its row |
| `memory/feedback_verify_before_fix_misread_2026_06_09.md` | Operator memory | The original incident + the rule it produced |

## When NOT to apply

This rule is about **citation discipline**, not about banning quick fixes.

- Trivial typo fixes (single-line)
- README / docs commits
- Reverts (`Revert "..."`) — the linked commit *is* the evidence
- PRs explicitly tagged `--no-verify-section` in `gh-pr-create` (warn-only path
  for docs / dependency bumps)

## Escalation

If the verification query is genuinely impossible (e.g. fix is for a path
the dev environment can't exercise), document why in the PR body's
`## Verified by` section — explicit `Unable to verify here, will verify on
hf-staging after deploy` is acceptable evidence (the citation is the
*honest acknowledgement* of the gap, not a fake test name).

If verification disproves the premise: close the issue with the evidence,
don't hunt for the imagined bug in adjacent tables. This is how PR #1406's
"live evidence" turned into a post-merge correction comment.

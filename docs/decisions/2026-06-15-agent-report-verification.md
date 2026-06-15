# ADR: Agent-report verification — inverse-probe contract for sub-agent briefs

**Date:** 2026-06-15
**Status:** Accepted
**Deciders:** Paul W

## Context

Session 2026-06-15 spawned four `Explore` agents in parallel to audit
course-creation, source→skills/LOs/attainment, upfront-assessment, and
voice-analysis-in-pipeline. The briefs returned 8 specific claims the user
pressed on. After direct file reads + targeted probes by the orchestrator,
**6 of 8 were wrong.** Pattern:

| Wrong claim | Why it failed |
|---|---|
| `reuse-path.ts` skips projection + inherits nothing | Reasoned about `reuse-path.ts`; real path is `_reuse-path.ts` (underscore prefix) — one letter killed the find |
| `no-ai-fanout-all.mjs` doesn't exist | Never listed `eslint-rules/`; inferred from a zero-result search |
| `firstCallMode` invisible in UI | Searched `lib/` and `lib/wizard/`; never searched `app/x/courses/` where the Design-tab chip lives |
| `Call.loScoresJson` legacy/divergent | Confused with `CallerModuleProgress.loScoresJson` (the column actually on schema) |
| Skills not linked to LOs | Searched for a direct join table; missed the `BehaviorTarget.skillRef → parameterId` provenance chain (#417) and the dual ref on `ContentQuestion` |
| Voice analysis never reaches next prompt | Searched composition for `voiceProsody`; missed the `CallScore → priorCallFeedback.ts` + `CallerTarget.currentScore` (skill_ema EMA) pathways |

Every wrong claim was a *negative* — "X doesn't exist", "Y has no callers",
"Z is dead code" — asserted without a corroborating positive probe.
Parallelism amplified the failure: each agent saw a slice; none could
cross-check the others.

Three existing guard layers cover adjacent surfaces but not this one:

| Layer | Surface | Pattern |
|---|---|---|
| [`ai-to-db-guard.md`](../../.claude/rules/ai-to-db-guard.md) | AI output driving DB writes | validate-then-execute |
| [`ai-read-grounding.md`](../../.claude/rules/ai-read-grounding.md) | AI text in chat asserting facts | verify-then-claim (grounding tool call same turn) |
| [`verify-before-fix.md`](../../.claude/rules/verify-before-fix.md) | Developer fixing from screenshot/intuition | symptom → cite-then-fix |

No layer covers the AGENT-REPORT surface — sub-agent briefs reaching the
orchestrator or user. Today's failure was the predictable consequence of
that gap.

Reuse check (AP-3 discipline): `reuse-finder` confirmed nothing relevant in
`.claude/rules/`, `.claude/agents/`, `.claude/hooks/`, `docs/kb/`, or memory.
The existing `reuse-finder.md` §Step 2 ("spot-verify the top hits") is the
nearest precedent — in-agent discipline, advisory, not a result gate.

## Decision

Introduce [`.claude/rules/agent-report-verification.md`](../../.claude/rules/agent-report-verification.md)
as a sibling to the three existing AI-grounding rules. The rule encodes:

1. **Inverse-probe contract** — every prompt the orchestrator passes to a
   spawned agent must instruct the agent to run an inverse probe before
   asserting any negative claim.
2. **Probe-then-relay discipline** — on receiving a brief, the orchestrator
   either corroborates each consequential negative claim with a positive
   probe in the same turn, or labels the claim `[unverified]` to the user.
3. **Negative-claim taxonomy** — a structural list of inverse-probe types
   (name-form, directory, schema-aware, dynamic-dispatch, single-tree,
   test-namespace) so the discipline is concrete, not aspirational.

Catalogue the rule in [`docs/kb/guard-registry.md`](../kb/guard-registry.md)
as a `(meta)` process gate per the existing classification — sibling to
the chase-prevention rows.

The rule never enumerates agent names, tool names, or path patterns inline.
It points at the live registries: `.claude/agents/` for agent types,
CLAUDE.md for the search-tool mandate (qmd over grep), `prisma/schema.prisma`
for schema-aware probes.

## Consequences

- **Cost:** every parallel-agent fanout incurs a synthesiser pass before
  the orchestrator relays. Single-claim probes from quick agents stay cheap
  via the "not consequential → label `[unverified]`" branch.
- **Benefit:** false-negative claims caught at the orchestrator boundary,
  before they reach the user or drive follow-on stories. Today's session
  caught five wrong claims by re-probing manually — that work becomes
  structural.
- **Side-effect on existing rules:** none. `reuse-finder.md` §Step 2 stays
  valid as the agent's own discipline; the new rule covers the orchestrator's
  duty regardless of which agent ran.
- **Side-effect on retros:** sessions where the wrong-claim rate spikes
  >20% from a particular agent type get a retro flag against that agent's
  prompt/capability definition.

## Alternatives considered

1. **Hook on Agent tool output.** No harness surface exists today for a
   `PostAgentResult` hook. Defer until the harness supports it; the rule
   stays valid in the meantime as orchestrator discipline.
2. **Make sub-agents serial.** Loses parallelism without addressing the
   root cause — each agent's slice is still partial; serial agents still
   can't cross-check.
3. **Raise agent verbosity / thoroughness.** Tried implicitly across this
   session. Doesn't help — wrong-form negative searches return zero faster,
   not more accurately.
4. **Do nothing.** Session accuracy rate (2/8 = 25%) is below the
   threshold where the agent layer is net-positive. Untenable.

## References

- [`.claude/rules/agent-report-verification.md`](../../.claude/rules/agent-report-verification.md) — the rule itself
- [`.claude/rules/verify-before-fix.md`](../../.claude/rules/verify-before-fix.md) — sibling (developer side)
- [`.claude/rules/ai-read-grounding.md`](../../.claude/rules/ai-read-grounding.md) — sibling (chat side)
- [`.claude/rules/ai-to-db-guard.md`](../../.claude/rules/ai-to-db-guard.md) — sibling (write side)
- [`docs/decisions/2026-06-11-chase-prevention-methodology.md`](./2026-06-11-chase-prevention-methodology.md) — precedent for process-gate rules
- [`docs/kb/guard-registry.md`](../kb/guard-registry.md) — catalogue entry (`(meta)` class)
- Memory: `feedback_chase_loop_anti_patterns.md` (AP-3 sibling pattern)

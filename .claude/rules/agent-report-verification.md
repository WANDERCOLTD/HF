# Agent-Report Verification

> Every negative claim returned by a sub-agent — spawned via the `Agent` tool,
> types catalogued in [`.claude/agents/`](../agents/) — must be corroborated by
> an inverse probe before reaching the user or driving downstream action.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (WRITE-side
> validate-before-execute), [`ai-read-grounding.md`](./ai-read-grounding.md)
> (CHAT-side verify-then-claim), and [`verify-before-fix.md`](./verify-before-fix.md)
> (DEVELOPER-side symptom-then-cite). This file holds the **AGENT-REPORT side**
> probe-then-relay pattern.
>
> Decision: [`docs/decisions/2026-06-15-agent-report-verification.md`](../../docs/decisions/2026-06-15-agent-report-verification.md).
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) as `(meta)`.

## Rule: Negative claims in agent briefs are unverified until inversely probed

When a sub-agent returns a brief asserting that something *does not exist*,
has *no callers*, is *dead code*, or has *no test coverage*, the claim is
structurally unverifiable from a single forward search. The agent searched
for one form of a name and didn't find it — that does not establish absence,
only that the search vocabulary was wrong.

```
Agent asserts negative → orchestrator runs inverse probe → only then relay
```

## When This Applies

Any orchestrator turn where:

1. A sub-agent (any type in [`.claude/agents/`](../agents/)) returns a brief
   via the `Agent` tool, AND
2. That brief contains one or more claims of the *absence* form (sample shapes
   below), AND
3. The orchestrator is about to either (a) relay the brief to the user, or
   (b) act on the claim — file a story, recommend a fix, change code.

Negative-claim shapes to watch for in any brief:

| Shape | Example phrasing | Required inverse probe |
|---|---|---|
| **Non-existence** | "X doesn't exist", "no file named X" | List the parent directory; probe alternate name forms (leading `_`, plural/singular, kebab/camel/snake) |
| **No-callers** | "Y has no callers", "Z is dead code" | Search dynamic-dispatch surfaces: registry maps, lazy `import(…)` strings, hook arrays, string-keyed factories |
| **Schema absence** | "field A is not on model M" | Read `prisma/schema.prisma` for model M directly; do not rely on grep — field may live on a sibling model with a similar name |
| **Wiring absence** | "the loader doesn't read W" | Probe the loader AND the consuming transforms AND the cascading data structure (`AssembledContext`, etc.) |
| **Coverage absence** | "no test pins this" | Probe `tests/` under multiple namespaces (`tests/lib/`, `tests/api/`, `tests/integration/`, `tests/components/`, `evals/`) plus seed-script tests |
| **Single-tree drift** | (path under `.claude/worktrees/…`) | Re-probe against the primary tree. Worktrees are stale by definition. |

Concrete examples for every row in the 2026-06-15 fingerprint live in the
parent ADR.

## Required Behaviours

### A. Prompt contract for spawned agents

When spawning a sub-agent — especially `Explore`, `Plan`, or
`general-purpose` — include in the prompt:

> *"Before asserting a negative ('X doesn't exist', 'Y has no callers', 'no
> test pins this'), run the inverse probe: alternate name forms, sibling
> directories, dynamic-dispatch surfaces (registries, lazy imports), and the
> schema directly when the claim is about a DB field. State both probes in
> the finding. Per CLAUDE.md, prefer `qmd` over `grep` — qmd normalises name
> forms and ranks by meaning, catching most of the cases that defeat a literal
> grep."*

### B. Orchestrator discipline on receiving a brief

For each negative claim in the brief:

1. **Consequential** (user will act on it / a fix decision will ride on it)
   — run the inverse probe in the orchestrator turn before relaying. Cite
   both the agent's original probe and the orchestrator's inverse probe in
   the relayed text.
2. **Not consequential** (background context, low blast radius) — relay
   with an explicit `[unverified]` marker so the user can request a probe.
3. **Never adopt a negative claim verbatim** without one of (1) or (2).

### C. Parallel-fanout synthesis

When multiple sub-agents run in parallel and ANY return negative claims, the
orchestrator's synthesis pass must:

- Reconcile contradictions across agents (one says "X exists", another says
  "X doesn't") before relaying either claim.
- Treat all parallel negatives as mutually un-cross-checked — none of the
  agents saw the others' evidence. Default to inverse-probing the
  load-bearing ones before they ship.

## Inverse-probe taxonomy

| Probe type | Trigger | Mechanism |
|---|---|---|
| **Name-form inversion** | Agent searched literal name; zero hits | Probe `_<name>`, `<name>s`, `<Name>`, kebab↔camel↔snake, leading dot |
| **Directory inversion** | Agent searched one tree | Probe the sibling tree (`lib/` ↔ `app/`, `apps/admin/lib/` ↔ `apps/admin/app/`) |
| **Schema-aware** | Claim about a Prisma model column | Read `prisma/schema.prisma` for the named model directly. Sibling models with similar names are a common confusion vector |
| **Dynamic-dispatch** | "No callers of Y" / "dead code" | Probe registry/factory maps and `import(…)` strings — code reachable by string key shows zero static callers |
| **Single-tree drift** | Path cited under `.claude/worktrees/…` | Re-probe in the primary tree |
| **Test-namespace inversion** | "No test exists" | Probe every `tests/<area>/` plus `evals/` plus seed-script tests |

## Pattern: probe-then-relay

```typescript
// BAD: agent returns brief → orchestrator relays verbatim
const brief = await spawnAgent({ subagent_type: "Explore", prompt: "…" });
return brief; // includes "X doesn't exist" — unverified

// GOOD: agent returns brief → orchestrator probes negatives → labelled relay
const brief = await spawnAgent({ subagent_type: "Explore", prompt: "…" });
for (const claim of negativeClaimsIn(brief).filter(c => c.consequential)) {
  claim.verifiedBy = await runInverseProbe(claim);  // see taxonomy above
}
return brief; // each consequential negative carries a probe citation
```

The orchestrator pattern doesn't require new code — it's a discipline applied
in the same turn the brief is received.

## Existing Enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| This rule | Orchestrator discipline + spawned-agent prompt contract | False-negative claims reaching the user or driving downstream action (the 2026-06-15 fingerprint: 6 of 8 agent claims wrong, all unverified negatives — see parent ADR for the row-by-row failure table) |
| [`.claude/agents/reuse-finder.md`](../agents/reuse-finder.md) §Step 2 | In-agent spot-verify (READ-based) | Agent-internal hallucination — advisory, not a result gate; complements but does not replace this rule |
| CLAUDE.md "qmd over grep" mandate | Project convention | Most name-form / vocabulary failures (qmd normalises name forms; grep does not) |
| [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) row (meta) | Discoverability | Process-gate visibility — operator can find the rule from the registry |

## When NOT to apply

This rule is about *negative* claims. Positive claims ("X exists at path P
line L", "Y is called from Z:N") are self-verifying — they include a
citation. The rule kicks in specifically when a brief asserts absence.

Exemptions:

- Trivial single-claim probes from quick agents where ceremony cost
  outweighs risk.
- Agent briefs the orchestrator spawned *itself* to spot-verify another
  agent's claim — the spot-verifier IS the inverse probe, no recursion.
- Documentation-style queries ("summarise this folder") where the agent
  isn't asserting absence of anything.

## Escalation

If you spawn an agent and the surface is genuinely under-defined such that
any inverse probe is also speculative, state the limit explicitly in the
orchestrator's response:

> *"This finding has no inverse-probe support — treat as a lead, not a
> verdict."*

If the wrong-claim rate from a particular agent type spikes (>20% in any
session), file a retro flag against that agent's prompt or capability list.
The agent definition lives in [`.claude/agents/<name>.md`](../agents/) and
is editable — the rule is not coupled to a particular agent's prompt; it
covers the orchestrator's duty regardless.

## Related anti-patterns

This rule is the structural answer to a sibling of AP-3 ("Parallel
infrastructure proposed without checking what exists"). Where AP-3 is the
*proposer's* discipline before recommending new infrastructure, this rule
is the *orchestrator's* discipline before adopting an agent's negative
finding. Both share the same root: confidence asserted without a
corroborating probe.

Memory: `feedback_chase_loop_anti_patterns.md`.

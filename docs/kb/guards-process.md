# Guards Process — how a lesson becomes an enforced invariant

> The ritual that keeps [`guard-registry.md`](./guard-registry.md) and
> [`invariants.md`](./invariants.md) alive. CLAUDE.md and `.claude/rules/ai-to-db-guard.md`
> hold the **triggers** ("when X, do Y") and point here; this doc holds the **procedure**.
> Don't copy CLAUDE.md's operational rules into this file — link to them.

## The lifecycle

```
incident / bug          ──▶  1. INVARIANT     state the durable truth (invariants.md)
revealed a hidden contract     2. GUARD        write executable enforcement (eslint / check-* / runtime)
                               3. REGISTER     add a row to guard-registry.md + classify a/b/c/meta
                               4. WIRE         meta.docs.url / failure msg → #guard-<name>
                               5. PIN          a test that fails without the guard
                               ──── later ────
                               6. RETIRE/DRAIN  scaffold (b) retired when its detail changes;
                                                drain (c) deleted when its counter hits zero
```

## 1. Invariant — state the durable truth

A bug that revealed an implicit contract earns a one-line invariant in `invariants.md`:
the rule that must hold in **any** architecture. Keep it architecture-independent ("AI
output is validated before any DB write"), not implementation-specific ("call
`validateManifest`"). The *mechanism* goes in the guard; the *principle* goes here.

## 2. Guard — pick the cheapest structural enforcement

| If the violation is detectable… | …use |
|---|---|
| statically, at a call site | a custom **ESLint rule** (`apps/admin/eslint-rules/`) |
| only against real data / FKs | a **`check-*` CI script** (`apps/admin/scripts/`) |
| only at runtime, mid-request | a **runtime validator** (validate-then-write; see `ai-to-db-guard.md`) |
| as a count that must not grow | a **ratchet** (`.ratchet.json` + `check-ratchet.sh`) |
| as an architectural property | a **fitness function** test |

If you genuinely can't add a structural guard, leave a `// TODO(ai-guard):` (tracked by the
`broken-windows` agent) — never ship the lesson as prose alone.

## 3. Register & classify

Add one row to the right table in `guard-registry.md` with the **survives-hardening class**:

- **(a) Invariant** — true in any architecture → carry forward through the hardening.
- **(b) Scaffold** — protects today's implementation detail → retire consciously when it changes.
- **(c) Drain** — temporary migration ratchet → delete when its counter hits zero.
- **(meta)** — process gate / fitness function → keep & extend.

One guard, one row. If it's an adaptive-loop boundary, the mechanism lives in
[`CHAIN-CONTRACTS.md`](../CHAIN-CONTRACTS.md) and the registry row *points* there — don't re-list.

## 4. Wire it back (the load-bearing step)

- ESLint rule → set `meta.docs.url` to `…/guard-registry.md#guard-<rule-name>`.
- `check-*` script → print that anchor URL in its failure message.
- Add the anchored **Guard detail** block in `guard-registry.md`.
- The meta-ratchet [`check-guard-kb-links.ts`](../../apps/admin/scripts/capture/check-guard-kb-links.ts)
  enforces this for ESLint rules — lower its baseline as you wire each one.

## 5. Pin with a test

A guard with no test is a guard one refactor from silent removal. Add the vitest/promptfoo/CI
assertion that fails when the guard is deleted. Record `file:line` in the registry row.

## 6. Retire or drain

- **Scaffold (b):** when the implementation detail it protects changes (e.g. a schema
  migration removes per-parent slug uniqueness), retire the rule *in the same PR* and note
  it in the tombstone log — don't let it linger as a false constraint.
- **Drain (c):** track the legacy-count audit to zero, then delete the rule and its script.

## Promote doc-only contracts (the hardening worklist)

Any contract that exists only in prose (a `CHAIN-CONTRACTS.md` row with an empty
**Enforcement** cell, a `CONTRACTS-*.md` rule with no guard) is a gap. The hardening
program promotes each into a class-**a** guard via steps 2–5 above. This is capture *and*
hardening in one pass — see `guard-registry.md` § "Doc-only contracts to PROMOTE".

## Triggers (defined elsewhere — do not duplicate)

| Trigger | Defined in |
|---|---|
| "About to commit" → `scope-enforcer` | `CLAUDE.md` |
| Schema changed → `migration-checker` | `CLAUDE.md` |
| AI writes to DB → validate-then-write + tray | `.claude/rules/ai-to-db-guard.md` |
| Post-plan / pre-commit → all 15 plan guards | `.claude/agents/guard-checker.md` |

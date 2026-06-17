# Lattice self-maintenance — the meta-gate

> `docs/lattice-chains.md` (PR #1863) is the inventory of every
> producer↔consumer chain in HF. This rule ensures the inventory
> stays current. The structural enforcement lives in
> [`tests/lib/lattice-self-maintenance.test.ts`](../../apps/admin/tests/lib/lattice-self-maintenance.test.ts).
>
> Sibling Coverage-pillar gates use the same generic enumerate→classify→ratchet
> pattern; this gate applies it RECURSIVELY to the Lattice doc itself.

## Rule

Two directions of pairing, both enforced:

1. **Inventory → reality**: every gate file path cited in
   `docs/lattice-chains.md` MUST exist on disk. If you remove a gate
   file, remove the row OR fix the path.
2. **Reality → inventory**: every structural gate on disk MUST be
   mentioned in the inventory (by filename anywhere in the doc) OR be
   added to `INVENTORY_EXEMPT` with a one-line reason. The "must be
   mentioned" check uses ratchets — current incumbent orphans are
   frozen; future PRs can only drop the count.

The four ratchets (as of 2026-06-17):

```
EXPECTED_ORPHAN_COUNT_COVERAGE = 9
EXPECTED_ORPHAN_COUNT_ESLINT   = 24
EXPECTED_ORPHAN_COUNT_SCRIPTS  = 15
EXPECTED_ORPHAN_COUNT_RULES    = 18
```

Each row added to the inventory drops a ratchet by 1.

## Why this exists

`docs/lattice-chains.md` was filed to close the reactive-discovery loop
— the operator was frustrated by ad-hoc audits surfacing new gaps
repeatedly. The inventory's purpose is to let future agents READ it
instead of re-discovering chains.

That only works if the inventory stays current. Without self-maintenance:

- New tests land but the matrix isn't updated → drifts toward worthless
- Gate files get renamed/moved → cited paths become stale → trust erodes
- Rules get deleted → the inventory still claims they enforce something

Self-maintenance is the meta-Coverage-pillar gate. It's how the Lattice
prevents its own decay.

## How to fix a failure

| Failure shape | Fix |
|---|---|
| "Inventory cites paths that don't exist on disk" | Either remove the row (gate retired) OR fix the path (file renamed/moved). Don't merge with stale citations. |
| "Coverage-test orphan count" / "ESLint-rule orphan count" / "CI-script orphan count" / "Rule-file orphan count" | Add a row to `docs/lattice-chains.md` for the orphan file. Drop `EXPECTED_ORPHAN_COUNT_<TYPE>` by 1. |
| "INVENTORY_EXEMPT ratchet drifted" | Bump conscientiously. Each exemption is "this gate legitimately doesn't have an inventory row" (meta-rules, author conventions). Most new gates SHOULD be rowed. |
| "Empty exempt reason" | Each exemption needs a >20-char justification. Write one. |

## When NOT to apply

The self-maintenance gate is **structural**. It always applies. What's
exempted is specific files via `INVENTORY_EXEMPT` (currently 3 entries
— the test itself + this rule + `api-conventions.md` as a documented
author-discipline file).

## When adding a new structural gate

Author checklist — same PR:

1. Build the gate (vitest / ESLint rule / CI script).
2. Add a row to the appropriate section of `docs/lattice-chains.md`
   citing the gate file's path.
3. Run `npx vitest run tests/lib/lattice-self-maintenance.test.ts`.
   If green → ship. If a ratchet failed, drop it.
4. If the gate is a meta-rule (enforces inventory state itself) → add
   to `INVENTORY_EXEMPT` with reason instead of rowing.

## How to use the inventory as an agent

When an Explore / Plan / general-purpose agent is about to claim "no
Lattice gap here":

1. Open `docs/lattice-chains.md`.
2. Find the chain in the matrix.
3. If PROTECTED → cite the gate file (the self-maintenance test
   guarantees it exists).
4. If PARTIAL → cite the gate + known-gap detail.
5. If GAP → file as a Coverage follow-on using the template.
6. If the chain isn't in the file — add a row, don't claim absence
   from the matrix as absence from the codebase.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/lattice-self-maintenance.test.ts` (born 2026-06-17, this PR) | 9 vitests: inventory exists, citation-existence, 4 orphan ratchets, exempt-count ratchet, non-empty-reason, distribution sanity | Inventory drift in either direction |
| `docs/lattice-chains.md` (#1863) | The inventory itself | The substrate this gate maintains |

## Future hardening

When the 4 orphan ratchets all drop near 0, lower the maximum allowed
orphan count to 0 — at that point every new gate MUST land with an
inventory row. We're at incumbent counts today because too many
existing tests / rules / scripts pre-date the inventory.

When all orphans cleared, add a positive assertion: every gate row in
the inventory has a recently-touched gate file (within 6 months) OR is
marked "stable / quiescent". Catches abandoned gates.

## Related

- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — the inventory
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test (template for new gates)
- Memory: `feedback_lattice_guard_umbrella.md` — original 4-pillar Lattice
- Memory: `feedback_lattice_5th_pillar_coverage.md` — Coverage pillar

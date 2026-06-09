# HF Knowledge Base (`docs/kb/`)

> **This is not a refactor.** We rejected a from-scratch rewrite (657k LOC, 105 models,
> a museum of hard-won fixes #407→#1372). This KB exists to make the **live** system
> *legible*, so we can harden it in place — production-grade, data-safe, and ready for
> multi-tenancy — without ever stopping it. The database stays the source of truth.

## What this is

A capture layer that consolidates what HF already knows about itself into one place,
adds the few missing pieces (generated structural facts + a unified guard registry),
and classifies everything by **"does it survive the hardening?"**.

The work is overwhelmingly **consolidation, not creation** — most of the knowledge
already exists, scattered across mechanisms that were never designed as one system.

## Reuse map — what already exists (don't rebuild these)

| Existing artifact | Role | KB tier it satisfies |
|---|---|---|
| `KNOWLEDGE-MAP.md` (repo root) | human-language → HF concept/file router | Part 6 — domain language |
| `memory/*.md` (entities, holographic, flow-*) | entity hierarchy + call-chain flow maps | Parts 5, 6 |
| `docs/CHAIN-CONTRACTS.md` | adaptive-loop stage-boundary contract registry | Part 2 — **the prototype for `guard-registry.md`** |
| `.claude/rules/ai-to-db-guard.md` | the AI-to-DB guard catalogue (#407→#1372) | Parts 2, 3 |
| `.ratchet.json` + `scripts/check-ratchet.sh` | count-cap ratchet: `tsc_errors`, `lint_errors`, `lint_warnings`, `quarantined_tests` | the **methodology** (fitness function) |
| `scripts/check-doc-citations.ts`, `check-knowledge-map.ts` | drift guards keeping docs honest | KB integrity |
| `docs/decisions/` + `/adr` | architecture decision records | Part 4 |

**`docs/kb/` adds only the three missing tiers:** generated structural facts, the
*consolidated* guard registry, and the survives-hardening classification.

## The nine parts of the KB

| # | Part | Format | Lives in | Status |
|---|---|---|---|---|
| 1 | Structural facts (model map, routes, coupling) | generated JSON | `docs/kb/generated/` | 🟡 model-map done |
| 2 | Guard / contract registry | markdown (CHAIN-style) | `docs/kb/guard-registry.md` | 🟡 first cut |
| 2b | Guards *process* (the ritual) | markdown | `docs/kb/guards-process.md` | 🟡 first cut |
| 3 | Narrative invariants / history | markdown | `docs/kb/invariants.md` | 🟡 seeded |
| 4 | Decisions (ADRs) | markdown | `docs/decisions/` | ✅ via `/adr` |
| 5 | Flow maps | markdown + ASCII | `memory/flow-*.md` | ✅ |
| 6 | Domain language | markdown | `KNOWLEDGE-MAP.md`, `memory/entities.md` | ✅ |
| 7 | Operational runbooks | markdown | `CLAUDE.md` (to extract) | 🔴 buried in prose |
| 8 | Behavioural spec | code | BDD specs, vitest, promptfoo | ✅ partial |
| 9 | Seed / data shape | JSON | `docs-archive/bdd-specs/` | ✅ |

## The two format rules (non-negotiable)

1. **Generated artifacts are never hand-edited.** Re-run the generator. (Tier 2 — JSON.)
2. **Narrative artifacts are never auto-generated.** Hand-curate. (Tier 3 — the *why*.)
3. **Executable guards stay as code.** The registry *catalogues* them; it never
   re-implements them as prose. A guard written down is a guard downgraded.

## How to use / regenerate

```bash
cd apps/admin
npx tsx scripts/capture/model-map.ts   # → docs/kb/generated/model-map.json
```

- **Find something** → `qmd search` (semantic recall over the whole corpus).
  qmd is **not** retired — it's how this KB gets built (search → curate → register).
- **What is true & enforced?** → this KB (authoritative, curated).
- **Query the facts** → `jq` over `docs/kb/generated/*.json`.

## Drift discipline

Tier-2 JSON is committed so a CI step can re-run each generator and fail on
`git diff` — same spirit as `check-fk-consistency` (CI step 5) and `check-doc-citations`.
Wire `model-map.ts` into that gate once the classification is ratified.

## The hardening program this feeds

```
Phase 0  Legibility   ← this KB. Map models/routes/guards. Delete dead code (ratchet ↓).
Phase 1  Safety       ← tested-restore backups, migration gates, RLS in log-only mode,
                         burn down the 212 baselined tsc_errors.
Phase 2  Isolation    ← tenantId + Postgres RLS, driven by generated/model-map.json
                         (89 models proposed tenant-scoped, 1 already aware).
Phase 3  Modularity   ← strangle the worst module first; characterization tests pin
                         behaviour before each cut. Touch the adaptive loop last.
```

Every phase advances a monotonic ratchet so the live system **cannot regress**.
See `guard-registry.md` for the guards that enforce it and `invariants.md` for why each exists.

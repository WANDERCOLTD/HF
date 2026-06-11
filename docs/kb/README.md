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
| 1 | Structural facts (model map, routes, coupling) | generated JSON | `docs/kb/generated/` | 🟢 all three done; 8/109 models ratified |
| 2 | Guard / contract registry | markdown (CHAIN-style) | `docs/kb/guard-registry.md` | 🟢 10/10 ESLint rules wired |
| 2b | Guards *process* (the ritual) | markdown | `docs/kb/guards-process.md` | 🟢 first cut |
| 3 | Narrative invariants / history | markdown | `docs/kb/invariants.md` | 🟡 seeded |
| 4 | Decisions (ADRs) | markdown | `docs/decisions/` | ✅ via `/adr` (tenancy ADR 2026-06-09) |
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
npm run kb:model-map     # → docs/kb/generated/model-map.json   (109 models classified)
npm run kb:routes        # → docs/kb/generated/route-inventory.json (501 routes)
npm run kb:coupling      # → docs/kb/generated/coupling-graph.json (~1600 files, ~3700 edges)
npm run kb:demo-knobs    # → docs/kb/generated/demo-knobs.json (cascade-knob catalogue for /x/help/demos)
npm run kb:rule-tests    # meta-ratchet: every custom ESLint rule has a sibling test
npm run kb:check         # all four generators + meta-ratchets + generated-fact freshness
```

### Ratifying a model classification

The model map's `proposedClass` is a heuristic; ratify a row by adding an entry to
[`model-map-overrides.json`](./model-map-overrides.json) (NOT the generated JSON):

```json
{
  "overrides": {
    "ModelName": { "proposedClass": "tenant-scoped", "confidence": "medium", "notes": "why" }
  }
}
```

Re-run `npm run kb:model-map`; the generator applies overrides and sets `reviewed:true`
on each ratified row. The overrides file is the *human* tier; the generated JSON is
re-derived on every run.

- **Find something** → `qmd search` (semantic recall over the whole corpus).
  qmd is **not** retired — it's how this KB gets built (search → curate → register).
- **What is true & enforced?** → this KB (authoritative, curated).
- **Query the facts** → `jq` over `docs/kb/generated/*.json`.

## Drift discipline (self-maintaining loop)

The KB integrity gate fires at **three** points; together they make it self-maintaining:

| When | What | Result |
|---|---|---|
| **Pre-commit** | `.githooks/pre-commit` § 6 auto-regenerates `model-map.json` if `schema.prisma` or `model-map-overrides.json` is staged, and `route-inventory.json` if any `app/api/**/route.ts` is staged. Regen'd JSON is `git add`-ed to the same commit. | Drift never reaches a commit in the common case. |
| **Local** (manual) | `npm run kb:check` (also step **8/8** of `npm run ctl check`) runs the meta-ratchet (`check-guard-kb-links.ts`) + the freshness diff (`check-kb-fresh.sh`, ignores volatile `generatedAt` via `git diff -I`). | Dev confirms before push. |
| **CI** | `.github/workflows/test.yml` runs `npm run kb:check` as a blocking step in the Lint & Type Check job. | Forgetting all the above still gets caught before merge. |

Tier-2 JSON is committed so a fresh `git diff --exit-code -I '"generatedAt":'` is the
actual check — same spirit as `check-fk-consistency` (CI step 5). The meta-ratchet
holds ESLint→KB back-links at the floor (any rule that loses its `meta.docs.url`
fails CI).

## The hardening program this feeds

```
Phase 0  Legibility   ← this KB. Map models/routes/guards. Delete dead code (ratchet ↓).
Phase 1  Safety       ← tested-restore backups, migration gates, RLS in log-only mode,
                         burn down the 212 baselined tsc_errors.
Phase 2  Isolation    ← tenantId + Postgres RLS. Driven by generated/model-map.json
                         (89 proposed tenant-scoped, 1 aware) + route-inventory.json
                         (130 possibly-unscoped routes). See ADR 2026-06-09-tenancy-isolation-model.
Phase 3  Modularity   ← strangle the worst module first; characterization tests pin
                         behaviour before each cut. Touch the adaptive loop last.
```

Every phase advances a monotonic ratchet so the live system **cannot regress**.
See `guard-registry.md` for the guards that enforce it and `invariants.md` for why each exists.

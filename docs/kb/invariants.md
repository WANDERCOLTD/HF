# Invariants & History (the *why*)

> The non-regenerable tier. Each entry is a hard-won truth — usually born from a
> production incident — that **any** future architecture must still honour. This is
> exactly the knowledge a from-scratch rewrite throws on the floor and then
> rediscovers in production. Curated by hand; never auto-generated.
>
> Format per entry: **the invariant** · born-from issue · enforced-by (→ `guard-registry.md`).

## AI-to-DB (never let AI output directly drive entity creation)

> Master rule: `AI proposes → Guard validates → Code executes`. Full catalogue in
> [`.claude/rules/ai-to-db-guard.md`](../../.claude/rules/ai-to-db-guard.md).

- **AI output is validated before any DB write.** A deterministic guard sits between
  every AI response and `prisma.*.create/update/delete`. — `validateManifest()` etc.
- **AI cannot trigger cohort fan-out.** Toggle "apply to all" is a human-only switch;
  an AI-suggested batch must not fan out across a cohort. — #854/#878 → `no-ai-fanout-all`.
- **AI-returned slugs are resolved within their parent scope**, never by bare global
  `findFirst({where:{slug}})`. Slugs are per-parent-unique, not global. — #407/#411 →
  `no-unscoped-slug-lookup`, `resolveModuleByLogicalId`.

## Adaptive-loop stage boundaries

> **Mechanism lives in [`CHAIN-CONTRACTS.md`](../CHAIN-CONTRACTS.md)** (producer → consumer →
> shape → enforcement → test). This file states only the *durable invariant*; do not copy
> the contract detail back here — point at the CHAIN row / issue instead.

- **Instruction-category directives are never rendered as learner quiz questions.** — #605
- **A learner has exactly one CONTENT AUTHORITY source per course.** — #607
- **SYSTEM-scope archetypes never enter the IDENTITY-fallback pool.** — #608
- **LO mastery has one canonical key form (slug, not display name).** — #614
- **Returning-caller behaviour is driven by playbook `teachingMode`, not hardcoded.** — #604

## Curriculum / Playbook (from `CONTRACTS-PLAYBOOK-CURRICULUM.md`)

- **Every Curriculum write creates its `PlaybookCurriculum(role:'primary')` join row**,
  inside the same transaction. Orphan Curriculum rows are the #1184/#1192 bug class. —
  #1202/#1203/#1204 → `ensurePrimaryPlaybookLink()`.
- **Educator writes that change compose inputs advance `Playbook.composeInputsUpdatedAt`**
  so staleness flips. Never bump speculatively or mid-pipeline. — #1268 → `bump*` helpers.

## Access / data safety

- **A STUDENT session is locked to its own LEARNER `Caller`** regardless of a supplied
  `?callerId=`. — #977 → `resolveCallerScopeForReading`.
- **Synthetic disclosure IDs are derived server-side** from `intentId + requirementId`;
  a client-supplied `disclosureId` is observed but never routed to the store. — #1048 →
  `deriveDisclosureId`.

## Process / methodology (chase-prevention)

> Born from the 6-week pattern of fix-loops on the same topic. Catalogued as
> AP-1..AP-5 in `memory/feedback_chase_loop_anti_patterns.md`;
> ADR at [`docs/decisions/2026-06-11-chase-prevention-methodology.md`](../decisions/2026-06-11-chase-prevention-methodology.md).

- **All async-readiness waiting goes through `lib/async/wait-until-ready.ts`** —
  bespoke `setInterval` / `setTimeout` retry loops are the AP-3 pattern. The 12
  existing call sites are grandfathered via allow-list; new code MUST use the
  helper. — G7 → `no-bespoke-async-polling`.
- **A `## Verified by` section is required on every PR body** citing concrete
  evidence (SQL, vitest, Playwright trace, log subject, curl). Don't trust
  screenshot OCR. — G4 → `scripts/gh-pr-create.sh`.
- **No reciprocal edit pushed without explicit intent.** Commit N+1 undoing
  ≥50% of commit N must either be squashed or bypass-tagged. — G3 →
  `scripts/check-reciprocal-edit.sh`.
- **Same-issue fix chains ratchet down.** Three+ `fix:` commits on a single
  `#NNNN` in 30 days triggers the root-cause agent before the next fix. — G2 →
  `scripts/check-fix-chain.sh` + `same_issue_fix_chain_max` ratchet.

## Hardening-era invariants (to establish)

> New truths this program will add. Each becomes a class-**a** guard.

- [ ] **No tenant-scoped query without a tenant predicate.** (Phase 2 → Postgres RLS.)
- [ ] **No destructive migration ships unreviewed.** (Phase 1 → `migration-checker` as a hard CI gate.)
- [ ] **Every backup has a tested restore.** (Phase 1 — an untested backup is a rumour.)
- [ ] **Behaviour is pinned before a module is re-platformed.** (Phase 3 → characterization tests.)

---

_When you fix a bug that revealed a hidden contract, add the invariant here in the same
PR and link the guard that now enforces it. This file is the memory the rewrite would lose._

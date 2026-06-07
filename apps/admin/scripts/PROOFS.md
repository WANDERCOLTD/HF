# Proof scripts — index

Operator-runnable scripts that exercise a real DB + dev server to verify
a specific contract or epic remains intact. They are not unit tests
(those live under `tests/`); they exist for incidents where you need to
walk a live system and check that a multi-stage flow actually works.

Each script is named `proof-<issue>-<short-slug>.ts` and prints
`PASS` / `FAIL` per assertion. Each exits non-zero when an assertion
fails so they're CI-friendly even though they're operator tools today.

## Running

All run from `apps/admin/`. The mastery-loop proof needs the dev server
on `localhost:3000` and `INTERNAL_API_SECRET` in `.env.local` (the same
secret the voice webhook uses). On hf-dev:

```bash
ssh hf-dev
cd ~/HF/apps/admin
npx tsx scripts/proof-<issue>-<slug>.ts
```

## Catalogue

| Script | Verifies | When to run |
|---|---|---|
| [`proof-554-modules-fix.ts`](./proof-554-modules-fix.ts) | #554 — lockedModule outcome ref resolution; moduleToReview gating against `null` when no prior activity | After any change to `lib/prompt/composition/transforms/modules.ts::computeSharedState` |
| [`proof-561-band-thresholds.ts`](./proof-561-band-thresholds.ts) | #561 — Per-band rubric descriptors wired into the assessor prompt | After any change to the `BehaviorTarget.config.bandThresholds` write path or rubric parser |
| [`proof-1252-mastery-loop.ts`](./proof-1252-mastery-loop.ts) | #1252 — Full adaptive-loop: courseStyle resolution, `CallerModuleProgress` seed at enrolment, G10 filter at instantiate, Bug A I-C1 surface, REWARD non-fallback (#1256), GOOD vs BAD learner mastery delta, module switch, cross-module attribution | After any change to enrolment seeders, REWARD executor, modules transform, or composition `buildCallerContext` |
| [`proof/epic-100/sim-canonical-call.ts`](./proof/epic-100/sim-canonical-call.ts) | Epic 100 — canonical call lifecycle (sim-driven) | Epic-100 regression guard |

## Conventions

- **`PASS/FAIL` lines** — operators grep for `FAIL` to spot regressions.
- **Exit code** — 0 for all-pass, 1 for any-fail.
- **Default fixtures** — sane default playbook/learner where possible
  (e.g. CIO/CTO Revision Aid for `proof-1252`), `--playbook <id>` /
  `--caller <id>` overrides for re-runs against specific data.
- **No prod writes** — proofs run on hf-dev only. The mastery-loop proof
  creates ~2 test learners + a few calls per run; defaults to
  soft-deleting them on exit (`--keep` to inspect manually).
- **Network calls** — proofs that hit the live pipeline use the
  `x-internal-secret` flow (CLAUDE.md §"You CAN hit authenticated API
  routes via the VM"); session cookies aren't required.

## When to add a new proof

Add one when a bug fix needs operator-verifiable evidence post-deploy
**and** the bug class is the kind that comes back. One-shot diagnostics
go in `scripts/` without the `proof-` prefix; the prefix means "I expect
to re-run this when the area is touched."

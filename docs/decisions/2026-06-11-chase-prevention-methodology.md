# ADR: Chase-prevention methodology — structural enforcement of AP-1..AP-5

**Date:** 2026-06-11
**Status:** Accepted
**Deciders:** Paul W

## Context

Over the six weeks 2026-04-29 → 2026-06-10, five recurring failure modes drove
roughly a quarter of fix-loop time. Each one has a clean recognition signal,
each has an existing HF tool that should have been invoked instead, and each
went unrecognised — repeatedly — because the recognition was a *should-have-
remembered*, not a structural gate.

The five patterns, catalogued as AP-1..AP-5:

| # | Pattern | Canonical incident |
|---|---|---|
| **AP-1** | **Reciprocal edit** — commit N+1 partially undoes commit N within minutes | #1365 → #1366 (transcript-parser removed and 15 min later restored; 25/34 of 34 lines re-introduced) |
| **AP-2** | **Fix chain** — ≥3 `fix:` commits on the same `#NNNN` in 7 days | #1412 (4 hardening-drill fixes in 48 h with no root-cause invocation between them) |
| **AP-3** | **Parallel infrastructure** — propose a new system without first checking docs/kb/, `.claude/rules/`, scripts/check-* | This very PR's initial brief ("0/14 rules need meta.docs.url") — the actual count was 13/13 at baseline 0 |
| **AP-4** | **Verify before fix** — build a fix-story from a screenshot or paraphrased complaint without running the minimal state query | #1406 (Beckett screenshot misread, fabricated "rich-recap garbage" narrative, `recapSynthesisCache: null` post-merge) |
| **AP-5** | **Fix before refactor** — band-aid `fix:` lands the same week a `feat:`/`refactor:` will eliminate the class | 2026-06-09 hardening drill (5 fixes obsoleted by the readiness-probe DB cleanup that followed) |

Memory: [`feedback_chase_loop_anti_patterns.md`](../../../.claude/projects/-Users-paulwander-projects-HF/memory/feedback_chase_loop_anti_patterns.md)
(operator-side recognition + tool table + structural-enforcement back-references).

Two earlier files already encoded slices of this knowledge but weren't connected:
- [`feedback_verify_before_fix_misread_2026_06_09.md`](../../../.claude/projects/-Users-paulwander-projects-HF/memory/feedback_verify_before_fix_misread_2026_06_09.md)
  — AP-4 in isolation.
- The five-loop language in `MEMORY.md` — informal, not enforced.

Options considered:

1. **No change — rely on session-start nudges + retros.** This is the
   pre-2026-06-11 state. Empirically: it doesn't work. The patterns keep
   recurring because human recognition is the weakest link.
2. **Hard gates on every pattern.** Tempting; structurally wrong for AP-5
   (some `fix:` commits MUST land before the cleanup — incident response,
   security) and disproportionate for AP-3 (creativity ≠ violation).
3. **Mixed gating: hard on AP-1/AP-2/AP-4, soft on AP-3, warn-only on AP-5.**
   The pattern-by-pattern severity matches the cost-of-false-positive curve.

## Decision

Adopt **Option 3 — mixed gating**, with the structural enforcement landed
in seven implementing artefacts (G1..G10, all on branch
`chore/kb-chase-prevention-wiring`):

| AP | Implementing artefact | Gate point | Severity |
|---|---|---|---|
| AP-3 | **G1** — [`.claude/hooks/kb-reuse-preamble.sh`](../../.claude/hooks/kb-reuse-preamble.sh) | UserPromptSubmit | **soft** — injects a mandatory KB-reuse preamble into context; the model must cite findings |
| AP-2 | **G2** — [`scripts/check-fix-chain.sh`](../../scripts/check-fix-chain.sh) + ratchet metric `same_issue_fix_chain_max` | post-commit + `npm run ctl check` | **hard** — ratchet only ever ratchets down |
| AP-1 | **G3** — [`scripts/check-reciprocal-edit.sh`](../../scripts/check-reciprocal-edit.sh) | pre-push | **hard** — blocks; bypass `ALLOW_RECIPROCAL_EDIT=1` requires intent |
| AP-4 | **G4** — [`scripts/gh-pr-create.sh`](../../scripts/gh-pr-create.sh) + [`.claude/rules/verify-before-fix.md`](../../.claude/rules/verify-before-fix.md) | PR creation | **hard** — rejects PRs without `## Verified by` evidence; bypass `--no-verify-section` for trivial PRs |
| AP-3 (G5 already done) | `kb:guard-links` meta-ratchet (`check-guard-kb-links.ts`) | CI | already at baseline 0 (13/13 KB-linked) — verified pre-G5; no new work needed |
| (methodology) | **G6** — [`memory/feedback_chase_loop_anti_patterns.md`](../../../.claude/projects/-Users-paulwander-projects-HF/memory/feedback_chase_loop_anti_patterns.md) + MEMORY.md index | session start | passive — recognition catalogue |
| AP-3 (Loop 3) | **G7** — [`lib/async/wait-until-ready.ts`](../../apps/admin/lib/async/wait-until-ready.ts) + [`eslint-rules/no-bespoke-async-polling.mjs`](../../apps/admin/eslint-rules/no-bespoke-async-polling.mjs) | lint | **warn** — 12 existing sites grandfathered via allowlist; new sites caught |
| AP-5 | **G8** — [`scripts/check-fix-refactor-inversion.ts`](../../scripts/check-fix-refactor-inversion.ts) | PR comment | **warn-only** — never blocks; nuanced enough that human review decides |
| (capacity) | **G9** — `memory_md_bytes` ratchet + rolling-7-day archive | `npm run ctl check` | **hard** — ratchet only ratchets down |

All seven gate points cite this ADR + their row in
[`docs/kb/guard-registry.md`](../kb/guard-registry.md) "Process guards" section.
The KB back-link convention (`meta.docs.url` / `Anchor: …#guard-…` in script
output) makes every gate's reason discoverable from the moment it fires.

## Consequences

**Positive:**
- AP-1, AP-2, AP-4 become structurally impossible to ship silently — the gate
  fires at the boundary, the developer reads the failure mode, the recognition
  is no longer load-bearing.
- AP-3 (parallel infra) gets a soft *prompt-time* nudge — the model is reminded
  to run reuse-finder before proposing, but never blocked from proposing.
- AP-5 stays warn-only because the false-positive cost is real (legitimate
  incident-response `fix:` commits SHOULD land before the cleanup).
- The KB and the memory layer stay in sync: the AP catalogue lives in operator
  memory, the structural enforcement in `scripts/` + `.githooks/` + ESLint,
  the back-links in `docs/kb/guard-registry.md`. Three tiers, one anchor convention.

**Negative / costs:**
- Six new scripts + one hook + one ESLint rule + two ratchet metrics is a
  meaningful surface to maintain. Mitigated: each artefact is small (<300
  LOC), independently testable, and the meta-ratchet (`kb:rule-tests` + the
  ratchet itself) catches regression at CI.
- AP-3's soft enforcement (a system reminder) is only as strong as the model's
  compliance. If the model ignores the preamble repeatedly, this ADR should
  be revisited to consider hardening the AP-3 gate.
- The reciprocal-edit detector's 50% threshold is a tunable. The verification
  against #1365 → #1366 showed 73% and 100% — a comfortable margin — but the
  detector will fire on legitimate refactors-of-refactors. Bypass-with-intent
  is the escape valve.

**Follow-ups (not blocking this ADR's acceptance):**
- Migrate the 12 grandfathered `no-bespoke-async-polling` sites to the
  `waitUntilReady` helper — separate story, drives the rule's allowlist to
  zero.
- Add the post-commit + pre-push hooks to `.git/hooks/` via the `.githooks/`
  symlink convention if not already wired on each developer's machine
  (the worktree convention means hook discovery is per-developer).
- Wire G2's `same_issue_fix_chain_max` into the CI `npm run ctl check` step —
  currently only runs via the post-commit + ratchet path. The ratchet *is*
  read by `check-ratchet.sh` step 8; verify it stays green on first CI run.
- Revisit AP-3 enforcement strength in 4 weeks (2026-07-09) if the soft gate
  has drifted.

## Verification

The following were tested live during G1..G9 implementation:

- **G1:** `echo '{"prompt":"new guard for X"}' | .claude/hooks/kb-reuse-preamble.sh`
  → emits the preamble. Negative `{"prompt":"fix the broken test"}` → silent.
- **G2:** `scripts/check-fix-chain.sh` → detects #1412 (4), #1394 (3), #1415 (3),
  #1379 (3), #1365 (3), #1271 (3) — all real chains in current history.
  `max-chain-length: 4`. Locked at baseline 4 in `.ratchet.json`.
- **G3:** `scripts/check-reciprocal-edit.sh 9be6fa94 031551f2` (the live
  #1365 → #1366 pair) → exit 1 + flags `vapi-provider.parse-transcript.test.ts`
  at 73% (25/34) and `providers/vapi/index.ts` at 100% (9/9). Negative pair
  `bf4e355f dcac6864` → exit 0.
- **G4:** `gh-pr-create.sh --body "Just a summary"` → exit 1, "missing Verified by";
  `--body "$(printf 'foo\n\n## Verified by\n\nSELECT count(*) FROM Call;\n')"` →
  "✔ verify-before-fix gate passed" then forwards to `gh`.
- **G7:** 8 RuleTester tests + 1 smoke test pass (`tests/eslint-rules/no-bespoke-async-polling.test.ts`).
  `npm run kb:rule-tests` → 16/16 at baseline 0.
- **G8:** `scripts/check-fix-refactor-inversion.ts --range 00c70f2b~1..c6943810`
  → 4 inversions detected, including `00c70f2b fix(voice): ghost-row dedup`
  → `c6943810 feat(session): #1344 Slice 4` at 56% file overlap.
- **G9:** `~/.claude/projects/-Users-paulwander-projects-HF/memory/MEMORY.md`
  reduced from 37,577 B → 29,073 B. Ratchet locked at 29,073.

## References

- [Guard registry — Process guards section](../kb/guard-registry.md)
- [Invariants — Process / methodology section](../kb/invariants.md)
- [Verify-before-fix path-scoped rule](../../.claude/rules/verify-before-fix.md)
- [Chase-loop anti-patterns memory](../../../.claude/projects/-Users-paulwander-projects-HF/memory/feedback_chase_loop_anti_patterns.md)
- [Original AP-4 incident report](../../../.claude/projects/-Users-paulwander-projects-HF/memory/feedback_verify_before_fix_misread_2026_06_09.md)

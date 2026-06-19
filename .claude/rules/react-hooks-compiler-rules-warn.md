# React Compiler rules — warn, not error

> The 3 React-Compiler-family rules in `eslint-plugin-react-hooks`
> (`static-components`, `purity`, `preserve-manual-memoization`) are
> intentionally configured at `"warn"` severity, not `"error"`. The
> `rules-of-hooks` rule (classic React) remains at `"error"`. The
> `.ratchet.json` `lint_warnings` baseline locks the current violation
> count so the codebase can't regress while a follow-on epic pays them
> down.
>
> Sibling to the `.claude/rules/*-coverage.md` Coverage-pillar gates
> (registry-consumer / route-auth-zod / tier-visibility / parameter):
> same generic shape (incumbent count frozen via ratchet, future
> regressions blocked). Different surface — this one is ESLint rule
> severity, not test-driven coverage.

## Rule

`apps/admin/eslint.config.mjs`:

- `react-hooks/rules-of-hooks` → `"error"` (classic React Hooks rule;
  zero current violations; future regressions block CI)
- `react-hooks/static-components` → `"warn"` (React Compiler family)
- `react-hooks/purity` → `"warn"` (React Compiler family)
- `react-hooks/preserve-manual-memoization` → `"warn"` (React Compiler
  family)

The ratchet (`.ratchet.json::lint_warnings`) holds the post-demote
warning count. The ratchet step in `.github/workflows/test.yml` (Lint
& Type Check job) refuses any increase.

## Why this exists

PRs #1998 through #2008 (8 consecutive merges, 2026-06-18 → 2026-06-19)
all merged with the Lint & Type Check job RED at the "Run ESLint" step.
Admins overrode the merge gate every time. Verified by:

```
for pr in 1998 2002 2003 2004 2005 2006 2007 2008; do
  gh pr view $pr --json statusCheckRollup,state -q \
    '"PR \#\(.number): Lint=\(.statusCheckRollup[] | select(.name == "Lint & Type Check") | .conclusion), State=\(.state)"'
done
```

All 8: `Lint=FAILURE, State=MERGED`. The original `#865` closeout claim
"zero current violations after #876 + #894; future regressions block CI"
had drifted silently because:

1. The Lint step (`npm run lint`) exits 1 when ESLint reports any error.
2. The ratchet step is AFTER lint in the same job (`test.yml` lines 51-70).
3. GitHub Actions skips later steps in a job when an earlier step fails.
4. So the ratchet check never ran → warning counts drifted from baseline
   (4544 → 4809 between #865 closeout and 2026-06-19) without producing
   a single signal in CI.
5. Meanwhile errors accumulated to 52 — the operator-visible signal was
   8 weeks of "RED CI, merge anyway."

The exact failure distribution from #2008 (`gh run view 27813806905
--log-failed`):

| Rule | Count | Message |
|---|---|---|
| `react-hooks/preserve-manual-memoization` | 34 | "Compilation Skipped: Existing memoization could not be preserved" |
| `react-hooks/static-components` | 12 | "Cannot create components during render" |
| `react-hooks/purity` | 6 | "Cannot call impure function during render" |

All 3 are React Compiler-family rules. The classic `rules-of-hooks` had
ZERO violations — kept at error.

A guard that fires red on every PR but gets bypassed on every merge is
worse than no guard — it consumes attention without producing signal.
Demoting restores honesty. The ratchet keeps the count frozen so the
debt can't grow while a pay-down effort follows.

## How to fix a regression

The ratchet (lint_warnings) refuses any increase. If your PR adds new
violations:

| Failure shape | Fix |
|---|---|
| `lint_warnings: NNNN (+M over baseline NNNN)` from `npm run ratchet:check` | Fix the new violations OR run `npm run ratchet:lock` ONLY if you have an explicit operator-approved decision to grow the debt (rare). |
| `lint_errors: N (+N over baseline 0)` | The new violation hit a rule still at `"error"` severity (most likely `rules-of-hooks`). Fix the violation; do NOT demote. |

## When this rule should be revisited

When a follow-on epic pays down the React Compiler violations to zero:

1. Audit `npm run lint` output. Confirm 0 errors AND <5 occurrences of
   the 3 rule names in any file.
2. Promote each rule back to `"error"` in `eslint.config.mjs`.
3. Update the comment block to reflect the new floor.
4. Run `npm run ratchet:lock` to drop `lint_warnings` to the new floor.

Until then: the warn floor + ratchet is the honest contract.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `apps/admin/eslint.config.mjs` lines ~519-541 | Rule severity at "warn" | Spurious CI red on incumbent violations |
| `.ratchet.json::lint_warnings` (4861 as of 2026-06-19) | Count-cap ratchet (#227) | New violations growing the warn count |
| `.github/workflows/test.yml` step "Ratchet check (blocking)" | Runs `npm run ratchet:check` after lint passes | Silent drift like the 4544→4809 lapse |
| This rule | Author discipline | Confusion when a future contributor sees "warn" and assumes the rule is unimportant |

## When NOT to apply

This rule covers the THREE specific React Compiler-family rules listed
above. It does NOT apply to:

- `react-hooks/rules-of-hooks` — classic Rules of Hooks; stays at error.
- Other ESLint rules at `"warn"` severity — those have their own ratchet
  enforcement via `lint_warnings`.
- The custom `hf-*` rules under `apps/admin/eslint-rules/*` — those are
  catalogued separately in `docs/kb/guard-registry.md`.

## Related

- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding
  Lattice survey discipline
- [`.claude/rules/verify-before-fix.md`](./verify-before-fix.md) —
  the citation-discipline this rule's "8/8 verified" PR list satisfies
- [`apps/admin/scripts/check-ratchet.sh`](../../apps/admin/scripts/check-ratchet.sh)
  — the ratchet runner
- `#865` closeout — the original promotion to "error" that drifted

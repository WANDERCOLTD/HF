# Exhaustive-claim scope — say what you swept

> A PR body that claims **completeness** over a set, or that one change
> **supersedes** another, must state the SCOPE of the check that backs it —
> which surfaces were searched. A `file:line` citation does not satisfy this:
> pointing at one file is precisely the partial check the rule exists to catch.
>
> Enforced by `verify_no_unscoped_exhaustive_claims()` in
> [`scripts/gh-pr-create.sh`](../../scripts/gh-pr-create.sh), pinned by
> [`tests/scripts/gh-pr-create-exhaustive-claim.test.ts`](../../apps/admin/tests/scripts/gh-pr-create-exhaustive-claim.test.ts).
>
> Sibling to [`agent-report-verification.md`](./agent-report-verification.md)
> (negative claims — "X doesn't exist") and
> [`verify-before-fix.md`](./verify-before-fix.md) (cite before you fix).
> This is the third shape: **partial checks described as complete**.

## Rule

When a PR body says any of:

- "the only failing check is …"
- "superseded by …", "fully covered by …"
- "the remaining N have no …", "nothing else references …"
- "no other callers / importers / consumers"
- "every X was checked"

it must carry, within ±2 lines, one of:

| Marker | Means |
|---|---|
| `[scope: lib/ app/ scripts/ .github/workflows/ Dockerfile]` | these are the surfaces I searched |
| `[reviewed-by: <who>]`, "independently verified / re-derived" | someone else re-derived it |
| `[unverified]` | the sweep was partial and I am saying so |
| Narrowed wording | "no importer **in lib/ or app/**" instead of "nowhere" |

Naming the scope is the point. It lets a reader spot the surface you *didn't*
search — which is the only way this class of error gets caught.

## Why this exists

2026-09-24. Three PRs in one session each carried a claim of this shape.
All three were wrong:

| Claim | Reality |
|---|---|
| "the only failing check is the unrelated audit backlog" | the failure was **caused by that PR** — a route bypassed the auth-coverage gate |
| "superseded by #2323, safe to drop" | #2323 covered **2 of 4** caller-creation paths; the dropped filter was still load-bearing for the other two |
| "the remaining 121 have no importer, no executor and no package.json script" | **six** executor references existed, in `cli/control.ts` and a GitHub workflow |

Every one had been checked. None had been checked exhaustively.

The defect was never the verification — it was describing a partial sweep as
a complete one. And the tell is always the same: the author searched the
surfaces they thought of, then wrote it up in language that implied they had
searched all of them.

**CI caught none of the three.** Independent review caught all three. That
asymmetry is the whole reason this is a gate and not a note.

## What does NOT satisfy it, and why

A `file:line` citation. The sibling negative-claim gate accepts one, because
"X doesn't exist" is refuted by a single counter-example, so a single
citation is proportionate evidence.

Completeness is different. "Nothing references this" is not supported by
pointing at one file you looked at — that is the partial check restated. The
evidence for a claim about a *set* is the boundary of the search.

## When NOT to apply

- Docs-only or trivial PRs — `--no-agent-claim-check` bypasses both gates.
- Claims already scoped in their wording. "No caller in `lib/`" asserts
  nothing about `app/`, so there is nothing to over-claim.
- Machine-generated completeness — a Coverage test that enumerates its own
  population and ratchets it. The enumeration *is* the scope; cite the test.

## When it fires

Do not reach for the bypass first. In order of preference:

1. **Widen the sweep**, then state it. Usually minutes, and it is how the
   `seed-companion` near-miss was caught before it broke the build.
2. **Get it re-derived.** An independent reviewer found all three of the
   failures above.
3. **Narrow the wording** to what you actually checked.
4. **`[unverified]`** — honest, and better than a confident wrong claim.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `scripts/gh-pr-create.sh::verify_no_unscoped_exhaustive_claims` (2026-09-24) | PR-creation gate, ±2-line marker window | Partial sweeps described as complete |
| `tests/scripts/gh-pr-create-exhaustive-claim.test.ts` | 11 cases, incl. all three real failures verbatim | Regex drift weakening the gate |
| `scripts/gh-pr-create.sh::verify_no_unverified_negatives` (2026-06-15) | Sibling gate | Negative claims without an inverse probe |

## Related

- [`.claude/rules/agent-report-verification.md`](./agent-report-verification.md) — negative claims
- [`.claude/rules/verify-before-fix.md`](./verify-before-fix.md) — cite before fixing
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — sweep before writing

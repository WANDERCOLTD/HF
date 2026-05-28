# Arch-Check G — Learner-Facing Page Playbook Resolution (L9)

> Static check + path-scoped rule for `apps/admin/app/x/sim/**/page.tsx` and `apps/admin/app/x/student/**/page.tsx`. Add to `arch-checker.md` Step 2 as Check G when that file is editable; until then this doc IS the canonical statement of the rule and the arch-checker should consult it inline when checking learner-facing page diffs.

## The invariant being defended

Every learner-facing page that mounts a session on a Playbook MUST resolve `playbookId` via the canonical L9 fallback chain:

1. `?playbookId=` URL param (deep-link from picker, wizard, etc.)
2. The caller's single ACTIVE `CallerPlaybook` enrollment
3. The caller's most-recently-enrolled ACTIVE playbook (`orderBy: enrolledAt desc`)
4. `null` → render a learner-readable empty state (NOT a silent no-op)

See `docs/CHAIN-CONTRACTS.md` Link L9 for the contract details.

## The detection step

For any change under `apps/admin/app/x/sim/**/page.tsx` OR `apps/admin/app/x/student/**/page.tsx` that reads `searchParams.get('playbookId')`:

```bash
# Find every learner-facing page reading the URL param:
grep -rn "searchParams.get(['\"]playbookId['\"])" \
  apps/admin/app/x/sim apps/admin/app/x/student 2>/dev/null
```

For each matching file, the same file MUST ALSO contain either:

- An import of `resolveActivePlaybookId` from `@/lib/caller/resolve-active-playbook` (server-side resolution), OR
- A fetch to `/api/callers/[...]/active-playbook` (client-side resolution via the API wrapper).

```bash
# Verify each matching learner-facing page also uses the helper or endpoint:
grep -E "resolveActivePlaybookId|/api/callers/.*active-playbook" <file>
```

## The fail signal

If a learner-facing page reads the URL param without using the helper or endpoint, emit a **FAIL** with the file path, the line number of the URL read, and this one-line remediation:

> *"Use `resolveActivePlaybookId(callerId, searchParams.get('playbookId'))` server-side, or `fetch('/api/callers/<id>/active-playbook?playbookId=<override>')` client-side. See `docs/CHAIN-CONTRACTS.md` Link L9 — every learner-facing page MUST resolve `playbookId` via the canonical fallback chain (URL → single ACTIVE enrollment → most-recently enrolled ACTIVE → null). Silent no-ops are forbidden."*

## What FAILs the rule

Hard fail (not a soft warning — silent no-ops on learner surfaces are the failure mode this defends against; there is no grace window):

- New learner-facing page under `/x/sim/**` or `/x/student/**` that reads `searchParams.get('playbookId')` without the helper / endpoint
- Refactor that drops the helper / endpoint but keeps the URL read
- A new helper that hides the URL read behind a wrapper which itself doesn't go through `resolveActivePlaybookId`

## Scope notes

- Pages OUTSIDE `/x/sim/**` and `/x/student/**` are NOT learner-facing — this check does not apply (e.g. `apps/admin/components/callers/CallerDetailPage.tsx` is admin UI; the inline auto-pick logic at lines 386-401 there is acceptable but carries a JSDoc note keeping it byte-identical to the helper).
- A page that does NOT read `searchParams.get('playbookId')` is not in scope (pages that derive `playbookId` purely from session context or route params don't need the URL-fallback chain).

## Rationale

Caught empirically by #947 / #948. Pre-fix, `/x/sim/[callerId]` showed no module picker, no banner, no error when a learner deep-linked without `?playbookId=`, because the page read only the URL and the playbook fetch never fired. The shared helper + this static check prevent the same trapdoor from re-opening on the next learner-facing page.

## Manual verification — broken-page sanity check

To prove the rule actually catches violations, drop this snippet temporarily into a learner-facing page (DO NOT commit):

```tsx
// @ts-expect-error — DO NOT COMMIT — rule self-test only
const playbookId = searchParams.get('playbookId');
// (no import of resolveActivePlaybookId, no fetch to /active-playbook)
```

Run the detection commands above — the first `grep` should match the new file, the second `grep` against that file should return no match, and the rule should FAIL. Delete the snippet before committing.

## Related

- `lib/caller/resolve-active-playbook.ts` — canonical helper.
- `app/api/callers/[callerId]/active-playbook/route.ts` — API wrapper.
- `tests/lib/caller/resolve-active-playbook.test.ts` — 13-case unit test (`docs/TEST-BANK.md` D003).
- `tests/integration/journey/learner-picker-reachability.integration.test.ts` — live-DB end-to-end (`docs/TEST-BANK.md` D004).
- `docs/CHAIN-CONTRACTS.md` Link L9 — contract row.
- `.claude/agents/arch-checker.md` Checks A-F — sibling architectural checks (Check G belongs here logically; written into this doc because the agent file is currently write-protected from the worktree).

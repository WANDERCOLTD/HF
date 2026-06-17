# Route auth + Zod coverage (Lattice Coverage-pillar member)

> Every `app/api/**/route.ts` write handler (POST / PUT / PATCH / DELETE)
> MUST call `requireAuth(...)` (or `requireEntityAccess(...)`) AND validate
> the request body via a Zod schema. Routes that intentionally don't
> (public intake, server-to-server with `x-internal-secret`) live in
> `ROUTE_AUTH_ZOD_EXEMPT` with a documented reason.
>
> Sibling to [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (registry storagePath → transform reader). Same generic Coverage pattern:
> enumerate producers, classify each as `compliant` / `exempt` / `gap`,
> ratchet the count. Closes the 2026-06-17 audit finding that ~89% of
> write routes lacked one or both gates.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule

When you write or modify a route file under `apps/admin/app/api/`:

1. **GET handlers** — no body to validate, no action needed.
2. **POST / PUT / PATCH / DELETE handlers** — call `requireAuth(<role>)` (or
   `requireEntityAccess(<entity>, <op>)` for the entity-scoped sibling) AND
   parse the body via a Zod schema (`z.object({...}).parse(body)` or
   `.safeParse(body)`).
3. If the route legitimately doesn't fit (1) or (2), add to
   `ROUTE_AUTH_ZOD_EXEMPT` in
   `tests/api/route-auth-zod-coverage.test.ts` with a one-line reason
   from the allowed taxonomy:
   - `public-intake` — pre-auth bootstrap (intake bootstrap, magic-link
     claim, password-reset request, etc.)
   - `internal-secret` — server-to-server route using
     `x-internal-secret` header, NOT session auth
   - `legacy-debt` — shipped before the gate; wire on next touch

## Why this exists

`.claude/rules/api-conventions.md:20` has documented since the journey-tab
build-out: *"Every `app/api/**/route.ts` must call `requireAuth(...)`"*.
Convention only. No ESLint, no test pin. Authors followed it when they
remembered.

The 2026-06-17 audit found:

| Surface | Count |
|---|---|
| Total `route.ts` files | 541 |
| Read-only (GET only) | 239 |
| Write handlers | 313 |
| **Compliant (auth + Zod both present)** | **32 (~10%)** |
| Missing one or both | ~281 (~89%) |

89% non-compliance is too widespread to fix in one PR. This Coverage test
freezes the incumbent population via `EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`
and ratchets: future PRs can only IMPROVE the ratio, never grow the gap.

## How matching works

For each `app/api/**/route.ts`:

1. Skip if no `export async function (POST|PUT|PATCH|DELETE)` is found
   (`read-only` classification).
2. If the relative path is in `ROUTE_AUTH_ZOD_EXEMPT` → `exempt`.
3. Otherwise:
   - **Auth check**: regex `requireAuth\(|requireEntityAccess\(`
   - **Zod check**: regex matches `z.<schemaType>(` OR `.parse(` /
     `.safeParse(` (zod schema imported from another file).
4. Both present → `compliant`. One missing → `gap-no-auth` / `gap-no-zod` /
   `gap-no-both`.

The ratchet test asserts `gaps.length <= EXPECTED_EXEMPT_COUNT_INITIAL_BUDGET`.

## When NOT to apply

- **GET handlers** — no body to validate. Classified `read-only` and
  excluded from the gate. Auth check still applies for sensitive reads
  via the sibling tier-visibility rule
  ([`response-redaction.md`](./response-redaction.md)).
- **Test fixtures and route templates under `tests/`** — not walked by
  the test (the walker only descends `app/api/`).

## When adding a new route

Author checklist (same PR):

1. POST / PUT / PATCH / DELETE handler? → continue.
2. Add `requireAuth("VIEWER"|"OPERATOR"|...)` OR `requireEntityAccess("<entity>", "<R|W>")`.
3. Define a Zod schema for the body. Parse the body through it before any
   business logic. Reject 400 on parse failure.
4. If the route is intentionally public OR server-to-server, add to
   `ROUTE_AUTH_ZOD_EXEMPT` with one of the three allowed reasons.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/api/route-auth-zod-coverage.test.ts` (born 2026-06-17, this PR) | 5 vitests: distribution-sanity, ratchet, non-empty-reason, non-stale-exempt, no-contradiction | New routes shipping without auth/Zod beyond the incumbent 89% non-compliance. Routes silently wired and forgotten in exempt list. Routes deleted but still in exempt list. |
| `.claude/rules/api-conventions.md:20` | Author discipline | Catches what slips past the test (regex heuristic for `.parse(` won't catch every shape) |
| `eslint-rules/no-bucketless-journey-setting.mjs` (#1738) — model pattern | Edit-time | Different surface; same generic gate shape (vitest + future ESLint) |

## When NOT to apply

The vitest is structural — it ALWAYS applies. What's exempted are
individual routes via `ROUTE_AUTH_ZOD_EXEMPT` with documented reason.

## Future hardening

When the gap-count drops below ~50, add an ESLint rule that fires at edit
time on any new write handler missing either pattern. The vitest + lint
combo follows the same shape as `coverage-producer-consumer.test.ts`
(#1848) + `composition-directive-needs-renderer.mjs`.

## Related

- [`tests/api/route-auth-zod-coverage.test.ts`](../../apps/admin/tests/api/route-auth-zod-coverage.test.ts) — the test
- [`.claude/rules/api-conventions.md`](./api-conventions.md) — the convention this rule structurally enforces
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test, same generic pattern
- [`.claude/rules/response-redaction.md`](./response-redaction.md) — tier-visibility on the READ side, complementary
- Memory: `feedback_lattice_5th_pillar_coverage.md` — the Coverage pillar this rule extends

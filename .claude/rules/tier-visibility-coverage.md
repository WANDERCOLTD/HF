# Tier-visibility coverage (Lattice Coverage-pillar member)

> Routes that mix operator-only fields with learner-safe fields AND admit
> roles below OPERATOR MUST route their response through a
> `redact<X>ForTier(raw, viewerTier)` projection per
> [`response-redaction.md`](./response-redaction.md). This test pins the
> known tier-sensitive routes in `TIER_SENSITIVE_ROUTES` and verifies
> the redactor is wired.
>
> Sibling to [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> and [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md) — same
> generic Coverage pattern, third surface.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule

When you write or modify a route file under `apps/admin/app/api/`:

1. Does the response mix operator-only fields (raw numeric scores,
   confidence, free-text reasoning, evidence text, decay factors,
   forward-planning) with learner-safe fields (status, category,
   high-level labels)?
2. Does the route admit roles below OPERATOR (e.g.
   `requireAuth("VIEWER")`, `requireEntityAccess(..., "R")`)?

If BOTH yes → add the route to `TIER_SENSITIVE_ROUTES` in
`tests/api/tier-visibility-coverage.test.ts` AND wire a
`redact<X>ForTier` (pattern: `lib/rbac/policies/adaptations.ts`).

If you can't wire the redactor in the same PR (significant payload to
audit), add to `TIER_VISIBILITY_EXEMPT` with a one-line reason
describing what's deferred + bump `EXPECTED_EXEMPT_COUNT`.

## Why this exists

`response-redaction.md` ships the pattern (`visibilityTierForRole` +
`redact<X>ForTier`) and the ESLint rule `hf-rbac/require-tiered-redactor`
that enforces it once a route OPTS IN via the `@tieredVisibility` JSDoc
tag.

But the rule is opt-in by design. The 2026-06-17 audit found **1 of
215 VIEWER-admitting routes** with the tag (0.5% adoption). **5
confirmed active leak routes** in the callers namespace return
operator-only fields to STUDENT readers:

- `/callers/[id]/skills-evidence` — reasoning + analysisSpecName + evidenceQuality + scoredBy
- `/callers/[id]/lo-mastery` — raw mastery (0-1) + tier + bandLabel
- `/callers/[id]/uplift` — confidence + hasLearnerEvidence + reasoning
- `/callers/[id]/memories` — confidence + evidence + decayFactor
- `/callers/[id]/insights` — recommendation + reason

This Coverage test makes the opt-in list itself structurally tracked.
Once a route is named in `TIER_SENSITIVE_ROUTES`, the test enforces the
redactor wiring. Authors can't quietly forget.

## How matching works

For each entry in `TIER_SENSITIVE_ROUTES`:

1. Skip if file missing (stale entry — test fails on the stale check).
2. If route is in `TIER_VISIBILITY_EXEMPT` → `exempt`.
3. Else regex-check the source for:
   - `visibilityTierForRole` (import + call)
   - `redact<Anything>ForTier` (import + call)
4. All four present → `compliant`. Otherwise → `gap` with `missing[]`
   detail.

## When NOT to apply

- Routes that admit only OPERATOR+ — no tier confusion to redact.
- Routes whose response is uniformly safe (status flags, slug IDs,
  category labels) — nothing to redact.
- Routes whose response is uniformly operator-only AND admitted only
  to OPERATOR+ — no learner consumer.

## When adding a new route

Author checklist (same PR):

1. Does the response carry per-field tier sensitivity? → continue.
2. Does the route admit roles below OPERATOR? → continue.
3. Add the route to `TIER_SENSITIVE_ROUTES`.
4. Create `lib/rbac/policies/<resource>.ts::redact<Resource>ForTier`
   (pure function — `(raw, tier) => Projected`).
5. Add a test file at `tests/lib/rbac/policies/<resource>-redact.test.ts`
   pinning the `redacted` shape's absence of every sensitive field.
6. Wire into the route:
   ```ts
   import { visibilityTierForRole } from "@/lib/rbac/visibility";
   import { redact<X>ForTier } from "@/lib/rbac/policies/<resource>";
   ...
   const viewerTier = visibilityTierForRole(auth.session.user.role);
   const raw = await computeRaw(...);
   return NextResponse.json(redact<X>ForTier(raw, viewerTier));
   ```
7. Add `@tieredVisibility` to the route's JSDoc header so the ESLint
   rule `hf-rbac/require-tiered-redactor` enforces the imports
   permanently.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/api/tier-visibility-coverage.test.ts` (born 2026-06-17, this PR) | 5 vitests: gap-check, ratchet, non-empty-reason, no-missing-files, no-contradiction | Tier-sensitive routes lacking redactors. Stale exempt entries. Routes silently wired without removing exempt. |
| `eslint-rules/require-tiered-redactor.mjs` (Wave C5 of #1685) | Edit-time, error severity, opt-in via `@tieredVisibility` | Routes that opt in but forget imports / calls. |
| `lib/rbac/policies/adaptations.ts` | Reference implementation | The canonical pattern: pure-function projection, discriminated union return, `viewerTier` field. |

## Future hardening

When all 5 exempt routes are wired, drop `EXPECTED_EXEMPT_COUNT` to 0.
At that point the test enforces zero gaps — adding a new tier-sensitive
route without the redactor fails CI immediately.

Beyond that, consider an automated detector: routes that admit VIEWER
AND return certain field shapes (e.g. confidence numeric, reasoning
text, scoring metadata) get auto-suggested into `TIER_SENSITIVE_ROUTES`
on PR review. But that's heuristic — keep the human-curated list as
the source of truth for now.

## Related

- [`tests/api/tier-visibility-coverage.test.ts`](../../apps/admin/tests/api/tier-visibility-coverage.test.ts) — the test
- [`.claude/rules/response-redaction.md`](./response-redaction.md) — the parent pattern
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test
- [`.claude/rules/route-auth-zod-coverage.md`](./route-auth-zod-coverage.md) — sibling Coverage-pillar test for route auth/Zod
- Memory: `feedback_lattice_5th_pillar_coverage.md`

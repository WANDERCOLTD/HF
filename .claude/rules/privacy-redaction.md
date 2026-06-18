# Privacy redaction — codified PII discipline

> Every route that returns PII alongside non-PII fields, while admitting
> sessions below the field's natural read tier, MUST route through a
> resource-specific `redact<Resource>ForTier(raw, viewerTier, preset?)`
> projection. The redactor decides what each tier sees; the route never
> branches on role.
>
> Sibling to [`response-redaction.md`](./response-redaction.md) (the
> generic tier-redaction pattern) and [`data-retention.md`](./data-retention.md)
> (regulatory-expiry stamp-at-write). This file is the **privacy-specific
> framing** of the response-redaction discipline — it points back at the
> generic pattern and adds the privacy invariants that make the discipline
> mandatory rather than convention.
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> §RBAC / API and §Privacy / consent. Enforces CHAIN-CONTRACTS.md §6a
> I-PR7. Born of epic #1915 child #1920.

## Rule

The structural pattern lives in
[`response-redaction.md`](./response-redaction.md). This file enumerates
the **PII-specific triggers** that make redaction non-negotiable, where
the generic rule is opt-in via the `@tieredVisibility` JSDoc tag.

When ANY of the following are true for a GET route under
`apps/admin/app/api/`:

1. Response carries a PII-bearing field (caller name / email / phone,
   transcript excerpt, evidence text, reasoning string, decay factor,
   confidence numeric, recommendation rationale, scoredBy attribution),
   AND
2. Route admits STUDENT or VIEWER tier sessions (role level 1) — the
   shape contains operator-only fields that a STUDENT shouldn't see.

Then the route MUST:

- Add the `@tieredVisibility` tag to its JSDoc header (enables the
  `hf-rbac/require-tiered-redactor` ESLint rule to enforce wiring).
- Import + invoke `visibilityTierForRole(role)` from `@/lib/rbac/visibility`.
- Import + invoke a `redact<Resource>ForTier(raw, viewerTier)` function
  from `@/lib/rbac/policies/<resource>.ts`.
- Register the route in `TIER_SENSITIVE_ROUTES` in
  `apps/admin/tests/api/tier-visibility-coverage.test.ts`.

## Why this is privacy, not just RBAC

A STUDENT session reading another learner's `confidence` numeric or
`reasoning` rationale is a confirmed **leak class** (5 routes pinned by
the tier-visibility-coverage exempt list ratchet:
`/api/callers/[id]/{skills-evidence, lo-mastery, uplift, memories, insights}`).
These aren't just permission gaps — they expose operator analysis,
behavioural scoring, and learner-evidence-source attribution that the
STUDENT-tier consumer was never authorised to see. That makes redaction
a Lattice-level privacy invariant, not an RBAC nice-to-have.

CHAIN-CONTRACTS.md §6a I-PR7 (epic #1915) catalogues this as a privacy
invariant. The `tier-visibility-coverage.test.ts` ratchet is the
load-bearing Coverage-pillar gate that prevents further drift.

## Pattern: route → resolver → projection → response

```typescript
import { visibilityTierForRole } from "@/lib/rbac/visibility";
import { redactSkillsEvidenceForTier } from "@/lib/rbac/policies/skills-evidence";

/**
 * @api GET /api/callers/[callerId]/skills-evidence
 * @scope callers:read
 * @tieredVisibility — required: skills-evidence carries reasoning + confidence
 */
export async function GET(req, { params }) {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;
  // ... scope check ...

  const viewerTier = visibilityTierForRole(auth.session.user.role);
  const raw = await computeRawSkillsEvidence(callerId);
  return NextResponse.json(redactSkillsEvidenceForTier(raw, viewerTier));
}
```

The redactor signature today is `(raw, tier)`. When `#1924` ships
`PrivacyPolicyPreset` and `#1925` ships the `privacyPresetId` cascade
scalar, the signature extends to `(raw, tier, preset)` per `#1923`
(deferred). HIPAA preset strips more than Basic on the same route.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `eslint-rules/require-tiered-redactor.mjs` | Edit-time, opt-in via `@tieredVisibility` JSDoc tag | Routes that opt in but forget the import or invocation |
| `tests/api/tier-visibility-coverage.test.ts` | Coverage-pillar ratchet (currently 5 exempt) | New routes shipping without redactor when the existing 5 leaks haven't yet been wired (#1922) |
| `lib/rbac/policies/adaptations.ts::redactAdaptationsForTier` (PR #1710) | Canonical reference implementation | Drift in the pattern — copy this file's shape when wiring new resources |
| `lib/rbac/visibility.ts::visibilityTierForRole` | Tier resolver | Role-to-tier mapping changes in one place, not per-route |
| CHAIN-CONTRACTS.md §6a I-PR7 (PR #1938) | Cross-stage privacy invariant | Discoverability — the contract names the structural enforcer |

## When this rule does NOT apply

- Routes that return uniformly safe fields (status, category, slug
  identifiers, public catalogue data) — nothing to redact.
- Routes admitting only OPERATOR+ — no tier confusion possible.
- Routes whose response is uniformly operator-only AND admitted only to
  OPERATOR+ — no learner consumer.
- Section-level rather than field-level differences — consider separate
  routes if the redacted shape barely overlaps the full shape.

## Escalation

If you're writing a new route that has tier-sensitive fields and can't
add a redactor in the same PR, add a `// TODO(privacy-redaction):`
comment describing what the lower-tier shape should be AND register the
route in `TIER_VISIBILITY_EXEMPT` with a one-line reason. The ratchet
will pin the deferred work; `broken-windows` agent surfaces the TODO.

## Related

- [`response-redaction.md`](./response-redaction.md) — the generic
  tier-redaction pattern this rule references
- [`data-retention.md`](./data-retention.md) — sibling privacy rule on
  the write/retention side
- [`docs/CHAIN-CONTRACTS.md#6a`](../../docs/CHAIN-CONTRACTS.md) — §6a
  I-PR7 invariant
- [`docs/lattice-chains.md`](../../docs/lattice-chains.md) — §Privacy /
  consent matrix row for this rule
- [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md) —
  registry row for `require-tiered-redactor` + `tier-visibility-coverage`


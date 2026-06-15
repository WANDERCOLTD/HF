# Response Redaction Pattern (Role-Tiered Visibility)

> When a route returns a payload with operator-only fields next to learner-safe
> fields, do not branch the route by role and do not duplicate the route. Use
> a declarative redactor at the route boundary that projects the full response
> onto the tier-appropriate shape.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (write-side
> validate-before-execute), [`ai-read-grounding.md`](./ai-read-grounding.md)
> (chat-side verify-before-claim), and [`verify-before-fix.md`](./verify-before-fix.md)
> (developer-side symptom-then-cite). This is the **read-side
> visibility-policy** sibling — least-privilege-by-role on response shape.

## Rule: Tier-then-redact at the route boundary

When a route's response contains fields that are safe for some roles but
sensitive for others, route the data through a resource-specific redactor
**before** the `NextResponse.json(...)` call. The redactor decides what each
tier sees; the route never branches on role.

```
requireAuth(lowest-admit-tier) → scope-check → compute raw response →
  visibilityTierForRole(role) → redact<Resource>ForTier(raw, tier) → respond
```

## When This Applies

Any route where:

1. The natural admit gate is broader than the natural full-payload gate
   (e.g. STUDENT may read their own data, OPERATOR may read the full
   payload of any caller).
2. The response contains fields that fall into different sensitivity
   classes — numeric internals, free-text rationale, forward-planning,
   per-call evidence excerpts, etc.
3. The shape difference is per-field, not per-section. (If it's
   per-section, separate routes may be cleaner.)

Today: `/api/callers/[callerId]/adaptations` (the canonical example).
Candidates for future application: `/skills-evidence` (rationale text),
`/uplift` (REWARD rationale arrays), `/lo-mastery` (evidence excerpts).

## The Tiers

| Tier | Roles (level via `ROLE_LEVEL`) | Intent |
|---|---|---|
| `redacted` | STUDENT (1) / VIEWER (1) / TESTER (1) / SUPER_TESTER (2) / DEMO (0) | Learner-facing or audit-only views. Numeric values, free-text reasoning, and forward-planning fields are dropped. |
| `full` | OPERATOR / EDUCATOR (3) / ADMIN (4) | The full educator payload. |
| `diagnostic` | SUPERADMIN (5) | Reserved for future debug fields (timing data, raw cascade internals). Functionally same as `full` today. |

Coarse on purpose. Three tiers, not seven — per-role response shapes
explode the test surface and harden into accidental contracts.

## Required Pattern

```typescript
// In the route file:
import { visibilityTierForRole } from "@/lib/rbac/visibility";
import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";

export async function GET(req, { params }) {
  const auth = await requireAuth("VIEWER");   // widest admit gate
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const viewerTier = visibilityTierForRole(auth.session.user.role);
  const raw = await computeRawResponse(callerId);
  return NextResponse.json(redactAdaptationsForTier(raw, viewerTier));
}
```

The redactor lives at `lib/rbac/policies/<resource>.ts` and is a pure
function — no I/O, easy to test exhaustively per tier.

## Whitelist-default-safe

When a new field is added to the raw response, it does NOT auto-flow
to the `redacted` tier. The redactor's `redacted` branch must
explicitly forward each field; if you add a sensitive field and forget
to update the redactor, the type system fires (the redacted shape
type is a structurally distinct interface, not `Partial<Raw>`).

The corresponding vitest pins the absence of every sensitive field
per tier so a regression like "I made the redacted shape forward
sourceScope" gets caught at test time.

## Response carries its tier

Every redactor returns a discriminated union with `viewerTier:
"redacted" | "full" | "diagnostic"`. The client branches on this
discriminator, NOT on its own copy of the user role. Two reasons:

1. The server is the source of truth — a stale or impersonated role
   on the client can't elevate the response shape.
2. The client doesn't need to know the role-to-tier mapping (it can
   change in `lib/rbac/visibility.ts` without touching client code).

## Existing Implementations

| Resource | Redactor | Route | Pinned by |
|---|---|---|---|
| Adaptations | `lib/rbac/policies/adaptations.ts::redactAdaptationsForTier` | `/api/callers/[callerId]/adaptations` | `tests/lib/rbac/policies/adaptations-redact.test.ts` + `tests/api/callers/adaptations-route.test.ts` |

## Lint enforcement (Wave C5 of #1685)

`eslint-rules/require-tiered-redactor.mjs` (rule `hf-rbac/require-tiered-redactor`, error severity from day 1) makes the pattern self-enforcing once a route opts in:

1. Add `@tieredVisibility` to the route's JSDoc header.
2. The rule then asserts the file imports `visibilityTierForRole` from `@/lib/rbac/visibility` AND imports a `redact<Resource>ForTier` function from `@/lib/rbac/policies/*`.
3. The rule also asserts both helpers are actually invoked in the handler — not just imported.

The rule is **opt-in** because tier-sensitivity isn't reliably detectable from AST alone. Once a route opts in by adding the tag, the rule keeps it honest forever — refactors that accidentally drop the import or the call fail CI.

**Allow-list:** test files, the rule source itself, and KB docs are exempt — they legitimately mention `@tieredVisibility` as data (fixtures, examples). New route templates that include the tag in a code-fence example must live under one of the exempt paths.

**Cascade behaviour:** when an import is missing, the corresponding "call missing" error is suppressed — the dev fixes one issue at a time. Once the import lands, the call-missing error surfaces on the next lint pass.

**Catalogued:** [`docs/kb/guard-registry.md#guard-require-tiered-redactor`](../../docs/kb/guard-registry.md#guard-require-tiered-redactor).

## When NOT to apply

- Routes where everyone sees the same shape (most reads).
- Per-route role gating that's coarser than field-level (e.g. an
  endpoint is OPERATOR-only — keep `requireAuth("OPERATOR")`, no
  redactor needed).
- Section-level rather than field-level differences (consider
  separate routes if the redacted shape barely overlaps the full
  shape).

## Escalation

If you're writing a new route that has tier-sensitive fields and
can't add a redactor in the same PR, add a `// TODO(visibility):`
comment describing what the lower-tier shape should be. These are
tracked by `broken-windows` agent.

/**
 * Response visibility tiers — declarative, role-driven redaction at
 * the route boundary.
 *
 * **The pattern:** every route that returns a payload with sensitive
 * vs reference-grade fields computes a tier from the session role and
 * passes the raw response through a resource-specific redactor:
 *
 *   ```ts
 *   import { visibilityTierForRole } from "@/lib/rbac/visibility";
 *   import { redactAdaptationsForTier } from "@/lib/rbac/policies/adaptations";
 *
 *   const auth = await requireAuth("VIEWER");
 *   if (isAuthError(auth)) return auth.error;
 *   if (!studentAllowedToReadCaller(auth.session, callerId)) return ...;
 *
 *   const tier = visibilityTierForRole(auth.session.user.role);
 *   const raw = await computeAdaptationsResponse(callerId);
 *   return NextResponse.json({ ...redactAdaptationsForTier(raw, tier), viewerTier: tier });
 *   ```
 *
 * **Why tier-then-redact (not 3 routes / not GraphQL):**
 * - Single route URL — client doesn't have to know its own role to fetch
 * - Server-enforced — client can never opt up
 * - Redactor is per-resource so each policy is co-located with its
 *   response type (see `lib/rbac/policies/<resource>.ts`)
 * - Default-safe by whitelist — new fields aren't auto-exposed to
 *   lower tiers; the redactor's lower-tier branch must explicitly
 *   forward them
 *
 * **The three tiers:**
 * - `redacted` — STUDENT / TESTER / VIEWER. Learner-facing or
 *   audit-only views. Numeric values, free-text reasoning, and
 *   forward-planning fields are dropped.
 * - `full` — OPERATOR / EDUCATOR / ADMIN. The full educator payload.
 * - `diagnostic` — SUPERADMIN. Reserved for future debug fields
 *   (timing data, raw cascade internals). For now functionally the
 *   same as `full`.
 *
 * Sibling to `.claude/rules/ai-to-db-guard.md` (write-side) and
 * `.claude/rules/ai-read-grounding.md` (chat-side). This is the
 * **route-response visibility-policy** sibling — read-side
 * least-privilege-by-role.
 */

import type { UserRole } from "@prisma/client";

import { ROLE_LEVEL } from "@/lib/roles";

export type VisibilityTier = "redacted" | "full" | "diagnostic";

/**
 * Maps a session role to its response-visibility tier.
 *
 * The mapping is intentionally coarse — three tiers, not seven —
 * because per-role response shapes explode the test surface and
 * harden into accidental contracts. Two cuts (educator vs learner,
 * superadmin diagnostics) cover every read surface we have today.
 */
export function visibilityTierForRole(role: UserRole | undefined): VisibilityTier {
  if (!role) return "redacted";
  const level = ROLE_LEVEL[role] ?? 0;
  if (level >= ROLE_LEVEL.SUPERADMIN) return "diagnostic";
  if (level >= ROLE_LEVEL.OPERATOR) return "full";
  return "redacted";
}

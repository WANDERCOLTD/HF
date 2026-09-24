/**
 * Entity Access Control
 *
 * Contract-driven entity-level access enforcement.
 * Loads the ENTITY_ACCESS_V1 contract from ContractRegistry (DB-backed, 30s cache)
 * and enforces per-role CRUD permissions with scope-based data filtering.
 *
 * Usage:
 *   const result = await requireEntityAccess("callers", "R");
 *   if (isEntityAuthError(result)) return result.error;
 *   const { session, scope } = result;
 *   // Use scope to filter queries: ALL, DOMAIN, OWN
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { ContractRegistry } from "@/lib/contracts/registry";
import { config } from "@/lib/config";
import type { UserRole } from "@prisma/client";
import type { Session } from "next-auth";

// ============================================================================
// Types
// ============================================================================

export type EntityName =
  | "callers"
  | "calls"
  | "cohorts"
  | "domains"
  | "playbooks"
  | "specs"
  | "parameters"
  | "goals"
  | "users"
  | "pipeline"
  | "ai_config"
  | "settings"
  | "analytics"
  | "metering"
  | "messages"
  | "content"
  | "sim"
  | "invites"
  | "rbac_policy"
  | "terminology";

export type AccessScope = "ALL" | "DOMAIN" | "OWN" | "NONE";
export type Operation = "C" | "R" | "U" | "D";

export type EntityAuthSuccess = {
  session: Session;
  scope: AccessScope;
};

export type EntityAuthFailure = {
  error: NextResponse;
};

export type EntityAuthResult = EntityAuthSuccess | EntityAuthFailure;

// ============================================================================
// Matrix cache (loaded from ENTITY_ACCESS_V1 contract)
// ============================================================================

type AccessRule = { scope: AccessScope; operations: Set<Operation> };
type RoleMatrix = Record<string, Record<string, AccessRule>>;

let cachedMatrix: RoleMatrix | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Fallback matrix used when the contract isn't seeded yet.
 * SUPERADMIN gets full access; all others get NONE.
 * This ensures the system is secure by default.
 */
const FALLBACK_RULE: AccessRule = { scope: "NONE", operations: new Set() };
const SUPERADMIN_RULE: AccessRule = { scope: "ALL", operations: new Set(["C", "R", "U", "D"]) };

/**
 * Parse a rule string like "ALL:CRUD" into { scope, operations }
 */
function parseRule(rule: string): AccessRule {
  const [scope, ops] = rule.split(":") as [AccessScope, string];
  return {
    scope: scope as AccessScope,
    operations: new Set((ops || "").split("") as Operation[]),
  };
}

/**
 * Load and cache the access matrix from the ENTITY_ACCESS_V1 contract
 */
async function loadMatrix(): Promise<RoleMatrix> {
  const now = Date.now();
  if (cachedMatrix && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedMatrix;
  }

  const contract = await ContractRegistry.getContract(config.specs.entityAccessV1);

  if (!contract || !contract.matrix) {
    console.warn("[access-control] ENTITY_ACCESS_V1 contract not found — using secure fallback");
    cachedMatrix = {};
    cacheLoadedAt = now;
    return cachedMatrix;
  }

  const matrix: RoleMatrix = {};
  const rawMatrix = contract.matrix as Record<string, Record<string, string>>;

  for (const [entity, roles] of Object.entries(rawMatrix)) {
    matrix[entity] = {};
    for (const [role, ruleStr] of Object.entries(roles)) {
      matrix[entity][role] = parseRule(ruleStr);
    }
  }

  cachedMatrix = matrix;
  cacheLoadedAt = now;
  return matrix;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if a role has access to an entity for a given operation.
 * Returns the access scope (ALL, DOMAIN, OWN, NONE).
 */
export async function checkEntityAccess(
  role: UserRole,
  entity: EntityName,
  operation: Operation
): Promise<{ allowed: boolean; scope: AccessScope }> {
  // SUPERADMIN always has full access (hardcoded bypass for safety)
  if (role === "SUPERADMIN") {
    return { allowed: true, scope: "ALL" };
  }

  const matrix = await loadMatrix();
  const entityRules = matrix[entity];

  if (!entityRules) {
    // Entity not in matrix — deny by default
    return { allowed: false, scope: "NONE" };
  }

  // Handle VIEWER as alias for TESTER
  const effectiveRole = role === "VIEWER" ? "TESTER" : role;
  const rule = entityRules[effectiveRole] || FALLBACK_RULE;

  if (rule.scope === "NONE" || !rule.operations.has(operation)) {
    return { allowed: false, scope: "NONE" };
  }

  return { allowed: true, scope: rule.scope };
}

/**
 * Require entity access for an API route.
 * Combines authentication + entity access check.
 *
 * Returns { session, scope } on success, or { error } on failure.
 */
export async function requireEntityAccess(
  entity: EntityName,
  operation: Operation
): Promise<EntityAuthResult> {
  let session: Session | null;
  try {
    session = await auth();
  } catch (e) {
    console.error("[requireEntityAccess] auth() threw:", (e as Error).message);
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { allowed, scope } = await checkEntityAccess(
    session.user.role,
    entity,
    operation
  );

  if (!allowed) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session, scope };
}

/**
 * Type guard: check if result is an entity auth error.
 */
export function isEntityAuthError(result: EntityAuthResult): result is EntityAuthFailure {
  return "error" in result;
}

/**
 * Build a Prisma `where` clause filter based on scope.
 * Convenience helper for API routes that need to filter by scope.
 *
 * @param scope - Access scope from requireEntityAccess
 * @param session - Authenticated session
 * @param ownerField - Field name for OWN scope (default: "userId")
 * @param domainField - Field name for DOMAIN scope (default: "domainId")
 */
export function buildScopeFilter(
  scope: AccessScope,
  session: Session,
  ownerField: string = "userId",
  domainField: string = "domainId"
): Record<string, string> {
  switch (scope) {
    case "OWN":
      return { [ownerField]: session.user.id };
    case "DOMAIN":
      if (!session.user.assignedDomainId) {
        // No domain assigned — this shouldn't happen for DOMAIN-scoped users
        // Return impossible filter to be safe (no results)
        return { [domainField]: "__no_domain_assigned__" };
      }
      return { [domainField]: session.user.assignedDomainId };
    case "ALL":
    default:
      return {};
  }
}

/**
 * Invalidate the cached matrix (useful after contract updates).
 */
export function invalidateAccessCache(): void {
  cachedMatrix = null;
  cacheLoadedAt = 0;
}

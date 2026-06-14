/**
 * Manifest-Driven Page Role Map
 *
 * Derives URL → minimum role requirements from the sidebar manifest.
 * Single source of truth: sidebar-manifest.json defines both
 * navigation visibility and page-level access enforcement.
 *
 * Used by middleware.ts for runtime enforcement and
 * page-auth-coverage.test.ts for CI validation.
 */

import manifest from "@/lib/sidebar/sidebar-manifest.json";

// Role hierarchy — duplicated as a plain object for edge-runtime compatibility
// (middleware.ts runs at the edge, can't import Prisma types)
const ROLE_LEVEL: Record<string, number> = {
  SUPERADMIN: 5,
  ADMIN: 4,
  OPERATOR: 3,
  EDUCATOR: 3,
  SUPER_TESTER: 2,
  TESTER: 1,
  STUDENT: 1,
  DEMO: 0,
  VIEWER: 1,
};

// Build route→role map from sidebar manifest
const PAGE_ROLES = new Map<string, string>();

for (const section of manifest) {
  if (!section.requiredRole) continue;
  const role = section.requiredRole;
  // All item hrefs in this section inherit the section's requiredRole.
  // (No section-level href — section is a grouping container; items carry the URLs.)
  for (const item of section.items) {
    PAGE_ROLES.set(item.href, role);
  }
}

/**
 * Get the minimum role required for a given URL path.
 * Uses exact match first, then longest-prefix match.
 * Returns null if the path has no role requirement (open to any authenticated user).
 */
export function getRequiredRole(pathname: string): string | null {
  // Exact match
  if (PAGE_ROLES.has(pathname)) return PAGE_ROLES.get(pathname)!;

  // Longest-prefix match: /x/specs/abc123 → matches /x/specs
  let best: { prefix: string; role: string } | null = null;
  for (const [prefix, role] of PAGE_ROLES) {
    if (
      pathname.startsWith(prefix + "/") &&
      (!best || prefix.length > best.prefix.length)
    ) {
      best = { prefix, role };
    }
  }

  return best?.role ?? null;
}

/**
 * Check if a user's role meets the required level.
 */
export function hasRequiredRole(
  userRole: string | undefined,
  requiredRole: string,
): boolean {
  const userLevel = ROLE_LEVEL[userRole ?? ""] ?? 0;
  const requiredLevel = ROLE_LEVEL[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}

/** All manifest-covered URLs (for CI test) */
export function getManifestUrls(): string[] {
  return Array.from(PAGE_ROLES.keys());
}

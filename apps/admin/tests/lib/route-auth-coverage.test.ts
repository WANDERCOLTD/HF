/**
 * Route Auth Coverage Test
 *
 * Scans all API route files and verifies they call requireAuth() or
 * requireEntityAccess(), or are explicitly listed as public.
 * This prevents auth regressions when new routes are added.
 *
 * NO HARDCODED ROLE ASSIGNMENTS — roles are defined only in:
 *   1. lib/permissions.ts (ROLE_LEVEL hierarchy)
 *   2. Each route's requireAuth("ROLE") or requireEntityAccess() call
 *   3. ENTITY_ACCESS_V1 contract (entity-level access matrix)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =====================================================
// PUBLIC ROUTES (no auth required)
// =====================================================

/** Routes that are intentionally public — any addition here needs team review */
const PUBLIC_ROUTES = new Set([
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/auth/login/route.ts",
  "app/api/health/route.ts",
  "app/api/ready/route.ts",
  "app/api/system/readiness/route.ts",
  "app/api/system/db-target/route.ts",  // Returns live runtime DATABASE_URL target — used by status-bar chip + /db-route verification (#986)
  "app/api/invite/route.ts",         // Accept invite (token-based, not session)
  "app/api/invite/accept/route.ts",
  "app/api/invite/verify/route.ts",  // Token-based invite verification (no session)
  "app/api/vapi/assistant-request/route.ts", // 307 → /api/voice/vapi/* (AnyVoice #1079)
  "app/api/vapi/knowledge/route.ts",         // 307 → /api/voice/vapi/* (AnyVoice #1079)
  "app/api/vapi/tools/route.ts",             // 307 → /api/voice/vapi/* (AnyVoice #1079)
  "app/api/vapi/webhook/route.ts",           // 307 → /api/voice/vapi/* (AnyVoice #1079)
  "app/api/voice/[slug]/assistant-request/route.ts", // Canonical voice route (webhook-secret auth, #1079)
  "app/api/voice/[slug]/knowledge/route.ts",         // Canonical voice route (webhook-secret auth, #1079)
  "app/api/voice/[slug]/tools/route.ts",             // Canonical voice route (webhook-secret auth, #1079)
  "app/api/voice/[slug]/webhook/route.ts",           // Canonical voice route (webhook-secret auth, #1079)
  "app/api/join/[token]/route.ts",           // Public magic join link (token-based, no session)
]);

// =====================================================
// HELPERS
// =====================================================

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === "route.ts" || entry.name === "route.js") {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

// =====================================================
// TESTS
// =====================================================

describe("Route auth coverage", () => {
  const apiDir = path.join(process.cwd(), "app/api");
  const routeFiles = findRouteFiles(apiDir);

  it("finds at least 100 route files (sanity check)", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(100);
  });

  it("every non-public route calls requireAuth()", () => {
    const missing: string[] = [];

    for (const filePath of routeFiles) {
      const relative = path.relative(process.cwd(), filePath);

      // Skip public routes
      if (PUBLIC_ROUTES.has(relative)) continue;

      const content = fs.readFileSync(filePath, "utf-8");

      // Check for requireAuth or requireEntityAccess import and call
      const hasRequireAuth =
        content.includes("requireAuth") ||
        content.includes("requireEntityAccess") ||
        content.includes("requireEducator") ||
        content.includes("requireStudent");

      if (!hasRequireAuth) {
        missing.push(relative);
      }
    }

    if (missing.length > 0) {
      console.error(
        `\n${missing.length} route(s) missing requireAuth():\n` +
          missing.map((f) => `  - ${f}`).join("\n")
      );
    }

    expect(missing).toEqual([]);
  });

  it("no route uses ad-hoc role checks instead of requireAuth()", () => {
    const adHocPatterns = [
      /session\.user\.role\s*(!==|===|!=|==)\s*["'](SUPERADMIN|ADMIN|OPERATOR|SUPER_TESTER|TESTER|VIEWER|DEMO)["']/,
    ];

    // This one exception is a business rule, not auth
    const ALLOWED_EXCEPTIONS = new Set([
      // Ticket ownership: "owner OR admin" is a business rule on top of auth
      "app/api/tickets/[ticketId]/route.ts",
    ]);

    const violations: string[] = [];

    for (const filePath of routeFiles) {
      const relative = path.relative(process.cwd(), filePath);
      if (ALLOWED_EXCEPTIONS.has(relative)) continue;

      const content = fs.readFileSync(filePath, "utf-8");

      for (const pattern of adHocPatterns) {
        if (pattern.test(content)) {
          violations.push(relative);
          break;
        }
      }
    }

    if (violations.length > 0) {
      console.error(
        `\n${violations.length} route(s) with ad-hoc role checks (use requireAuth instead):\n` +
          violations.map((f) => `  - ${f}`).join("\n")
      );
    }

    expect(violations).toEqual([]);
  });

  it("public routes list is minimal (no unnecessary exemptions)", () => {
    // Ensure no public route actually has requireAuth (meaning it should be removed from the public list)
    const unnecessaryPublic: string[] = [];

    for (const route of PUBLIC_ROUTES) {
      const fullPath = path.join(process.cwd(), route);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.includes("requireAuth") || content.includes("requireEntityAccess")) {
        unnecessaryPublic.push(route);
      }
    }

    if (unnecessaryPublic.length > 0) {
      console.error(
        `\nThese routes are marked public but actually use requireAuth() — remove from PUBLIC_ROUTES:\n` +
          unnecessaryPublic.map((f) => `  - ${f}`).join("\n")
      );
    }

    expect(unnecessaryPublic).toEqual([]);
  });
});

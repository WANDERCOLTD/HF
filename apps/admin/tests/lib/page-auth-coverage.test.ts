/**
 * Page Auth Coverage Test
 *
 * Scans all page.tsx files under app/x/ and verifies that every page URL
 * is either covered by the sidebar manifest's requiredRole (enforced by
 * middleware) or explicitly listed as a public page.
 *
 * This prevents new pages from being added without role-level access control.
 * Mirrors route-auth-coverage.test.ts but for UI pages instead of API routes.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getRequiredRole } from "@/lib/page-roles";

// =====================================================
// PUBLIC PAGES (any authenticated user can access)
// =====================================================

/**
 * Pages accessible to any logged-in user (no minimum role beyond VIEWER).
 * These live in sidebar manifest sections without a requiredRole.
 * Any addition here should be reviewed — consider adding a requiredRole
 * to the manifest section instead.
 *
 * Use URL prefixes to cover dynamic segments:
 *   "/x/callers" covers /x/callers, /x/callers/[callerId], etc.
 */
const PUBLIC_PAGES = new Set([
  // Dashboard — has its own role-based rendering via switch/case
  "/x",
  // Account (accessible from user menu, not in sidebar)
  "/x/account",
  // Home section (no requiredRole)
  "/x/demos",
  "/x/tickets",
  // Educator section (no requiredRole — scoped by educator-access)
  "/x/educator",
  // Student section (no requiredRole — scoped by student-access)
  "/x/student",
  // Goals — removed standalone page, now a tab on course detail
]);

// =====================================================
// HELPERS
// =====================================================

/** Recursively find all page.tsx files under a directory */
function findPageFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip private directories (prefixed with _)
        if (!entry.name.startsWith("_")) {
          walk(fullPath);
        }
      } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/** Convert a page file path to its URL path */
function filePathToUrl(filePath: string): string {
  // e.g. /abs/path/app/x/ai-config/page.tsx → /x/ai-config
  const cwd = process.cwd();
  const relative = path.relative(cwd, filePath); // app/x/ai-config/page.tsx
  const withoutFile = path.dirname(relative); // app/x/ai-config
  const url = "/" + withoutFile.replace(/^app\//, ""); // /x/ai-config
  return url;
}

/**
 * Check if a URL is covered by the PUBLIC_PAGES set.
 * Supports prefix matching: "/x/callers" covers "/x/callers/[callerId]".
 */
function isPublicPage(url: string): boolean {
  if (PUBLIC_PAGES.has(url)) return true;

  // Check prefix match
  for (const prefix of PUBLIC_PAGES) {
    if (url.startsWith(prefix + "/")) return true;
  }

  return false;
}

// =====================================================
// TESTS
// =====================================================

describe("Page auth coverage", () => {
  const pagesDir = path.join(process.cwd(), "app/x");
  const pageFiles = findPageFiles(pagesDir);

  it("finds at least 50 page files (sanity check)", () => {
    expect(pageFiles.length).toBeGreaterThanOrEqual(50);
  });

  it("every page is covered by manifest requiredRole or PUBLIC_PAGES", () => {
    const uncovered: string[] = [];

    for (const filePath of pageFiles) {
      const url = filePathToUrl(filePath);

      // Check if covered by manifest (middleware enforcement)
      const manifestRole = getRequiredRole(url);
      if (manifestRole) continue;

      // Check if explicitly public
      if (isPublicPage(url)) continue;

      uncovered.push(`${url} (${path.relative(process.cwd(), filePath)})`);
    }

    if (uncovered.length > 0) {
      console.error(
        `\n${uncovered.length} page(s) not covered by RBAC:\n` +
          uncovered.map((p) => `  - ${p}`).join("\n") +
          "\n\nFix: Add a requiredRole to the page's sidebar manifest section," +
          "\nor add the URL to PUBLIC_PAGES in this test.\n",
      );
    }

    expect(uncovered).toEqual([]);
  });

  it("PUBLIC_PAGES entries are not redundantly covered by manifest", () => {
    // If a page is in PUBLIC_PAGES but the manifest already enforces a role,
    // the PUBLIC_PAGES entry is unnecessary and may be confusing.
    const redundant: string[] = [];

    for (const url of PUBLIC_PAGES) {
      const manifestRole = getRequiredRole(url);
      if (manifestRole) {
        redundant.push(`${url} (manifest requires ${manifestRole})`);
      }
    }

    if (redundant.length > 0) {
      console.error(
        `\nThese PUBLIC_PAGES entries are redundant — manifest already enforces role:\n` +
          redundant.map((p) => `  - ${p}`).join("\n") +
          "\n\nRemove them from PUBLIC_PAGES.\n",
      );
    }

    expect(redundant).toEqual([]);
  });
});

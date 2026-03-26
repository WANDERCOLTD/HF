/**
 * Route-to-breadcrumb mapping for the top bar.
 *
 * Each entry maps a URL path prefix to a breadcrumb label.
 * Labels can be:
 * - A static string (rendered as-is)
 * - A TermKey reference (resolved via useTerminology at render time)
 * - An entity lookup (resolved from EntityContext or lightweight fetch)
 *
 * Order matters: entries are matched top-down, first match wins.
 */

import type { TermKey } from "@/lib/terminology/types";

// ── Types ────────────────────────────────────────────────

export interface RouteBreadcrumbDef {
  /** URL path prefix to match (exact or with trailing segments) */
  path: string;
  /** Static label, OR term key for terminology-aware resolution */
  label: string | { termKey: TermKey; plural?: boolean };
}

/** Entity types that can appear as dynamic [id] segments */
export type BreadcrumbEntityType =
  | "playbook"
  | "subject"
  | "source"
  | "domain"
  | "community"
  | "cohort"
  | "caller"
  | "call"
  | "institution";

/** Maps entity type to its API endpoint for name resolution */
export const ENTITY_API_MAP: Record<BreadcrumbEntityType, string> = {
  playbook: "/api/playbooks",
  subject: "/api/subjects",
  source: "/api/content-sources",
  domain: "/api/domains",
  community: "/api/communities",
  cohort: "/api/cohorts",
  caller: "/api/callers",
  call: "/api/calls",
  institution: "/api/institutions",
};

/** Maps entity type to the JSON path for extracting the name */
export const ENTITY_NAME_PATH: Record<BreadcrumbEntityType, string[]> = {
  playbook: ["playbook", "name"],
  subject: ["subject", "name"],
  source: ["source", "title"],
  domain: ["domain", "name"],
  community: ["community", "name"],
  cohort: ["cohort", "name"],
  caller: ["caller", "name"],
  call: ["call", "callerName"],
  institution: ["institution", "name"],
};

// ── Route Definitions ────────────────────────────────────

/**
 * Static route-to-label mapping for all /x/** top-level pages.
 * Matched by exact path. Dynamic segments ([id]) are handled
 * separately by the useBreadcrumbs hook via entity resolution.
 */
export const ROUTE_LABELS: Record<string, string | { termKey: TermKey; plural?: boolean }> = {
  // Library
  "/x/courses": { termKey: "playbook", plural: true },
  "/x/courses/new": "New Course",
  "/x/courses/create": "Create Course",
  "/x/subjects": "Subjects",
  "/x/content-review": "Review",
  "/x/dictionary": "Dictionary",
  "/x/import": "Import",

  // Calls
  "/x/sim": "Sim",
  "/x/analytics": "Analytics",
  "/x/testimony": "Testimony",

  // Manage
  "/x/communities": "Communities",
  "/x/communities/new": "New Community",
  "/x/cohorts": { termKey: "cohort", plural: true },
  "/x/callers": { termKey: "caller", plural: true },
  "/x/jobs": "Jobs",

  // Configure
  "/x/domains": { termKey: "domain", plural: true },
  "/x/playbooks": { termKey: "playbook", plural: true },
  "/x/specs": "Specs",
  "/x/layers": "Layers",
  "/x/taxonomy-graph": "Taxonomy",
  "/x/flows": "Flows",
  "/x/content-explorer": "Content Explorer",

  // My School
  "/x/educator": "Dashboard",
  "/x/educator/departments": { termKey: "group", plural: true },
  "/x/educator/try": "Try It",
  "/x/educator/reports": "Reports",
  "/x/educator/settings": "Settings",
  "/x/educator/classrooms": { termKey: "cohort", plural: true },
  "/x/educator/students": { termKey: "caller", plural: true },

  // My Learning
  "/x/student/stuff": "Dashboard",
  "/x/student/files": "Files",
  "/x/student/progress": "Progress",
  "/x/student/calls": { termKey: "session_short", plural: true },
  "/x/student/teacher": { termKey: "mentor" },

  // AI
  "/x/ai-config": "AI Config",
  "/x/ai-knowledge": "AI Knowledge",
  "/x/logs": "AI Logs",
  "/x/ai-errors": "AI Errors",
  "/x/metering": "AI Metering",

  // Administration
  "/x/system": "System Health",
  "/x/system/access-control": "Access Control",
  "/x/users": "Team",
  "/x/institutions": { termKey: "domain", plural: true },
  "/x/institutions/new": "New Institution",
  "/x/settings": "Settings",
  "/x/account": "Account",

  // Dev Tools
  "/x/playground": "Playground",
  "/x/pipeline": "Pipeline Runs",
  "/x/launchpad": "Launchpad",
  "/x/debug": "Debug",
  "/x/admin/tests": "E2E Tests",
  "/x/data-management": "Seed Data",
  "/x/snapshots": "Snapshots",
  "/x/smoke-test": "Smoke Test",
  "/x/wizard-lab": "Wizard Lab",

  // Launch wizards
  "/x/get-started-v5": "Build Course",
  "/x/onboarding": "Onboarding Flows",
  "/x/teach": "Teach",
  "/x/demonstrate": "Demonstrate",
};

/**
 * Parent breadcrumb for wizard/leaf pages that should show a back-trail in the topbar.
 * e.g. /x/get-started → "Dashboard > Get Started"
 */
export const PARENT_ROUTES: Record<string, { label: string; href: string }> = {
  "/x/get-started-v5": { label: "Dashboard", href: "/x" },
};

/**
 * Route patterns with dynamic entity segments.
 * Pattern: parent path + entity type for the [id] segment.
 * Matched in order; the first match wins.
 */
export interface DynamicRoutePattern {
  /** Parent path before the dynamic segment */
  parentPath: string;
  /** Breadcrumb label for the parent list page */
  parentLabel: string | { termKey: TermKey; plural?: boolean };
  /** Entity type for resolving the dynamic [id] segment name */
  entityType: BreadcrumbEntityType;
  /** Optional nested patterns under this entity */
  children?: DynamicRoutePattern[];
}

export const DYNAMIC_ROUTES: DynamicRoutePattern[] = [
  {
    parentPath: "/x/courses",
    parentLabel: { termKey: "playbook", plural: true },
    entityType: "playbook",
    children: [
      {
        parentPath: "subjects",
        parentLabel: "Subjects",
        entityType: "subject",
        children: [
          {
            parentPath: "sources",
            parentLabel: "Sources",
            entityType: "source",
          },
        ],
      },
      {
        parentPath: "sessions",
        parentLabel: "Sessions",
        entityType: "playbook", // session number, not entity — special case
      },
    ],
  },
  {
    parentPath: "/x/institutions",
    parentLabel: { termKey: "domain", plural: true },
    entityType: "institution",
  },
  {
    parentPath: "/x/communities",
    parentLabel: "Communities",
    entityType: "community",
  },
  {
    parentPath: "/x/cohorts",
    parentLabel: { termKey: "cohort", plural: true },
    entityType: "cohort",
  },
  {
    parentPath: "/x/callers",
    parentLabel: { termKey: "caller", plural: true },
    entityType: "caller",
  },
  {
    parentPath: "/x/subjects",
    parentLabel: "Subjects",
    entityType: "subject",
  },
  {
    parentPath: "/x/domains",
    parentLabel: { termKey: "domain", plural: true },
    entityType: "domain",
  },
];

// ── Helpers ──────────────────────────────────────────────

/** Convert a URL slug to title case: "wizard-lab" → "Wizard Lab" */
export function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

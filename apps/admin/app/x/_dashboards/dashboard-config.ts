/**
 * Dashboard Configuration — Role-based section visibility & entity config
 *
 * Each role gets a config controlling which sections appear,
 * what entity previews to show, and which quick links are available.
 */

import type { TermKey } from "@/lib/terminology/types";

// ── Entity Config ───────────────────────────────────────────

export type EntityKey = "domains" | "playbooks" | "callers" | "specs" | "communities";

export interface EntityConfig {
  key: EntityKey;
  termKey: TermKey;          // terminology key for label
  icon: string;              // Lucide icon name from ICON_MAP
  href: string;              // "View all" link
  createHref: string;        // "+ New" link
  columns: EntityColumn[];   // What to show in each row
}

export interface EntityColumn {
  key: string;               // field name in entity data
  label?: string;            // optional header (not shown in compact mode)
  termKey?: TermKey;         // if label should use terminology
  type: "text" | "count" | "date" | "badge";
}

export const ENTITY_CONFIGS: Record<EntityKey, EntityConfig> = {
  domains: {
    key: "domains",
    termKey: "domain",
    icon: "Globe",
    href: "/x/domains",
    createHref: "/x/institutions/new",
    columns: [
      { key: "playbookCount", type: "count", termKey: "playbook" },
      { key: "callerCount", type: "count", termKey: "caller" },
      { key: "kind", type: "badge" },
    ],
  },
  playbooks: {
    key: "playbooks",
    termKey: "playbook",
    icon: "BookOpen",
    href: "/x/playbooks",
    createHref: "/x/courses",
    columns: [
      { key: "domainName", type: "text", termKey: "domain" },
      { key: "callerCount", type: "count", termKey: "caller" },
      { key: "status", type: "badge" },
    ],
  },
  callers: {
    key: "callers",
    termKey: "caller",
    icon: "User",
    href: "/x/callers",
    createHref: "/x/callers",
    columns: [
      { key: "domainName", type: "text", termKey: "domain" },
      { key: "lastCallAt", type: "date" },
    ],
  },
  specs: {
    key: "specs",
    termKey: "spec",
    icon: "ClipboardList",
    href: "/x/specs",
    createHref: "/x/specs",
    columns: [
      { key: "role", type: "badge" },
      { key: "version", type: "text" },
    ],
  },
  communities: {
    key: "communities",
    termKey: "cohort",
    icon: "Users",
    href: "/x/communities",
    createHref: "/x/quick-launch",
    columns: [
      { key: "callerCount", type: "count", termKey: "caller" },
      { key: "kind", type: "badge" },
    ],
  },
};

// ── Quick Link Config ───────────────────────────────────────

export interface QuickLink {
  label: string;             // display label (or term template)
  termKey?: TermKey;         // if label should use terminology
  icon: string;              // Lucide icon name
  href: string;
  description?: string;
}

// ── Role Config ─────────────────────────────────────────────

export interface DashboardRoleConfig {
  title: string;
  subtitle: string;          // supports {term} placeholders resolved at render
  showWizards: boolean;
  showJobs: boolean;
  showSearch: boolean;
  showFooter: boolean;
  entityKeys: EntityKey[];   // which entity previews to show
  recentCallsLimit: number;
  quickLinks: QuickLink[];
}

export const DASHBOARD_CONFIGS: Record<string, DashboardRoleConfig> = {
  SUPERADMIN: {
    title: "HumanFirst Studio",
    subtitle: "Build, test, and deploy conversational AI experiences",
    showWizards: true,
    showJobs: true,
    showSearch: true,
    showFooter: true,
    entityKeys: ["domains", "playbooks", "callers", "communities", "specs"],
    recentCallsLimit: 8,
    quickLinks: [
      { label: "Prompt Tuner", icon: "FlaskConical", href: "/x/playground?mode=caller", description: "Fine-tune prompts" },
      { label: "Analytics", icon: "TrendingUp", href: "/x/analytics", description: "Performance data" },
      { label: "Import", icon: "Download", href: "/x/import", description: "Transcripts & data" },
      { label: "Taxonomy", icon: "TreePine", href: "/x/dictionary", description: "Parameters & patterns" },
    ],
  },
  ADMIN: {
    title: "Dashboard",
    subtitle: "Manage your platform",
    showWizards: true,
    showJobs: true,
    showSearch: true,
    showFooter: false,
    entityKeys: ["domains", "playbooks", "callers", "communities"],
    recentCallsLimit: 6,
    quickLinks: [
      { label: "Analytics", icon: "TrendingUp", href: "/x/analytics", description: "Performance data" },
      { label: "Import", icon: "Download", href: "/x/import", description: "Transcripts & data" },
      { label: "Team", icon: "Users", href: "/x/users", description: "Manage users" },
    ],
  },
  OPERATOR: {
    title: "Dashboard",
    subtitle: "Manage your platform",
    showWizards: true,
    showJobs: true,
    showSearch: true,
    showFooter: false,
    entityKeys: ["domains", "playbooks", "callers", "communities"],
    recentCallsLimit: 6,
    quickLinks: [
      { label: "Analytics", icon: "TrendingUp", href: "/x/analytics", description: "Performance data" },
      { label: "Import", icon: "Download", href: "/x/import", description: "Transcripts & data" },
    ],
  },
  SUPER_TESTER: {
    title: "Testing Dashboard",
    subtitle: "Run tests and review results",
    showWizards: false,
    showJobs: false,
    showSearch: false,
    showFooter: false,
    entityKeys: ["callers", "domains"],
    recentCallsLimit: 5,
    quickLinks: [
      { label: "Learn", icon: "MessageCircle", href: "/x/sim", description: "Start a session" },
      { label: "Analytics", icon: "TrendingUp", href: "/x/analytics", description: "Test results" },
    ],
  },
  TESTER: {
    title: "My Calls",
    subtitle: "View your call history and start new conversations",
    showWizards: false,
    showJobs: false,
    showSearch: false,
    showFooter: false,
    entityKeys: ["callers"],
    recentCallsLimit: 5,
    quickLinks: [
      { label: "Learn", icon: "MessageCircle", href: "/x/sim", description: "Start a session" },
    ],
  },
  VIEWER: {
    title: "My Calls",
    subtitle: "View your call history and start new conversations",
    showWizards: false,
    showJobs: false,
    showSearch: false,
    showFooter: false,
    entityKeys: ["callers"],
    recentCallsLimit: 5,
    quickLinks: [
      { label: "Learn", icon: "MessageCircle", href: "/x/sim", description: "Start a session" },
    ],
  },
  DEMO: {
    title: "Welcome to HumanFirst",
    subtitle: "Experience AI-powered conversations that adapt to every individual.",
    showWizards: false,
    showJobs: false,
    showSearch: false,
    showFooter: false,
    entityKeys: [],
    recentCallsLimit: 0,
    quickLinks: [],
  },
};

// ── Task Labels & Resume Paths (moved from AdminDashboard) ──

export const TASK_LABELS: Record<string, string> = {
  quick_launch: "Community",
  institution_setup: "Institution Setup",
  content_wizard: "Content Wizard",
  create_spec: "Create Spec",
  configure_caller: "Configure Caller",
  extraction: "Extraction",
  curriculum_generation: "Curriculum",
};

export const RESUME_PATHS: Record<string, (ctx: Record<string, unknown>) => string> = {
  institution_setup: () => "/x/institutions/new",
  quick_launch: () => "/x/quick-launch",
  content_wizard: () => "/x/content-sources",
  create_spec: () => "/x/specs",
  configure_caller: (ctx) => ctx.callerId ? `/x/callers/${ctx.callerId}` : "/x/callers",
  extraction: (ctx) => ctx.subjectId ? `/x/subjects?id=${ctx.subjectId}` : "/x/subjects",
  curriculum_generation: (ctx) => ctx.subjectId ? `/x/subjects?id=${ctx.subjectId}` : "/x/subjects",
};

// ── Footer Links (SUPERADMIN only) ──────────────────────────

export const FOOTER_LINKS = [
  { href: "/x/pipeline", icon: "GitBranch", label: "Run History" },
  { href: "/x/metering", icon: "BarChart3", label: "Metering" },
  { href: "/x/ai-config", icon: "Bot", label: "AI Config" },
  { href: "/x/taxonomy-graph", icon: "Orbit", label: "Taxonomy Graph" },
];

// ── Wizard Actions ──────────────────────────────────────────

export const WIZARD_ACTIONS = [
  {
    label: "Institution",
    termKey: "domain" as TermKey,
    icon: "Rocket",
    href: "/x/institutions/new",
    description: "Set up a new institution",
    primary: true,
  },
  {
    label: "Course",
    termKey: "playbook" as TermKey,
    icon: "Rocket",
    href: "/x/courses?action=setup",
    description: "Create a new course",
    primary: false,
  },
  {
    label: "Community",
    termKey: "cohort" as TermKey,
    icon: "Rocket",
    href: "/x/quick-launch",
    description: "Set up a new group",
    primary: false,
  },
  {
    label: "Teach",
    icon: "GraduationCap",
    href: "/x/teach",
    description: "Teach a lesson with AI",
    primary: false,
  },
  {
    label: "Try It",
    icon: "PlayCircle",
    href: "/x/educator/try",
    description: "Preview the voice AI prompt",
    primary: false,
  },
];

// ── Helpers ─────────────────────────────────────────────────

/** Get config for a role, falling back to ADMIN */
export function getConfigForRole(role: string): DashboardRoleConfig {
  return DASHBOARD_CONFIGS[role] ?? DASHBOARD_CONFIGS.ADMIN;
}

/** Roles that are considered "admin-level" (OPERATOR+) */
const ADMIN_ROLES = new Set(["SUPERADMIN", "ADMIN", "OPERATOR"]);

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

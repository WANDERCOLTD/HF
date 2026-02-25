/**
 * Shared utility for grouping playbook specs into holographic categories.
 *
 * Extracted from app/x/courses/[courseId]/page.tsx so the same logic
 * can be reused by useCourseContext and other consumers.
 */

// ── Types ──────────────────────────────────────────────

export type SpecDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope?: string;
  outputType: string;
  specType?: string;
  specRole: string | null;
  config?: any;
  extendsAgent?: string | null;
  isActive?: boolean;
};

export type PlaybookItem = {
  id: string;
  itemType: string;
  isEnabled: boolean;
  sortOrder: number;
  spec: SpecDetail | null;
};

export type ResolvedSystemSpec = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  specRole: string | null;
  outputType: string;
};

export type SystemSpec = {
  specId: string;
  isEnabled: boolean;
  configOverride: any;
  spec?: ResolvedSystemSpec;
};

export type SpecGroup = Array<{ name: string; description: string | null; slug: string }>;

export type SpecGroups = {
  persona: SpecGroup;
  measure: SpecGroup;
  adapt: SpecGroup;
  guard: SpecGroup;
  voice: SpecGroup;
  compose: SpecGroup;
};

// ── Functions ──────────────────────────────────────────

export function archetypeLabel(slug: string | null | undefined): string {
  if (!slug) return "AI Agent";
  // Strip trailing version number (e.g., "TUT-001" → "Tut") and humanise
  return slug
    .replace(/-\d+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function groupSpecs(
  items: PlaybookItem[],
  systemSpecs: SystemSpec[],
): SpecGroups {
  // Domain items (IDENTITY overlays, CONTENT specs, etc.)
  const enabledItems = items
    .filter((i) => i.isEnabled && i.spec)
    .map((i) => i.spec!);

  // System specs (EXTRACT, SYNTHESISE, CONSTRAIN, etc.)
  const enabledSystem = (systemSpecs || [])
    .filter((s) => s.isEnabled && s.spec)
    .map((s) => s.spec!);

  const all = [...enabledItems, ...enabledSystem];

  return {
    persona: enabledItems.filter((s) => s.specRole === "IDENTITY"),
    measure: all.filter(
      (s) =>
        s.specRole === "EXTRACT" ||
        (s.outputType === "MEASURE" && s.specRole !== "SYNTHESISE") ||
        s.outputType === "LEARN",
    ),
    adapt: all.filter(
      (s) =>
        s.specRole === "SYNTHESISE" &&
        ["ADAPT", "REWARD", "AGGREGATE"].includes(s.outputType),
    ),
    guard: all.filter((s) => s.specRole === "CONSTRAIN"),
    voice: all.filter((s) => s.specRole === "VOICE"),
    compose: all.filter(
      (s) =>
        s.outputType === "COMPOSE" &&
        s.specRole !== "IDENTITY" &&
        s.specRole !== "CONSTRAIN",
    ),
  };
}

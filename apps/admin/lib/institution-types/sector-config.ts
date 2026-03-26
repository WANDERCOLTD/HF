/**
 * Sector Configuration
 *
 * Shared config for institution type display: icons, colors, descriptions, and archetype mapping.
 * Used by SectorBadge (display) and TypePicker (creation).
 *
 * Colors reference existing --badge-*-* CSS variables from globals.css.
 * Archetype mapping mirrors seed-institution-types.ts for client-side use.
 *
 * Note: This is a client-side file — server code should use config.specs.*Archetype instead.
 */

// Archetype slug constants — mirror config.specs.*Archetype defaults.
// Server-side: use config.specs.defaultArchetype, config.specs.coachArchetype, etc.
const ARCHETYPE_TUTOR = "TUT-001";
const ARCHETYPE_COACH = "COACH-001";
const ARCHETYPE_COMPANION = "COMPANION-001";

export type SectorSlug = "school" | "corporate" | "community" | "coaching" | "healthcare" | "training" | "university";

export interface SectorDef {
  /** Lucide icon name (imported separately in components) */
  icon: string;
  /** CSS variable prefix for badge colors (e.g., "blue" → --badge-blue-text/bg/border) */
  colorKey: string;
  /** Short label for the badge */
  label: string;
  /** One-line description for type picker cards */
  description: string;
  /** Hover tooltip — explains what this type means for the AI agent */
  tooltip: string;
  /** Default archetype slug — mirrors seed data, used for client-side teaching style pre-fill */
  archetype: string;
  /** Default teaching style for Teach wizard pre-fill */
  teachingStyle: string;
}

/**
 * Registry of known institution type sectors.
 * Unknown slugs gracefully fall back to a neutral style.
 */
export const SECTOR_CONFIG: Record<SectorSlug, SectorDef> = {
  school: {
    icon: "GraduationCap",
    colorKey: "blue",
    label: "School",
    description: "Primary/secondary schools and educational institutions",
    tooltip: "AI agent acts as a patient tutor — explains concepts, checks understanding, adapts to learning pace",
    archetype: ARCHETYPE_TUTOR,
    teachingStyle: "tutor",
  },
  corporate: {
    icon: "Building2",
    colorKey: "amber",
    label: "Corporate",
    description: "Businesses and corporate training environments",
    tooltip: "AI agent acts as a professional coach — goal-oriented, strategic, focused on performance outcomes",
    archetype: ARCHETYPE_COACH,
    teachingStyle: "coach",
  },
  community: {
    icon: "Users",
    colorKey: "green",
    label: "Community",
    description: "Purpose-led communities, support groups, and member networks",
    tooltip: "AI agent acts as a supportive companion — warm, empathetic, focused on connection and wellbeing",
    archetype: ARCHETYPE_COMPANION,
    teachingStyle: "companion",
  },
  coaching: {
    icon: "Target",
    colorKey: "purple",
    label: "Coaching",
    description: "Coaching practices and mentoring programs",
    tooltip: "AI agent acts as a strategic coach — challenges thinking, tracks goals, drives personal growth",
    archetype: ARCHETYPE_COACH,
    teachingStyle: "coach",
  },
  healthcare: {
    icon: "Heart",
    colorKey: "pink",
    label: "Healthcare",
    description: "Healthcare training and professional development programs",
    tooltip: "AI agent acts as a clinical trainer — structured, competency-focused, aligned to healthcare standards",
    archetype: ARCHETYPE_COACH,
    teachingStyle: "coach",
  },
  training: {
    icon: "Dumbbell",
    colorKey: "cyan",
    label: "Training",
    description: "Training companies and professional development providers",
    tooltip: "AI agent acts as a skills coach — structured, practical, focused on competency and certification",
    archetype: ARCHETYPE_COACH,
    teachingStyle: "coach",
  },
  university: {
    icon: "Library",
    colorKey: "blue",
    label: "University",
    description: "Universities and higher education institutions",
    tooltip: "AI agent acts as a Socratic tutor — challenges thinking, encourages critical evaluation, links theory to practice",
    archetype: ARCHETYPE_TUTOR,
    teachingStyle: "tutor",
  },
};

/** All known sector slugs */
export const SECTOR_SLUGS = Object.keys(SECTOR_CONFIG) as SectorSlug[];

/** Look up sector config by slug, with null-safe fallback */
export function getSectorDef(slug: string | null | undefined): SectorDef | null {
  if (!slug) return null;
  return SECTOR_CONFIG[slug as SectorSlug] ?? null;
}

/** Derive teaching style from archetype slug (fallback for domains without institution type) */
export function archetypeToTeachingStyle(archetypeSlug: string | null | undefined): string {
  if (!archetypeSlug) return "tutor";
  if (archetypeSlug.startsWith("COACH")) return "coach";
  if (archetypeSlug.startsWith("COMPANION")) return "companion";
  return "tutor";
}

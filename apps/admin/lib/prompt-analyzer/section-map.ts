/**
 * Prompt Analyzer — Section → Admin Surface Mapping
 *
 * Maps each llmPrompt JSON key to the admin surfaces where it can be changed.
 * Used by the analysis AI to give actionable recommendations, and by the UI
 * to render links to the correct admin pages.
 */

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface AdminSurface {
  /** Admin page path. May contain `{callerId}` for dynamic substitution. */
  path: string;
  /** Human-readable label for the link */
  label: string;
  /** What action the admin should take there */
  action: string;
}

export interface SectionMapping {
  /** Key in the llmPrompt JSON object */
  sectionKey: string;
  /** Human-readable name */
  label: string;
  /** Short description of what this section controls */
  description: string;
  /** Admin pages where this section's data can be edited */
  adminSurfaces: AdminSurface[];
  /** What DB data feeds into this section */
  dataSources: string[];
}

// ------------------------------------------------------------------
// Section Map (17 entries)
// ------------------------------------------------------------------

export const SECTION_MAP: SectionMapping[] = [
  {
    sectionKey: "_preamble",
    label: "Preamble",
    description: "System instruction, reading order, and critical rules for the AI agent",
    adminSurfaces: [
      { path: "/x/specs", label: "COMP-001 Spec", action: "Edit preamble config (systemInstruction, criticalRules)" },
      { path: "/x/layers", label: "Identity Layers", action: "Edit identity boundaries (doesNot rules)" },
    ],
    dataSources: ["COMP-001 spec config", "identity spec boundaries"],
  },
  {
    sectionKey: "_quickStart",
    label: "Quick Start",
    description: "Top-of-prompt summary: agent identity, caller context, session plan, voice style, opening line",
    adminSurfaces: [
      { path: "/x/layers", label: "Identity Layers", action: "Edit roleStatement (you_are) and sessionStructure.opening (first_line)" },
      { path: "/x/callers/{callerId}", label: "Caller Record", action: "View caller data (this_caller is auto-computed)" },
      { path: "/x/callers/{callerId}", label: "Behavior Targets", action: "Edit targets that drive voice_style (Assess tab)" },
    ],
    dataSources: ["identity spec", "caller record", "memories", "behavior targets", "curriculum modules", "goals"],
  },
  {
    sectionKey: "identity",
    label: "Identity",
    description: "Agent role, primary goal, techniques, boundaries (does/doesNot), style guidelines",
    adminSurfaces: [
      { path: "/x/layers", label: "Identity Layers", action: "Edit identity spec overlay (roleStatement, techniques, styleGuidelines, boundaries)" },
    ],
    dataSources: ["identity spec (IDENTITY role from playbook stack)"],
  },
  {
    sectionKey: "curriculum",
    label: "Curriculum",
    description: "Course modules, progress tracking, next module to teach",
    adminSurfaces: [
      { path: "/x/courses", label: "Courses", action: "Edit curriculum modules and structure" },
    ],
    dataSources: ["content spec (CONTENT role)", "caller module progress"],
  },
  {
    sectionKey: "teachingContent",
    label: "Teaching Content",
    description: "Session-scoped teaching points (assertions) extracted from uploaded documents",
    adminSurfaces: [
      { path: "/x/content-explorer", label: "Content Explorer", action: "View and edit content assertions" },
      { path: "/x/subjects", label: "Subjects", action: "Manage content sources and uploads" },
    ],
    dataSources: ["ContentAssertion table (filtered by lesson plan / session scope)"],
  },
  {
    sectionKey: "memories",
    label: "Memories",
    description: "Caller memories grouped by category (facts, preferences, topics, context, events, relationships)",
    adminSurfaces: [
      { path: "/x/callers/{callerId}", label: "Caller Profile", action: "View memories on Profile tab (auto-extracted by MEM-001)" },
    ],
    dataSources: ["CallerMemory table"],
  },
  {
    sectionKey: "behaviorTargets",
    label: "Behavior Targets",
    description: "Agent behavior adaptation targets (warmth, pace, complexity, question rate, etc.)",
    adminSurfaces: [
      { path: "/x/callers/{callerId}", label: "Caller Targets", action: "Edit targets on Assess tab" },
      { path: "/x/specs", label: "ADAPT Specs", action: "Edit ADAPT spec parameters that compute targets" },
    ],
    dataSources: ["BehaviorTarget + CallerTarget tables"],
  },
  {
    sectionKey: "personality",
    label: "Personality",
    description: "Big Five personality profile and VARK learning style (auto-computed from calls)",
    adminSurfaces: [
      { path: "/x/callers/{callerId}", label: "Caller Profile", action: "View on Profile tab (auto-computed by PERS-001, not directly editable)" },
    ],
    dataSources: ["CallerPersonalityProfile (auto from PERS-001 spec)"],
  },
  {
    sectionKey: "instructions",
    label: "Instructions",
    description: "Combined instructions: voice guidance, session pedagogy, personality adaptation, teaching content references, behavior targets summary",
    adminSurfaces: [
      { path: "/x/specs", label: "VOICE-001 Spec", action: "Edit voice guidance config (response length, pacing, natural speech)" },
      { path: "/x/specs", label: "COMP-001 Spec", action: "Edit session pedagogy config and narrative templates" },
      { path: "/x/layers", label: "Identity Layers", action: "Edit personality adaptation rules in identity spec" },
    ],
    dataSources: ["VOICE-001 spec", "COMP-001 spec", "identity spec", "personality profile", "behavior targets"],
  },
  {
    sectionKey: "domain",
    label: "Domain",
    description: "Institution name, description, and audience context",
    adminSurfaces: [
      { path: "/x/domains", label: "Domains", action: "Edit institution name and description" },
    ],
    dataSources: ["Domain table"],
  },
  {
    sectionKey: "learnerGoals",
    label: "Learner Goals",
    description: "Goals set for this caller (auto-extracted from calls or manually created)",
    adminSurfaces: [
      { path: "/x/callers/{callerId}", label: "Caller Goals", action: "Edit goals on Profile tab" },
    ],
    dataSources: ["Goal table"],
  },
  {
    sectionKey: "callHistory",
    label: "Call History",
    description: "Total call count and recent call context (auto-computed, not directly editable)",
    adminSurfaces: [
      { path: "/x/callers/{callerId}", label: "Caller Calls", action: "View call history on Calls tab" },
    ],
    dataSources: ["Call table (count + recent records)"],
  },
  {
    sectionKey: "contentTrust",
    label: "Content Trust",
    description: "Source authority levels and trust rules governing content delivery confidence",
    adminSurfaces: [
      { path: "/x/content-explorer", label: "Content Explorer", action: "View trust levels per source" },
      { path: "/x/subjects", label: "Subjects", action: "Edit source trust levels and accrediting body" },
    ],
    dataSources: ["ContentSource trust levels", "content spec trust config"],
  },
  {
    sectionKey: "courseInstructions",
    label: "Course Instructions",
    description: "Tutor rules extracted from COURSE_REFERENCE documents (how to teach, not what to teach)",
    adminSurfaces: [
      { path: "/x/subjects", label: "Subjects", action: "Upload or manage course reference documents" },
    ],
    dataSources: ["ContentAssertion (COURSE_REFERENCE document type)"],
  },
  {
    sectionKey: "visualAids",
    label: "Visual Aids",
    description: "Images, figures, and diagrams available for sharing during calls",
    adminSurfaces: [
      { path: "/x/subjects", label: "Subjects", action: "Manage content sources with images and figures" },
    ],
    dataSources: ["SubjectMedia + AssertionMedia tables"],
  },
  {
    sectionKey: "pedagogyMode",
    label: "Pedagogy Mode",
    description: "Active teaching mode for this session (introduce, deepen, review, assess)",
    adminSurfaces: [
      { path: "/x/courses", label: "Courses", action: "Edit lesson plan and session types" },
    ],
    dataSources: ["Lesson plan + curriculum progress (auto-computed)"],
  },
  {
    sectionKey: "activityToolkit",
    label: "Activity Toolkit",
    description: "Recommended interactive activities for this session based on pedagogy and personality",
    adminSurfaces: [
      { path: "/x/specs", label: "Activity Specs", action: "Configure activity definitions and rules" },
    ],
    dataSources: ["Activity specs + personality + curriculum context"],
  },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Build the section map as a formatted text table for AI context injection */
export function renderSectionMapForAI(): string {
  return SECTION_MAP.map((s) => {
    const surfaces = s.adminSurfaces
      .map((a) => `  → ${a.label}: ${a.action} (${a.path})`)
      .join("\n");
    return `### ${s.sectionKey} — ${s.label}\n${s.description}\nData sources: ${s.dataSources.join(", ")}\n${surfaces}`;
  }).join("\n\n");
}

/** Substitute {callerId} in admin surface paths */
export function resolveAdminPaths(surfaces: AdminSurface[], callerId: string): AdminSurface[] {
  return surfaces.map((s) => ({
    ...s,
    path: s.path.replace("{callerId}", callerId),
  }));
}

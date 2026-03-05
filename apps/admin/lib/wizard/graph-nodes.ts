/**
 * Wizard Graph Nodes — static definitions for all wizard fields.
 *
 * 13 user-facing nodes + 4 auto-resolved nodes.
 * These are the DAG vertices; dependsOn arrays are the edges.
 *
 * Pure data — no React, no side effects, no DB calls.
 */

import type { WizardGraphNode } from "./graph-schema";

// ── Domain dependency shorthand ───────────────────────────
// Institution resolution produces EITHER existingDomainId (found in DB)
// OR the wizard tracks a draftDomainId (new institution). Either satisfies
// the dependency for subject/course lookup.
const DOMAIN_DEP = "existingDomainId|draftDomainId";

// ── User-facing nodes (13) ────────────────────────────────

export const WIZARD_GRAPH_NODES: WizardGraphNode[] = [
  // ── INSTITUTION GROUP ──────────────────────────────────

  {
    key: "institutionName",
    label: "Organisation name",
    group: "institution",
    inputType: "free-text",
    required: true,
    priority: 1,
    dependsOn: [],
    resolvedBy: ["file-upload"],
    promptHint: "Ask for their school or organisation name. Extract it if mentioned casually.",
    mutablePostScaffold: false,
    affinityTags: ["identity", "institution"],
  },
  {
    key: "typeSlug",
    label: "Organisation type",
    group: "institution",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [], // No hard dep — can be answered independently or auto-inferred
    resolvedBy: ["institution-lookup", "name-type-inference"],
    optionsKey: "institutionTypes",
    promptHint: "Only ask if not auto-inferred from institution name. Usually resolved automatically.",
    mutablePostScaffold: false,
    affinityTags: ["identity", "institution"],
  },
  {
    key: "websiteUrl",
    label: "Website URL",
    group: "institution",
    inputType: "free-text",
    required: false,
    priority: 4,
    dependsOn: [],
    promptHint: "Optional. Offer to skip. Used for logo/branding extraction.",
    mutablePostScaffold: true,
    affinityTags: ["identity", "institution"],
  },

  // ── COURSE GROUP ───────────────────────────────────────

  {
    key: "subjectDiscipline",
    label: "Subject area",
    group: "course",
    inputType: "free-text",
    required: false,
    priority: 2,
    dependsOn: [DOMAIN_DEP],
    resolvedBy: ["institution-lookup", "file-upload", "subject-lookup"],
    optionsKey: "subjectsCatalog",
    skipWhen: { type: "community" },
    promptHint: "Broad academic discipline (Biology, English, Maths). NOT a specific course.",
    mutablePostScaffold: false,
    affinityTags: ["course", "subject"],
  },
  {
    key: "courseName",
    label: "Course name",
    group: "course",
    inputType: "free-text",
    required: true,
    priority: 1,
    dependsOn: [DOMAIN_DEP],
    resolvedBy: ["course-lookup", "entity-chain"],
    promptHint: "Specific offering within the subject (GCSE Biology, 11+ Comprehension).",
    mutablePostScaffold: false,
    affinityTags: ["course"],
  },
  {
    key: "interactionPattern",
    label: "Teaching approach",
    group: "course",
    inputType: "options",
    required: true,
    priority: 1,
    dependsOn: [],
    resolvedBy: ["course-lookup", "entity-chain"],
    optionsKey: "interactionPatterns",
    promptHint: "Socratic, Directive, Advisory, or Coaching. Suggest based on subject context.",
    mutablePostScaffold: false,
    affinityTags: ["course", "pedagogy"],
  },
  {
    key: "teachingMode",
    label: "Teaching emphasis",
    group: "course",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    optionsKey: "teachingModes",
    skipWhen: { type: "community" },
    promptHint: "Recall, Comprehension, Practice, or Syllabus.",
    mutablePostScaffold: true,
    affinityTags: ["course", "pedagogy"],
  },

  // ── WELCOME GROUP ──────────────────────────────────────

  {
    key: "welcomeMessage",
    label: "Welcome message",
    group: "welcome",
    inputType: "free-text",
    required: false,
    priority: 3,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    skipWhen: { type: "truthy", key: "welcomeSkipped" },
    promptHint: "What the student hears on their first call. Offer a default. Use suggest_welcome_message to generate one.",
    mutablePostScaffold: true,
    affinityTags: ["welcome", "experience"],
  },
  {
    key: "sessionCount",
    label: "Number of sessions",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    resolvedBy: ["file-upload"],
    optionsKey: "sessionCounts",
    skipWhen: { type: "community" },
    promptHint: "3, 5, 8, or 12 sessions.",
    mutablePostScaffold: true,
    affinityTags: ["timing", "structure"],
  },
  {
    key: "durationMins",
    label: "Session duration",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 3,
    dependsOn: [],
    optionsKey: "durations",
    promptHint: "15, 30, 45, or 60 minutes.",
    mutablePostScaffold: true,
    affinityTags: ["timing"],
  },
  {
    key: "planEmphasis",
    label: "Breadth vs depth",
    group: "welcome",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    optionsKey: "planEmphases",
    skipWhen: { type: "community" },
    promptHint: "Breadth, Balanced, or Depth.",
    mutablePostScaffold: true,
    affinityTags: ["structure", "pedagogy"],
  },

  // ── TUNE GROUP ─────────────────────────────────────────

  {
    key: "behaviorTargets",
    label: "Personality",
    group: "tune",
    inputType: "sliders",
    required: false,
    priority: 4,
    dependsOn: [],
    resolvedBy: ["auto-default"],
    promptHint: "Warmth, directiveness, pace, encouragement sliders.",
    mutablePostScaffold: true,
    affinityTags: ["personality"],
  },
  {
    key: "lessonPlanModel",
    label: "Lesson plan model",
    group: "tune",
    inputType: "options",
    required: false,
    priority: 4,
    dependsOn: [],
    optionsKey: "lessonModels",
    skipWhen: { type: "community" },
    promptHint: "Direct, 5E, Spiral, Mastery, or Project-Based. Suggest based on subject.",
    mutablePostScaffold: true,
    affinityTags: ["structure", "pedagogy"],
  },
];

// ── Auto-resolved nodes (4) ──────────────────────────────
// Not asked by the AI — populated by resolvers. Tracked so that
// other nodes can depend on them and the evaluator can check their status.

export const AUTO_NODES: WizardGraphNode[] = [
  {
    key: "existingInstitutionId",
    label: "Institution ID",
    group: "institution",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: ["institutionName"],
    resolvedBy: ["institution-lookup"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
  {
    key: "existingDomainId",
    label: "Domain ID",
    group: "institution",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: ["institutionName"],
    resolvedBy: ["institution-lookup"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
  {
    key: "defaultDomainKind",
    label: "Domain kind",
    group: "institution",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: ["institutionName"],
    resolvedBy: ["institution-lookup"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
  {
    key: "draftPlaybookId",
    label: "Playbook ID",
    group: "course",
    inputType: "auto-resolved",
    required: false,
    priority: 1,
    dependsOn: [DOMAIN_DEP],
    resolvedBy: ["course-lookup", "entity-chain"],
    promptHint: "",
    mutablePostScaffold: false,
    affinityTags: [],
  },
];

/** All nodes — user-facing + auto-resolved */
export const ALL_NODES: WizardGraphNode[] = [...WIZARD_GRAPH_NODES, ...AUTO_NODES];

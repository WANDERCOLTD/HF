/**
 * Wizard Graph Schema — Blackboard Architecture with DAG Constraints.
 *
 * Defines the type system for a non-linear wizard conversation graph.
 * Nodes are fields to collect, edges are dependency constraints.
 * The evaluator reads the blackboard (data bag) and computes which
 * nodes are available, blocked, or complete on every turn.
 *
 * Pure types — no runtime, no React, no side effects.
 */

// ── Node classification ───────────────────────────────────

/** How a node gets its value */
export type NodeInputType =
  | "free-text"       // User types in chat
  | "options"         // Predefined choices (show_options)
  | "sliders"         // Personality sliders (show_sliders)
  | "file-upload"     // Upload panel (show_upload)
  | "auto-resolved"   // Filled by entity resolution / inference (never asked directly)
  | "derived";        // Computed from other node values

/** Current state of a node */
export type NodeStatus =
  | "blocked"         // Dependencies not met
  | "available"       // Deps met, no value yet — can be asked
  | "skipped"         // Skip condition is true (e.g., COMMUNITY domain)
  | "satisfied"       // Has a value (user-provided or auto-resolved)
  | "locked";         // Post-scaffold: structural field, cannot change

/** Display group for ScaffoldPanel sections */
export type NodeGroup = "institution" | "course" | "pedagogy" | "content" | "welcome" | "experience" | "tune";

/** Priority tier — lower number = ask sooner */
export type PriorityTier = 1 | 2 | 3 | 4;

// ── Skip conditions (serializable predicates) ─────────────

export type SkipCondition =
  | { type: "equals"; key: string; value: unknown }
  | { type: "not-equals"; key: string; value: unknown }
  | { type: "truthy"; key: string }
  | { type: "falsy"; key: string }
  | { type: "community" }  // shorthand for defaultDomainKind === "COMMUNITY"
  | { type: "all-falsy"; keys: string[] }; // skip when NONE of the listed keys are truthy

// ── Resolver keys ─────────────────────────────────────────

export type ResolverKey =
  | "institution-lookup"   // DB lookup by name → domainId, typeSlug, domainKind
  | "name-type-inference"  // Regex on institutionName → typeSlug
  | "subject-lookup"       // DB lookup by name + domainId → subject
  | "course-lookup"        // DB lookup by name + domainId → playbook
  | "file-upload"          // PackUploadStep → subjects, assertions, metadata
  | "entity-chain"         // Full institution → subject → course cascade
  | "auto-default";        // System provides a sensible default

// ── Options registry key ──────────────────────────────────

export type OptionsKey =
  | "institutionTypes"
  | "interactionPatterns"
  | "teachingModes"
  | "audiences"
  | "assessmentStyles"
  | "sessionCounts"
  | "durations"
  | "planEmphases"
  | "lessonModels"
  | "subjectsCatalog"
  // #253: how learners progress — AI scheduler-led vs learner-picks-from-menu.
  // Maps to PlaybookConfig.modulesAuthored (true = learner picks).
  | "progressionModes";

// ── Graph node definition ─────────────────────────────────

export interface WizardGraphNode {
  /** Unique key — matches the data bag key (e.g., "institutionName") */
  key: string;

  /** Human-readable label for ScaffoldPanel and system prompt */
  label: string;

  /** Display group for ScaffoldPanel */
  group: NodeGroup;

  /** How this field gets its value */
  inputType: NodeInputType;

  /** Whether this field is required for course launch */
  required: boolean;

  /** Priority tier for ordering heuristic (1 = ask first, 4 = ask last) */
  priority: PriorityTier;

  /**
   * Dependency keys — this node is BLOCKED until all deps have values.
   * Supports OR operator: "existingDomainId|draftDomainId" means
   * the dependency is satisfied if EITHER key has a value.
   * Empty array = no dependencies (available immediately if not skipped).
   */
  dependsOn: string[];

  /**
   * Skip condition — evaluated against the blackboard.
   * If true, node status = "skipped" (never asked, never required).
   */
  skipWhen?: SkipCondition;

  /**
   * Resolver keys — which Knowledge Sources can auto-satisfy this node.
   * When a resolver fires, it can mark this node as satisfied without
   * the AI asking about it.
   */
  resolvedBy?: ResolverKey[];

  /** Reference to the options set (for inputType = "options") */
  optionsKey?: OptionsKey;

  /**
   * Conversational hint for the AI — guidance for asking about this node.
   * Injected into the system prompt, not shown to the user.
   */
  promptHint: string;

  /**
   * Post-scaffold mutability. If false, this field cannot be changed
   * after course creation (structural field like institution or course name).
   */
  mutablePostScaffold: boolean;

  /**
   * Conversational affinity tags — nodes with overlapping tags
   * are good to ask in sequence (e.g., "timing" groups sessions + duration).
   */
  affinityTags: string[];

  /**
   * Alternative blackboard keys that also satisfy this node.
   * If ANY of these has a value, the node is treated as "satisfied"
   * even if its own key is empty. Supports OR-style satisfaction
   * (e.g., institutionName is satisfied when existingInstitutionId is set).
   */
  satisfiedAlso?: string[];
}

// ── Graph evaluation result ───────────────────────────────

export interface GraphEvaluation {
  /** All nodes and their current status */
  nodeStatuses: Map<string, NodeStatus>;

  /** Nodes available for collection (deps met, no value, not skipped) */
  available: WizardGraphNode[];

  /** Priority-ordered list of what to ask next */
  suggested: WizardGraphNode[];

  /** Nodes blocked by unmet dependencies */
  blocked: WizardGraphNode[];

  /** Nodes with values */
  satisfied: WizardGraphNode[];

  /** Nodes skipped by condition */
  skipped: WizardGraphNode[];

  /** % of non-skipped user-facing nodes that are satisfied */
  readinessPct: number;

  /** Required nodes still missing — what blocks launch */
  missingRequired: WizardGraphNode[];

  /** All required nodes satisfied? */
  canLaunch: boolean;

  /** Group of the top suggested node (for ScaffoldPanel highlighting) */
  activeGroup: NodeGroup | null;
}

// ── Resolver types ────────────────────────────────────────

/** Result returned by a resolver execution */
export interface ResolverResult {
  /** Fields to write to the blackboard */
  fields: Record<string, unknown>;

  /** Context message for the AI (what happened, what to tell the user) */
  aiContext: string;

  /** Whether the AI should auto-commit these values (vs. show options) */
  autoCommit: boolean;
}

/** A resolver registration in the registry */
export interface ResolverRegistration {
  key: ResolverKey;

  /** Which blackboard field changes trigger this resolver */
  triggerOn: string[];

  /** Additional blackboard fields required for this resolver to run */
  requires: string[];

  /** Node keys this resolver can potentially satisfy */
  canSatisfy: string[];
}

/** Orchestrated result of processUpdate */
export interface ProcessUpdateResult {
  /** All fields after resolvers (original + resolver results) */
  mergedFields: Record<string, unknown>;

  /** Context messages from resolvers (for AI system prompt) */
  aiContextMessages: string[];

  /** Fresh graph evaluation after all updates */
  evaluation: GraphEvaluation;
}

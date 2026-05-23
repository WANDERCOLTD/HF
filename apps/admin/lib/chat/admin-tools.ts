/**
 * Admin Tool Definitions
 *
 * Tool schemas for the Cmd+K AI assistant (DATA mode).
 * Used with Anthropic's native tool calling format.
 */

import type { AITool } from "@/lib/ai/client";

export const ADMIN_TOOLS: AITool[] = [
  {
    name: "query_specs",
    description:
      "Search and list analysis specs. Use to find specs by role, name, slug, or domain. Returns id, name, slug, specRole, extendsAgent, and a config summary.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Filter by name (case-insensitive, partial match)",
        },
        spec_role: {
          type: "string",
          enum: ["IDENTITY", "CONTENT", "EXTRACT", "SYNTHESISE", "CONSTRAIN", "ORCHESTRATE", "OBSERVE", "VOICE"],
          description: "Filter by spec role",
        },
        slug: {
          type: "string",
          description: "Filter by slug (case-insensitive, partial match)",
        },
        is_active: {
          type: "boolean",
          description: "Filter by active status (default: true)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 10, max: 25)",
        },
      },
    },
  },
  {
    name: "get_spec_config",
    description:
      "Get the full config JSON for a specific spec by ID. Use this before proposing changes to see the current state.",
    input_schema: {
      type: "object",
      properties: {
        spec_id: {
          type: "string",
          description: "The spec ID (UUID)",
        },
      },
      required: ["spec_id"],
    },
  },
  {
    name: "update_spec_config",
    description:
      "Update a spec's config JSON by merging new values. Only updates the fields you provide — other fields are preserved. ALWAYS show the user what will change and get confirmation before calling this tool.",
    input_schema: {
      type: "object",
      properties: {
        spec_id: {
          type: "string",
          description: "The spec ID to update",
        },
        config_updates: {
          type: "object",
          description:
            "Fields to merge into the config. Example: { styleGuidelines: [...], constraints: [...] }",
        },
        reason: {
          type: "string",
          description: "Why this change is being made (for audit trail)",
        },
      },
      required: ["spec_id", "config_updates", "reason"],
    },
  },
  {
    name: "query_callers",
    description:
      "Search callers by name or domain. Returns name, email, domain, call count, and personality summary.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Filter by caller name (case-insensitive, partial match)",
        },
        domain_id: {
          type: "string",
          description: "Filter by domain ID",
        },
        domain_name: {
          type: "string",
          description: "Filter by domain name (case-insensitive, partial match)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 10, max: 25)",
        },
      },
    },
  },
  {
    name: "get_domain_info",
    description:
      "Get detailed info about a domain: description, playbook, specs in the playbook, caller count, and identity/content spec configs.",
    input_schema: {
      type: "object",
      properties: {
        domain_id: {
          type: "string",
          description: "The domain ID (UUID)",
        },
        domain_name: {
          type: "string",
          description: "Domain name to search for (if ID not known)",
        },
      },
    },
  },

  // ── Curriculum Building Tools ──────────────────────────────────────────

  {
    name: "create_subject_with_source",
    description:
      "Create a new Subject and its primary ContentSource in one step. The source is automatically attached to the subject. Use this as the first step when building a curriculum from scratch. Returns subject_id and source_id needed for subsequent tools.",
    input_schema: {
      type: "object",
      properties: {
        subject_slug: {
          type: "string",
          description: "Unique slug for the subject (e.g., 'krebs-cycle', 'food-safety-l2'). Lowercase, hyphens only.",
        },
        subject_name: {
          type: "string",
          description: "Display name for the subject (e.g., 'The Krebs Cycle', 'Food Safety Level 2')",
        },
        subject_description: {
          type: "string",
          description: "Brief description of the subject and what it covers",
        },
        source_slug: {
          type: "string",
          description: "Unique slug for the content source (e.g., 'krebs-cycle-ai-knowledge')",
        },
        source_name: {
          type: "string",
          description: "Display name for the content source (e.g., 'AI-Generated Krebs Cycle Content')",
        },
        source_description: {
          type: "string",
          description: "Description of where this content comes from",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for the source attachment (default: ['content']). Use ['syllabus','content'] if this defines curriculum structure.",
        },
      },
      required: ["subject_slug", "subject_name", "source_slug", "source_name"],
    },
  },
  {
    name: "add_content_assertions",
    description:
      "Add teaching points (ContentAssertions) to a content source. Each assertion is a single atomic fact, definition, rule, process, or example. Generate these from your knowledge of the topic. Categories: 'fact', 'definition', 'threshold', 'rule', 'process', 'example'. Max 50 per call. Assertions are deduplicated by content hash.",
    input_schema: {
      type: "object",
      properties: {
        source_id: {
          type: "string",
          description: "The content source ID (returned by create_subject_with_source)",
        },
        assertions: {
          type: "array",
          description: "Array of assertion objects. Generate 15-30 teaching points covering the topic comprehensively.",
          items: {
            type: "object",
            properties: {
              assertion: {
                type: "string",
                description: "The teaching point text. Must be a single, self-contained, verifiable statement.",
              },
              category: {
                type: "string",
                enum: ["fact", "definition", "threshold", "rule", "process", "example"],
                description: "Type of assertion",
              },
              chapter: {
                type: "string",
                description: "Logical grouping / topic area (e.g., 'Glycolysis', 'Electron Transport Chain')",
              },
              section: {
                type: "string",
                description: "Sub-section within the chapter",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Topic tags for this assertion",
              },
              exam_relevance: {
                type: "number",
                description: "0.0-1.0 how important this is for assessment (optional)",
              },
            },
            required: ["assertion", "category"],
          },
        },
      },
      required: ["source_id", "assertions"],
    },
  },
  {
    name: "link_subject_to_domain",
    description:
      "Link a subject to a domain so callers in that domain can access this curriculum. Use get_domain_info first if you need to find the domain ID.",
    input_schema: {
      type: "object",
      properties: {
        subject_id: {
          type: "string",
          description: "The subject ID (returned by create_subject_with_source)",
        },
        domain_id: {
          type: "string",
          description: "The domain ID to link to (use get_domain_info to find it)",
        },
      },
      required: ["subject_id", "domain_id"],
    },
  },
  {
    name: "generate_curriculum",
    description:
      "Trigger async AI curriculum generation for a subject. Requires at least one source with assertions attached. Returns a task ID for tracking. The curriculum organises assertions into modules and learning sequences.",
    input_schema: {
      type: "object",
      properties: {
        subject_id: {
          type: "string",
          description: "The subject ID to generate curriculum for",
        },
      },
      required: ["subject_id"],
    },
  },

  // ── Tuning / Behaviour Target Writes ──────────────────────────

  {
    name: "update_behavior_target",
    description:
      "Set a target value for a single adjustable BEHAVIOR parameter, scoped to either the whole COURSE (PLAYBOOK) or one LEARNER (CALLER). Use ONLY when the educator clearly asks to change behaviour (e.g. 'be less friendly', 'increase challenge for Sofia'). Call once per parameter. The parameterId must come from the catalogue in your system prompt — never invent IDs. The targetValue is a number in [0, 1] (clamped server-side); pass null to remove the override and fall back to the resolution cascade (CALLER → PLAYBOOK → SEGMENT → SYSTEM). Read the `scope` from the Tuning tab's active scope toggle — never infer from the conversation. When `scope=\"LEARNER\"`, you MUST pass `caller_id` from the active entity context. The tool returns the DB-confirmed value — quote it back to the educator, never claim a different number.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["LEARNER", "PLAYBOOK"],
          description: "Required since #661. Read from the Tuning tab's active scope toggle. LEARNER writes BehaviorTarget(scope=CALLER) for the given caller_id; PLAYBOOK writes BehaviorTarget(scope=PLAYBOOK) for the given playbook_id.",
        },
        playbook_id: {
          type: "string",
          description: "Playbook UUID from the active entity context (type: 'playbook'). Required when scope=PLAYBOOK.",
        },
        caller_id: {
          type: "string",
          description: "Caller UUID from the active entity context (type: 'caller'). Required when scope=LEARNER. If absent and scope=LEARNER, the tool refuses with a structured error.",
        },
        parameter_id: {
          type: "string",
          description: "BEHAVIOR parameter slug from the catalogue (e.g. 'BEH-WARMTH'). Must be adjustable.",
        },
        target_value: {
          type: ["number", "null"],
          description: "New target in [0, 1], or null to remove the override at this scope.",
        },
        reason: {
          type: "string",
          description: "Short justification, for audit (e.g. 'Educator asked for less friendly tone for Sofia').",
        },
      },
      required: ["scope", "parameter_id", "target_value", "reason"],
    },
  },

  {
    name: "update_playbook_config",
    description:
      "Update non-behaviour course settings on a playbook by merging values into Playbook.config. The playbook_id comes from the active entity context. Pass any keys from the PlaybookConfig surface in `config_updates` — they are merged into the existing config (other keys preserved). Common keys: sessionCount (integer, the 'session budget'), durationMins (integer minutes), emphasis ('breadth'|'balanced'|'depth'), lessonPlanMode ('structured'|'continuous'), lessonPlanModel ('direct_instruction'|'socratic'|'5e'|'spiral'|'mastery'|'project'), interactionPattern ('socratic'|'directive'|'advisory'|'coaching'|'companion'|'facilitation'|'reflective'|'open'|'conversational-guide'), teachingMode ('recall'|'comprehension'|'practice'|'syllabus'), audience ('primary'|'secondary'|'sixth-form'|'higher-ed'|'adult-professional'|'adult-casual'|'mixed'), welcomeMessage (string), courseContext (string), courseLearningOutcomes (string[]), physicalMaterials (string), subjectDiscipline (string), aiCanShareMaterials (boolean). For BEHAVIOR parameter changes (warmth, challenge, formality, etc.) use update_behavior_target instead.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: {
          type: "string",
          description: "Playbook UUID from the active entity context (type: 'playbook').",
        },
        config_updates: {
          type: "object",
          description: "Key-value pairs merged into Playbook.config. Use camelCase keys from PlaybookConfig (see description). Example: { sessionCount: 5, durationMins: 6 }. Only the keys you set are touched; everything else is preserved.",
        },
        reason: {
          type: "string",
          description: "Short justification for the change (audit trail).",
        },
      },
      required: ["playbook_id", "config_updates", "reason"],
    },
  },

  // ── Read access ────────────────────────────────────────────────

  {
    name: "get_caller_detail",
    description:
      "Get the full caller profile — same data the caller detail page shows. Returns name, email, phone, role, archive status, domain, cohort memberships, enrollments, learnerProfile, goals, scores summary, memory counts, recent calls, personality profile, slugs. Use when the educator asks about a specific learner's state, progress, history, or context.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: {
          type: "string",
          description: "Caller UUID (from entity context with type: 'caller', or from query_callers).",
        },
      },
      required: ["caller_id"],
    },
  },

  // ── Write access — caller / playbook / domain meta ───────────────

  {
    name: "update_caller",
    description:
      "Update a caller's profile fields by merging values. Only the keys you set are touched. Accepts: name (string), email (string|null), phone (string|null), externalId (string|null), role (enum), domainId (string|null — moves to different institution), cohortGroupId (string|null), archive (boolean — true to archive, false to restore). For renaming a learner, just pass `name`.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        name: { type: "string" },
        email: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        externalId: { type: ["string", "null"] },
        role: {
          type: "string",
          enum: ["STUDENT", "TESTER", "OPERATOR", "ADMIN", "SUPERADMIN", "SUPER_TESTER", "EDUCATOR", "DEMO", "VIEWER"],
        },
        domainId: { type: ["string", "null"] },
        cohortGroupId: { type: ["string", "null"] },
        archive: {
          type: "boolean",
          description: "true → archive (sets archivedAt = now); false → restore (clears archivedAt).",
        },
        reason: { type: "string" },
      },
      required: ["caller_id", "reason"],
    },
  },

  {
    name: "update_playbook_meta",
    description:
      "Update playbook top-level metadata fields (name, description, sortOrder). For Playbook.config keys (sessionCount, durationMins, teaching style, etc.) use update_playbook_config instead. Does NOT change publish status (DRAFT ↔ PUBLISHED) — that needs the publish flow in the UI.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        sortOrder: { type: "number" },
        reason: { type: "string" },
      },
      required: ["playbook_id", "reason"],
    },
  },

  {
    name: "update_domain",
    description:
      "Update a domain's (institution's) top-level fields: name, slug, description, isActive. For Domain.config use config_updates (merge style — other keys preserved). Use when the educator asks to rename their institution or change its description.",
    input_schema: {
      type: "object",
      properties: {
        domain_id: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
        description: { type: "string" },
        isActive: { type: "boolean" },
        config_updates: {
          type: "object",
          description: "Merge into Domain.config (other keys preserved).",
        },
        reason: { type: "string" },
      },
      required: ["domain_id", "reason"],
    },
  },

  // ── System Diagnostics ──────────────────────────────────────────

  {
    name: "system_ini_check",
    description:
      "Run a full system initialization check. Verifies environment variables, database connectivity, canonical specs, domains, contracts, admin users, parameters, AI services, VAPI integration, and storage. SUPERADMIN only. Returns pass/fail/warn for each check with remediation advice. Use when the user asks about system health, setup status, or readiness.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

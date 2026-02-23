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

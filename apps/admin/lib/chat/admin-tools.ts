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
      "Set a behaviour target at one of two scopes: LEARNER (only this caller) or PLAYBOOK (every learner on the course). The scope is decided by the educator's Tuning tab toggle and surfaced in the 'Active Tuning Scope' block of your system prompt — read it from there, never infer it. Use ONLY when the educator clearly asks to change behaviour. The parameterId must come from the catalogue — never invent IDs. The targetValue is a number in [0, 1] (clamped server-side); pass null to remove the override and fall back to the cascade (CallerTarget > CALLER > PLAYBOOK > DOMAIN > SYSTEM). When scope=LEARNER you MUST pass caller_id; when scope=PLAYBOOK you MUST pass playbook_id. The tool returns the DB-confirmed value — quote it back, never claim a different number.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["LEARNER", "PLAYBOOK"],
          description: "Write scope. Read from the 'Active Tuning Scope' block in your system prompt — do NOT decide it yourself.",
        },
        playbook_id: {
          type: "string",
          description: "Playbook UUID from the active entity context. Required when scope=PLAYBOOK.",
        },
        caller_id: {
          type: "string",
          description: "Caller UUID from the active entity context. Required when scope=LEARNER.",
        },
        parameter_id: {
          type: "string",
          description: "BEHAVIOR parameter slug from the catalogue (e.g. 'BEH-WARMTH'). Must be adjustable.",
        },
        target_value: {
          type: ["number", "null"],
          description: "New target in [0, 1], or null to remove the override at the chosen scope.",
        },
        reason: {
          type: "string",
          description: "Short justification, for audit (e.g. 'Educator asked for less friendly tone').",
        },
      },
      required: ["scope", "parameter_id", "target_value", "reason"],
    },
  },

  {
    name: "update_playbook_config",
    description:
      "Update non-behaviour course settings on a playbook by merging values into Playbook.config. The playbook_id comes from the active entity context. Pass any keys from the PlaybookConfig surface in `config_updates` — they are merged into the existing config (other keys preserved). Common keys: sessionCount (integer, the 'session budget'), durationMins (integer minutes), emphasis ('breadth'|'balanced'|'depth'), lessonPlanMode ('structured'|'continuous'), lessonPlanModel ('direct_instruction'|'socratic'|'5e'|'spiral'|'mastery'|'project'), interactionPattern ('socratic'|'directive'|'advisory'|'coaching'|'companion'|'facilitation'|'reflective'|'open'|'conversational-guide'), teachingMode ('recall'|'comprehension'|'practice'|'syllabus'), audience ('primary'|'secondary'|'sixth-form'|'higher-ed'|'adult-professional'|'adult-casual'|'mixed'), welcomeMessage (string), courseContext (string), courseLearningOutcomes (string[]), physicalMaterials (string), subjectDiscipline (string), aiCanShareMaterials (boolean), firstCallMode ('onboarding'|'teach_immediately'|'baseline_assessment'), firstSessionTargets (object map of parameterId→{value, confidence}), progressNarrative (object: enabled, cadence, minScoreDelta, skipFirstCall), offboardingSummary (object: enabled, cadence, includeModuleMastery, includeGoalProgress, includeSkillCurrentScore), tolerances (object: retrievalCadenceOverride (integer N), memoryDecayScale (0.1-1.0)). The course-default Mastery Threshold lives in BehaviorTarget(scope=PLAYBOOK, parameterId='TOL-MASTERY-THRESHOLD'), NOT here — use update_behavior_target. For other BEHAVIOR parameter changes (warmth, challenge, formality, etc.) also use update_behavior_target.",
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
      "Update a caller's profile fields by merging values. Only the keys you set are touched. Accepts: name (string), email (string|null), phone (string|null), externalId (string|null), cohortGroupId (string|null), archive (boolean — true to archive, false to restore). For renaming a learner, just pass `name`. NOTE: role + domainId are deliberately NOT AI-accessible — role changes are privilege escalation and domainId changes cross-tenant; both must be done by a human via the admin UI.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        name: { type: "string" },
        email: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        externalId: { type: ["string", "null"] },
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
      "Update a domain's (institution's) fields. Top-level metadata (name, slug, description, isActive) is direct. `config_updates` merges into Domain.config (other keys preserved). For the 4 COMPOSE-affecting domain fields — `onboardingFlowPhases`, `onboardingDefaultTargets`, `onboardingWelcome`, `onboardingIdentitySpecId` — pass them at the top level; they route through `updateDomainConfig` which bumps `Domain.composeInputsUpdatedAt` so every caller in every playbook in this domain marks their cached prompt stale. Use when the educator asks to rename the institution, change its description, or tune domain-level onboarding overlays.",
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
        onboardingFlowPhases: {
          type: "object",
          description:
            "Domain-level fallback for `Playbook.config.onboardingFlowPhases`. Object with a `phases` array. Pass null to clear. Bumps the domain compose timestamp.",
        },
        onboardingDefaultTargets: {
          type: "object",
          description:
            "Domain-level fallback for `Playbook.config.firstSessionTargets`. Map of parameterId → { value, confidence }. Pass null to clear. Bumps the domain compose timestamp.",
        },
        onboardingWelcome: {
          type: "string",
          description:
            "Domain-level welcome greeting fallback used when `Playbook.config.welcome.message` is unset. Pass empty string to clear. Bumps the domain compose timestamp.",
        },
        onboardingIdentitySpecId: {
          type: "string",
          description:
            "AnalysisSpec UUID for the domain-level identity overlay (TUT-001, COMPANION-001, COACH-001, etc.). Pass empty string to clear. Bumps the domain compose timestamp.",
        },
        reason: { type: "string" },
      },
      required: ["domain_id", "reason"],
    },
  },

  // ── Curriculum-side edits ───────────────────────────────────────
  // Mirror the educator-facing routes in app/api/curricula/* +
  // app/api/assertions/[assertionId] so the AI can edit course content
  // through the same surface educators do. Each write fires
  // `bumpPlaybookComposeTimestamp` after success so enrolled callers
  // see <StalePromptPill /> on next page load.

  {
    name: "update_curriculum_module",
    description:
      "Update an existing CurriculumModule's editable fields. Pass any combination of: title, description, sortOrder, estimatedDurationMinutes, masteryThreshold (0-1), prerequisites (string[]), keyTerms (string[]), assessmentCriteria (string[]), isActive (boolean). Only the keys you pass are touched; everything else is preserved. The parent playbook's compose timestamp is bumped so every enrolled caller recomposes on next call. Use when the educator says 'rename module 3 to X' or 'extend module 2 to 90 minutes'.",
    input_schema: {
      type: "object",
      properties: {
        module_id: { type: "string", description: "CurriculumModule UUID." },
        title: { type: "string" },
        description: { type: "string" },
        sortOrder: { type: "integer" },
        estimatedDurationMinutes: { type: "integer" },
        masteryThreshold: { type: "number", minimum: 0, maximum: 1 },
        prerequisites: { type: "array", items: { type: "string" } },
        keyTerms: { type: "array", items: { type: "string" } },
        assessmentCriteria: { type: "array", items: { type: "string" } },
        isActive: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["module_id", "reason"],
    },
  },

  {
    name: "update_assertion_lo_link",
    description:
      "Link (or clear) the LearningObjective FK on a ContentAssertion. Pass `learning_objective_id` as a UUID to teacher-verify the link (sets linkConfidence=1.0 + syncs learningOutcomeRef). Pass `null` to clear. Every playbook that links the assertion's parent source via PlaybookSource gets its compose timestamp bumped. Use when the educator says 'this assertion is actually about LO-5' or 'unlink this — it's miscategorised'.",
    input_schema: {
      type: "object",
      properties: {
        assertion_id: { type: "string", description: "ContentAssertion UUID." },
        learning_objective_id: {
          type: ["string", "null"],
          description: "LearningObjective UUID to link, or null to clear the link.",
        },
        reason: { type: "string" },
      },
      required: ["assertion_id", "reason"],
    },
  },

  // ── Goal lifecycle ──────────────────────────────────────────────

  {
    name: "confirm_goal",
    description:
      "Mark a Goal as COMPLETED. If a pending completion signal (CallerAttribute key='goal_completion_signal') exists for the goal, flip its booleanValue to true. The caller's compose timestamp is bumped so the next call recomposes against the updated goal state. Use when the educator says 'mark Anna's goal as done' or confirms a pipeline-detected completion.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "Goal UUID." },
        reason: { type: "string" },
      },
      required: ["goal_id", "reason"],
    },
  },

  {
    name: "dismiss_goal",
    description:
      "Dismiss a pending completion signal on a Goal without marking the goal COMPLETED. Flips the latest CallerAttribute(key='goal_completion_signal') booleanValue to false. The caller's compose timestamp is bumped. Use when the pipeline flagged a goal as complete but the educator wants to keep it active.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "Goal UUID." },
        reason: { type: "string" },
      },
      required: ["goal_id", "reason"],
    },
  },

  // ── Read parity for the writers ─────────────────────────────────
  // The AI now writes Playbook.config, BehaviorTarget, CurriculumModule,
  // and Goal status. To make safe edits ('change session count from 5
  // to 7') it needs to read the current value first. These reads close
  // that loop. All read-only — no RBAC tightening beyond OPERATOR.

  {
    name: "get_playbook_config",
    description:
      "Read the full Playbook (course) config + top-level metadata. Returns id, name, description, status, domainId, and the entire Playbook.config JSON. Use BEFORE update_playbook_config so you know the current values and don't blindly overwrite. Also returns composeInputsUpdatedAt so you can tell the educator if the prompt is stale.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
      },
      required: ["playbook_id"],
    },
  },

  {
    name: "list_behavior_targets",
    description:
      "List active BehaviorTargets. Pass `playbook_id` for PLAYBOOK-scope (course defaults) or `caller_id` for CALLER-scope (per-learner overrides; fanned out across all of the caller's CallerIdentity rows). Returns parameterId, name, description, targetValue, confidence, source. Use BEFORE update_behavior_target so you know the current values and can speak in delta terms ('raise warmth from 0.6 to 0.75').",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string", description: "Playbook UUID for PLAYBOOK scope. Mutually exclusive with caller_id." },
        caller_id: { type: "string", description: "Caller UUID for CALLER scope. Mutually exclusive with playbook_id." },
      },
    },
  },

  {
    name: "list_curriculum_modules",
    description:
      "List CurriculumModule rows. Pass `curriculum_id` for direct lookup, or `playbook_id` to resolve via the Playbook → Curriculum FK. Returns id, slug, title, description, sortOrder, isActive, estimatedDurationMinutes, masteryThreshold, plus learningObjectives summary (ref + description). Use BEFORE update_curriculum_module or update_learning_objective so you know which moduleId / LO ref to act on.",
    input_schema: {
      type: "object",
      properties: {
        curriculum_id: { type: "string" },
        playbook_id: { type: "string" },
      },
    },
  },

  {
    name: "list_goals_for_caller",
    description:
      "List a caller's Goal rows. Returns id, name, type, status (ACTIVE/COMPLETED/ARCHIVED/PAUSED), progress (0-1), startedAt, completedAt, isAssessmentTarget. Use BEFORE confirm_goal / dismiss_goal so you know which goalId to act on. Also useful for 'how is Anna progressing?' summary requests.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        status: {
          type: "string",
          enum: ["ACTIVE", "COMPLETED", "ARCHIVED", "PAUSED"],
          description: "Optional filter. Omit to return all statuses.",
        },
      },
      required: ["caller_id"],
    },
  },

  // ── Trigger compose / state recovery ────────────────────────────

  {
    name: "recompose_caller_prompt",
    description:
      "Force a fresh compose of a caller's prompt RIGHT NOW (rather than waiting for their next call). After bumping Playbook.config or any other compose-affecting setting, the caller's cached ComposedPrompt is marked stale (see <StalePromptPill />) but doesn't actually recompose until their next call OR an operator click 'Recompose now'. This tool is the chat equivalent. POST to /api/callers/[id]/compose-prompt with triggerType='manual'. Returns the new ComposedPrompt id + composedAt.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["caller_id", "reason"],
    },
  },

  // ── Demo / cohort recompose fan-out (#1429) ──────────────────────
  // These tools are the chat equivalent of the <StalePromptPillForCourse />
  // [Reprompt all] button. They fan out per-caller recomposes server-side.
  //
  // `reprompt_demo_set` is OPERATOR+ — bounded to demo callers, so the
  // blast radius is the test set.
  // `reprompt_playbook` is ADMIN+ — fans out across ALL active callers,
  // including real learners. Surfaces in the tray as `fanoutScope: 'all'`
  // per epic #854. The ADMIN+ role gate is the cohort-fan-out human gate
  // (the no-ai-fanout-all ESLint rule does NOT cover this handler
  // because it calls `autoComposeForCaller` directly, not the three
  // watched config helpers — the role gate is the substitute control).

  {
    name: "reprompt_demo_set",
    description:
      "Force a fresh compose RIGHT NOW for every demo caller on a course (CallerPlaybook.policyMode='demo', status='ACTIVE'). Use after a config tweak when you want the test set to reflect the new prompt on their next call — no waiting for next-call-but-one. Fans out POST /api/callers/[id]/compose-prompt server-side. Returns the number triggered and any failures. Demo callers are typically `test-admin-*@hf-admin.local` rows created via the V2 intake admin escape hatch.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["playbook_id", "reason"],
    },
  },

  {
    name: "reprompt_playbook",
    description:
      "Force a fresh compose RIGHT NOW for EVERY active caller on the course — including production learners. ADMIN+ only (OPERATOR is refused with a 403). Use sparingly. The pending-changes tray surfaces this as a `fanoutScope: 'all'` action per epic #854. Returns the number triggered and any failures.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["playbook_id", "reason"],
    },
  },

  // ── Curriculum-side direct edits (single LO + curriculum meta) ──

  {
    name: "update_learning_objective",
    description:
      "Update a single LearningObjective without rewriting the whole module's LO list. Pass `learning_objective_id` and any of: description, performanceStatement, learnerVisible (boolean), masteryThreshold (0-1). Bumps the parent playbook's compose timestamp. Use when the educator says 'rephrase LO-3' or 'mark LO-7 as not learner-visible'.",
    input_schema: {
      type: "object",
      properties: {
        learning_objective_id: { type: "string" },
        description: { type: "string" },
        performanceStatement: { type: "string" },
        learnerVisible: { type: "boolean" },
        masteryThreshold: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" },
      },
      required: ["learning_objective_id", "reason"],
    },
  },

  {
    name: "update_curriculum_metadata",
    description:
      "Update Curriculum top-level metadata (NOT modules/LOs/assertions — use the dedicated tools for those, or lesson-plan editing via UI). Pass `curriculum_id` and any of: name, description, sourceTitle, sourceYear, authors (string[]). Bumps the parent playbook's compose timestamp so the curriculum loader picks up the change.",
    input_schema: {
      type: "object",
      properties: {
        curriculum_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        sourceTitle: { type: "string" },
        sourceYear: { type: "integer" },
        authors: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["curriculum_id", "reason"],
    },
  },

  // ── System Diagnostics ──────────────────────────────────────────

  {
    name: "system_ini_check",
    description:
      "Run a full system initialization check. Verifies environment variables, database connectivity, canonical specs, domains, contracts, admin users, parameters, AI services, voice provider integration, and storage. SUPERADMIN only. Returns pass/fail/warn for each check with remediation advice. Use when the user asks about system health, setup status, or readiness.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // NOT YET AVAILABLE — roadmap stubs
  //
  // These tools are declared so the AI never silently invents them and
  // never pretends to call something that doesn't exist. When invoked,
  // they return a friendly refusal that tells the educator: (a) the
  // feature is on the roadmap, (b) which UI surface to use today.
  //
  // To promote a stub to a real tool:
  //   1. Implement the handler in admin-tool-handlers.ts
  //   2. Add the RBAC entry to TOOL_MIN_ROLE
  //   3. Switch the dispatch case from handleNotYetAvailable to the real handler
  //   4. Update this description to remove the "NOT YET AVAILABLE" prefix
  // ─────────────────────────────────────────────────────────────────────

  {
    name: "list_caller_memories",
    description:
      "NOT YET AVAILABLE — list a caller's CallerMemory rows by category (personality, preferences, key_facts, behaviour_pattern). When invoked, you MUST tell the user: 'I can't list memories yet — that tool is on the roadmap. For now, open /x/callers/[callerId]?tab=how to inspect them directly.' Do NOT pretend to call this; surface the limitation explicitly.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        category: { type: "string" },
      },
      required: ["caller_id"],
    },
  },

  {
    name: "create_goal",
    description:
      "NOT YET AVAILABLE — directly add a single Goal for a caller (type, name, priority, isAssessmentTarget). When invoked, you MUST tell the user: 'I can't create goals one-off yet — that tool is on the roadmap. Goals are currently created automatically by generate_curriculum or via the Goals UI at /x/callers/[callerId]?tab=what.' Do NOT pretend to call this.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["LEARN", "BEHAVIOUR", "ASSESSMENT"] },
        priority: { type: "integer" },
        isAssessmentTarget: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["caller_id", "name", "type", "reason"],
    },
  },

  {
    name: "rename_subject",
    description:
      "NOT YET AVAILABLE — rename a Subject (name, description, defaultTrustLevel, teachingProfile). When invoked, you MUST tell the user: 'I can't rename subjects yet — that tool is on the roadmap. You can rename a subject directly in the Subjects UI at /x/subjects, or use create_subject_with_source if you need a new one.' Do NOT pretend to call this.",
    input_schema: {
      type: "object",
      properties: {
        subject_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        defaultTrustLevel: { type: "string" },
        teachingProfile: { type: "string" },
        reason: { type: "string" },
      },
      required: ["subject_id", "reason"],
    },
  },

  {
    name: "replace_lesson_plan",
    description:
      "NOT YET AVAILABLE — replace Curriculum.deliveryConfig.lessonPlan in bulk. When invoked, you MUST tell the user: 'I can't replace lesson plans through chat yet — that tool is on the roadmap. The lesson-plan editor at /x/courses/[courseId]?tab=design has a Regenerate button that drives the same write through the UI.' Do NOT pretend to call this — the lesson plan is a structured object best authored via the editor.",
    input_schema: {
      type: "object",
      properties: {
        curriculum_id: { type: "string" },
        plan: { type: "object" },
        reason: { type: "string" },
      },
      required: ["curriculum_id", "plan", "reason"],
    },
  },

  {
    name: "add_curriculum_module",
    description:
      "NOT YET AVAILABLE — add a single new CurriculumModule (without rebuilding the whole curriculum). When invoked, you MUST tell the user: 'I can't add a single module yet — that tool is on the roadmap. Today you can use generate_curriculum to bulk-author the curriculum, or the Curriculum editor at /x/courses/[courseId]?tab=design for hand-authored module changes.' Do NOT pretend to call this.",
    input_schema: {
      type: "object",
      properties: {
        curriculum_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        sortOrder: { type: "integer" },
        // SAFETY: slug is the per-parent identity used by AGGREGATE
        // mastery keys (#411/#614). An AI-chosen slug could orphan
        // downstream `lo_mastery:{moduleId}:*` entries. When this stub is
        // promoted, the server-side handler must derive the slug from
        // the title via slugify(), not accept it from the model.
        reason: { type: "string" },
      },
      required: ["curriculum_id", "title", "reason"],
    },
  },

  {
    name: "reset_caller",
    description:
      "NOT YET AVAILABLE — wipe a caller's runtime state (calls, scores, memories, attributes, goals) and start over without deleting the Caller row. When invoked, you MUST tell the user: 'I can't reset a learner through chat yet — that tool is on the roadmap (the route logic at POST /api/callers/[id]/reset still needs extracting to a shared library before chat can call it safely). Today you can reset from the caller detail page UI.' Do NOT pretend to call this — it is destructive and the deferred safety extraction matters.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["caller_id", "reason"],
    },
  },

  // ── #1225 Slice B — last-7-days landings ────────────────────────────

  {
    name: "swap_primary_curriculum",
    description:
      "Promote a Curriculum to be the PRIMARY for a Playbook (course). The current primary (if any) is demoted to 'linked' inside the same transaction. The target may already be 'linked' (variant promotion) or not yet attached (will be created with role='primary'). Bumps Playbook.composeInputsUpdatedAt so the next call recomposes the prompt. Use when the educator says \"make curriculum X the primary for course Y\".",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: {
          type: "string",
          description: "Playbook UUID from the active entity context.",
        },
        curriculum_id: {
          type: "string",
          description: "Target Curriculum UUID to promote to primary.",
        },
        reason: { type: "string", description: "Short justification (audit trail)." },
      },
      required: ["playbook_id", "curriculum_id", "reason"],
    },
  },

  {
    name: "attach_linked_curriculum",
    description:
      "Attach a Curriculum to a Playbook as a 'linked' (variant) reference. Does NOT affect the primary join row. Idempotent: if a join row already exists, returns ok without change. Use when offering the same curriculum under a variant playbook line. Bumps Playbook.composeInputsUpdatedAt only if a new row is created.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        curriculum_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["playbook_id", "curriculum_id", "reason"],
    },
  },

  {
    name: "detach_linked_curriculum",
    description:
      "Remove a 'linked' Curriculum from a Playbook. REFUSED if the existing join row has role='primary' (use swap_primary_curriculum first to demote it). Bumps Playbook.composeInputsUpdatedAt.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        curriculum_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["playbook_id", "curriculum_id", "reason"],
    },
  },

  {
    name: "update_intake_spec_draft",
    description:
      "Edit the TS source of a DRAFT IntakeSpec row (e.g. CreateCourse@0.1.0). The body JSON cache is automatically re-derived from the new source via @tallyseal/spec-emitter parse + projectBodyFromEditable so list-page fieldCount stays in sync. REFUSED on PUBLISHED rows (DRAFT → PUBLISHED is a human-only gate via the editor's deploy button). Alternative to opening /x/intake/specs/[id] in the browser.",
    input_schema: {
      type: "object",
      properties: {
        spec_id: { type: "string", description: "IntakeSpec UUID." },
        source: {
          type: "string",
          description:
            "New canonical TS source. Must parse via @tallyseal/spec-emitter or the tool refuses with a typed error.",
        },
        reason: { type: "string" },
      },
      required: ["spec_id", "source", "reason"],
    },
  },

  {
    name: "get_voice_config",
    description:
      "Read the voice configuration for a Playbook — provider, model, voiceId, end-state behaviour, polling. `voiceId` is the TTS voice catalogue id (e.g. \"aura-asteria-en\", \"arcas\") — what the LEARNER HEARS. Do NOT confuse it with `model` (the LLM behind the voice agent, e.g. \"claude-haiku-4-5\"), which has no effect on the heard voice. Does NOT expose model.secret (operator-only material, surfaced via settings page only).",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
      },
      required: ["playbook_id"],
    },
  },

  {
    name: "explain_voice_cascade",
    description:
      "Read-only. Returns the full voice cascade explanation for a caller — which layer won for every field (system / provider / domain / course). Takes `{ callerId: string }`. Does NOT mutate any config.",
    input_schema: {
      type: "object",
      properties: {
        callerId: { type: "string" },
      },
      required: ["callerId"],
    },
  },

  // ── #1485 / Epic #1442 Layer 3 Slice 4 — DEMO mode action palette ─────
  //
  // Five narrow tools exposed only via DEMO chat mode (`DEMO_TOOLS` filter
  // in `app/api/chat/route.ts`). Each delegates to existing infrastructure
  // — no TTS synthesis, no prompt composition, no Call creation is
  // re-implemented. Same registry → same forbidden-fields / RBAC / pending-
  // change meta-tests apply automatically.

  {
    name: "test_voice",
    description:
      "Play a short TTS sample of the course's current voice config so the operator can hear how the voice will sound. Wraps the existing `POST /api/voice-providers/[id]/sample` (#1421 Slice B) — does NOT re-implement TTS synthesis. Server resolves the VoiceProvider row id from the system-enabled provider slug. Defaults `text` to the playbook's `welcomeMessage` when not provided (capped at 200 chars).",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: {
          type: "string",
          description: "Playbook UUID (course the operator is demoing).",
        },
        text: {
          type: "string",
          description:
            "Text to synthesise. Hard-capped at 200 chars server-side. Defaults to Playbook.config.welcomeMessage when omitted.",
        },
      },
      required: ["playbook_id"],
    },
  },

  {
    name: "dry_run_prompt",
    description:
      "Compose the prompt that would fire if a learner started a call on this course right now, WITHOUT persisting a Call or ComposedPrompt row. Wraps the existing `POST /api/courses/[courseId]/dry-run-prompt` route — does NOT re-implement composition. Returns a ≤400-char summary of the opening + tone sections so the operator can sanity-check the change before showing the prospect. Use after `apply_demo_preset` to verify the change landed in the next-call prompt.",
    input_schema: {
      type: "object",
      properties: {
        course_id: {
          type: "string",
          description: "Course (Playbook) UUID.",
        },
        call_sequence: {
          type: "integer",
          description:
            "Override call count. Default 1 (force first-call composition). Use 2+ to dry-run a continuing-learner prompt.",
        },
      },
      required: ["course_id"],
    },
  },

  {
    name: "apply_demo_preset",
    description:
      "Set the four 'good demo defaults' on a course in one batch: `firstCallMode='teach_immediately'`, `welcome.aboutYou.enabled=false`, `welcome.aiIntroCall.enabled=false`, `welcomeMessage` (optional), and behaviour target `BEH-RESPONSE-LEN=0.2` (short, punchy responses). Every write goes through the pending-changes tray with `aiSuggested: true` and `fanoutScope: 'none'` — the operator clicks Save & apply to confirm. You DO NOT bypass the tray. Use when the operator says 'apply the demo preset' or similar.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: {
          type: "string",
          description: "Course (Playbook) UUID.",
        },
        welcome_message: {
          type: "string",
          description:
            "Optional new welcome message. When omitted, the existing welcomeMessage is preserved.",
        },
        reason: {
          type: "string",
          description: "Short justification (audit trail).",
        },
      },
      required: ["playbook_id", "reason"],
    },
  },

  {
    name: "precompose_for_fresh_learner",
    description:
      "Pre-warm a demo caller's prompt so the next live call on this course starts instantly. Resolves the most-recently-created `policyMode='demo'` caller on the playbook (you do NOT create one — operators mint them via the V2 intake admin escape hatch). Wraps `autoComposeForCaller` from `lib/enrollment/auto-compose.ts` — does NOT re-implement composition or create Call rows. Returns `{ callerId, composedAt }`.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: {
          type: "string",
          description: "Course (Playbook) UUID.",
        },
        reason: {
          type: "string",
          description: "Short justification (audit trail).",
        },
      },
      required: ["playbook_id", "reason"],
    },
  },

  {
    name: "open_sim",
    description:
      "Return a navigation hint pointing at `/x/sim/<callerId>` so the operator can jump straight into the chat surface with a specific caller. Read-only — no DB write, no compose, no Call creation.",
    input_schema: {
      type: "object",
      properties: {
        caller_id: {
          type: "string",
          description: "Caller UUID.",
        },
      },
      required: ["caller_id"],
    },
  },

  {
    name: "update_voice_config",
    description:
      "Adjust voice configuration for a Playbook by merging into Playbook.config.voice. The ALLOWED key set is driven by the system-enabled VoiceProvider's getConfigSchema() PLUS cross-cutting HF keys (autoPipeline, silenceTimeoutSeconds, maxDurationSeconds, voicemailDetectionEnabled, endCallPhrases, maxCostPerCallUsd, pollIntervalMs, endedReasonOverride) AND `prosodyMode` (`\"ielts\" | \"general\" | \"auto\"`) which controls how the voice provider scores the call audio — IELTS mode writes the 4-band CallScores (Fluency & Coherence, Pronunciation, Lexical Resource, Grammatical Range & Accuracy); General mode writes CONV_PACE and pace_indicators only; `auto` falls back to the legacy tierPresetId heuristic. #1270 — `provider` and `model` are LOCKED at system level and are NOT accepted (system picks the enabled VP; `model` is the LLM behind the voice agent and is pinned per VP; it is NOT the TTS voice the learner hears — that is `voiceId`); `modelSecret` / `secret` / `apiKey` are DELIBERATELY not accepted — secret rotation is an operator-only flow. Bumps Playbook.composeInputsUpdatedAt.",
    input_schema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        settings: {
          type: "object",
          description: "Voice settings to merge into config.voice. Validated against the resolver's cascadeable key set at handler time.",
          properties: {
            autoPipeline: { type: "boolean" },
            endedReasonOverride: { type: ["string", "null"] },
            pollIntervalMs: { type: "integer" },
            maxCostPerCallUsd: { type: "number" },
            silenceTimeoutSeconds: { type: "integer" },
            maxDurationSeconds: { type: "integer" },
            voicemailDetectionEnabled: { type: "boolean" },
            endCallPhrases: { type: "array", items: { type: "string" } },
            prosodyMode: { type: "string", enum: ["ielts", "general", "auto"] },
          },
          additionalProperties: true,
        },
        reason: { type: "string" },
      },
      required: ["playbook_id", "settings", "reason"],
    },
  },
];

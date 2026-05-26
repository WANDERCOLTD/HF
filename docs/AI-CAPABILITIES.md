# Cmd+K AI Capabilities

**Auto-generated** from `apps/admin/lib/chat/admin-tools.ts` + the `TOOL_MIN_ROLE` map in `admin-tool-handlers.ts`. Do not edit by hand — run `npm run docs:ai-capabilities` to refresh, or `npm run docs:ai-capabilities:check` in CI to gate drift.

Mirrors what the AI sees at every chat turn. "Live" tools execute real handlers. "Roadmap stubs" return a friendly refusal that tells the educator which UI to use today (the schema description carries the verbatim line the AI will say).

> Last generated: 2026-05-26T09:38:17.948Z
> Live tools: 27
> Roadmap stubs: 6

## Contract

Every educator-facing write must bump compose timestamps (per `docs/CHAIN-CONTRACTS.md` §3 Link 3 sub-contract). Every promised tool must be declared in `ADMIN_TOOLS[]` — the AI cannot invent capabilities. The dispatch in `admin-tool-handlers.ts` enforces RBAC via `TOOL_MIN_ROLE` *before* the handler runs, so STUDENT/VIEWER hit auth refusal before any read or write.

## Live tools

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `add_content_assertions` | OPERATOR | `source_id`, `assertions` | — | Add teaching points (ContentAssertions) to a content source. |
| `confirm_goal` | OPERATOR | `goal_id`, `reason` | — | Mark a Goal as COMPLETED. |
| `create_subject_with_source` | OPERATOR | `subject_slug`, `subject_name`, `source_slug`, `source_name` | `subject_description`, `source_description`, `tags` | Create a new Subject and its primary ContentSource in one step. |
| `dismiss_goal` | OPERATOR | `goal_id`, `reason` | — | Dismiss a pending completion signal on a Goal without marking the goal COMPLETED. |
| `generate_curriculum` | OPERATOR | `subject_id` | — | Trigger async AI curriculum generation for a subject. |
| `get_caller_detail` | OPERATOR | `caller_id` | — | Get the full caller profile — same data the caller detail page shows. |
| `get_domain_info` | OPERATOR | — | `domain_id`, `domain_name` | Get detailed info about a domain: description, playbook, specs in the playbook, caller count, and identity/content spec configs. |
| `get_playbook_config` | OPERATOR | `playbook_id` | — | Read the full Playbook (course) config + top-level metadata. |
| `get_spec_config` | OPERATOR | `spec_id` | — | Get the full config JSON for a specific spec by ID. |
| `link_subject_to_domain` | OPERATOR | `subject_id`, `domain_id` | — | Link a subject to a domain so callers in that domain can access this curriculum. |
| `list_behavior_targets` | OPERATOR | — | `playbook_id`, `caller_id` | List active BehaviorTargets. |
| `list_curriculum_modules` | OPERATOR | — | `curriculum_id`, `playbook_id` | List CurriculumModule rows. |
| `list_goals_for_caller` | OPERATOR | `caller_id` | `status` | List a caller's Goal rows. |
| `query_callers` | OPERATOR | — | `name`, `domain_id`, `domain_name`, `limit` | Search callers by name or domain. |
| `query_specs` | OPERATOR | — | `name`, `spec_role`, `slug`, `is_active`, `limit` | Search and list analysis specs. |
| `recompose_caller_prompt` | OPERATOR | `caller_id`, `reason` | — | Force a fresh compose of a caller's prompt RIGHT NOW (rather than waiting for their next call). |
| `system_ini_check` | SUPERADMIN | — | — | Run a full system initialization check. |
| `update_assertion_lo_link` | OPERATOR | `assertion_id`, `reason` | `learning_objective_id` | Link (or clear) the LearningObjective FK on a ContentAssertion. |
| `update_behavior_target` | OPERATOR | `scope`, `parameter_id`, `target_value`, `reason` | `playbook_id`, `caller_id` | Set a behaviour target at one of two scopes: LEARNER (only this caller) or PLAYBOOK (every learner on the course). |
| `update_caller` | OPERATOR | `caller_id`, `reason` | `name`, `email`, `phone`, `externalId`, `role`, `domainId`, `cohortGroupId`, `archive` | Update a caller's profile fields by merging values. |
| `update_curriculum_metadata` | OPERATOR | `curriculum_id`, `reason` | `name`, `description`, `sourceTitle`, `sourceYear`, `authors` | Update Curriculum top-level metadata (NOT modules/LOs/assertions — use the dedicated tools for those, or lesson-plan editing via UI). |
| `update_curriculum_module` | OPERATOR | `module_id`, `reason` | `title`, `description`, `sortOrder`, `estimatedDurationMinutes`, `masteryThreshold`, `prerequisites`, `keyTerms`, `assessmentCriteria`, `isActive` | Update an existing CurriculumModule's editable fields. |
| `update_domain` | OPERATOR | `domain_id`, `reason` | `name`, `slug`, `description`, `isActive`, `config_updates`, `onboardingFlowPhases`, `onboardingDefaultTargets`, `onboardingWelcome`, `onboardingIdentitySpecId` | Update a domain's (institution's) fields. |
| `update_learning_objective` | OPERATOR | `learning_objective_id`, `reason` | `description`, `performanceStatement`, `learnerVisible`, `masteryThreshold` | Update a single LearningObjective without rewriting the whole module's LO list. |
| `update_playbook_config` | OPERATOR | `playbook_id`, `config_updates`, `reason` | — | Update non-behaviour course settings on a playbook by merging values into Playbook. |
| `update_playbook_meta` | OPERATOR | `playbook_id`, `reason` | `name`, `description`, `sortOrder` | Update playbook top-level metadata fields (name, description, sortOrder). |
| `update_spec_config` | OPERATOR | `spec_id`, `config_updates`, `reason` | — | Update a spec's config JSON by merging new values. |

## Roadmap stubs (NOT YET AVAILABLE)

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `add_curriculum_module` | OPERATOR | `curriculum_id`, `title`, `reason` | `description`, `sortOrder`, `slug` | add a single new CurriculumModule (without rebuilding the whole curriculum). |
| `create_goal` | OPERATOR | `caller_id`, `name`, `type`, `reason` | `priority`, `isAssessmentTarget` | directly add a single Goal for a caller (type, name, priority, isAssessmentTarget). |
| `list_caller_memories` | OPERATOR | `caller_id` | `category` | list a caller's CallerMemory rows by category (personality, preferences, key_facts, behaviour_pattern). |
| `rename_subject` | OPERATOR | `subject_id`, `reason` | `name`, `description`, `defaultTrustLevel`, `teachingProfile` | rename a Subject (name, description, defaultTrustLevel, teachingProfile). |
| `replace_lesson_plan` | OPERATOR | `curriculum_id`, `plan`, `reason` | — | replace Curriculum. |
| `reset_caller` | OPERATOR | `caller_id`, `reason` | — | wipe a caller's runtime state (calls, scores, memories, attributes, goals) and start over without deleting the Caller row. |

## Promoting a stub

1. Implement the handler in `apps/admin/lib/chat/admin-tool-handlers.ts`.
2. Verify the RBAC entry (already at OPERATOR by default; bump if the op is destructive).
3. Remove the tool name from the `NOT_YET_AVAILABLE_TOOLS` Set and add a dispatch case routing to the real handler.
4. Strip the `NOT YET AVAILABLE — ` prefix from the description in `admin-tools.ts`.
5. Run `npm run docs:ai-capabilities` to regenerate this file.


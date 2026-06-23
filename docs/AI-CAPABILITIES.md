# AI Capabilities

**Auto-generated** from the three AI tool registries in `apps/admin/lib/chat/` + the `TOOL_MIN_ROLE` map in each registry's handler. Do not edit by hand — run `npm run docs:ai-capabilities` to refresh, or `npm run docs:ai-capabilities:check` in CI to gate drift.

This mirrors what the AI sees at every chat turn across all three AI surfaces. "Live" tools execute real handlers. "Roadmap stubs" return a friendly refusal that points the user at the UI surface to use today.

> Last generated: 2026-06-23T11:19:49.291Z
> Surfaces: 4
> Total tools: 72 (66 live, 6 roadmap stubs)

## Contract

Per `docs/CHAIN-CONTRACTS.md` §3 Link 3:

1. Every AI write path must be declared in one of the registries below.
2. Every entry must declare RBAC via `TOOL_MIN_ROLE` in its handler module.
3. Every NOT YET AVAILABLE tool must carry the prefix in its description AND be listed in `NOT_YET_AVAILABLE_TOOLS`.
4. Every compose-affecting write must route through a `update*Config` helper or call `bump*ComposeTimestamp` — never write `prisma.{playbook,domain,analysisSpec}.update` directly. ESLint rules enforce this at severity `error`.
5. This file is auto-derived. CI fails on drift.

## Cmd+K (admin chat)

Source: `apps/admin/lib/chat/admin-tools.ts`

41 live, 6 stubs.

### Live tools

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `add_content_assertions` | OPERATOR | `source_id`, `assertions` | — | Add teaching points (ContentAssertions) to a content source. |
| `apply_demo_preset` | OPERATOR | `playbook_id`, `reason` | `welcome_message` | Set the four 'good demo defaults' on a course in one batch: `firstCallMode='teach_immediately'`, `welcome. |
| `attach_linked_curriculum` | OPERATOR | `playbook_id`, `curriculum_id`, `reason` | — | Attach a Curriculum to a Playbook as a 'linked' (variant) reference. |
| `confirm_goal` | OPERATOR | `goal_id`, `reason` | — | Mark a Goal as COMPLETED. |
| `create_subject_with_source` | OPERATOR | `subject_slug`, `subject_name`, `source_slug`, `source_name` | `subject_description`, `source_description`, `tags` | Create a new Subject and its primary ContentSource in one step. |
| `detach_linked_curriculum` | OPERATOR | `playbook_id`, `curriculum_id`, `reason` | — | Remove a 'linked' Curriculum from a Playbook. |
| `dismiss_goal` | OPERATOR | `goal_id`, `reason` | — | Dismiss a pending completion signal on a Goal without marking the goal COMPLETED. |
| `dry_run_prompt` | SUPER_TESTER | `course_id` | `call_sequence` | Compose the prompt that would fire if a learner started a call on this course right now, WITHOUT persisting a Call or ComposedPrompt row. |
| `explain_voice_cascade` | OPERATOR | `callerId` | — | Read-only. |
| `generate_curriculum` | OPERATOR | `subject_id` | — | Trigger async AI curriculum generation for a subject. |
| `get_caller_detail` | OPERATOR | `caller_id` | — | Get the full caller profile — same data the caller detail page shows. |
| `get_domain_info` | OPERATOR | — | `domain_id`, `domain_name` | Get detailed info about a domain: description, playbook, specs in the playbook, caller count, and identity/content spec configs. |
| `get_playbook_config` | OPERATOR | `playbook_id` | — | Read the full Playbook (course) config + top-level metadata. |
| `get_spec_config` | OPERATOR | `spec_id` | — | Get the full config JSON for a specific spec by ID. |
| `get_voice_config` | OPERATOR | `playbook_id` | — | Read the voice configuration for a Playbook — provider, model, voiceId, end-state behaviour, polling. |
| `link_subject_to_domain` | OPERATOR | `subject_id`, `domain_id` | — | Link a subject to a domain so callers in that domain can access this curriculum. |
| `list_behavior_targets` | OPERATOR | — | `playbook_id`, `caller_id` | List active BehaviorTargets. |
| `list_curriculum_modules` | OPERATOR | — | `curriculum_id`, `playbook_id` | List CurriculumModule rows. |
| `list_goals_for_caller` | OPERATOR | `caller_id` | `status` | List a caller's Goal rows. |
| `open_sim` | VIEWER | `caller_id` | — | Return a navigation hint pointing at `/x/sim/<callerId>` so the operator can jump straight into the chat surface with a specific caller. |
| `precompose_for_fresh_learner` | OPERATOR | `playbook_id`, `reason` | — | Pre-warm a demo caller's prompt so the next live call on this course starts instantly. |
| `query_callers` | OPERATOR | — | `name`, `domain_id`, `domain_name`, `limit` | Search callers by name or domain. |
| `query_specs` | OPERATOR | — | `name`, `spec_role`, `slug`, `is_active`, `limit` | Search and list analysis specs. |
| `recompose_caller_prompt` | OPERATOR | `caller_id`, `reason` | — | Force a fresh compose of a caller's prompt RIGHT NOW (rather than waiting for their next call). |
| `reprompt_demo_set` | OPERATOR | `playbook_id`, `reason` | — | Force a fresh compose RIGHT NOW for every demo caller on a course (CallerPlaybook. |
| `reprompt_playbook` | ADMIN | `playbook_id`, `reason` | — | Force a fresh compose RIGHT NOW for EVERY active caller on the course — including production learners. |
| `swap_primary_curriculum` | OPERATOR | `playbook_id`, `curriculum_id`, `reason` | — | Promote a Curriculum to be the PRIMARY for a Playbook (course). |
| `system_ini_check` | SUPERADMIN | — | — | Run a full system initialization check. |
| `test_voice` | SUPER_TESTER | `playbook_id` | `text` | Play a short TTS sample of the course's current voice config so the operator can hear how the voice will sound. |
| `update_assertion_lo_link` | OPERATOR | `assertion_id`, `reason` | `learning_objective_id` | Link (or clear) the LearningObjective FK on a ContentAssertion. |
| `update_behavior_target` | OPERATOR | `scope`, `parameter_id`, `target_value`, `reason` | `playbook_id`, `caller_id` | Set a behaviour target at one of two scopes: LEARNER (only this caller) or PLAYBOOK (every learner on the course). |
| `update_caller` | OPERATOR | `caller_id`, `reason` | `name`, `email`, `phone`, `externalId`, `cohortGroupId`, `archive` | Update a caller's profile fields by merging values. |
| `update_curriculum_metadata` | OPERATOR | `curriculum_id`, `reason` | `name`, `description`, `sourceTitle`, `sourceYear`, `authors` | Update Curriculum top-level metadata (NOT modules/LOs/assertions — use the dedicated tools for those, or lesson-plan editing via UI). |
| `update_curriculum_module` | OPERATOR | `module_id`, `reason` | `title`, `description`, `sortOrder`, `estimatedDurationMinutes`, `masteryThreshold`, `prerequisites`, `keyTerms`, `assessmentCriteria`, `isActive` | Update an existing CurriculumModule's editable fields. |
| `update_domain` | OPERATOR | `domain_id`, `reason` | `name`, `slug`, `description`, `isActive`, `config_updates`, `onboardingFlowPhases`, `onboardingDefaultTargets`, `onboardingWelcome`, `onboardingIdentitySpecId` | Update a domain's (institution's) fields. |
| `update_intake_spec_draft` | OPERATOR | `spec_id`, `source`, `reason` | — | Edit the TS source of a DRAFT IntakeSpec row (e. |
| `update_learning_objective` | OPERATOR | `learning_objective_id`, `reason` | `description`, `performanceStatement`, `learnerVisible`, `masteryThreshold` | Update a single LearningObjective without rewriting the whole module's LO list. |
| `update_playbook_config` | OPERATOR | `playbook_id`, `config_updates`, `reason` | — | Update non-behaviour course settings on a playbook by merging values into Playbook. |
| `update_playbook_meta` | OPERATOR | `playbook_id`, `reason` | `name`, `description`, `sortOrder` | Update playbook top-level metadata fields (name, description, sortOrder). |
| `update_spec_config` | OPERATOR | `spec_id`, `config_updates`, `reason` | — | Update a spec's config JSON by merging new values. |
| `update_voice_config` | OPERATOR | `playbook_id`, `settings`, `reason` | — | Adjust voice configuration for a Playbook by merging into Playbook. |

### Roadmap stubs (NOT YET AVAILABLE)

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `add_curriculum_module` | OPERATOR | `curriculum_id`, `title`, `reason` | `description`, `sortOrder` | add a single new CurriculumModule (without rebuilding the whole curriculum). |
| `create_goal` | OPERATOR | `caller_id`, `name`, `type`, `reason` | `priority`, `isAssessmentTarget` | directly add a single Goal for a caller (type, name, priority, isAssessmentTarget). |
| `list_caller_memories` | OPERATOR | `caller_id` | `category` | list a caller's CallerMemory rows by category (personality, preferences, key_facts, behaviour_pattern). |
| `rename_subject` | OPERATOR | `subject_id`, `reason` | `name`, `description`, `defaultTrustLevel`, `teachingProfile` | rename a Subject (name, description, defaultTrustLevel, teachingProfile). |
| `replace_lesson_plan` | OPERATOR | `curriculum_id`, `plan`, `reason` | — | replace Curriculum. |
| `reset_caller` | OPERATOR | `caller_id`, `reason` | — | wipe a caller's runtime state (calls, scores, memories, attributes, goals) and start over without deleting the Caller row. |

## Wizard (course-creation chat)

Source: `apps/admin/lib/chat/conversational-wizard-tools.ts`

10 live, 0 stubs.

### Live tools

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `create_community` | (route-level) | `hubName`, `communityMode` | `hubDescription`, `hubPattern`, `communityKind`, `topics`, `welcomeMessage` | Create a community hub with infrastructure (COMMUNITY domain, identity spec, playbook, cohort group). |
| `create_course` | (route-level) | `courseName`, `interactionPattern` | `domainId`, `groupId`, `subjectDiscipline`, `teachingMode`, `welcomeMessage`, `sessionCount`, `durationMins`, `planEmphasis`, `audience`, `behaviorTargets`, `personalityPreset`, `lessonPlanModel`, `physicalMaterials`, `packSubjectIds`, `uploadSourceIds` | Create the course with full infrastructure (identity spec, playbook, system specs, onboarding) and a test caller. |
| `create_institution` | (route-level) | `name` | `typeSlug`, `websiteUrl` | Create a new institution (and its domain). |
| `mark_complete` | (route-level) | — | `playbookId`, `callerId` | Signal that setup is complete. |
| `show_options` | (route-level) | `question`, `dataKey`, `mode`, `options` | `required`, `fieldPicker` | Show a structured option card for questions with predefined choices. |
| `show_suggestions` | (route-level) | `question`, `suggestions` | — | Show clickable quick-reply chips above the chat input. |
| `show_upload` | (route-level) | `question` | — | Show the file upload panel above the chat input bar. |
| `suggest_welcome_message` | (route-level) | `courseName` | `subjectDiscipline`, `interactionPattern`, `personalityPreset` | Generate a welcome message for the first call based on the course context. |
| `update_course_config` | (route-level) | — | `domainId`, `playbookId`, `welcomeMessage`, `sessionCount`, `durationMins`, `planEmphasis`, `behaviorTargets`, `lessonPlanModel`, `onboardingFlowPhases` | Update an already-created course's configuration. |
| `update_setup` | (route-level) | `fields` | — | Save one or more extracted data fields from the conversation. |

## Course-Ref (course-reference chat)

Source: `apps/admin/lib/chat/course-ref-tools.ts`

5 live, 0 stubs.

### Live tools

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `check_completeness` | (route-level) | — | — | Check which sections of the course reference are complete, partial, or empty. |
| `finalize_ref` | (route-level) | — | `institutionName`, `courseName`, `courseId` | Finalize the course reference and create the course. |
| `show_ref_preview` | (route-level) | `sections` | — | Update the preview panel to show the current state of one or more sections. |
| `show_suggestions` | (route-level) | `question`, `suggestions` | — | Show clickable quick-reply chips above the chat input. |
| `update_ref` | (route-level) | `section`, `data` | — | Save or update a section of the course reference document. |

## Voice (VAPI custom tools)

Source: `apps/admin/docs-archive/bdd-specs/TOOLS-001-voice-tool-definitions.spec.json`

10 live, 0 stubs.

### Live tools

| Tool | Min role | Required | Optional | Summary |
|------|----------|----------|----------|---------|
| `check_mastery` | (route-level) | `module` | — | Check if the caller has mastered a specific module or concept. |
| `get_next_module` | (route-level) | — | — | Find out what the next module or topic is in the caller's curriculum. |
| `get_practice_question` | (route-level) | `topic` | — | Get a practice question or scenario for the current topic. |
| `log_activity_result` | (route-level) | `activity_id`, `outcome` | `topic`, `notes` | Log the result of an interactive activity (pop quiz, MCQ, scenario, teach-back, etc. |
| `lookup_teaching_point` | (route-level) | `topic` | `limit` | Look up specific teaching content or facts about a topic. |
| `lookup_vocabulary` | (route-level) | `term` | — | Look up the definition of a word or term from the course materials. |
| `record_observation` | (route-level) | `key`, `value` | `category` | Record an important observation about the caller during the conversation. |
| `request_artifact` | (route-level) | `type`, `title`, `content` | `reason` | Request that a study artifact be sent to the caller after the call. |
| `send_text_to_caller` | (route-level) | `message` | `purpose` | Send a text message (SMS) to the caller. |
| `share_content` | (route-level) | `media_id` | `caption` | Share a visual aid (image, diagram, PDF) with the caller. |

## Promoting a stub

1. Implement the handler in the registry's handler module.
2. Verify the RBAC entry in `TOOL_MIN_ROLE` (default OPERATOR; bump if destructive).
3. Remove the tool name from the `NOT_YET_AVAILABLE_TOOLS` Set and add a dispatch case routing to the real handler.
4. Strip the `NOT YET AVAILABLE — ` prefix from the description in the registry.
5. Run `npm run docs:ai-capabilities` to regenerate this file.


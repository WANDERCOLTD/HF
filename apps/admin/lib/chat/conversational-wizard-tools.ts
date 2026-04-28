/**
 * Wizard Tool Definitions — tool schemas sent to the AI in WIZARD mode.
 *
 * Execution handled by executeWizardTool() in wizard-tool-executor.ts.
 */

import type { AITool } from "@/lib/ai/client";

export const CONVERSATIONAL_TOOLS: AITool[] = [
  {
    name: "update_setup",
    description:
      "Save one or more extracted data fields from the conversation. " +
      "Call this EVERY time you learn new information — even from a casual mention. " +
      "IMPORTANT: subjectDiscipline = broad discipline (English Language, Biology, Maths). " +
      "courseName = specific course within that subject (GCSE Biology, 11+ Comprehension). " +
      "NEVER put a broad discipline into courseName or a specific course into subjectDiscipline. " +
      "Valid field keys: institutionName, typeSlug, websiteUrl, groupName, groupId, courseName, subjectDiscipline, " +
      "interactionPattern, teachingMode, audience, learningOutcomes, " +
      "welcomeMessage, sessionCount, durationMins, " +
      "planEmphasis, assessments, behaviorTargets, " +
      "existingInstitutionId, existingDomainId, defaultDomainKind, " +
      "physicalMaterials, personalityPreset, personalityDescription, " +
      "courseContext, assessmentTargets, constraints, communityMode, " +
      "welcomeGoals, welcomeAboutYou, welcomeKnowledgeCheck, welcomeAiIntro, npsEnabled, " +
      "contentSkipped, welcomeSkipped, tuneSkipped, " +
      "courseRefEnabled, skillsFramework, teachingPrinciples, coursePhases, " +
      "edgeCases, assessmentBoundaries. " +
      "courseRefEnabled = set to true when user wants detailed teaching guide. " +
      "skillsFramework = array of { id, name, description?, tiers: { emerging, developing, secure } }. " +
      "teachingPrinciples = { corePrinciples: string[], sessionStructure?: { phases: [] }, techniquesBySkill?: [] }. " +
      "coursePhases = array of { name, sessions?, goal?, tutorBehaviour?: [], exitCriteria?: [], checkpoints?: [] }. " +
      "edgeCases = array of { scenario, response }. " +
      "assessmentBoundaries = array of strings (what this course is NOT). " +
      "audience = learner age group (primary, secondary, sixth-form, higher-ed, adult-professional, adult-casual). " +
      "learningOutcomes = array of strings, what students should achieve by course end. " +
      "assessments = assessment style (formal, light, none). " +
      "courseContext = 3-5 sentence synthesis of the teacher's course philosophy, learner profile, " +
      "and teaching rationale. Capture during Phase 1b — distill WHY the course exists, WHO the learners are, " +
      "and WHAT makes the teaching approach distinctive. This reaches the voice AI on every call. " +
      "assessmentTargets = specific measurable outcomes the learner is working toward (exams, certifications, practical skills). " +
      "Save as array of strings. Only extract when teacher explicitly states them. " +
      "constraints = things the AI must NEVER do — pedagogical anti-patterns to avoid. " +
      "Save as array of strings. Only extract when teacher explicitly states them.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "Key-value pairs to save. Keys must be valid wizard field names.",
          additionalProperties: true,
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "show_suggestions",
    description:
      "Show clickable quick-reply chips above the chat input. " +
      "ONLY for CONFIRMATION and SKIP chips — never to present a list of choices. " +
      "Good: 'Sounds good', 'Skip for now', 'Use default', 'Go more directive'. " +
      "Bad: 'Socratic', 'Direct instruction' — bare option labels with no explanation. " +
      "For required choices (approach, sessions, etc.) explain in prose, recommend one, " +
      "then offer confirmatory chips. Suggestions auto-send as a user message when clicked. " +
      "ALWAYS include the 'question' field — shown as a small label above the chips.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Short context label displayed above the chips.",
        },
        suggestions: {
          type: "array",
          items: { type: "string" },
          description: "1-3 short confirmatory labels (e.g. 'Sounds good', 'Skip for now', 'Use default', 'Go more directive'). Never bare option names.",
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ["question", "suggestions"],
    },
  },
  {
    name: "show_options",
    description:
      "Show a structured option card for questions with predefined choices. " +
      "Two modes: (1) CHOICE card — inline in the chat stream, for teaching approach, session count/duration, lesson plan model, subject discipline, or any question with 2-8 predefined values. " +
      "Use mode 'radio' for single-choice, 'checklist' for multi-choice. " +
      "Always set recommended: true on the option you recommend. " +
      "(2) FIELD PICKER — set fieldPicker: true after presenting the full Phase 2/5 proposal summary. " +
      "Shows above the input bar so the user can pick which proposal field to change. " +
      "Use mode: 'checklist', dataKey: '_fieldPicker', options = one entry per bold field in the proposal (label = field name, description = proposed value + one-sentence rationale). " +
      "Known special dataKey values: '_fieldPicker' (proposal amendment picker, fieldPicker: true) " +
      "and '_welcomePhases' (welcome flow proposal picker, mode: 'checklist', renders inline, " +
      "options = Goals / About You / Knowledge Check / AI Introduction; the AI parses the user's " +
      "checklist response and saves the four welcome* fields via update_setup). " +
      "IMPORTANT: use show_options for CHOICE questions, show_suggestions for CONFIRMATIONS only. " +
      "When fieldPicker: true, do NOT also call show_suggestions in the same response.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to display above the options.",
        },
        dataKey: {
          type: "string",
          description: "The setup field key this answer maps to (e.g. 'interactionPattern', 'sessionCount'). Use '_fieldPicker' for field picker mode.",
        },
        mode: {
          type: "string",
          enum: ["radio", "checklist"],
          description: "radio = single-choice (auto-submits on selection). checklist = multi-select with Confirm button.",
        },
        required: {
          type: "boolean",
          description: "If true, Skip button is hidden. Default false.",
        },
        fieldPicker: {
          type: "boolean",
          description: "If true, renders above the input bar as a proposal field picker. Use after full proposal summary only. Options = each bold proposal field. Do not call show_suggestions in the same response.",
        },
        options: {
          type: "array",
          description: "2-8 options. Include recommended: true on the suggested choice.",
          items: {
            type: "object",
            properties: {
              value: { type: "string", description: "The data value to save." },
              label: { type: "string", description: "Short display label." },
              description: { type: "string", description: "1-sentence explanation shown below the label." },
              recommended: { type: "boolean", description: "Mark the recommended option." },
            },
            required: ["value", "label", "description"],
          },
          minItems: 2,
          maxItems: 8,
        },
      },
      required: ["question", "dataKey", "mode", "options"],
    },
  },
  {
    name: "show_upload",
    description:
      "Show the file upload panel above the chat input bar. " +
      "Accepts PDFs, Word documents, and text files. " +
      "The system extracts teaching points automatically. " +
      "Only show this when the user is ready to upload content. " +
      "In V4, the user can also click the + button to trigger this themselves.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Header label (e.g. 'Upload teaching materials').",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "create_institution",
    description:
      "Create a new institution (and its domain). " +
      "Only call this when the user has confirmed they want to proceed AND the institution doesn't already exist. " +
      "Returns the created institution ID and domain ID.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Institution name." },
        typeSlug: { type: "string", description: "Institution type slug." },
        websiteUrl: { type: "string", description: "Optional website URL." },
      },
      required: ["name"],
    },
  },
  {
    name: "create_course",
    description:
      "Create the course with full infrastructure (identity spec, playbook, system specs, onboarding) and a test caller. " +
      "Only call this after the user explicitly confirms creation. " +
      "Pass ALL collected values — including optional ones like welcomeMessage, behaviorTargets, etc. " +
      "domainId is optional — the system auto-resolves it from the institution name in setupData. " +
      "personalityPreset is mapped to behaviorTargets automatically if behaviorTargets is not provided.",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain ID. Optional — auto-resolved from institution name if omitted." },
        groupId: { type: "string", description: "Department/group ID (if user specified a department)." },
        courseName: { type: "string" },
        subjectDiscipline: { type: "string" },
        interactionPattern: { type: "string" },
        teachingMode: { type: "string" },
        welcomeMessage: { type: "string" },
        sessionCount: { type: "number" },
        durationMins: { type: "number" },
        planEmphasis: { type: "string" },
        behaviorTargets: {
          type: "object",
          description: "Personality values (0-100). If not provided, derived from personalityPreset.",
          additionalProperties: { type: "number" },
        },
        personalityPreset: {
          type: "string",
          description: "Preset ID (e.g. 'socratic-mentor'). Mapped to behaviorTargets if no explicit targets.",
        },
        lessonPlanModel: { type: "string" },
        physicalMaterials: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              name: { type: "string" },
              details: { type: "string" },
            },
            required: ["type", "name"],
          },
          description: "Physical materials students have (textbooks, workbooks, etc.).",
        },
        packSubjectIds: {
          type: "array",
          items: { type: "string" },
          description: "Subject IDs from content upload (legacy, prefer uploadSourceIds).",
        },
        uploadSourceIds: {
          type: "array",
          items: { type: "string" },
          description: "Content source IDs from content upload (preferred over packSubjectIds).",
        },
      },
      required: ["courseName", "interactionPattern"],
    },
  },
  {
    name: "create_community",
    description:
      "Create a community hub with infrastructure (COMMUNITY domain, identity spec, playbook, cohort group). " +
      "Use this instead of create_course when the user wants a community hub, discussion group, book club, etc. " +
      "NEVER use create_course for community intent — always use create_community. " +
      "communityMode: 'attached' = linked to user's institution, 'standalone' = free-floating hub.",
    input_schema: {
      type: "object",
      properties: {
        hubName: { type: "string", description: "Name for the community hub." },
        hubDescription: { type: "string", description: "One-sentence description of the hub's purpose." },
        communityMode: {
          type: "string",
          enum: ["attached", "standalone"],
          description: "attached = linked to user's institution; standalone = free-floating.",
        },
        hubPattern: {
          type: "string",
          description: "Interaction pattern for the hub AI (default: conversational-guide).",
        },
        communityKind: {
          type: "string",
          enum: ["TOPIC_BASED", "OPEN_CONNECTION"],
          description: "TOPIC_BASED if topics are defined, OPEN_CONNECTION otherwise.",
        },
        topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Topic name." },
              pattern: { type: "string", description: "Interaction pattern for this topic (optional, defaults to hubPattern)." },
            },
            required: ["name"],
          },
          description: "Topic areas for the hub (optional).",
        },
        welcomeMessage: {
          type: "string",
          description: "Brief greeting members hear on their first call (optional — persona default used if omitted).",
        },
      },
      required: ["hubName", "communityMode"],
    },
  },
  {
    name: "update_course_config",
    description:
      "Update an already-created course's configuration. " +
      "Use after create_course when the user changes welcome message, personality, or lesson settings. " +
      "Only pass values that have changed.",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain ID. Optional — auto-resolved from setupData if omitted." },
        playbookId: { type: "string", description: "Playbook ID. Optional — auto-resolved from setupData if omitted." },
        welcomeMessage: { type: "string" },
        sessionCount: { type: "number" },
        durationMins: { type: "number" },
        planEmphasis: { type: "string" },
        behaviorTargets: {
          type: "object",
          description: "Personality values (0-100).",
          additionalProperties: { type: "number" },
        },
        lessonPlanModel: { type: "string" },
        onboardingFlowPhases: {
          type: "object",
          description: "Updated onboarding flow phases with content attachments. Use when the user wants to change which materials are shared in which phase of the first call.",
        },
      },
      required: [],
    },
  },
  {
    name: "suggest_welcome_message",
    description:
      "Generate a welcome message for the first call based on the course context. " +
      "Present the suggestion in your text response — do not render a panel. " +
      "The user can accept, modify, or skip. " +
      "ALWAYS call show_suggestions after presenting the welcome message " +
      "(e.g. 'Use this', 'Tweak it', 'Skip welcome'). " +
      "Save accepted message via update_setup with key 'welcomeMessage'.",
    input_schema: {
      type: "object",
      properties: {
        courseName: { type: "string" },
        subjectDiscipline: { type: "string" },
        interactionPattern: { type: "string" },
        personalityPreset: { type: "string" },
      },
      required: ["courseName"],
    },
  },
  {
    name: "mark_complete",
    description:
      "Signal that setup is complete. Call this after the course has been successfully created.",
    input_schema: {
      type: "object",
      properties: {
        playbookId: { type: "string" },
        callerId: { type: "string" },
      },
      required: [],
    },
  },
];

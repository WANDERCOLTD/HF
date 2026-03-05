/**
 * Conversational Wizard Tools (V4)
 *
 * Tool set for the conversation-first wizard.
 * show_options re-added for structured choices (renders inline in chat stream, not above input).
 * show_sliders / show_actions remain dropped.
 * Added: suggest_welcome_message.
 *
 * Execution reuses executeWizardTool() from wizard-tools.ts — same switch dispatcher.
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
      "Valid field keys: institutionName, typeSlug, websiteUrl, courseName, subjectDiscipline, " +
      "interactionPattern, teachingMode, welcomeMessage, sessionCount, durationMins, " +
      "planEmphasis, behaviorTargets, lessonPlanModel, existingInstitutionId, existingDomainId, defaultDomainKind, " +
      "physicalMaterials, personalityPreset, personalityDescription, " +
      "contentSkipped, welcomeSkipped, tuneSkipped.",
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
      "Show a structured option card inline in the chat stream for questions with predefined choices. " +
      "Use for: teaching approach, session count/duration, lesson plan model, subject discipline (from catalog), " +
      "or any question with 2-8 predefined values. " +
      "Use mode 'radio' for single-choice, 'checklist' for multi-choice. " +
      "Always set recommended: true on the option you recommend. " +
      "The user can click 'Something else' to type freely instead, or 'Skip' for optional fields. " +
      "IMPORTANT: use show_options for CHOICE questions, show_suggestions for CONFIRMATIONS only.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to display above the options.",
        },
        dataKey: {
          type: "string",
          description: "The setup field key this answer maps to (e.g. 'interactionPattern', 'sessionCount').",
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
      "Requires: domainId (from institution creation or existing institution), courseName, interactionPattern. " +
      "personalityPreset is mapped to behaviorTargets automatically if behaviorTargets is not provided.",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain ID." },
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
          description: "Subject IDs from content upload (if any).",
        },
      },
      required: ["domainId", "courseName", "interactionPattern"],
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
        domainId: { type: "string", description: "Domain ID." },
        playbookId: { type: "string", description: "Playbook ID (from create_course result)." },
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
      },
      required: ["domainId", "playbookId"],
    },
  },
  {
    name: "suggest_welcome_message",
    description:
      "Generate a welcome message for the first call based on the course context. " +
      "Present the suggestion in your text response — do not render a panel. " +
      "The user can accept, modify, or skip. " +
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

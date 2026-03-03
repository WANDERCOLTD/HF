/**
 * Wizard Tools — tool definitions for the WIZARD chat mode.
 *
 * These tools let the AI:
 *   - Save extracted data (update_setup)
 *   - Present structured options above the chat bar (show_options, show_sliders, show_upload, show_actions)
 *   - Trigger creation (create_institution, create_course)
 *   - Signal completion (mark_complete)
 *
 * Tool RESULTS are returned to the AI for the next iteration.
 * Tool SIDE-EFFECTS are communicated to the client via a separate channel
 * (the response includes tool call metadata that the client processes).
 */

import type { AITool } from "@/lib/ai/client";

// ── Tool definitions (sent to the AI) ───────────────────

export const WIZARD_TOOLS: AITool[] = [
  {
    name: "update_setup",
    description:
      "Save one or more extracted data fields from the conversation. " +
      "Call this EVERY time you learn new information — even from a casual mention. " +
      "Valid field keys: institutionName, typeSlug, websiteUrl, courseName, subjectDiscipline, " +
      "interactionPattern, teachingMode, welcomeMessage, sessionCount, durationMins, " +
      "planEmphasis, behaviorTargets, lessonPlanModel, existingInstitutionId, existingDomainId, defaultDomainKind.",
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
    name: "show_options",
    description:
      "Present a set of options as radio buttons (single-select) or checkboxes (multi-select) " +
      "above the chat input bar. The user clicks to select. " +
      "Use mode='radio' for mutually exclusive choices, mode='checklist' for multi-select. " +
      "Set recommended=true on ONE option if you have a suggestion.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Header label for the option group (e.g. 'Teaching approach').",
        },
        dataKey: {
          type: "string",
          description: "The wizard field key this selection maps to (e.g. 'interactionPattern').",
        },
        mode: {
          type: "string",
          enum: ["radio", "checklist"],
          description: "radio = single-select, checklist = multi-select.",
        },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
              recommended: { type: "boolean" },
            },
            required: ["value", "label", "description"],
          },
          description: "The options to present. 2-6 options.",
        },
      },
      required: ["question", "dataKey", "mode", "options"],
    },
  },
  {
    name: "show_sliders",
    description:
      "Present personality sliders above the chat input bar. " +
      "Each slider is 0-100 with labelled low/high ends.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Header label (e.g. 'Adjust personality').",
        },
        sliders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              label: { type: "string" },
              low: { type: "string" },
              high: { type: "string" },
            },
            required: ["key", "label", "low", "high"],
          },
        },
      },
      required: ["question", "sliders"],
    },
  },
  {
    name: "show_upload",
    description:
      "Show the file upload panel above the chat input bar. " +
      "Accepts PDFs, Word documents, and text files. " +
      "The system extracts teaching points automatically. " +
      "Only show this for non-community courses.",
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
    name: "show_actions",
    description:
      "Present action buttons above the input bar. " +
      "Use when the required fields are collected and you're offering to create the course. " +
      "Typically: primary='Create & Try a Call', secondary='Continue Setup' or 'Fine-tune first'.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Context text above the buttons.",
        },
        primary: {
          type: "object",
          properties: {
            label: { type: "string" },
            icon: { type: "string", description: "Lucide icon name (e.g. 'Rocket')." },
          },
          required: ["label"],
        },
        secondary: {
          type: "object",
          properties: {
            label: { type: "string" },
            icon: { type: "string" },
          },
          required: ["label"],
        },
      },
      required: ["question", "primary", "secondary"],
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
      "Create the course (playbook) and a test caller. " +
      "Only call this after the user explicitly confirms (e.g. clicks 'Create & Try a Call'). " +
      "Requires: domainId (from institution creation or existing institution), courseName, interactionPattern.",
    input_schema: {
      type: "object",
      properties: {
        domainId: { type: "string", description: "Domain ID (from create_institution result or existing institution)." },
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
          description: "Personality slider values (0-100).",
          additionalProperties: { type: "number" },
        },
        lessonPlanModel: { type: "string" },
      },
      required: ["domainId", "courseName", "interactionPattern"],
    },
  },
  {
    name: "mark_complete",
    description:
      "Signal that setup is complete. Call this after the course has been successfully created.",
    input_schema: {
      type: "object",
      properties: {
        playBookId: { type: "string" },
        callerId: { type: "string" },
      },
      required: [],
    },
  },
];

// ── Tool result type ────────────────────────────────────

export interface WizardToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Execute a wizard tool call.
 *
 * NOTE: show_* tools and update_setup don't have server-side effects —
 * they return confirmation messages that let the AI continue the conversation.
 * The ACTUAL side effects (rendering panels, saving data) happen client-side
 * by inspecting the tool_use blocks in the AI response.
 *
 * create_institution and create_course DO have server-side effects.
 */
export async function executeWizardTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<WizardToolResult & { tool_use_id: string }> {
  // Placeholder tool_use_id — will be replaced by caller
  const base = { tool_use_id: "" };

  switch (toolName) {
    case "update_setup": {
      const fields = input.fields as Record<string, unknown>;
      const keys = Object.keys(fields);

      // Auto-resolve institution when name is provided
      if (fields.institutionName && typeof fields.institutionName === "string") {
        const resolved = await resolveInstitutionByName(fields.institutionName);
        if (resolved) {
          // Build subjects/courses context for the AI
          let subjectContext = "";
          if (resolved.subjects.length > 0) {
            const subjectLines = resolved.subjects.map((s) => {
              const courseList = s.courses.length > 0
                ? s.courses.map((c) => `${c.name}${c.interactionPattern ? ` [${c.interactionPattern}]` : ""}`).join(", ")
                : "no courses yet";
              return `  - ${s.name} (${courseList})`;
            });
            subjectContext =
              `\nSubjects in this domain:\n${subjectLines.join("\n")}\n` +
              `When asking about the course, first present existing subjects as options ` +
              `(show_options with dataKey "subjectDiscipline") plus an "Add new subject" option. ` +
              `If the user picks a subject that has existing courses, show those courses ` +
              `plus a "Create new course" option (show_options with dataKey "courseName").`;
          } else {
            subjectContext = "\nNo subjects or courses exist yet — ask for subject and course name as normal.";
          }

          const resolvedFields =
            `{ existingInstitutionId: "${resolved.institutionId}", ` +
            `existingDomainId: "${resolved.domainId}", ` +
            (resolved.typeSlug ? `typeSlug: "${resolved.typeSlug}", ` : "") +
            `defaultDomainKind: "${resolved.domainKind}" }`;

          if (resolved.exactMatch) {
            return {
              ...base,
              content:
                `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
                `RESOLVED EXISTING INSTITUTION: "${resolved.name}" ` +
                `(type: ${resolved.typeSlug || "unknown"}, institutionId: ${resolved.institutionId}, ` +
                `domainId: ${resolved.domainId}, domainKind: ${resolved.domainKind}). ` +
                `Call update_setup now with: ${resolvedFields} — ` +
                `then skip to the next unanswered field (do NOT ask about organisation type).` +
                subjectContext,
            };
          }

          // Partial match — ask user to confirm before committing
          return {
            ...base,
            content:
              `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
              `PARTIAL MATCH FOUND: "${resolved.name}" ` +
              `(type: ${resolved.typeSlug || "unknown"}, institutionId: ${resolved.institutionId}, ` +
              `domainId: ${resolved.domainId}, domainKind: ${resolved.domainKind}). ` +
              `The user typed "${fields.institutionName}" which partially matches "${resolved.name}". ` +
              `ASK THE USER TO CONFIRM: e.g. "Did you mean ${resolved.name}?" ` +
              `If they confirm, call update_setup with: ${resolvedFields} and skip organisation type. ` +
              `If they say no, treat as a new institution.` +
              subjectContext,
          };
        }

        // No DB match — try name-based type inference for new institutions
        const inferredType = inferTypeFromName(fields.institutionName);
        if (inferredType) {
          return {
            ...base,
            content:
              `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
              `No existing institution found. TYPE AUTO-SET: "${inferredType}" ` +
              `(inferred from the name "${fields.institutionName}"). ` +
              `Call update_setup now with: { typeSlug: "${inferredType}" } — ` +
              `then skip to the next unanswered field (do NOT ask about organisation type).`,
          };
        }
      }

      return { ...base, content: `Saved ${keys.length} field(s): ${keys.join(", ")}. Continue the conversation.` };
    }

    case "show_options":
    case "show_sliders":
    case "show_upload":
    case "show_actions": {
      return { ...base, content: `Panel displayed to user. Wait for their response.` };
    }

    case "create_institution": {
      // Server-side: actually create the institution
      try {
        const { prisma } = await import("@/lib/prisma");
        const slugify = (await import("slugify")).default;

        const name = input.name as string;
        const typeSlug = input.typeSlug as string | undefined;

        // Find institution type + its default domain kind
        let typeId: string | undefined;
        let domainKind: "INSTITUTION" | "COMMUNITY" = "INSTITUTION";
        if (typeSlug) {
          const instType = await prisma.institutionType.findFirst({
            where: { slug: typeSlug },
            select: { id: true, defaultDomainKind: true },
          });
          typeId = instType?.id;
          if (instType?.defaultDomainKind === "COMMUNITY") domainKind = "COMMUNITY";
        }

        // Create institution
        const institution = await prisma.institution.create({
          data: {
            name,
            slug: slugify(name, { lower: true, strict: true }),
            ...(typeId ? { typeId } : {}),
          },
        });

        // Create domain
        const domain = await prisma.domain.create({
          data: {
            name,
            slug: slugify(name, { lower: true, strict: true }),
            institutionId: institution.id,
            kind: domainKind,
          },
        });

        // Link user to institution (set as active institution)
        await prisma.user.update({
          where: { id: userId },
          data: { activeInstitutionId: institution.id },
        });

        return {
          ...base,
          content: JSON.stringify({
            ok: true,
            institutionId: institution.id,
            domainId: domain.id,
            domainKind,
          }),
        };
      } catch (err) {
        return {
          ...base,
          content: JSON.stringify({ ok: false, error: String(err) }),
          is_error: true,
        };
      }
    }

    case "create_course": {
      // Server-side: create the course (playbook + test caller + enrollment)
      try {
        const { prisma } = await import("@/lib/prisma");

        const domainId = input.domainId as string;
        const courseName = input.courseName as string;
        const interactionPattern = input.interactionPattern as string;
        const subjectDiscipline = (input.subjectDiscipline as string) || courseName;

        // Build playbook config JSON (these fields aren't direct columns)
        const playbookConfig: Record<string, unknown> = {};
        if (interactionPattern) playbookConfig.interactionPattern = interactionPattern;
        if (input.teachingMode) playbookConfig.teachingMode = input.teachingMode;
        if (subjectDiscipline) playbookConfig.subjectDiscipline = subjectDiscipline;
        if (input.welcomeMessage) playbookConfig.welcomeMessage = input.welcomeMessage;
        if (input.sessionCount) playbookConfig.sessionCount = Number(input.sessionCount);
        if (input.durationMins) playbookConfig.durationMins = Number(input.durationMins);
        if (input.planEmphasis) playbookConfig.planEmphasis = input.planEmphasis;
        if (input.lessonPlanModel) playbookConfig.lessonPlanModel = input.lessonPlanModel;
        if (input.behaviorTargets) playbookConfig.behaviorTargets = input.behaviorTargets;

        // Create playbook
        const playbook = await prisma.playbook.create({
          data: {
            name: courseName,
            domainId,
            config: Object.keys(playbookConfig).length > 0 ? JSON.parse(JSON.stringify(playbookConfig)) : undefined,
          },
        });

        // Create a test caller
        const friendlyNames = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Quinn"];
        const callerName = friendlyNames[Math.floor(Math.random() * friendlyNames.length)];

        const caller = await prisma.caller.create({
          data: {
            name: `${callerName} (Test)`,
            domainId,
          },
        });

        // Enrol caller in this playbook
        await prisma.callerPlaybook.create({
          data: {
            callerId: caller.id,
            playbookId: playbook.id,
          },
        }).catch(() => {
          // Ignore if already enrolled
        });

        return {
          ...base,
          content: JSON.stringify({
            ok: true,
            playbookId: playbook.id,
            callerId: caller.id,
            callerName: `${callerName} (Test)`,
          }),
        };
      } catch (err) {
        return {
          ...base,
          content: JSON.stringify({ ok: false, error: String(err) }),
          is_error: true,
        };
      }
    }

    case "mark_complete": {
      return { ...base, content: "Setup complete. The user can now try a sim call." };
    }

    default: {
      return { ...base, content: `Unknown tool: ${toolName}`, is_error: true };
    }
  }
}

// ── Institution resolution ──────────────────────────────

interface ResolvedCourse {
  id: string;
  name: string;
  interactionPattern?: string;
}

interface ResolvedSubject {
  id: string;
  name: string;
  courses: ResolvedCourse[];
}

interface ResolvedInstitution {
  institutionId: string;
  name: string;
  typeSlug: string | null;
  domainId: string;
  domainKind: string;
  subjects: ResolvedSubject[];
  /** true = exact name match, false = partial (contains) match needing confirmation */
  exactMatch: boolean;
}

/**
 * Look up an existing institution by name.
 * Strategy: exact match first, then partial (contains) for 3+ char inputs.
 * Returns the best match with its type, primary domain, subjects, and courses.
 *
 * Uses two direct Domain relations (both naturally domain-scoped):
 *   Domain → subjects (SubjectDomain) — what subjects are taught here
 *   Domain → playbooks (Playbook) → subjects (PlaybookSubject) — courses + their subjects
 * Then merges in JS: subjects as keys, courses attached to each.
 */
async function resolveInstitutionByName(name: string): Promise<ResolvedInstitution | null> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const includeClause = {
      type: { select: { slug: true } },
      domains: {
        take: 1,
        orderBy: { createdAt: "asc" as const },
        select: {
          id: true,
          kind: true,
          subjects: {
            select: {
              subject: { select: { id: true, name: true } },
            },
          },
          playbooks: {
            select: {
              id: true,
              name: true,
              config: true,
              subjects: {
                select: {
                  subject: { select: { id: true } },
                },
              },
            },
          },
        },
      },
    };

    // 1. Try exact match first (fast, unambiguous)
    let institution = await prisma.institution.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      include: includeClause,
    });
    let exactMatch = !!institution;

    // 2. No exact match — try partial match (minimum 3 chars to avoid noise)
    if (!institution && name.trim().length >= 3) {
      const candidates = await prisma.institution.findMany({
        where: { name: { contains: name, mode: "insensitive" } },
        include: includeClause,
        take: 5,
      });
      if (candidates.length > 0) {
        // Pick shortest name — best match ratio (e.g. "riverside" → "Riverside Academy" over "Riverside Community Training Centre")
        institution = candidates.sort((a, b) => a.name.length - b.name.length)[0];
        exactMatch = false;
      }
    }

    if (!institution || institution.domains.length === 0) return null;

    const domain = institution.domains[0];

    // Build subject map from SubjectDomain (includes subjects with no courses)
    const subjectMap = new Map<string, ResolvedSubject>();
    for (const sd of domain.subjects) {
      subjectMap.set(sd.subject.id, {
        id: sd.subject.id,
        name: sd.subject.name,
        courses: [],
      });
    }

    // Attach courses to their subjects via PlaybookSubject
    for (const pb of domain.playbooks) {
      const config = pb.config as Record<string, unknown> | null;
      const course: ResolvedCourse = {
        id: pb.id,
        name: pb.name,
        interactionPattern: config?.interactionPattern as string | undefined,
      };
      for (const ps of pb.subjects) {
        const subject = subjectMap.get(ps.subject.id);
        if (subject) subject.courses.push(course);
      }
    }

    return {
      institutionId: institution.id,
      name: institution.name,
      typeSlug: institution.type?.slug ?? null,
      domainId: domain.id,
      domainKind: domain.kind,
      subjects: Array.from(subjectMap.values()),
      exactMatch,
    };
  } catch (err) {
    console.warn("[wizard-tools] Institution resolution failed:", err);
    return null;
  }
}

// ── Name-based type inference ───────────────────────────

const TYPE_PATTERNS: Array<{ pattern: RegExp; typeSlug: string }> = [
  { pattern: /\b(academy|school|college|sixth\s*form|primary|secondary|grammar|prep|nursery|kindergarten)\b/i, typeSlug: "school" },
  { pattern: /\b(hospital|clinic|nhs|health\s*(service|centre|center)|medical|surgery|dental)\b/i, typeSlug: "healthcare" },
  { pattern: /\b(gym|fitness|sport|athletic|martial\s*arts|swimming|tennis|yoga)\b/i, typeSlug: "coaching" },
  { pattern: /\b(foundation|charity|community|trust|volunteer|youth|church|mosque|synagogue|temple)\b/i, typeSlug: "community" },
  { pattern: /\b(training|workshop|bootcamp|course\s*provider|learning\s*centre)\b/i, typeSlug: "training" },
  { pattern: /\b(ltd|limited|inc|corp|plc|consulting|solutions|partners|agency|group)\b/i, typeSlug: "corporate" },
];

/**
 * Infer institution type from name patterns.
 * Returns the slug if a strong signal is found, null otherwise.
 */
function inferTypeFromName(name: string): string | null {
  for (const { pattern, typeSlug } of TYPE_PATTERNS) {
    if (pattern.test(name)) return typeSlug;
  }
  return null;
}

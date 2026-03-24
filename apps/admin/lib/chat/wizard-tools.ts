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

// ── Helpers ─────────────────────────────────────────────

/** Return the string only if it looks like a real UUID (v4). Rejects slugs, made-up prefixed IDs, etc. */
function validUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Standard UUID v4 pattern — also accepts Prisma cuid/cuid2 (25+ alphanum chars)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  // Prisma CUID (starts with c, 25 chars) or CUID2 (24+ chars alphanumeric)
  if (/^c[a-z0-9]{24,}$/i.test(value)) return value;
  return undefined;
}

// ── Tool definitions (sent to the AI) ───────────────────

export const WIZARD_TOOLS: AITool[] = [
  {
    name: "update_setup",
    description:
      "Save one or more extracted data fields from the conversation. " +
      "Call this EVERY time you learn new information — even from a casual mention. " +
      "IMPORTANT: subjectDiscipline = broad discipline (English Language, Biology, Maths). " +
      "courseName = specific course within that subject (GCSE Biology, 11+ Comprehension). " +
      "NEVER put a broad discipline into courseName or a specific course into subjectDiscipline. " +
      "Valid field keys: institutionName, typeSlug, websiteUrl, courseName, subjectDiscipline, " +
      "interactionPattern, audience, teachingMode, welcomeMessage, sessionCount, durationMins, " +
      "planEmphasis, behaviorTargets, lessonPlanModel, existingInstitutionId, existingDomainId, defaultDomainKind, " +
      "courseContext, assessmentTargets, constraints, " +
      "contentSkipped, welcomeSkipped, tuneSkipped. " +
      "courseContext = 3-5 sentence synthesis of the teacher's course philosophy, learner profile, " +
      "and teaching rationale. " +
      "assessmentTargets = specific measurable outcomes the learner is working toward (exams, certifications, practical skills). " +
      "Save as array of strings, e.g. [\"Pass the Beit Din\", \"Read from the siddur fluently\"]. " +
      "Only extract when teacher explicitly states them. " +
      "constraints = things the AI must NEVER do — pedagogical anti-patterns the teacher wants to avoid. " +
      "Save as array of strings, e.g. [\"Never drill letters in isolation\", \"Avoid competitive language\"]. " +
      "Only extract when teacher explicitly states them.",
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
    name: "show_suggestions",
    description:
      "Show clickable quick-reply chips above the chat input. " +
      "Use this whenever you ask an OPTIONAL or skippable question — the user should never have to type 'skip'. " +
      "Suggestions auto-send as a user message when clicked. " +
      "Can be used alongside a text response but NOT alongside other show_* tools. " +
      "IMPORTANT: Always include the 'question' field to give the chips context — " +
      "e.g. 'Welcome Message' or 'Website URL'. Without it, the user sees orphan buttons with no explanation.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Short context label displayed above the chips (e.g. 'Welcome Message', 'Website URL'). REQUIRED — chips are meaningless without it.",
        },
        suggestions: {
          type: "array",
          items: { type: "string" },
          description: "1-3 short suggestion labels (e.g. 'Skip for now', 'I'll add this later').",
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ["question", "suggestions"],
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
      "Only call this after the user explicitly confirms (e.g. clicks 'Create & Try a Call'). " +
      "Pass ALL collected values — including optional ones like welcomeMessage, behaviorTargets, etc. " +
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
        audience: { type: "string", description: "Student audience: primary, secondary, sixth-form, higher-ed, adult-professional, adult-casual." },
        lessonPlanModel: { type: "string" },
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
          description: "Personality slider values (0-100).",
          additionalProperties: { type: "number" },
        },
        lessonPlanModel: { type: "string" },
      },
      required: ["domainId", "playbookId"],
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
  /** Fields to auto-inject as a client-side update_setup call (e.g. resolved entity IDs). */
  autoInjectFields?: Record<string, unknown>;
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
  setupData?: Record<string, unknown>,
): Promise<WizardToolResult & { tool_use_id: string }> {
  // Placeholder tool_use_id — will be replaced by caller
  const base = { tool_use_id: "" };

  switch (toolName) {
    case "update_setup": {
      const fields = input.fields as Record<string, unknown>;
      const keys = Object.keys(fields);

      // ── Institution resolution ──────────────────────────
      if (fields.institutionName && typeof fields.institutionName === "string") {
        const resolved = await resolveInstitutionByName(fields.institutionName);
        if (resolved) {
          // Build subjects/courses context for the AI
          let subjectContext = "";
          // Check if the user already specified a subject in this same update_setup call
          const userProvidedSubject = fields.subjectDiscipline && typeof fields.subjectDiscipline === "string"
            ? (fields.subjectDiscipline as string)
            : null;

          if (resolved.subjects.length > 0) {
            const subjectLines = resolved.subjects.map((s) => {
              const courseList = s.courses.length > 0
                ? s.courses.map((c) => `${c.name}${c.interactionPattern ? ` [${c.interactionPattern}]` : ""}`).join(", ")
                : "no courses yet";
              return `  - ${s.name} (${courseList})`;
            });
            subjectContext = `\nExisting subjects in this institution:\n${subjectLines.join("\n")}`;

            // If the user already provided a subject in this call, don't auto-commit from DB —
            // the user's input takes priority. Just list existing subjects for context.
            if (userProvidedSubject) {
              subjectContext +=
                `\nThe user specified subject "${userProvidedSubject}" in this message. ` +
                `Use the user's subject — do NOT override it with an existing subject from the database. ` +
                `Proceed to the Course phase.`;
            } else if (resolved.subjects.length === 1 && resolved.subjects[0].courses.length === 1) {
              // Smart auto-commit: if only 1 subject with only 1 course, include full chain
              // BUT respect user's explicit courseName if it differs from the existing course
              const sub = resolved.subjects[0];
              const course = sub.courses[0];
              const userCourse = (fields.courseName as string | undefined) || (setupData?.courseName as string | undefined);
              const userWantsDifferent = userCourse && course.name.toLowerCase() !== userCourse.toLowerCase();
              if (userWantsDifferent) {
                subjectContext +=
                  `\nAUTO-COMMIT SUBJECT: Only one subject ("${sub.name}"). ` +
                  `Call update_setup with: { subjectDiscipline: "${sub.name}" }. ` +
                  `Existing course "${course.name}" found but user named their course "${userCourse}". ` +
                  `Do NOT auto-commit the existing course. Ask user: use existing "${course.name}" or create new "${userCourse}"?` +
                  `\nShow as show_options for courseName: "${course.name}" and "Create '${userCourse}' as new course".`;
              } else {
                subjectContext +=
                  `\nAUTO-COMMIT CHAIN: Only one subject ("${sub.name}") with one course ("${course.name}"` +
                  `${course.interactionPattern ? `, ${course.interactionPattern}` : ""}). ` +
                  `Call update_setup with: { subjectDiscipline: "${sub.name}", courseName: "${course.name}"` +
                  `${course.interactionPattern ? `, interactionPattern: "${course.interactionPattern}"` : ""} ` +
                  `} — tell the user what you found and skip to next uncollected field.`;
              }
            } else if (resolved.subjects.length === 1) {
              const sub = resolved.subjects[0];
              subjectContext +=
                `\nAUTO-COMMIT SUBJECT: Only one subject ("${sub.name}"). ` +
                `Call update_setup with: { subjectDiscipline: "${sub.name}" }. ` +
                (sub.courses.length > 1
                  ? `Multiple courses exist — show them as show_options for courseName with "Create new course" at the end.`
                  : `No existing courses — ask for course name as normal.`);
            } else {
              subjectContext +=
                `\nMULTIPLE SUBJECTS: Show as show_options for subjectDiscipline with "Add new subject" at the end.`;
            }
          } else {
            subjectContext = "\nNo subjects or courses exist yet — ask for subject and course name as normal.";
          }

          const resolvedFields =
            `{ existingInstitutionId: "${resolved.institutionId}", ` +
            `existingDomainId: "${resolved.domainId}", ` +
            (resolved.typeSlug ? `typeSlug: "${resolved.typeSlug}", ` : "") +
            `defaultDomainKind: "${resolved.domainKind}" }`;

          // Auto-inject resolved IDs client-side (don't rely on AI calling update_setup again)
          const institutionAutoFields: Record<string, unknown> = {
            existingInstitutionId: resolved.institutionId,
            existingDomainId: resolved.domainId,
            defaultDomainKind: resolved.domainKind,
            ...(resolved.typeSlug ? { typeSlug: resolved.typeSlug } : {}),
          };

          // Smart auto-commit: exact match OR single partial match → auto-commit
          if (resolved.exactMatch) {
            return {
              ...base,
              autoInjectFields: institutionAutoFields,
              content:
                `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
                `AUTO-COMMIT INSTITUTION: "${resolved.name}" ` +
                `(type: ${resolved.typeSlug || "unknown"}, institutionId: ${resolved.institutionId}, ` +
                `domainId: ${resolved.domainId}, domainKind: ${resolved.domainKind}). ` +
                `Call update_setup now with: ${resolvedFields} — ` +
                `tell the user what you found and skip to the next unanswered field.` +
                subjectContext,
            };
          }

          // Partial match — single candidate = auto-commit, multiple = show options
          // (resolveInstitutionByName already picks the best single candidate)
          return {
            ...base,
            autoInjectFields: institutionAutoFields,
            content:
              `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
              `AUTO-COMMIT INSTITUTION (partial match): "${resolved.name}" ` +
              `(type: ${resolved.typeSlug || "unknown"}, institutionId: ${resolved.institutionId}, ` +
              `domainId: ${resolved.domainId}, domainKind: ${resolved.domainKind}). ` +
              `The user typed "${fields.institutionName}" which matches "${resolved.name}". ` +
              `Call update_setup with: ${resolvedFields}. ` +
              `Tell the user: "Found ${resolved.name} — using your existing organisation."` +
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

      // ── Course resolution (requires known domainId) ─────
      const domainId = (setupData?.existingDomainId || setupData?.draftDomainId) as string | undefined;
      if (fields.courseName && typeof fields.courseName === "string" && domainId) {
        const resolved = await resolveCourseByName(fields.courseName, domainId);
        if (resolved) {
          if (resolved.autoCommit) {
            const pb = resolved.playbooks[0];
            return {
              ...base,
              autoInjectFields: {
                draftPlaybookId: pb.id,
                ...(pb.interactionPattern ? { interactionPattern: pb.interactionPattern } : {}),
              },
              content:
                `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
                `AUTO-COMMIT COURSE: "${pb.name}" (playbookId: ${pb.id}` +
                `${pb.interactionPattern ? `, interactionPattern: ${pb.interactionPattern}` : ""}). ` +
                `Call update_setup with: { draftPlaybookId: "${pb.id}"` +
                `${pb.interactionPattern ? `, interactionPattern: "${pb.interactionPattern}"` : ""} }. ` +
                `Tell the user: "Found ${pb.name} — using your existing course." ` +
                `Skip teaching approach if already set. Move to next uncollected field.`,
            };
          }
          // Multiple matches — show options
          const optionLines = resolved.playbooks.map((p) =>
            `  - "${p.name}" (playbookId: ${p.id}${p.interactionPattern ? `, ${p.interactionPattern}` : ""})`
          ).join("\n");
          return {
            ...base,
            content:
              `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
              `MULTIPLE COURSE MATCHES:\n${optionLines}\n` +
              `Show as show_options for courseName (radio mode) with "Create new course" at the end.`,
          };
        }
      }

      // ── Subject resolution (requires known domainId) ────
      if (fields.subjectDiscipline && typeof fields.subjectDiscipline === "string" && domainId) {
        const resolved = await resolveSubjectByName(fields.subjectDiscipline, domainId);
        if (resolved) {
          if (resolved.autoCommit) {
            const sub = resolved.subjects[0];

            // Build course context so the AI knows what courses exist for this subject
            // If the user already provided a courseName that differs from the only existing course,
            // don't auto-commit — they want a NEW course with that name.
            const userCourseName = (fields.courseName as string | undefined) || (setupData?.courseName as string | undefined);
            let courseContext = "";
            if (sub.courses.length === 1) {
              const c = sub.courses[0];
              const userWantsDifferentCourse = userCourseName &&
                c.name.toLowerCase() !== userCourseName.toLowerCase();
              if (userWantsDifferentCourse) {
                courseContext =
                  `\nExisting course "${c.name}" found, but user already named their course "${userCourseName}". ` +
                  `Do NOT auto-commit the existing course. Create a new course named "${userCourseName}" instead. ` +
                  `Ask: "There's already a course called '${c.name}' — would you like to use it, or create '${userCourseName}' as a new course?"` +
                  `\nShow as show_options for courseName (radio mode): "${c.name}" and "Create '${userCourseName}' as new course".`;
              } else {
                courseContext =
                  `\nAUTO-COMMIT COURSE: Only one course for this subject: "${c.name}" (playbookId: ${c.id}` +
                  `${c.interactionPattern ? `, interactionPattern: ${c.interactionPattern}` : ""}). ` +
                  `Call update_setup with: { courseName: "${c.name}", draftPlaybookId: "${c.id}"` +
                  `${c.interactionPattern ? `, interactionPattern: "${c.interactionPattern}"` : ""} }. ` +
                  `Tell the user what you found. Skip to the next uncollected field (likely content upload).`;
              }
            } else if (sub.courses.length > 1) {
              const courseLines = sub.courses.map((c) =>
                `  - "${c.name}" (playbookId: ${c.id}${c.interactionPattern ? `, ${c.interactionPattern}` : ""})`
              ).join("\n");
              courseContext =
                `\nMULTIPLE COURSES for this subject:\n${courseLines}\n` +
                `Show as show_options for courseName (radio mode) with "Create new course" at the end.`;
            } else {
              courseContext = "\nNo existing courses for this subject — ask for course name next.";
            }

            // Only auto-inject the existing course if user didn't name a different one
            const shouldAutoInjectCourse = sub.courses.length === 1 &&
              !(userCourseName && sub.courses[0].name.toLowerCase() !== userCourseName.toLowerCase());
            return {
              ...base,
              autoInjectFields: shouldAutoInjectCourse ? {
                draftPlaybookId: sub.courses[0].id,
                courseName: sub.courses[0].name,
                ...(sub.courses[0].interactionPattern ? { interactionPattern: sub.courses[0].interactionPattern } : {}),
              } : undefined,
              content:
                `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
                `AUTO-COMMIT SUBJECT: "${sub.name}" (subjectId: ${sub.id}). ` +
                `Tell the user: "Found ${sub.name}."` +
                courseContext,
            };
          }
          // Multiple subject matches — show options
          const optionLines = resolved.subjects.map((s) =>
            `  - "${s.name}" (subjectId: ${s.id}, ${s.courses.length} course${s.courses.length !== 1 ? "s" : ""})`
          ).join("\n");
          return {
            ...base,
            content:
              `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
              `MULTIPLE SUBJECT MATCHES:\n${optionLines}\n` +
              `Show as show_options for subjectDiscipline (radio mode) with "Add new subject" at the end.`,
          };
        }
      }

      return { ...base, content: `Saved ${keys.length} field(s): ${keys.join(", ")}. Continue the conversation.` };
    }

    case "show_options":
    case "show_sliders":
    case "show_actions": {
      return { ...base, content: `Panel displayed to user. Wait for their response.` };
    }

    case "show_upload": {
      // Safety net: auto-create institution if domainId is missing but we have enough data.
      // This handles the case where the AI skips create_institution before the content phase.
      const existingDomainId = (setupData?.existingDomainId || setupData?.draftDomainId) as string | undefined;
      if (!existingDomainId && setupData?.institutionName) {
        try {
          const name = setupData.institutionName as string;

          // 1. Check if it already exists (maybe created earlier in a different turn)
          const resolved = await resolveInstitutionByName(name);
          if (resolved) {
            return {
              ...base,
              autoInjectFields: {
                existingDomainId: resolved.domainId,
                existingInstitutionId: resolved.institutionId,
                defaultDomainKind: resolved.domainKind,
              },
              content: "Teaching Materials panel is visible in the right column. Guide the user to drop files there. Wait for their response.",
            };
          }

          // 2. Not found — create institution + domain on-the-fly
          const { prisma } = await import("@/lib/prisma");
          const slugify = (await import("slugify")).default;
          const typeSlug = setupData.typeSlug as string | undefined;

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

          const institution = await prisma.institution.create({
            data: {
              name,
              slug: slugify(name, { lower: true, strict: true }),
              ...(typeId ? { typeId } : {}),
            },
          });

          const domain = await prisma.domain.create({
            data: {
              name,
              slug: slugify(name, { lower: true, strict: true }),
              institutionId: institution.id,
              kind: domainKind,
            },
          });

          await prisma.user.update({
            where: { id: userId },
            data: { activeInstitutionId: institution.id },
          });

          console.log(`[wizard-tools] Auto-created institution "${name}" (${institution.id}) + domain (${domain.id}) for show_upload`);

          return {
            ...base,
            autoInjectFields: {
              draftDomainId: domain.id,
              draftInstitutionId: institution.id,
              defaultDomainKind: domainKind,
            },
            content: "Teaching Materials panel is visible in the right column. Guide the user to drop files there. Wait for their response.",
          };
        } catch (err) {
          console.error("[wizard-tools] Auto-create institution for show_upload failed:", err);
          // Fall through — show upload anyway, SourcesPanel will show a clear error
        }
      }
      return { ...base, content: `Teaching Materials panel is visible in the right column. Guide the user to drop files there. Wait for their response.` };
    }

    case "show_suggestions": {
      return { ...base, content: `Suggestion chips displayed to user. Wait for their response.` };
    }

    case "create_institution": {
      // Server-side: actually create the institution
      try {
        const { prisma } = await import("@/lib/prisma");
        const slugify = (await import("slugify")).default;

        const name = input.name as string;
        const typeSlug = input.typeSlug as string | undefined;

        // ── Guard: if institution already exists (setupData or name match), return it ──
        // The AI sometimes calls create_institution even when update_setup already resolved one.
        const existingDomainId = validUuid(setupData?.existingDomainId);
        const existingInstitutionId = validUuid(setupData?.existingInstitutionId);
        if (existingDomainId && existingInstitutionId) {
          console.log(`[wizard-tools] create_institution: institution already resolved (${existingInstitutionId}), returning existing`);
          return {
            ...base,
            content: JSON.stringify({
              ok: true,
              institutionId: existingInstitutionId,
              domainId: existingDomainId,
              alreadyExisted: true,
            }),
          };
        }
        // Also check by name
        const resolved = await resolveInstitutionByName(name);
        if (resolved) {
          console.log(`[wizard-tools] create_institution: "${name}" already exists (${resolved.institutionId}), returning existing`);
          return {
            ...base,
            content: JSON.stringify({
              ok: true,
              institutionId: resolved.institutionId,
              domainId: resolved.domainId,
              alreadyExisted: true,
            }),
          };
        }

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

        // Create institution + domain + link user atomically
        const [institution, domain] = await prisma.$transaction(async (tx) => {
          const inst = await tx.institution.create({
            data: {
              name,
              slug: slugify(name, { lower: true, strict: true }),
              ...(typeId ? { typeId } : {}),
            },
          });

          const dom = await tx.domain.create({
            data: {
              name,
              slug: slugify(name, { lower: true, strict: true }),
              institutionId: inst.id,
              kind: domainKind,
            },
          });

          await tx.user.update({
            where: { id: userId },
            data: { activeInstitutionId: inst.id },
          });

          return [inst, dom] as const;
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
      // Server-side: full course creation with scaffolding (identity spec, playbook, system specs, publish, onboarding)
      try {
        const { prisma } = await import("@/lib/prisma");
        const { scaffoldDomain } = await import("@/lib/domain/scaffold");
        const { loadPersonaFlowPhases, loadPersonaArchetype, loadPersonaWelcomeTemplate } = await import("@/lib/domain/quick-launch");
        const { applyBehaviorTargets, behaviorTargetsFromPresets } = await import("@/lib/domain/agent-tuning");
        const { enrollCaller } = await import("@/lib/enrollment");
        const { randomFakeName } = await import("@/lib/fake-names");
        const slugify = (await import("slugify")).default;
        const { generateLessonPlan } = await import("@/lib/content-trust/lesson-planner");

        // ── Resolve domainId — validate AI input, prefer setupData truth ──
        // The AI frequently hallucinates domainId (slugs, prefixed IDs, etc.).
        // Always prefer setupData (set by update_setup from real DB lookups),
        // only use input.domainId if it's a real UUID AND setupData has nothing.
        let domainId = validUuid(setupData?.existingDomainId)
          || validUuid(setupData?.draftDomainId)
          || validUuid(input.domainId);

        // Last resort: if AI sent a slug/name, try to resolve it from the DB
        if (!domainId && input.domainId && typeof input.domainId === "string") {
          console.warn(`[wizard-tools] create_course: rejected invalid domainId from AI: "${input.domainId}" — attempting slug/name lookup`);
          const domain = await prisma.domain.findFirst({
            where: {
              OR: [
                { slug: input.domainId as string },
                { name: { equals: input.domainId as string, mode: "insensitive" } },
              ],
            },
            select: { id: true },
          });
          if (domain) {
            domainId = domain.id;
            console.log(`[wizard-tools] create_course: resolved slug/name "${input.domainId}" → ${domain.id}`);
          }
        }
        const courseName = input.courseName as string;
        const interactionPattern = input.interactionPattern as string;
        const subjectDiscipline = (input.subjectDiscipline as string) || courseName;
        const packSubjectIds = (input.packSubjectIds as string[] | undefined)
          || (setupData?.packSubjectIds as string[] | undefined);

        // ── Safety net: auto-create institution + domain if missing ──
        // Mirrors the show_upload safety net. The AI sometimes skips
        // create_institution and jumps straight to create_course.
        if (!domainId && setupData?.institutionName) {
          const name = setupData.institutionName as string;
          const resolved = await resolveInstitutionByName(name);
          if (resolved) {
            domainId = resolved.domainId;
          } else {
            const typeSlug = setupData.typeSlug as string | undefined;
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
            const institution = await prisma.institution.create({
              data: {
                name,
                slug: slugify(name, { lower: true, strict: true }),
                ...(typeId ? { typeId } : {}),
              },
            });
            const domain = await prisma.domain.create({
              data: {
                name,
                slug: slugify(name, { lower: true, strict: true }),
                institutionId: institution.id,
                kind: domainKind,
              },
            });
            await prisma.user.update({
              where: { id: userId },
              data: { activeInstitutionId: institution.id },
            });
            domainId = domain.id;
            console.log(`[wizard-tools] Auto-created institution "${name}" (${institution.id}) + domain (${domain.id}) for create_course`);
          }
        }

        if (!domainId) {
          return {
            ...base,
            content: JSON.stringify({
              ok: false,
              error: "No institution set up yet. Ask the user for their organisation name first, then retry.",
            }),
            is_error: true,
          };
        }

        // ── Guard: existing course resolved via entity resolution ──
        // If draftPlaybookId is already set, skip scaffolding — just apply config tweaks
        // and create a test caller enrolled in the existing course.
        // BUT: if the user explicitly named a different course, ignore the draftPlaybookId
        // and create a brand new course with their chosen name.
        let existingPlaybookId = setupData?.draftPlaybookId as string | undefined;
        if (existingPlaybookId && courseName) {
          const existingPbName = await prisma.playbook.findUnique({
            where: { id: existingPlaybookId },
            select: { name: true },
          });
          if (existingPbName && existingPbName.name.toLowerCase() !== courseName.toLowerCase()) {
            console.log(`[wizard-tools] create_course: user named course "${courseName}" but draftPlaybookId points to "${existingPbName.name}" — creating new course instead`);
            existingPlaybookId = undefined;
          }
        }
        if (existingPlaybookId) {
          const existingPb = await prisma.playbook.findUnique({
            where: { id: existingPlaybookId },
            select: { id: true, domainId: true, config: true },
          });

          if (existingPb) {
            // Apply any config updates the user changed during the wizard
            const existingConfig = (existingPb.config as Record<string, unknown>) || {};
            const configUpdate: Record<string, unknown> = { ...existingConfig };
            if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
            if (input.teachingMode) configUpdate.teachingMode = input.teachingMode;
            if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
            if (input.welcomeMessage) configUpdate.welcomeMessage = input.welcomeMessage;
            if (input.sessionCount) configUpdate.sessionCount = Number(input.sessionCount);
            if (input.durationMins) configUpdate.durationMins = Number(input.durationMins);
            if (input.planEmphasis) configUpdate.planEmphasis = input.planEmphasis;
            if (input.audience) configUpdate.audience = input.audience;
            if (input.lessonPlanModel) configUpdate.lessonPlanModel = input.lessonPlanModel;
            if (input.physicalMaterials) configUpdate.physicalMaterials = input.physicalMaterials;

            await prisma.playbook.update({
              where: { id: existingPlaybookId },
              data: { config: JSON.parse(JSON.stringify(configUpdate)) },
            });

            // Apply behavior targets if provided
            const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
            if (behaviorTargets && Object.keys(behaviorTargets).length > 0) {
              await applyBehaviorTargets(existingPlaybookId, behaviorTargets);
            }

            // Apply welcome message to domain
            const resolvedDomainId = existingPb.domainId || domainId;
            if (input.welcomeMessage && resolvedDomainId) {
              await prisma.domain.update({
                where: { id: resolvedDomainId },
                data: { onboardingWelcome: input.welcomeMessage as string },
              });
            }

            // If test caller already exists, return it (no duplicates)
            const existingCallerId = setupData?.draftCallerId as string | undefined;
            if (existingCallerId) {
              return {
                ...base,
                content: JSON.stringify({
                  ok: true,
                  playbookId: existingPlaybookId,
                  callerId: existingCallerId,
                  existingCourse: true,
                }),
              };
            }

            // Ensure the wizard user has a TEACHER Caller (needed for educator dashboard)
            const existingTeacher = await prisma.caller.findFirst({
              where: { userId, domainId: resolvedDomainId, role: "TEACHER" },
              select: { id: true },
            });
            if (!existingTeacher) {
              const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { name: true, email: true },
              });
              await prisma.caller.create({
                data: {
                  name: user?.name || "Educator",
                  email: user?.email || undefined,
                  role: "TEACHER",
                  userId,
                  domainId: resolvedDomainId,
                },
              });
            }

            // Create test caller enrolled in existing course
            const callerName = randomFakeName();
            const caller = await prisma.caller.create({
              data: { name: callerName, domainId: resolvedDomainId },
            });
            await enrollCaller(caller.id, existingPlaybookId, "wizard-v2");

            // Instantiate Goal records for the test caller from config.goals
            const existingGoals = (existingConfig.goals as Array<{ type: string; name: string; description?: string; isAssessmentTarget?: boolean; assessmentConfig?: any; priority?: number }>) || [];
            for (const g of existingGoals) {
              await prisma.goal.create({
                data: {
                  callerId: caller.id,
                  playbookId: existingPlaybookId,
                  type: g.type || "LEARN",
                  name: g.name,
                  description: g.description || null,
                  isAssessmentTarget: g.isAssessmentTarget || false,
                  assessmentConfig: g.assessmentConfig || undefined,
                  status: "ACTIVE",
                  priority: g.priority || 5,
                  startedAt: new Date(),
                },
              });
            }

            // Auto-generate curriculum if existing playbook has none (non-blocking)
            const { generateInstantCurriculum: genCurriculum } = await import("@/lib/domain/instant-curriculum");
            genCurriculum({
              domainId: resolvedDomainId,
              playbookId: existingPlaybookId,
              subjectName: subjectDiscipline,
              persona: interactionPattern,
              subjectIds: packSubjectIds,
              intents: {
                sessionCount: input.sessionCount ? Number(input.sessionCount) : undefined,
                durationMins: input.durationMins ? Number(input.durationMins) : undefined,
                emphasis: input.planEmphasis as string | undefined,
              },
            }).catch(err => console.error("[wizard] Instant curriculum (existing) failed (non-fatal):", err.message));

            // Resolve primary subject for the existing playbook
            const existingPbSubject = await prisma.playbookSubject.findFirst({
              where: { playbookId: existingPlaybookId },
              select: { subjectId: true },
            });

            // Backfill teachMethod on assertions extracted before teachingMode was set
            const resolvedTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
            if (resolvedTeachingMode) {
              const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
              backfillTeachMethods(existingPlaybookId).catch(err =>
                console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
            }

            // Generate real lesson plan from content sources (if available)
            const existingLessonPlanPreview = await generateLessonPlanPreview(
              prisma, packSubjectIds, existingPbSubject?.subjectId,
              input.sessionCount ? Number(input.sessionCount) : undefined,
              input.durationMins ? Number(input.durationMins) : undefined,
            );

            return {
              ...base,
              content: JSON.stringify({
                ok: true,
                playbookId: existingPlaybookId,
                callerId: caller.id,
                callerName,
                existingCourse: true,
                lessonPlanPreview: existingLessonPlanPreview,
              }),
            };
          }
          // Playbook was deleted — fall through to normal creation
        }

        // 1. Create or find Subject
        const subjectSlug = slugify(subjectDiscipline, { lower: true, strict: true });
        let subject = await prisma.subject.findFirst({ where: { slug: subjectSlug } });
        if (!subject) {
          subject = await prisma.subject.create({
            data: { slug: subjectSlug, name: subjectDiscipline, isActive: true },
          });
        }

        // 2. Link Subject → Domain
        const existingSubjectLink = await prisma.subjectDomain.findFirst({
          where: { subjectId: subject.id, domainId },
        });
        if (!existingSubjectLink) {
          await prisma.subjectDomain.create({
            data: { subjectId: subject.id, domainId },
          });
        }

        // 3. Resolve archetype + flow phases from interaction pattern
        const archetypeSlug = await loadPersonaArchetype(interactionPattern);
        const flowPhases = await loadPersonaFlowPhases(interactionPattern);

        // 4. Scaffold domain (identity spec + playbook + system specs + publish + onboarding)
        const scaffoldResult = await scaffoldDomain(domainId, {
          extendsAgent: archetypeSlug || undefined,
          flowPhases: flowPhases || undefined,
          forceNewPlaybook: true,
          playbookName: courseName,
        });

        if (!scaffoldResult.playbook) {
          throw new Error("Scaffold failed to create playbook");
        }

        const playbookId = scaffoldResult.playbook.id;

        // 5. Store config in playbook
        const pb = await prisma.playbook.findUnique({
          where: { id: playbookId },
          select: { config: true },
        });
        const existingConfig = (pb?.config as Record<string, unknown>) || {};
        const configUpdate: Record<string, unknown> = { ...existingConfig };
        if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
        if (input.teachingMode) configUpdate.teachingMode = input.teachingMode;
        if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
        if (input.welcomeMessage) configUpdate.welcomeMessage = input.welcomeMessage;
        if (input.sessionCount) configUpdate.sessionCount = Number(input.sessionCount);
        if (input.durationMins) configUpdate.durationMins = Number(input.durationMins);
        if (input.planEmphasis) configUpdate.planEmphasis = input.planEmphasis;
        if (input.audience) configUpdate.audience = input.audience;
        if (input.lessonPlanModel) configUpdate.lessonPlanModel = input.lessonPlanModel;
        if (input.physicalMaterials) configUpdate.physicalMaterials = input.physicalMaterials;
        if (input.courseContext) configUpdate.courseContext = input.courseContext;
        if (input.constraints) configUpdate.constraints = input.constraints;
        // Map assessment targets into goal templates
        if (input.assessmentTargets) {
          const existingGoals = (configUpdate.goals as any[]) || [];
          const newAssessmentGoals = (input.assessmentTargets as string[]).map((t: string) => ({
            type: "ACHIEVE",
            name: t,
            isAssessmentTarget: true,
            isDefault: true,
            priority: 8,
          }));
          configUpdate.goals = [
            ...existingGoals.filter((g: any) => !g.isAssessmentTarget),
            ...newAssessmentGoals,
          ];
        }
        // Map learning outcomes into LEARN goals (from wizard or setupData)
        const learningOutcomes = (input.learningOutcomes as string[])
          || (setupData?.learningOutcomes as string[]);
        if (learningOutcomes && learningOutcomes.length > 0) {
          const existingGoals = (configUpdate.goals as any[]) || [];
          const existingNames = new Set(existingGoals.map((g: any) => g.name?.toLowerCase().trim()));
          const newLOGoals = learningOutcomes
            .filter((lo: string) => !existingNames.has(lo.toLowerCase().trim()))
            .map((lo: string) => ({
              type: "LEARN",
              name: lo,
              isDefault: true,
              priority: 5,
            }));
          if (newLOGoals.length > 0) {
            configUpdate.goals = [...existingGoals, ...newLOGoals];
          }
        }

        await prisma.playbook.update({
          where: { id: playbookId },
          data: { config: JSON.parse(JSON.stringify(configUpdate)) },
        });

        // 6. Link Subject → Playbook
        await prisma.playbookSubject.upsert({
          where: { playbookId_subjectId: { playbookId, subjectId: subject.id } },
          update: {},
          create: { playbookId, subjectId: subject.id },
        });

        // 7. Link content-upload subjects from PackUploadStep (if any)
        //    Fallback: if AI didn't pass packSubjectIds, auto-discover content
        //    subjects already on this domain and link them to the new playbook.
        let subjectIdsToLink = packSubjectIds ?? [];
        if (subjectIdsToLink.length === 0 && domainId) {
          const domainSubjects = await prisma.subjectDomain.findMany({
            where: { domainId },
            select: { subjectId: true },
          });
          const withSources = await prisma.subjectSource.findMany({
            where: { subjectId: { in: domainSubjects.map(ds => ds.subjectId) } },
            select: { subjectId: true },
            distinct: ["subjectId"],
          });
          subjectIdsToLink = withSources
            .map(ss => ss.subjectId)
            .filter(id => id !== subject.id);
        }
        for (const packSubId of subjectIdsToLink) {
          await prisma.playbookSubject.upsert({
            where: { playbookId_subjectId: { playbookId, subjectId: packSubId } },
            update: {},
            create: { playbookId, subjectId: packSubId },
          });
          const domainLink = await prisma.subjectDomain.findFirst({
            where: { subjectId: packSubId, domainId },
          });
          if (!domainLink) {
            await prisma.subjectDomain.create({
              data: { subjectId: packSubId, domainId },
            });
          }
        }

        // 8. Configure onboarding (welcome message + behavior targets)
        const resolvedWelcome = (input.welcomeMessage as string)
          || await loadPersonaWelcomeTemplate(interactionPattern)
          || null;

        const domainUpdate: Record<string, unknown> = {};
        if (resolvedWelcome) domainUpdate.onboardingWelcome = resolvedWelcome;

        const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
        const personalityPreset = input.personalityPreset as string | undefined;
        const resolvedTargets =
          (behaviorTargets && Object.keys(behaviorTargets).length > 0)
            ? behaviorTargets
            : personalityPreset
              ? behaviorTargetsFromPresets(personalityPreset)
              : undefined;
        if (resolvedTargets && Object.keys(resolvedTargets).length > 0) {
          const wrapped: Record<string, { value: number; confidence: number }> = {};
          for (const [paramId, value] of Object.entries(resolvedTargets)) {
            wrapped[paramId] = { value, confidence: 0.5 };
          }
          domainUpdate.onboardingDefaultTargets = wrapped;
          await applyBehaviorTargets(playbookId, resolvedTargets);
        }

        if (Object.keys(domainUpdate).length > 0) {
          await prisma.domain.update({ where: { id: domainId }, data: domainUpdate });
        }

        // 8b. Wire student-visible media into onboarding flow phases
        //     So the AI proactively shares materials during the first call,
        //     and the educator can see/edit attachments in the First Call Preview.
        const allSubjectIds = [subject.id, ...subjectIdsToLink];
        const { isStudentVisibleDefault } = await import("@/lib/doc-type-icons");
        const studentMedia = await prisma.subjectMedia.findMany({
          where: { subjectId: { in: allSubjectIds } },
          include: {
            media: {
              select: {
                id: true, fileName: true, title: true, mimeType: true,
                source: { select: { documentType: true } },
              },
            },
          },
          orderBy: { sortOrder: "asc" },
          take: 20,
        });
        const visibleMedia = studentMedia.filter(
          (sm) => sm.media.source?.documentType && isStudentVisibleDefault(sm.media.source.documentType),
        );

        // Build a lookup for filenames (used later in result)
        const mediaLookup = new Map<string, { fileName: string; title: string | null }>();
        for (const sm of visibleMedia) {
          mediaLookup.set(sm.media.id, { fileName: sm.media.fileName, title: sm.media.title });
        }

        let finalFlowPhases: any = null;
        if (visibleMedia.length > 0) {
          const domainRow = await prisma.domain.findUnique({
            where: { id: domainId },
            select: { onboardingFlowPhases: true },
          });
          const flowConfig = domainRow?.onboardingFlowPhases as { phases?: Array<{ phase: string; duration: string; goals: string[]; content?: Array<{ mediaId: string; instruction?: string }> }> } | null;
          if (flowConfig?.phases?.length) {
            // Find the first content-bearing phase
            const contentIdx = flowConfig.phases.findIndex(
              (p) => /topic|teach|content|practice|reading/i.test(p.phase),
            );
            const targetIdx = contentIdx >= 0 ? contentIdx : 0;
            const updatedPhases = flowConfig.phases.map((phase, i) => {
              if (i !== targetIdx) return phase;
              return {
                ...phase,
                content: visibleMedia.map((sm) => ({
                  mediaId: sm.media.id,
                  instruction: "Share this with the learner when introducing the topic",
                })),
              };
            });
            finalFlowPhases = { phases: updatedPhases };
            await prisma.domain.update({
              where: { id: domainId },
              data: { onboardingFlowPhases: finalFlowPhases },
            });
          }
        }

        // 9a. Ensure the wizard user has a TEACHER Caller (needed for educator dashboard)
        const existingTeacher = await prisma.caller.findFirst({
          where: { userId, domainId, role: "TEACHER" },
          select: { id: true },
        });
        if (!existingTeacher) {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, email: true },
          });
          await prisma.caller.create({
            data: {
              name: user?.name || "Educator",
              email: user?.email || undefined,
              role: "TEACHER",
              userId,
              domainId,
            },
          });
        }

        // 9b. Create test caller with proper enrollment
        const callerName = randomFakeName();

        const caller = await prisma.caller.create({
          data: { name: callerName, domainId },
        });

        await enrollCaller(caller.id, playbookId, "wizard-v2");

        // 9c. Instantiate Goal records for the test caller from config.goals
        const callerGoals = (configUpdate.goals as Array<{ type: string; name: string; description?: string; isAssessmentTarget?: boolean; assessmentConfig?: any; priority?: number }>) || [];
        for (const g of callerGoals) {
          await prisma.goal.create({
            data: {
              callerId: caller.id,
              playbookId,
              type: g.type || "LEARN",
              name: g.name,
              description: g.description || null,
              isAssessmentTarget: g.isAssessmentTarget || false,
              assessmentConfig: g.assessmentConfig || undefined,
              status: "ACTIVE",
              priority: g.priority || 5,
              startedAt: new Date(),
            },
          });
        }

        // 10. Backfill teachMethod on assertions extracted before teachingMode was set
        const resolvedTeachingModeNew = (input.teachingMode as string) || (setupData?.teachingMode as string);
        if (resolvedTeachingModeNew) {
          const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
          backfillTeachMethods(playbookId).catch(err =>
            console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
        }

        // 11. Auto-generate curriculum (non-blocking, fire-and-forget)
        const { generateInstantCurriculum } = await import("@/lib/domain/instant-curriculum");
        generateInstantCurriculum({
          domainId,
          playbookId,
          subjectName: subjectDiscipline,
          persona: interactionPattern,
          subjectIds: subjectIdsToLink.length > 0 ? subjectIdsToLink : packSubjectIds,
          intents: {
            sessionCount: input.sessionCount ? Number(input.sessionCount) : undefined,
            durationMins: input.durationMins ? Number(input.durationMins) : undefined,
            emphasis: input.planEmphasis as string | undefined,
          },
        }).catch(err => console.error("[wizard] Instant curriculum failed (non-fatal):", err.message));

        // Generate real lesson plan from content sources (with IDs for session-scoped content)
        const lessonPlanPreview = await generateLessonPlanPreview(
          prisma, subjectIdsToLink.length > 0 ? subjectIdsToLink : packSubjectIds, subject.id,
          input.sessionCount ? Number(input.sessionCount) : undefined,
          input.durationMins ? Number(input.durationMins) : undefined,
        );

        // Build first call preview data (phases + resolved media filenames)
        const previewDomain = await prisma.domain.findUnique({
          where: { id: domainId },
          select: { onboardingWelcome: true, onboardingFlowPhases: true },
        });
        const previewPhases = (previewDomain?.onboardingFlowPhases as { phases?: any[] } | null)?.phases || [];
        const firstCallPreview = {
          domainId,
          playbookId,
          welcomeMessage: previewDomain?.onboardingWelcome || resolvedWelcome || null,
          phases: previewPhases.map((p: any) => ({
            phase: p.phase,
            duration: p.duration,
            goals: p.goals || [],
            content: (p.content || []).map((c: any) => {
              const info = mediaLookup.get(c.mediaId);
              return {
                mediaId: c.mediaId,
                fileName: info?.fileName || "Unknown file",
                title: info?.title || null,
                instruction: c.instruction,
              };
            }),
          })),
        };

        return {
          ...base,
          content: JSON.stringify({
            ok: true,
            domainId,
            playbookId,
            callerId: caller.id,
            callerName,
            lessonPlanPreview,
            firstCallPreview,
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

    case "create_community": {
      // Server-side: create a community hub (domain, identity, cohort group)
      // Reuses the same logic as POST /api/communities but called from wizard context
      try {
        const { prisma } = await import("@/lib/prisma");
        const { scaffoldDomain } = await import("@/lib/domain/scaffold");
        const { loadPersonaFlowPhases, loadPersonaWelcomeTemplate } = await import("@/lib/domain/quick-launch");
        const { config } = await import("@/lib/config");
        const crypto = await import("crypto");

        const hubName = input.hubName as string;
        const hubDescription = (input.hubDescription as string) || "";
        const communityMode = input.communityMode as "attached" | "standalone";
        const hubPattern = (input.hubPattern as string) || "conversational-guide";
        const communityKind = (input.communityKind as string) || "OPEN_CONNECTION";
        const topics = (input.topics as Array<{ name: string; pattern?: string }>) || [];
        const welcomeMessage = (input.welcomeMessage as string) || null;

        // Resolve institutionId based on mode
        let institutionId: string | null = null;
        if (communityMode === "attached") {
          // Use the institution from setupData or user's active institution
          institutionId = (setupData?.existingInstitutionId as string)
            || (await prisma.user.findUnique({ where: { id: userId }, select: { activeInstitutionId: true } }))?.activeInstitutionId
            || null;
        }

        // Generate slug
        const baseSlug = hubName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60);
        const existing = await prisma.domain.findMany({
          where: { slug: { startsWith: baseSlug } },
          select: { slug: true },
        });
        const slugs = new Set(existing.map((d: { slug: string }) => d.slug));
        let slug = baseSlug;
        let counter = 2;
        while (slugs.has(slug)) {
          slug = `${baseSlug}-${counter++}`;
        }

        // Resolve archetype from pattern
        const PATTERN_ARCHETYPE: Record<string, string> = {
          companion: config.specs.companionArchetype,
          advisory: config.specs.advisorArchetype,
          coaching: config.specs.coachArchetype,
          socratic: config.specs.defaultArchetype,
          facilitation: config.specs.facilitatorArchetype,
          reflective: config.specs.mentorArchetype,
          open: config.specs.companionArchetype,
          directive: config.specs.defaultArchetype,
          "conversational-guide": config.specs.convguideArchetype,
        };
        const archetype = PATTERN_ARCHETYPE[hubPattern] || config.specs.convguideArchetype;

        // Build domain config
        const domainConfig: Record<string, unknown> = { communityKind };
        if (communityKind === "OPEN_CONNECTION" && hubPattern) {
          domainConfig.hubPattern = hubPattern;
        }

        // Resolve operator's Caller ID
        let operatorCaller = await prisma.caller.findFirst({
          where: { userId },
          select: { id: true },
        });

        const joinToken = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

        const { domain: community, cohortGroupId } = await prisma.$transaction(async (tx: any) => {
          const domain = await tx.domain.create({
            data: {
              name: hubName.trim(),
              slug,
              description: hubDescription.trim() || null,
              kind: "COMMUNITY",
              config: domainConfig,
              institutionId,
            },
          });

          // Create topic playbooks
          if (communityKind === "TOPIC_BASED" && topics.length > 0) {
            for (let i = 0; i < topics.length; i++) {
              const topic = topics[i];
              if (!topic?.name?.trim()) continue;
              await tx.playbook.create({
                data: {
                  name: topic.name.trim(),
                  domainId: domain.id,
                  sortOrder: i + 1,
                  status: "PUBLISHED",
                  config: { interactionPattern: topic.pattern || hubPattern },
                },
              });
            }
          }

          // Create operator caller if needed
          if (!operatorCaller) {
            const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
            operatorCaller = await tx.caller.create({
              data: {
                name: user?.name || "Operator",
                email: user?.email || undefined,
                role: "TEACHER",
                userId,
                domainId: domain.id,
              },
              select: { id: true },
            });
          }

          // Create CohortGroup with join token
          const cohortGroup = await tx.cohortGroup.create({
            data: {
              name: hubName.trim(),
              domainId: domain.id,
              ownerId: operatorCaller!.id,
              joinToken,
              institutionId,
            },
          });

          // Link topic playbooks to CohortGroup
          const topicPlaybooks = await tx.playbook.findMany({
            where: { domainId: domain.id, status: "PUBLISHED" },
            select: { id: true },
          });
          if (topicPlaybooks.length > 0) {
            await tx.cohortPlaybook.createMany({
              data: topicPlaybooks.map((pb: { id: string }) => ({
                cohortGroupId: cohortGroup.id,
                playbookId: pb.id,
              })),
              skipDuplicates: true,
            });
          }

          return { domain, cohortGroupId: cohortGroup.id };
        });

        // Resolve persona-specific flow phases (same as create_course)
        const flowPhases = await loadPersonaFlowPhases(hubPattern);

        // Scaffold domain — creates identity spec, main playbook
        const scaffoldResult = await scaffoldDomain(community.id, {
          playbookName: hubName.trim(),
          extendsAgent: archetype,
          flowPhases: flowPhases || undefined,
          forceNewPlaybook: communityKind === "TOPIC_BASED" && topics.length > 0,
        });

        // Resolve welcome message: explicit → persona template → null
        const resolvedWelcome = welcomeMessage
          || await loadPersonaWelcomeTemplate(hubPattern)
          || null;

        // Persist welcome message to domain
        if (resolvedWelcome) {
          await prisma.domain.update({
            where: { id: community.id },
            data: { onboardingWelcome: resolvedWelcome },
          });
        }

        // Link scaffold-created playbooks to CohortGroup
        const allPlaybooks = await prisma.playbook.findMany({
          where: { domainId: community.id, status: "PUBLISHED" },
          select: { id: true },
        });
        if (allPlaybooks.length > 0) {
          await prisma.cohortPlaybook.createMany({
            data: allPlaybooks.map((pb: { id: string }) => ({
              cohortGroupId,
              playbookId: pb.id,
            })),
            skipDuplicates: true,
          });
        }

        // Build firstCallPreview — uses scaffold's main playbook ID
        // (community hubs have no media, so content[] is empty on all phases)
        const previewDomain = await prisma.domain.findUnique({
          where: { id: community.id },
          select: { onboardingWelcome: true, onboardingFlowPhases: true },
        });
        const previewPhases = (previewDomain?.onboardingFlowPhases as { phases?: any[] } | null)?.phases || [];
        const mainPlaybookId = scaffoldResult.playbook?.id || allPlaybooks[0]?.id || "";
        const firstCallPreview = {
          domainId: community.id,
          playbookId: mainPlaybookId,
          welcomeMessage: previewDomain?.onboardingWelcome || null,
          phases: previewPhases.map((p: any) => ({
            phase: p.phase,
            duration: p.duration,
            goals: p.goals || [],
            content: [], // No media for community hubs
          })),
        };

        return {
          ...base,
          content: JSON.stringify({
            ok: true,
            domainId: community.id,
            playbookId: mainPlaybookId,
            cohortGroupId,
            joinToken,
            communityMode,
            hubUrl: `/x/communities/${community.id}`,
            firstCallPreview,
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

    case "update_course_config": {
      // Server-side: persist config changes to an existing course (post-creation tweaks)
      try {
        const { prisma } = await import("@/lib/prisma");
        const { applyBehaviorTargets } = await import("@/lib/domain/agent-tuning");

        const domainId = validUuid(input.domainId)
          || validUuid(setupData?.existingDomainId)
          || validUuid(setupData?.draftDomainId);
        const playbookId = validUuid(input.playbookId)
          || validUuid(setupData?.draftPlaybookId);

        if (!domainId || !playbookId) {
          return {
            ...base,
            content: JSON.stringify({ ok: false, error: "Invalid domainId or playbookId. Use the IDs from create_course result." }),
            is_error: true,
          };
        }

        // 1. Persist welcome message to Domain
        const welcomeMessage = input.welcomeMessage as string | undefined;
        if (welcomeMessage) {
          await prisma.domain.update({
            where: { id: domainId },
            data: { onboardingWelcome: welcomeMessage },
          });
        }

        // 2. Persist behavior targets to Domain + BehaviorTarget rows
        const behaviorTargets = input.behaviorTargets as Record<string, number> | undefined;
        if (behaviorTargets && Object.keys(behaviorTargets).length > 0) {
          const wrapped: Record<string, { value: number; confidence: number }> = {};
          for (const [paramId, value] of Object.entries(behaviorTargets)) {
            wrapped[paramId] = { value, confidence: 0.5 };
          }
          await prisma.domain.update({
            where: { id: domainId },
            data: { onboardingDefaultTargets: wrapped },
          });
          await applyBehaviorTargets(playbookId, behaviorTargets);
        }

        // 3. Persist onboarding flow phases to Domain (attachment changes)
        if (input.onboardingFlowPhases) {
          await prisma.domain.update({
            where: { id: domainId },
            data: { onboardingFlowPhases: JSON.parse(JSON.stringify(input.onboardingFlowPhases)) },
          });
        }

        // 4. Merge session settings + lesson plan into playbook config
        const pb = await prisma.playbook.findUnique({
          where: { id: playbookId },
          select: { config: true },
        });
        const existingConfig = (pb?.config as Record<string, unknown>) || {};
        const configUpdate: Record<string, unknown> = { ...existingConfig };

        if (input.sessionCount) configUpdate.sessionCount = Number(input.sessionCount);
        if (input.durationMins) configUpdate.durationMins = Number(input.durationMins);
        if (input.planEmphasis) configUpdate.planEmphasis = input.planEmphasis;
        if (input.lessonPlanModel) configUpdate.lessonPlanModel = input.lessonPlanModel;
        if (welcomeMessage) configUpdate.welcomeMessage = welcomeMessage;
        if (input.courseContext) configUpdate.courseContext = input.courseContext;

        await prisma.playbook.update({
          where: { id: playbookId },
          data: { config: JSON.parse(JSON.stringify(configUpdate)) },
        });

        return {
          ...base,
          content: JSON.stringify({ ok: true, message: "Course configuration updated" }),
        };
      } catch (err) {
        return {
          ...base,
          content: JSON.stringify({ ok: false, error: String(err) }),
          is_error: true,
        };
      }
    }

    case "suggest_welcome_message": {
      // Generate a template-based welcome message suggestion from course context.
      // V4 only — called after personality + content are captured.
      const courseName = (input.courseName as string) || (setupData?.courseName as string) || "this course";
      const subjectDiscipline = (input.subjectDiscipline as string) || (setupData?.subjectDiscipline as string) || "";
      const interactionPattern = (input.interactionPattern as string) || (setupData?.interactionPattern as string) || "";
      const physicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string) || "";

      const patternPhrase: Record<string, string> = {
        socratic: "guide you with questions to build your own understanding",
        directive: "walk you through each concept step by step",
        advisory: "offer guidance and perspective when you need it",
        coaching: "help you think through challenges and find your own answers",
        companion: "have a genuine, thoughtful conversation with you",
        facilitation: "guide our conversation around the topics that interest you",
        reflective: "help you reflect on what you're learning and why it matters",
        open: "work through this with you in whatever way feels right",
        "conversational-guide": "have a great conversation about the things that interest you",
      };
      const stylePhrase = patternPhrase[interactionPattern] || "work through this with you";
      const subjectClause = subjectDiscipline ? ` in ${subjectDiscipline}` : "";
      const materialsClause = physicalMaterials ? ` Have your ${physicalMaterials} nearby if you can.` : "";

      const isConvGuide = interactionPattern === "conversational-guide";
      const suggestion = isConvGuide
        ? `Hi! I'm really glad you called. I'm here to ${stylePhrase}. No agenda, no pressure — just a good chat. What's been on your mind lately?`
        : `Hi! I'm your tutor for ${courseName}${subjectClause}. I'm here to ${stylePhrase}.${materialsClause} What would you like to start with today?`;

      return {
        ...base,
        content: JSON.stringify({ ok: true, suggestion }),
      };
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

// ── Course resolution ───────────────────────────────────

interface ResolvedPlaybook {
  id: string;
  name: string;
  interactionPattern?: string;
}

interface CourseResolution {
  playbooks: ResolvedPlaybook[];
  /** true if single exact match or single partial match (auto-commit) */
  autoCommit: boolean;
}

/**
 * Look up existing courses (playbooks) in a domain by name.
 * Strategy: exact match first, then partial (contains) for 3+ char inputs.
 * Returns all candidates with auto-commit flag.
 */
async function resolveCourseByName(name: string, domainId: string): Promise<CourseResolution | null> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const selectClause = { id: true, name: true, config: true } as const;

    // 1. Try exact match
    const exact = await prisma.playbook.findFirst({
      where: { domainId, name: { equals: name, mode: "insensitive" } },
      select: selectClause,
    });
    if (exact) {
      const config = exact.config as Record<string, unknown> | null;
      return {
        playbooks: [{ id: exact.id, name: exact.name, interactionPattern: config?.interactionPattern as string | undefined }],
        autoCommit: true,
      };
    }

    // 2. Partial match (3+ chars)
    if (name.trim().length >= 3) {
      const candidates = await prisma.playbook.findMany({
        where: { domainId, name: { contains: name, mode: "insensitive" } },
        select: selectClause,
        take: 5,
      });
      if (candidates.length > 0) {
        const playbooks = candidates
          .sort((a, b) => a.name.length - b.name.length)
          .map((c) => {
            const config = c.config as Record<string, unknown> | null;
            return { id: c.id, name: c.name, interactionPattern: config?.interactionPattern as string | undefined };
          });
        return {
          playbooks,
          autoCommit: playbooks.length === 1,
        };
      }
    }

    return null;
  } catch (err) {
    console.warn("[wizard-tools] Course resolution failed:", err);
    return null;
  }
}

// ── Subject resolution ──────────────────────────────────

interface ResolvedSubjectMatch {
  id: string;
  name: string;
  /** Courses (playbooks) linked to this subject in this domain */
  courses: ResolvedPlaybook[];
}

interface SubjectResolution {
  subjects: ResolvedSubjectMatch[];
  /** true if single exact match or single partial match (auto-commit) */
  autoCommit: boolean;
}

/**
 * Look up existing subjects in a domain by name.
 * Strategy: exact match first, then partial (contains) for 3+ char inputs.
 * Scoped to domain via SubjectDomain join. Includes courses for each subject.
 */
async function resolveSubjectByName(name: string, domainId: string): Promise<SubjectResolution | null> {
  try {
    const { prisma } = await import("@/lib/prisma");

    const subjectSelect = {
      subject: {
        select: {
          id: true,
          name: true,
          playbooks: {
            where: { playbook: { domainId } },
            select: {
              playbook: { select: { id: true, name: true, config: true } },
            },
          },
        },
      },
    } as const;

    function toSubjectMatch(link: { subject: { id: string; name: string; playbooks: Array<{ playbook: { id: string; name: string; config: unknown } }> } }): ResolvedSubjectMatch {
      return {
        id: link.subject.id,
        name: link.subject.name,
        courses: link.subject.playbooks.map((ps) => {
          const config = ps.playbook.config as Record<string, unknown> | null;
          return { id: ps.playbook.id, name: ps.playbook.name, interactionPattern: config?.interactionPattern as string | undefined };
        }),
      };
    }

    // 1. Try exact match (domain-scoped via SubjectDomain)
    const exactLink = await prisma.subjectDomain.findFirst({
      where: { domainId, subject: { name: { equals: name, mode: "insensitive" } } },
      select: subjectSelect,
    });
    if (exactLink) {
      return {
        subjects: [toSubjectMatch(exactLink)],
        autoCommit: true,
      };
    }

    // 2. Partial match (3+ chars, domain-scoped)
    if (name.trim().length >= 3) {
      const candidateLinks = await prisma.subjectDomain.findMany({
        where: { domainId, subject: { name: { contains: name, mode: "insensitive" } } },
        select: subjectSelect,
        take: 5,
      });
      if (candidateLinks.length > 0) {
        const subjects = candidateLinks
          .sort((a, b) => a.subject.name.length - b.subject.name.length)
          .map(toSubjectMatch);
        return {
          subjects,
          autoCommit: subjects.length === 1,
        };
      }
    }

    return null;
  } catch (err) {
    console.warn("[wizard-tools] Subject resolution failed:", err);
    return null;
  }
}

// ── Lesson plan generation for create_course ────────────

/**
 * Generate a real lesson plan preview from content source assertions.
 *
 * If content sources have extracted assertions, calls generateLessonPlan
 * to produce sessions with assertionIds/vocabularyIds/questionIds,
 * creates a Curriculum record, and saves the plan to deliveryConfig.
 *
 * Falls back to a generic numbered preview if no assertions exist yet.
 */
async function generateLessonPlanPreview(
  prisma: any,
  packSubjectIds: string[] | undefined,
  primarySubjectId: string | undefined,
  sessionCount?: number,
  durationMins?: number,
): Promise<Array<{ session: number; label: string; type: string }>> {
  const fallbackCount = sessionCount || 6;
  const fallback = Array.from({ length: fallbackCount }, (_, i) => ({
    session: i + 1,
    label: `Session ${i + 1}`,
    type: i === 0 ? "introduction" : i === fallbackCount - 1 ? "review" : "lesson",
  }));

  // Need at least one subject with content sources
  const subjectIds = packSubjectIds?.length
    ? packSubjectIds
    : primarySubjectId
      ? [primarySubjectId]
      : [];

  // Helper: persist a lesson plan (fallback or real) to the curriculum
  async function persistPlanToCurriculum(
    planEntries: Array<{ session: number; label: string; type: string; [k: string]: any }>,
    generatedFrom: string,
  ) {
    const resolvedSubjectId = primarySubjectId || (subjectIds.length > 0 ? subjectIds[0] : null);
    if (!resolvedSubjectId) return;

    const subject = await prisma.subject.findUnique({
      where: { id: resolvedSubjectId },
      select: { id: true, slug: true, name: true },
    });
    if (!subject) return;

    const curriculumSlug = `${subject.slug}-curriculum`;
    const existingCurriculum = await prisma.curriculum.findFirst({
      where: { subjectId: subject.id },
      select: { id: true, deliveryConfig: true, notableInfo: true },
    });

    const lessonPlanData = {
      estimatedSessions: planEntries.length,
      entries: planEntries,
      generatedAt: new Date().toISOString(),
      generatedFrom,
    };

    const modulesFromPlan = planEntries.map((e, i) => ({
      id: `MOD-${i + 1}`,
      title: e.label,
      description: `${e.type} session`,
      sortOrder: i,
      learningOutcomes: (e.assertionIds || []).slice(0, 3).map((_: string, j: number) => `LO${j + 1}`),
    }));

    if (existingCurriculum) {
      const dc = (existingCurriculum.deliveryConfig as Record<string, any>) || {};
      // Don't overwrite a real plan with a fallback
      if (dc?.lessonPlan?.entries?.length && generatedFrom === "fallback-wizard") return;
      const ni = (existingCurriculum as any).notableInfo as Record<string, any> || {};
      await prisma.curriculum.update({
        where: { id: existingCurriculum.id },
        data: {
          deliveryConfig: { ...dc, lessonPlan: lessonPlanData },
          notableInfo: { ...ni, modules: modulesFromPlan },
        },
      });
    } else {
      await prisma.curriculum.create({
        data: {
          slug: curriculumSlug,
          name: `${subject.name} Curriculum`,
          subjectId: subject.id,
          deliveryConfig: { lessonPlan: lessonPlanData },
          notableInfo: { modules: modulesFromPlan },
          constraints: [],
        },
      });
    }

    // Sync modules to first-class DB records
    const curriculumId = existingCurriculum?.id
      || (await prisma.curriculum.findFirst({ where: { subjectId: subject.id }, select: { id: true } }))?.id;
    if (curriculumId && modulesFromPlan.length > 0) {
      try {
        const { syncModulesToDB } = await import("@/lib/curriculum/sync-modules");
        await syncModulesToDB(curriculumId, modulesFromPlan);
      } catch (syncErr: any) {
        console.warn("[wizard-tools] Module sync failed (non-fatal):", syncErr.message);
      }
    }
  }

  if (subjectIds.length === 0) {
    // No subjects — persist fallback so the course page shows sessions
    await persistPlanToCurriculum(
      fallback.map((f) => ({ ...f, moduleId: null, moduleLabel: "" })),
      "fallback-wizard",
    ).catch(() => {}); // non-fatal
    return fallback;
  }

  try {
    // Find content sources linked to these subjects
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId: { in: subjectIds } },
      select: { sourceId: true, subjectId: true },
    });

    if (subjectSources.length === 0) {
      await persistPlanToCurriculum(
        fallback.map((f) => ({ ...f, moduleId: null, moduleLabel: "" })),
        "fallback-wizard",
      ).catch(() => {});
      return fallback;
    }

    const sourceIds = subjectSources.map((ss: any) => ss.sourceId);

    // Quick check: are assertions ready? The SourcesPanel waits for extraction
    // to complete before signalling Phase 4a, so normally assertions exist by now.
    // If not (fast user, slow extraction), try twice with a short wait, then fall back.
    // The fallback plan is still useful — the course page's "Regenerate" button
    // will work (we always populate notableInfo.modules), and the session-assertions
    // API will pick up assertions whenever extraction finishes.
    let assertionCount = await prisma.contentAssertion.count({
      where: { sourceId: { in: sourceIds } },
    });
    if (assertionCount === 0) {
      // One brief retry — 3s is enough for the tail end of extraction
      await new Promise((r) => setTimeout(r, 3000));
      assertionCount = await prisma.contentAssertion.count({
        where: { sourceId: { in: sourceIds } },
      });
    }

    if (assertionCount === 0) {
      await persistPlanToCurriculum(
        fallback.map((f) => ({ ...f, moduleId: null, moduleLabel: "" })),
        "fallback-wizard",
      ).catch(() => {});
      return fallback;
    }

    // Generate lesson plan from all content sources (not just the first)
    const { generateLessonPlan } = await import("@/lib/content-trust/lesson-planner");

    // Find the source with the most assertions for primary plan generation
    const sourceCounts = await prisma.contentAssertion.groupBy({
      by: ["sourceId"],
      where: { sourceId: { in: sourceIds } },
      _count: true,
      orderBy: { _count: { sourceId: "desc" } },
    });
    const primarySourceId = sourceCounts[0]?.sourceId || sourceIds[0];

    const plan = await generateLessonPlan(primarySourceId, {
      targetSessionCount: sessionCount,
      sessionLength: durationMins || 30,
      skipAIRefinement: true,
    });

    if (plan.sessions.length === 0) {
      await persistPlanToCurriculum(
        fallback.map((f) => ({ ...f, moduleId: null, moduleLabel: "" })),
        "fallback-wizard",
      ).catch(() => {});
      return fallback;
    }

    // Map LessonSession[] → LessonPlanEntry[] format
    const entries = plan.sessions.map((s) => ({
      session: s.sessionNumber,
      type: s.sessionType,
      moduleId: null,
      moduleLabel: "",
      label: s.title,
      estimatedDurationMins: s.estimatedMinutes,
      assertionIds: [...(s.assertionIds || [])],
      vocabularyIds: [...(s.vocabularyIds || [])],
      questionIds: [...(s.questionIds || [])],
      ...(s.media?.length ? { media: s.media } : {}),
    }));

    // Distribute assertions from secondary sources across sessions (round-robin).
    // The primary source's assertions are already assigned; this adds content from
    // any additional uploaded files so they don't all land in "unassigned".
    const secondarySourceIds = sourceIds.filter((id: string) => id !== primarySourceId);
    if (secondarySourceIds.length > 0) {
      const secondaryAssertions = await prisma.contentAssertion.findMany({
        where: { sourceId: { in: secondarySourceIds } },
        select: { id: true },
        orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
      });
      // Distribute round-robin across non-onboarding sessions
      const teachingSessions = entries.filter((e) => !["onboarding", "introduction"].includes(e.type));
      const target = teachingSessions.length > 0 ? teachingSessions : entries;
      for (let i = 0; i < secondaryAssertions.length; i++) {
        const session = target[i % target.length];
        session.assertionIds.push(secondaryAssertions[i].id);
      }
    }

    // Persist the real plan to the curriculum
    await persistPlanToCurriculum(entries, "auto-wizard");

    // ── Resolve content text for preview ──────────────
    const allAssertionIds = entries.flatMap((e) => e.assertionIds || []);
    const allVocabIds = entries.flatMap((e) => e.vocabularyIds || []);
    const allQuestionIds = entries.flatMap((e) => e.questionIds || []);

    const [assertions, vocabs, questionCount] = await Promise.all([
      allAssertionIds.length > 0
        ? prisma.contentAssertion.findMany({
            where: { id: { in: allAssertionIds } },
            select: { id: true, assertion: true },
          })
        : [],
      allVocabIds.length > 0
        ? prisma.contentVocabulary.findMany({
            where: { id: { in: allVocabIds } },
            select: { id: true, term: true },
          })
        : [],
      allQuestionIds.length > 0
        ? prisma.contentQuestion.count({
            where: { id: { in: allQuestionIds } },
          })
        : 0,
    ]);

    const assertionMap = new Map(assertions.map((a: any) => [a.id, a.assertion]));
    const vocabMap = new Map(vocabs.map((v: any) => [v.id, v.term]));

    // Return enriched preview for the UI
    return entries.map((e) => {
      const tpTexts = (e.assertionIds || [])
        .map((id: string) => assertionMap.get(id))
        .filter(Boolean) as string[];
      const vTerms = (e.vocabularyIds || [])
        .map((id: string) => vocabMap.get(id))
        .filter(Boolean) as string[];
      const qCount = (e.questionIds || []).length;

      return {
        session: e.session,
        label: e.label,
        type: e.type,
        teachingPointCount: tpTexts.length,
        vocabCount: vTerms.length,
        questionCount: qCount,
        teachingPointPreviews: tpTexts.slice(0, 3).map((t) =>
          t.length > 80 ? t.slice(0, 77) + "…" : t
        ),
        vocabPreviews: vTerms.slice(0, 3),
      };
    });
  } catch (err: any) {
    console.warn("[wizard-tools] Lesson plan generation failed, using fallback preview:", err.message);
    await persistPlanToCurriculum(
      fallback.map((f) => ({ ...f, moduleId: null, moduleLabel: "" })),
      "fallback-wizard",
    ).catch(() => {});
    return fallback;
  }
}

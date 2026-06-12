import type { WizardToolExec } from "../_shared/types";
import { ensureInstitutionAndDomain } from "../_shared/ensure-institution-and-domain";
import { resolveInstitutionByName } from "../resolvers/institution-by-name";
import { resolveCourseByName } from "../resolvers/course-by-name";
import { resolveSubjectByName } from "../resolvers/subject-by-name";

export async function execute(
  input: Record<string, unknown>,
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // #316 follow-up: validate field NAMES against the canonical wizard
  // graph keys. The AI repeatedly hallucinates keys from the label
  // ("moduleProgression" vs the canonical "progressionMode"), or writes
  // a progressionMode value to interactionPattern. Catch both at the
  // boundary so the data bag stays canonical.
  const { validateSetupFields } = await import("@/lib/wizard/validate-setup-fields");
  const rawFields = input.fields as Record<string, unknown> | null | undefined;
  // Defensive: AI sometimes calls update_setup({}) or update_setup({ fields: null }).
  // Log so we can spot the upstream prompt issue, then fail-soft on validation.
  if (!rawFields || typeof rawFields !== "object") {
    console.warn(
      `[wizard-tools] update_setup called with malformed input.fields=${JSON.stringify(rawFields)} — treating as no-op`,
    );
  }
  const { validated: fields, corrections, errors: fieldErrors } = validateSetupFields(rawFields);
  if (corrections.length > 0) {
    for (const c of corrections) {
      console.log(`[wizard-tools] update_setup auto-corrected: ${c.from} → ${c.to} (${c.reason})`);
    }
  }
  // #468: collect rejection notes instead of early-returning. The
  // resolution logic (institution / course / subject) and the valid
  // sibling fields all still get processed. The AI is told about both
  // the saved fields AND the rejected ones in the final response.
  const rejectionNotes: string[] = [];
  const rejectedFields: Record<string, unknown> = {};

  if (fieldErrors.length > 0) {
    const summary = fieldErrors
      .map((e) => `"${e.key}"${e.suggestion ? ` (did you mean "${e.suggestion}"?)` : ""}`)
      .join(", ");
    console.warn(`[wizard-tools] update_setup REJECTED unknown fields: ${summary}`);
    for (const e of fieldErrors) {
      rejectedFields[e.key] = rawFields?.[e.key];
    }
    rejectionNotes.push(
      `Unknown setup field(s) NOT saved: ${summary}. Use canonical wizard keys (the "key" in the graph, not the label).`,
    );
  }

  let keys = Object.keys(fields);

  // ── #398 — progressionMode is NEVER writable via update_setup ──
  // ...unless the field is ALREADY set in setupData (idempotent re-affirm).
  // The reject's only purpose is to force the chip-click picker. Once
  // the chip click has set the field, redundant AI writes are harmless.
  const alreadySet =
    setupData?.progressionMode !== undefined &&
    setupData?.progressionMode !== null &&
    setupData?.progressionMode !== "";
  if ("progressionMode" in fields && !alreadySet) {
    const attempted = fields.progressionMode;
    rejectedFields.progressionMode = attempted;
    delete fields.progressionMode;
    keys = Object.keys(fields);
    console.warn(
      `[wizard-tools] update_setup REJECTED progressionMode="${String(attempted)}" — AI cannot write this field. Must use show_options with dataKey:"progressionMode" so the chip click writes setData() client-side. (Other fields in this call ARE saved: ${keys.join(", ") || "(none)"}.)`,
    );
    rejectionNotes.push(
      `progressionMode NOT saved — call show_options with dataKey:"progressionMode" instead. The chip click writes setupData client-side. Options: { value: "ai-led", label: "AI directs the sequence" } and { value: "learner-picks", label: "Let learners pick from a menu" }.`,
    );
  }

  // If after rejection there are no valid fields left, return an
  // explicit error so the AI knows nothing landed and can retry.
  if (keys.length === 0 && rejectionNotes.length > 0) {
    return {
      content: JSON.stringify({
        ok: false,
        saved: [],
        rejected: rejectedFields,
        error: rejectionNotes.join(" "),
      }),
      is_error: true,
    };
  }

  // Helper to append rejection notes to any success-path content string.
  // Used to thread partial-rejection info through every return below.
  const withRejections = (content: string): string =>
    rejectionNotes.length === 0
      ? content
      : `${content} ALSO REJECTED FROM THIS CALL: ${rejectionNotes.join(" ")}`;

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
          autoInjectFields: institutionAutoFields,
          content: withRejections(
            `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
            `AUTO-COMMIT INSTITUTION: "${resolved.name}" ` +
            `(type: ${resolved.typeSlug || "unknown"}, institutionId: ${resolved.institutionId}, ` +
            `domainId: ${resolved.domainId}, domainKind: ${resolved.domainKind}). ` +
            `Call update_setup now with: ${resolvedFields} — ` +
            `tell the user what you found and skip to the next unanswered field.` +
            subjectContext,
          ),
        };
      }

      // Partial match — single candidate = auto-commit, multiple = show options
      // (resolveInstitutionByName already picks the best single candidate)
      return {
        autoInjectFields: institutionAutoFields,
        content: withRejections(
          `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
          `AUTO-COMMIT INSTITUTION (partial match): "${resolved.name}" ` +
          `(type: ${resolved.typeSlug || "unknown"}, institutionId: ${resolved.institutionId}, ` +
          `domainId: ${resolved.domainId}, domainKind: ${resolved.domainKind}). ` +
          `The user typed "${fields.institutionName}" which matches "${resolved.name}". ` +
          `Call update_setup with: ${resolvedFields}. ` +
          `Tell the user: "Found ${resolved.name} — using your existing organisation."` +
          subjectContext,
        ),
      };
    }

    // No DB match — auto-create institution + domain eagerly
    // This unblocks the SourcesPanel (needs domainId for file uploads)
    const typeSlug = (fields.typeSlug as string) || (setupData?.typeSlug as string) || undefined;
    const created = await ensureInstitutionAndDomain(fields.institutionName, userId, typeSlug);
    if (created) {
      return {
        autoInjectFields: {
          draftDomainId: created.domainId,
          draftInstitutionId: created.institutionId,
          defaultDomainKind: created.domainKind,
          ...(typeSlug ? { typeSlug } : {}),
        },
        content: withRejections(
          `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
          `No existing institution — created "${fields.institutionName}" ` +
          `(type: ${typeSlug || "general"}, domainId: ${created.domainId}). ` +
          `Proceed to the next unanswered field.`,
        ),
      };
    }
    // ensureInstitutionAndDomain returned null — fall through, safety nets in show_upload/create_course will catch it
  }

  // ── Course resolution (requires known domainId) ─────
  // Skip resolution if the user already chose from a show_options panel
  // (setupData.courseName is set from a prior turn — re-resolving causes double-question loops)
  const domainId = (setupData?.existingDomainId || setupData?.draftDomainId) as string | undefined;
  const courseAlreadyChosen = !!(setupData?.courseName) && (setupData.courseName === fields.courseName);
  if (fields.courseName && typeof fields.courseName === "string" && domainId && !courseAlreadyChosen) {
    const resolved = await resolveCourseByName(fields.courseName, domainId);
    if (resolved) {
      if (resolved.autoCommit) {
        const pb = resolved.playbooks[0];
        return {
          autoInjectFields: {
            draftPlaybookId: pb.id,
            ...(pb.interactionPattern ? { interactionPattern: pb.interactionPattern } : {}),
          },
          content: withRejections(
            `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
            `AUTO-COMMIT COURSE: "${pb.name}" (playbookId: ${pb.id}` +
            `${pb.interactionPattern ? `, interactionPattern: ${pb.interactionPattern}` : ""}). ` +
            `Call update_setup with: { draftPlaybookId: "${pb.id}"` +
            `${pb.interactionPattern ? `, interactionPattern: "${pb.interactionPattern}"` : ""} }. ` +
            `Tell the user: "Found ${pb.name} — using your existing course." ` +
            `Skip teaching approach if already set. Move to next uncollected field.`,
          ),
        };
      }
      // Multiple matches — show options
      const optionLines = resolved.playbooks.map((p) =>
        `  - "${p.name}" (playbookId: ${p.id}${p.interactionPattern ? `, ${p.interactionPattern}` : ""})`
      ).join("\n");
      return {
        content: withRejections(
          `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
          `MULTIPLE COURSE MATCHES:\n${optionLines}\n` +
          `Show as show_options for courseName (radio mode) with "Create new course" at the end.`,
        ),
      };
    }
    // No DB match — this is a brand-new course name. Tell the AI to advance.
    // Without this, the AI may respond with a dead-end (no chips/suggestions).
    return {
      content: withRejections(
        `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
        `NEW COURSE: "${fields.courseName}" — no existing match. This is a new course. ` +
        `Confirm to the user and advance to the next priority per the graph. ` +
        `You MUST call show_suggestions or show_options — do NOT end with just a statement.`,
      ),
    };
  }

  // ── Subject resolution (requires known domainId) ────
  // Skip if subject is already committed from a prior turn (avoids re-listing courses)
  const subjectAlreadyCommitted = !!(setupData?.subjectDiscipline) && (setupData.subjectDiscipline === fields.subjectDiscipline);
  if (fields.subjectDiscipline && typeof fields.subjectDiscipline === "string" && domainId && !subjectAlreadyCommitted) {
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
          autoInjectFields: shouldAutoInjectCourse ? {
            draftPlaybookId: sub.courses[0].id,
            courseName: sub.courses[0].name,
            ...(sub.courses[0].interactionPattern ? { interactionPattern: sub.courses[0].interactionPattern } : {}),
          } : undefined,
          content: withRejections(
            `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
            `AUTO-COMMIT SUBJECT: "${sub.name}" (subjectId: ${sub.id}). ` +
            `Tell the user: "Found ${sub.name}."` +
            courseContext,
          ),
        };
      }
      // Multiple subject matches — show options
      const optionLines = resolved.subjects.map((s) =>
        `  - "${s.name}" (subjectId: ${s.id}, ${s.courses.length} course${s.courses.length !== 1 ? "s" : ""})`
      ).join("\n");
      return {
        content: withRejections(
          `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
          `MULTIPLE SUBJECT MATCHES:\n${optionLines}\n` +
          `Show as show_options for subjectDiscipline (radio mode) with "Add new subject" at the end.`,
        ),
      };
    }
  }

  // ── Persist websiteUrl to Institution if provided ──
  if (fields.websiteUrl && typeof fields.websiteUrl === "string") {
    const instId = (setupData?.existingInstitutionId || setupData?.draftInstitutionId) as string | undefined;
    if (instId) {
      try {
        const { prisma } = await import("@/lib/prisma");
        await prisma.institution.update({
          where: { id: instId },
          data: { websiteUrl: fields.websiteUrl },
        });
      } catch (err) {
        console.error("[wizard-tools] websiteUrl persist failed (non-fatal):", err);
      }
    }
  }

  return { content: withRejections(`Saved ${keys.length} field(s): ${keys.join(", ")}. Advance to the next graph priority. You MUST call show_suggestions or show_options — do NOT end with just a statement.`) };
}

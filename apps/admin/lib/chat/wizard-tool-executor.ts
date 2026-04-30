/**
 * Wizard Tool Executor — server-side execution of wizard tool calls.
 *
 * Tool definitions live in conversational-wizard-tools.ts (CONVERSATIONAL_TOOLS).
 * This file handles the server-side execution: resolving entities, creating
 * institutions/courses, and returning results to the AI loop.
 */

// ── Helpers ─────────────────────────────────────────────

/**
 * Build the student-experience portion of a Playbook.config from wizard
 * setupData. Writes BOTH the legacy shape (`welcome` / `nps` / `surveys`)
 * AND the new canonical `sessionFlow.intake` shape (#216 mirror pattern).
 *
 * Mutates `configUpdate` in place. Skips fields already present (idempotent).
 *
 * Bag keys (stable contract):
 *   welcomeGoals / welcomeAboutYou / welcomeKnowledgeCheck / welcomeAiIntro: boolean
 *   welcomeKnowledgeCheckMode: "mcq" | "socratic"  (NEW for #222)
 *   npsEnabled: boolean
 *
 * @param setupData wizard flow-bag (record of values keyed by bag key)
 * @param configUpdate mutable Playbook.config working copy
 * @param contextLabel string used in observability warnings ("create_course (existing)" etc.)
 * @param entityId    playbookId / courseId for observability
 */
export function applyStudentExperienceConfig(
  setupData: Record<string, unknown> | undefined,
  configUpdate: Record<string, unknown>,
  contextLabel: string,
  entityId: string,
): void {
  // ── Welcome (legacy) — always written by wizard until Phase 5 cleanup. ──
  if (!configUpdate.welcome) {
    const welcomeKeysSet = ["welcomeGoals", "welcomeAboutYou", "welcomeKnowledgeCheck", "welcomeAiIntro"]
      .filter((k) => setupData?.[k] !== undefined).length;
    if (welcomeKeysSet === 0) {
      console.warn(
        `[wizard-tool-executor] ${contextLabel} called without explicit welcome flags — falling back to DEFAULT_WELCOME_CONFIG. id=${entityId}`,
      );
    }
    configUpdate.welcome = {
      goals: { enabled: setupData?.welcomeGoals !== false },
      aboutYou: { enabled: setupData?.welcomeAboutYou !== false },
      knowledgeCheck: { enabled: setupData?.welcomeKnowledgeCheck === true },
      aiIntroCall: { enabled: setupData?.welcomeAiIntro === true },
    };
  }

  // ── sessionFlow.intake (new shape) — mirror of welcome plus deliveryMode. ──
  // Always set so the resolver / editor see the same source of truth. The
  // mirror layer is removed in Phase 5 (#220) once legacy fields are dropped.
  const existingSessionFlow = (configUpdate.sessionFlow as Record<string, unknown> | undefined) ?? {};
  const welcome = configUpdate.welcome as {
    goals: { enabled: boolean };
    aboutYou: { enabled: boolean };
    knowledgeCheck: { enabled: boolean };
    aiIntroCall: { enabled: boolean };
  };
  const deliveryMode: "mcq" | "socratic" =
    setupData?.welcomeKnowledgeCheckMode === "socratic" ? "socratic" : "mcq";
  configUpdate.sessionFlow = {
    ...existingSessionFlow,
    intake: {
      goals: { enabled: welcome.goals.enabled },
      aboutYou: { enabled: welcome.aboutYou.enabled },
      knowledgeCheck: { enabled: welcome.knowledgeCheck.enabled, deliveryMode },
      aiIntroCall: { enabled: welcome.aiIntroCall.enabled },
    },
  };

  // ── NPS — top-level config field, mirrored to surveys.post.enabled for
  // structured-mode rail compatibility (existing pattern). ──
  if (!configUpdate.nps) {
    configUpdate.nps = {
      enabled: setupData?.npsEnabled !== false,
      trigger: "mastery" as const,
      threshold: 80,
    };
  }
  if (!configUpdate.surveys) {
    const nps = configUpdate.nps as { enabled: boolean };
    configUpdate.surveys = {
      post: { enabled: nps.enabled },
    };
  }
}

/** Return the string only if it looks like a real UUID (v4). Rejects slugs, made-up prefixed IDs, etc. */
function validUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Standard UUID v4 pattern — also accepts Prisma cuid/cuid2 (25+ alphanum chars)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  // Prisma CUID (starts with c, 25 chars) or CUID2 (24+ chars alphanumeric)
  if (/^c[a-z0-9]{24,}$/i.test(value)) return value;
  return undefined;
}

/** Resolve existing institution by name, or create institution + domain + link user. */
async function ensureInstitutionAndDomain(
  institutionName: string,
  userId: string,
  typeSlug?: string,
): Promise<{ domainId: string; institutionId: string; domainKind: "INSTITUTION" | "COMMUNITY" } | null> {
  const resolved = await resolveInstitutionByName(institutionName);
  if (resolved) {
    return { domainId: resolved.domainId, institutionId: resolved.institutionId, domainKind: resolved.domainKind };
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    const slugify = (await import("slugify")).default;

    let typeId: string | undefined;
    let domainKind: "INSTITUTION" | "COMMUNITY" = "INSTITUTION";
    const resolvedTypeSlug = typeSlug || inferTypeFromName(institutionName) || undefined;
    if (resolvedTypeSlug) {
      const instType = await prisma.institutionType.findFirst({
        where: { slug: resolvedTypeSlug },
        select: { id: true, defaultDomainKind: true },
      });
      typeId = instType?.id;
      if (instType?.defaultDomainKind === "COMMUNITY") domainKind = "COMMUNITY";
    }

    const [institution, domain] = await prisma.$transaction(async (tx) => {
      const inst = await tx.institution.create({
        data: {
          name: institutionName,
          slug: slugify(institutionName, { lower: true, strict: true }),
          ...(typeId ? { typeId } : {}),
        },
      });
      const dom = await tx.domain.create({
        data: {
          name: institutionName,
          slug: slugify(institutionName, { lower: true, strict: true }),
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

    console.log(`[wizard-tools] ensureInstitutionAndDomain: created "${institutionName}" (inst: ${institution.id}, domain: ${domain.id})`);
    return { domainId: domain.id, institutionId: institution.id, domainKind };
  } catch (err) {
    console.error("[wizard-tools] ensureInstitutionAndDomain failed:", err);
    return null;
  }
}

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

        // No DB match — auto-create institution + domain eagerly
        // This unblocks the SourcesPanel (needs domainId for file uploads)
        const typeSlug = (fields.typeSlug as string) || (setupData?.typeSlug as string) || undefined;
        const created = await ensureInstitutionAndDomain(fields.institutionName, userId, typeSlug);
        if (created) {
          return {
            ...base,
            autoInjectFields: {
              draftDomainId: created.domainId,
              draftInstitutionId: created.institutionId,
              defaultDomainKind: created.domainKind,
              ...(typeSlug ? { typeSlug } : {}),
            },
            content:
              `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
              `No existing institution — created "${fields.institutionName}" ` +
              `(type: ${typeSlug || "general"}, domainId: ${created.domainId}). ` +
              `Proceed to the next unanswered field.`,
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
        // No DB match — this is a brand-new course name. Tell the AI to advance.
        // Without this, the AI may respond with a dead-end (no chips/suggestions).
        return {
          ...base,
          content:
            `Saved ${keys.length} field(s): ${keys.join(", ")}. ` +
            `NEW COURSE: "${fields.courseName}" — no existing match. This is a new course. ` +
            `Confirm to the user and advance to the next priority per the graph. ` +
            `You MUST call show_suggestions or show_options — do NOT end with just a statement.`,
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

      return { ...base, content: `Saved ${keys.length} field(s): ${keys.join(", ")}. Advance to the next graph priority. You MUST call show_suggestions or show_options — do NOT end with just a statement.` };
    }

    case "show_options": {
      return { ...base, content: `Panel displayed to user. Wait for their response.` };
    }

    case "show_upload": {
      // Safety net: auto-create institution if domainId is missing but we have enough data.
      // This handles the case where the AI skips create_institution before the content phase.
      const existingDomainId = (setupData?.existingDomainId || setupData?.draftDomainId) as string | undefined;
      if (!existingDomainId && setupData?.institutionName) {
        const result = await ensureInstitutionAndDomain(
          setupData.institutionName as string,
          userId,
          setupData.typeSlug as string | undefined,
        );
        if (result) {
          return {
            ...base,
            autoInjectFields: {
              draftDomainId: result.domainId,
              draftInstitutionId: result.institutionId,
              defaultDomainKind: result.domainKind,
            },
            content: "Teaching Materials panel is visible in the right column. Guide the user to drop files there. Wait for their response.",
          };
        }
        // ensureInstitutionAndDomain returned null — fall through, show upload anyway
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
      // ── Guard: graph must say "Can launch: YES" before creation ──
      const { evaluateGraph } = await import("@/lib/wizard/graph-evaluator");
      const graphCheck = evaluateGraph(setupData ?? {});
      if (!graphCheck.canLaunch) {
        const labels = graphCheck.missingRequired.map((n) => n.label);
        console.log(`[wizard-tools] create_course BLOCKED — missing required: ${labels.join(", ")}`);
        return { ack: `Cannot create course yet — still missing: ${labels.join(", ")}. Collect these first, then try again.` };
      }
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
        // Discipline guard (#207): never let a placeholder name (e.g. "Course")
        // become a Subject. If the AI calls create_course before the discipline
        // is set and courseName is also generic, refuse to scaffold rather than
        // create an orphan Subject row.
        const { isPlaceholderSubjectName } = await import("@/lib/knowledge/cleanup-placeholder-subjects");
        const rawSubjectDiscipline = (input.subjectDiscipline as string) || courseName;
        if (!rawSubjectDiscipline || isPlaceholderSubjectName(rawSubjectDiscipline)) {
          return {
            ...base,
            content: JSON.stringify({
              ok: false,
              error: "Subject discipline is required. Ask the user what subject this course teaches (e.g. 'IELTS Speaking', 'Year 5 Maths', 'Food Safety') and pass it as subjectDiscipline.",
            }),
            is_error: true,
          };
        }
        const subjectDiscipline = rawSubjectDiscipline;
        const packSubjectIds = (input.packSubjectIds as string[] | undefined)
          || (setupData?.packSubjectIds as string[] | undefined);
        // Phase 5: prefer sourceIds for direct PlaybookSource creation
        const uploadSourceIds = (input.uploadSourceIds as string[] | undefined)
          || (setupData?.uploadSourceIds as string[] | undefined);

        // ── Safety net: auto-create institution + domain if missing ──
        // The AI sometimes skips create_institution and jumps straight to create_course.
        if (!domainId && setupData?.institutionName) {
          const result = await ensureInstitutionAndDomain(
            setupData.institutionName as string,
            userId,
            setupData.typeSlug as string | undefined,
          );
          if (result) domainId = result.domainId;
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
            // Fall back to setupData (wizard data bag) for fields the AI may not repeat in create_course
            const existingConfig = (existingPb.config as Record<string, unknown>) || {};
            const configUpdate: Record<string, unknown> = { ...existingConfig };
            if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
            const teachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
            if (teachingMode) configUpdate.teachingMode = teachingMode;
            if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
            const welcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
            if (welcomeMessage) configUpdate.welcomeMessage = welcomeMessage;
            const sessionCount = input.sessionCount ?? setupData?.sessionCount;
            if (sessionCount) configUpdate.sessionCount = Number(sessionCount);
            const durationMins = input.durationMins ?? setupData?.durationMins;
            if (durationMins) configUpdate.durationMins = Number(durationMins);
            const planEmphasis = (input.planEmphasis as string) || (setupData?.planEmphasis as string);
            if (planEmphasis) configUpdate.planEmphasis = planEmphasis;
            const audience = (input.audience as string) || (setupData?.audience as string);
            if (audience) configUpdate.audience = audience;
            const lessonPlanModel = (input.lessonPlanModel as string) || (setupData?.lessonPlanModel as string);
            if (lessonPlanModel) configUpdate.lessonPlanModel = lessonPlanModel;
            const physicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
            if (physicalMaterials) configUpdate.physicalMaterials = physicalMaterials;
            const courseContext = (input.courseContext as string) || (setupData?.courseContext as string);
            if (courseContext) configUpdate.courseContext = courseContext;
            const constraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
            if (constraints) configUpdate.constraints = constraints;

            // #167 — Carry through pedagogy detected from an uploaded course
            // reference. These values override the system defaults:
            //   - lessonPlanMode: "continuous" means the scheduler decides
            //     per call and we skip carving fixed sessions.
            //   - cadenceMinutesPerCall: overrides durationMins.
            //   - suggestedSessionCount: overrides sessionCount when set.
            const pedagogy = setupData?.coursePedagogy as {
              lessonPlanMode?: "structured" | "continuous" | null;
              cadenceMinutesPerCall?: number | null;
              suggestedSessionCount?: number | null;
            } | undefined;
            if (pedagogy?.lessonPlanMode) {
              configUpdate.lessonPlanMode = pedagogy.lessonPlanMode;
            }
            if (pedagogy?.cadenceMinutesPerCall && !durationMins) {
              configUpdate.durationMins = pedagogy.cadenceMinutesPerCall;
            }
            if (pedagogy?.suggestedSessionCount && !sessionCount) {
              configUpdate.sessionCount = pedagogy.suggestedSessionCount;
            }

            // Student experience config — welcome + sessionFlow.intake mirror + nps
            applyStudentExperienceConfig(
              setupData as Record<string, unknown> | undefined,
              configUpdate,
              "create_course (existing path)",
              existingPlaybookId,
            );

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

            // Instantiate Goal records for the test caller from config.goals (shared helper).
            // No try/catch — if this fails, the wizard's "course ready" claim is a lie and the
            // educator will see "No goals yet" with no warning. Surface the failure instead.
            const { instantiatePlaybookGoals: instantiateGoalsExisting } = await import("@/lib/enrollment/instantiate-goals");
            await instantiateGoalsExisting(caller.id, resolvedDomainId);

            // Resolve primary subject for the existing playbook
            const existingPbSubject = await prisma.playbookSubject.findFirst({
              where: { playbookId: existingPlaybookId },
              select: { subjectId: true },
            });

            // Auto-generate curriculum if existing playbook has none (non-blocking)
            // Include primary subject — after bridging, sources live there.
            const existingCurrSubjectIds = [
              ...(existingPbSubject ? [existingPbSubject.subjectId] : []),
              ...(packSubjectIds ?? []),
            ];
            const { generateInstantCurriculum: genCurriculum } = await import("@/lib/domain/instant-curriculum");
            genCurriculum({
              domainId: resolvedDomainId,
              playbookId: existingPlaybookId,
              subjectName: subjectDiscipline,
              persona: interactionPattern,
              subjectIds: existingCurrSubjectIds,
              intents: {
                sessionCount: input.sessionCount ? Number(input.sessionCount) : undefined,
                durationMins: input.durationMins ? Number(input.durationMins) : undefined,
                emphasis: input.planEmphasis as string | undefined,
              },
            }).catch(err => console.error("[wizard] Instant curriculum (existing) failed (non-fatal):", err.message));

            // Bridge COURSE_REFERENCE sources to the primary subject (existing course path)
            if (existingPbSubject && packSubjectIds?.length) {
              for (const packSubId of packSubjectIds) {
                // Bridge COURSE_REFERENCE sources — skip when uploadSourceIds handles it
                if (!uploadSourceIds?.length) {
                  const packSources = await prisma.subjectSource.findMany({
                    where: { subjectId: packSubId },
                    select: { sourceId: true, source: { select: { documentType: true } } },
                  });
                  for (const ps of packSources) {
                    if (ps.source.documentType === "COURSE_REFERENCE" || ps.source.documentType === "POLICY_DOCUMENT") {
                      const existingLink = await prisma.subjectSource.findFirst({
                        where: { subjectId: existingPbSubject.subjectId, sourceId: ps.sourceId },
                      });
                      if (!existingLink) {
                        await prisma.subjectSource.create({
                          data: { subjectId: existingPbSubject.subjectId, sourceId: ps.sourceId },
                        });
                      }
                      // Dual-write: PlaybookSource for bridged source
                      const { upsertPlaybookSource: upsertBridge } = await import("@/lib/knowledge/domain-sources");
                      await upsertBridge(existingPlaybookId, ps.sourceId);
                    }
                  }
                }
              }
            }

            // Backfill teachMethod on assertions extracted before teachingMode was set
            const resolvedTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
            if (resolvedTeachingMode) {
              const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
              backfillTeachMethods(existingPlaybookId).catch(err =>
                console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
            }

            // Create assertions from pedagogy data (if user filled any pedagogy nodes)
            // Skip if pedagogy source already exists for this subject (re-run guard)
            const hasPedagogyExisting = setupData?.skillsFramework || setupData?.teachingPrinciples
              || setupData?.coursePhases || setupData?.edgeCases || setupData?.assessmentBoundaries;
            if (hasPedagogyExisting && existingPbSubject?.subjectId) {
              const existingPedSource = await prisma.contentSource.findFirst({
                where: {
                  documentType: "COURSE_REFERENCE",
                  subjects: { some: { subjectId: existingPbSubject.subjectId } },
                },
              });
              if (!existingPedSource) {
                try {
                  const { convertCourseRefToAssertions } = await import("@/lib/content-trust/course-ref-to-assertions");
                  const { renderCourseRefMarkdown } = await import("@/lib/content-trust/course-ref-to-markdown");
                  const refData = {
                    skillsFramework: setupData?.skillsFramework as any,
                    teachingApproach: setupData?.teachingPrinciples as any,
                    coursePhases: setupData?.coursePhases as any,
                    edgeCases: setupData?.edgeCases as any,
                    assessmentBoundaries: setupData?.assessmentBoundaries as string[],
                    learnerModel: setupData?.learnerModel as any,
                    sessionOverrides: setupData?.sessionOverrides as any,
                    contentStrategy: setupData?.contentStrategy as any,
                    communicationRules: setupData?.communicationRules as any,
                  };
                  const assertionRows = convertCourseRefToAssertions(refData);
                  if (assertionRows.length > 0) {
                    const refSource = await prisma.contentSource.create({
                      data: {
                        name: `${courseName || "Course"} — Course Reference`,
                        documentType: "COURSE_REFERENCE",
                        textSample: renderCourseRefMarkdown(refData),
                        status: "COMPLETED",
                      },
                    });
                    await prisma.subjectSource.create({
                      data: { subjectId: existingPbSubject.subjectId, sourceId: refSource.id },
                    });
                    // Dual-write: PlaybookSource for pedagogy source
                    const { upsertPlaybookSource: upsertPedExisting } = await import("@/lib/knowledge/domain-sources");
                    await upsertPedExisting(existingPlaybookId, refSource.id, { tags: ["course-reference"] });

                    for (const row of assertionRows) {
                      await prisma.contentAssertion.create({
                        data: { ...row, sourceId: refSource.id, confidence: 1.0, depth: 0, isActive: true },
                      });
                    }
                    console.log(`[wizard] Created ${assertionRows.length} pedagogy assertions for existing course`);
                  }
                } catch (err) {
                  console.error("[wizard] Pedagogy assertion creation (existing) failed (non-fatal):", (err as Error).message);
                }
              } else {
                console.log(`[wizard] Skipping pedagogy source creation — already exists (source ${existingPedSource.id})`);
              }
            }

            // Sync instruction assertions into course identity spec overlay
            const { syncInstructionsToIdentitySpec } = await import("@/lib/content-trust/sync-instructions-to-spec");
            syncInstructionsToIdentitySpec(existingPlaybookId).catch(err =>
              console.error("[wizard] instruction spec sync failed (non-fatal):", err.message));

            // Lesson plan generation removed — scheduler handles pacing

            return {
              ...base,
              content: JSON.stringify({
                ok: true,
                playbookId: existingPlaybookId,
                callerId: caller.id,
                callerName,
                existingCourse: true,
              }),
            };
          }
          // Playbook was deleted — fall through to normal creation
        }

        // 1. Create or find Subject (course-scoped slug to prevent content bleeding)
        //    Each course gets its own subject even if the discipline name is the same.
        //    e.g. "abacus-academy-pw-secret-garden-1005-english-language"
        const domainRow = await prisma.domain.findUnique({ where: { id: domainId }, select: { slug: true } });
        const courseSlug = slugify(courseName, { lower: true, strict: true });
        const disciplineSlug = slugify(subjectDiscipline, { lower: true, strict: true });
        const subjectSlug = `${domainRow!.slug}-${courseSlug}-${disciplineSlug}`;
        let subject = await prisma.subject.findFirst({ where: { slug: subjectSlug } });
        if (!subject) {
          const { suggestTeachingProfile } = await import("@/lib/content-trust/teaching-profiles");
          subject = await prisma.subject.create({
            data: {
              slug: subjectSlug,
              name: subjectDiscipline,
              isActive: true,
              teachingProfile: suggestTeachingProfile(subjectDiscipline),
            },
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

        // 3. Dedup guard: if a playbook with the same name already exists in this domain,
        //    treat it as the existing course (prevents duplicates from AI retries)
        const existingDupe = await prisma.playbook.findFirst({
          where: {
            domainId,
            name: { equals: courseName, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (existingDupe) {
          console.log(`[wizard-tools] create_course: playbook "${courseName}" already exists in domain ${domainId} — reusing ${existingDupe.id}`);
          // Re-enter the existing-course path by setting existingPlaybookId
          // and recursing through the same tool (setupData is immutable here,
          // so we call ourselves with the draftPlaybookId patched in).
          return executeWizardTool(
            "create_course",
            input,
            userId,
            { ...setupData, draftPlaybookId: existingDupe.id },
          );
        }

        // 4. Resolve archetype + flow phases from interaction pattern
        const archetypeSlug = await loadPersonaArchetype(interactionPattern);
        const flowPhases = await loadPersonaFlowPhases(interactionPattern);

        // 5. Scaffold domain (identity spec + playbook + system specs + publish + onboarding)
        const groupId = (input.groupId as string) || (setupData?.groupId as string) || undefined;
        const scaffoldResult = await scaffoldDomain(domainId, {
          extendsAgent: archetypeSlug || undefined,
          flowPhases: flowPhases || undefined,
          forceNewPlaybook: true,
          playbookName: courseName,
          groupId,
        });

        if (!scaffoldResult.playbook) {
          throw new Error("Scaffold failed to create playbook");
        }

        const playbookId = scaffoldResult.playbook.id;

        // 4b. Link primary subject to playbook (step 7 only links pack subjects)
        await prisma.playbookSubject.upsert({
          where: { playbookId_subjectId: { playbookId, subjectId: subject.id } },
          update: {},
          create: { playbookId, subjectId: subject.id },
        });

        // Remove any placeholder PlaybookSubjects accumulated on this playbook
        // from earlier wizard turns (e.g. a Subject named "Course" created when
        // subjectDiscipline fell back to courseName). See #207.
        const { removePlaceholderPlaybookSubjects } = await import("@/lib/knowledge/cleanup-placeholder-subjects");
        await removePlaceholderPlaybookSubjects(playbookId, subject.id);

        // Dual-write: sync PlaybookSource from primary subject
        // Skip when uploadSourceIds provided — Phase 5 (step 7c) creates PlaybookSource
        // directly, and syncPlaybookSources would pull in ALL sources for this subject.
        if (!uploadSourceIds?.length) {
          const { syncPlaybookSources } = await import("@/lib/knowledge/domain-sources");
          await syncPlaybookSources(playbookId, subject.id);
        }

        // 5. Store config in playbook
        // Fall back to setupData (wizard data bag) for fields the AI may not repeat in create_course
        const pb = await prisma.playbook.findUnique({
          where: { id: playbookId },
          select: { config: true },
        });
        const existingConfig = (pb?.config as Record<string, unknown>) || {};
        const configUpdate: Record<string, unknown> = { ...existingConfig };
        if (interactionPattern) configUpdate.interactionPattern = interactionPattern;
        const newTeachingMode = (input.teachingMode as string) || (setupData?.teachingMode as string);
        if (newTeachingMode) configUpdate.teachingMode = newTeachingMode;
        if (subjectDiscipline) configUpdate.subjectDiscipline = subjectDiscipline;
        const newWelcomeMessage = (input.welcomeMessage as string) || (setupData?.welcomeMessage as string);
        if (newWelcomeMessage) configUpdate.welcomeMessage = newWelcomeMessage;
        const newSessionCount = input.sessionCount ?? setupData?.sessionCount;
        if (newSessionCount) configUpdate.sessionCount = Number(newSessionCount);
        const newDurationMins = input.durationMins ?? setupData?.durationMins;
        if (newDurationMins) configUpdate.durationMins = Number(newDurationMins);
        const newPlanEmphasis = (input.planEmphasis as string) || (setupData?.planEmphasis as string);
        if (newPlanEmphasis) configUpdate.planEmphasis = newPlanEmphasis;
        const newAudience = (input.audience as string) || (setupData?.audience as string);
        if (newAudience) configUpdate.audience = newAudience;
        const newLessonPlanModel = (input.lessonPlanModel as string) || (setupData?.lessonPlanModel as string);
        if (newLessonPlanModel) configUpdate.lessonPlanModel = newLessonPlanModel;
        const newPhysicalMaterials = (input.physicalMaterials as string) || (setupData?.physicalMaterials as string);
        if (newPhysicalMaterials) configUpdate.physicalMaterials = newPhysicalMaterials;
        const newCourseContext = (input.courseContext as string) || (setupData?.courseContext as string);
        if (newCourseContext) configUpdate.courseContext = newCourseContext;
        const newConstraints = (input.constraints as string[]) || (setupData?.constraints as string[]);
        if (newConstraints) configUpdate.constraints = newConstraints;
        // #167 — Carry through pedagogy detected from an uploaded course
        // reference. Mirrors the existing-playbook path above.
        const newPedagogy = setupData?.coursePedagogy as {
          lessonPlanMode?: "structured" | "continuous" | null;
          cadenceMinutesPerCall?: number | null;
          suggestedSessionCount?: number | null;
        } | undefined;
        if (newPedagogy?.lessonPlanMode) {
          configUpdate.lessonPlanMode = newPedagogy.lessonPlanMode;
        }
        if (newPedagogy?.cadenceMinutesPerCall && !newDurationMins) {
          configUpdate.durationMins = newPedagogy.cadenceMinutesPerCall;
        }
        if (newPedagogy?.suggestedSessionCount && !newSessionCount) {
          configUpdate.sessionCount = newPedagogy.suggestedSessionCount;
        }

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

        // Student experience config — welcome + sessionFlow.intake mirror + nps
        applyStudentExperienceConfig(
          setupData as Record<string, unknown> | undefined,
          configUpdate,
          "create_course (new path)",
          playbookId,
        );

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

        // Dual-write: sync PlaybookSource from primary subject (idempotent if already done at 4b)
        // Skip when uploadSourceIds provided — Phase 5 (step 7c) handles it.
        if (!uploadSourceIds?.length) {
          const { syncPlaybookSources: syncStep6 } = await import("@/lib/knowledge/domain-sources");
          await syncStep6(playbookId, subject.id);
        }

        // 6b. Create per-course identity spec overlay
        //     Extends the domain identity spec so course-specific teaching rules
        //     are scoped to this course and don't bleed into other courses.
        const domainForSpec = await prisma.domain.findUnique({
          where: { id: domainId },
          select: { onboardingIdentitySpecId: true },
        });
        if (domainForSpec?.onboardingIdentitySpecId) {
          const domainSpec = await prisma.analysisSpec.findUnique({
            where: { id: domainForSpec.onboardingIdentitySpecId },
            select: { slug: true },
          });
          if (domainSpec) {
            const courseIdentitySlug = `${slugify(courseName, { lower: true, strict: true })}-identity`;
            const courseIdentity = await prisma.analysisSpec.upsert({
              where: { slug: courseIdentitySlug },
              update: {},
              create: {
                slug: courseIdentitySlug,
                name: `${courseName} Identity`,
                description: `Course overlay for ${courseName} — extends domain identity with course-specific teaching rules.`,
                outputType: "COMPOSE",
                specRole: "IDENTITY",
                specType: "DOMAIN",
                scope: "DOMAIN",
                domain: "identity",
                isActive: true,
                isDirty: false,
                isDeletable: true,
                extendsAgent: domainSpec.slug,
                config: { parameters: [] },
              },
            });
            // Link at sortOrder -1 so resolveSpecs picks it before domain overlay (sortOrder 0)
            const existingLink = await prisma.playbookItem.findFirst({
              where: { playbookId, specId: courseIdentity.id },
            });
            if (!existingLink) {
              await prisma.playbookItem.create({
                data: {
                  playbookId,
                  itemType: "SPEC",
                  specId: courseIdentity.id,
                  sortOrder: -1,
                  isEnabled: true,
                },
              });
            }
          }
        }

        // 7. Link content-upload subjects from PackUploadStep (if any)
        //    Only link subjects explicitly passed via packSubjectIds (from the upload step).
        //    No domain-wide fallback — that caused content from other courses on the
        //    same domain to bleed into new courses.
        const subjectIdsToLink = (packSubjectIds ?? [])
          .filter(id => id !== subject.id); // primary subject already linked at step 4b
        for (const packSubId of subjectIdsToLink) {
          await prisma.playbookSubject.upsert({
            where: { playbookId_subjectId: { playbookId, subjectId: packSubId } },
            update: {},
            create: { playbookId, subjectId: packSubId },
          });
          // Dual-write: sync PlaybookSource from pack subject
          // Skip when uploadSourceIds provided — Phase 5 (step 7c) handles it.
          if (!uploadSourceIds?.length) {
            const { syncPlaybookSources: syncPackSub } = await import("@/lib/knowledge/domain-sources");
            await syncPackSub(playbookId, packSubId);
          }

          const domainLink = await prisma.subjectDomain.findFirst({
            where: { subjectId: packSubId, domainId },
          });
          if (!domainLink) {
            await prisma.subjectDomain.create({
              data: { subjectId: packSubId, domainId },
            });
          }
        }

        // 7b. Bridge COURSE_REFERENCE sources to the primary subject.
        //     LEGACY: Ingest now puts all docs (including pedagogy) on the primary subject.
        //     Kept for backward compatibility with courses that have fragmented subjects.
        //     Skip when uploadSourceIds provided — Phase 5 (step 7c) handles all sources directly.
        if (!uploadSourceIds?.length) {
          for (const packSubId of subjectIdsToLink) {
            const packSources = await prisma.subjectSource.findMany({
              where: { subjectId: packSubId },
              select: { sourceId: true, source: { select: { documentType: true } } },
            });
            for (const ps of packSources) {
              if (ps.source.documentType === "COURSE_REFERENCE" || ps.source.documentType === "POLICY_DOCUMENT") {
                const existingLink = await prisma.subjectSource.findFirst({
                  where: { subjectId: subject.id, sourceId: ps.sourceId },
                });
                if (!existingLink) {
                  await prisma.subjectSource.create({
                    data: { subjectId: subject.id, sourceId: ps.sourceId },
                  });
                }
                // Dual-write: PlaybookSource for bridged source
                const { upsertPlaybookSource: upsertBridgeNew } = await import("@/lib/knowledge/domain-sources");
                await upsertBridgeNew(playbookId, ps.sourceId);
              }
            }
          }
        }

        // 7c. Direct PlaybookSource creation from uploadSourceIds (Phase 5)
        //     When ingest provides sourceIds directly, create PlaybookSource without
        //     needing the Subject → SubjectSource chain.
        if (uploadSourceIds?.length) {
          const { upsertPlaybookSource } = await import("@/lib/knowledge/domain-sources");
          for (const srcId of uploadSourceIds) {
            await upsertPlaybookSource(playbookId, srcId);
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

        // 9a. Ensure the wizard user has a TEACHER Caller (needed for educator dashboard + cohort ownership)
        let teacherCaller = await prisma.caller.findFirst({
          where: { userId, domainId, role: "TEACHER" },
          select: { id: true },
        });
        if (!teacherCaller) {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, email: true },
          });
          teacherCaller = await prisma.caller.create({
            data: {
              name: user?.name || "Educator",
              email: user?.email || undefined,
              role: "TEACHER",
              userId,
              domainId,
            },
            select: { id: true },
          });
        }

        // 9b. Create TWO test callers: demo (skips onboarding) + full (normal journey)
        const { instantiatePlaybookGoals } = await import("@/lib/enrollment/instantiate-goals");

        async function createTestCaller(callerName: string, skipOnboarding: boolean) {
          const c = await prisma.caller.create({
            data: { name: callerName, domainId },
          });
          await enrollCaller(c.id, playbookId, "wizard-v2", undefined,
            { skipAutoCompose: skipOnboarding });

          // Instantiate Goal rows from playbook.config.goals. Shared helper keeps
          // v5 wizard (course-setup) and chat wizard in lockstep. Re-throw on failure
          // so the wizard reports the broken state instead of pretending success.
          await instantiatePlaybookGoals(c.id, domainId);

          // Skip onboarding: mark complete, mark surveys submitted, then compose
          if (skipOnboarding) {
            const { applySkipOnboarding } = await import("@/lib/enrollment/skip-onboarding");
            await applySkipOnboarding(c.id, domainId);

            const { autoComposeForCaller } = await import("@/lib/enrollment/auto-compose");
            autoComposeForCaller(c.id, playbookId).catch(err =>
              console.error(`[wizard] Auto-compose failed for demo caller ${c.id}:`, err.message));
          }

          return c;
        }

        const demoName = randomFakeName();
        const callerName = randomFakeName();
        // Demo caller (skip-onboarding) is best-effort — don't block course creation if it fails
        let demoCaller: { id: string } | null = null;
        try {
          demoCaller = await createTestCaller(demoName, true);
        } catch (err) {
          console.error("[wizard] Demo caller creation failed (non-fatal):", (err as Error).message);
        }
        const caller = await createTestCaller(callerName, false);

        // 9d. Create or reuse "Test Learners" cohort so the course has a join link
        const cohortName = `${courseName} — Test Learners`;
        let cohort = await prisma.cohortGroup.findFirst({
          where: { domainId, name: cohortName },
        });
        let joinToken = cohort?.joinToken || "";
        if (!cohort) {
          joinToken = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
          cohort = await prisma.cohortGroup.create({
            data: {
              name: cohortName,
              domainId,
              ownerId: teacherCaller.id,
              joinToken,
              isActive: true,
            },
          });
        }
        await prisma.cohortPlaybook.upsert({
          where: { cohortGroupId_playbookId: { cohortGroupId: cohort.id, playbookId } },
          update: {},
          create: {
            cohortGroupId: cohort.id,
            playbookId,
            assignedBy: "wizard-v5",
          },
        });
        // Add test callers to the cohort (skip if already a member)
        for (const cId of [demoCaller?.id, caller.id].filter(Boolean) as string[]) {
          const existingMembership = await prisma.callerCohortMembership.findFirst({
            where: { callerId: cId, cohortGroupId: cohort.id },
          });
          if (!existingMembership) {
            await prisma.callerCohortMembership.create({
              data: { callerId: cId, cohortGroupId: cohort.id },
            });
          }
        }

        // 10. Backfill teachMethod on assertions extracted before teachingMode was set
        const resolvedTeachingModeNew = (input.teachingMode as string) || (setupData?.teachingMode as string);
        if (resolvedTeachingModeNew) {
          const { backfillTeachMethods } = await import("@/lib/content-trust/backfill-teach-methods");
          backfillTeachMethods(playbookId).catch(err =>
            console.error("[wizard] teachMethod backfill failed (non-fatal):", err.message));
        }

        // 10b. Sync instruction assertions into course identity spec overlay
        const { syncInstructionsToIdentitySpec } = await import("@/lib/content-trust/sync-instructions-to-spec");

        // 10c. Create assertions from pedagogy data (if user filled any pedagogy nodes)
        //      Skip if pedagogy source already exists for this subject (re-run guard)
        const hasPedagogy = setupData?.skillsFramework || setupData?.teachingPrinciples
          || setupData?.coursePhases || setupData?.edgeCases || setupData?.assessmentBoundaries;
        if (hasPedagogy) {
          const existingPedSource = await prisma.contentSource.findFirst({
            where: {
              documentType: "COURSE_REFERENCE",
              name: `${courseName} — Course Reference`,
              subjects: { some: { subjectId: subject.id } },
            },
          });
          if (!existingPedSource) {
            try {
              const { convertCourseRefToAssertions } = await import("@/lib/content-trust/course-ref-to-assertions");
              const { renderCourseRefMarkdown } = await import("@/lib/content-trust/course-ref-to-markdown");
              const refData = {
                courseOverview: {
                  subject: subjectDiscipline,
                  studentAge: (setupData?.audience as string) || undefined,
                },
                skillsFramework: setupData?.skillsFramework as any,
                teachingApproach: setupData?.teachingPrinciples as any,
                coursePhases: setupData?.coursePhases as any,
                edgeCases: setupData?.edgeCases as any,
                assessmentBoundaries: setupData?.assessmentBoundaries as string[],
                learnerModel: setupData?.learnerModel as any,
                sessionOverrides: setupData?.sessionOverrides as any,
                contentStrategy: setupData?.contentStrategy as any,
                communicationRules: setupData?.communicationRules as any,
              };

              const assertionRows = convertCourseRefToAssertions(refData);
              if (assertionRows.length > 0) {
                // Create a ContentSource to hold the pedagogy assertions
                const refSource = await prisma.contentSource.create({
                  data: {
                    name: `${courseName} — Course Reference`,
                    documentType: "COURSE_REFERENCE",
                    textSample: renderCourseRefMarkdown(refData),
                    status: "COMPLETED",
                  },
                });

                // Link source to primary subject
                await prisma.subjectSource.create({
                  data: { subjectId: subject.id, sourceId: refSource.id },
                });
                // Dual-write: PlaybookSource for pedagogy source
                const { upsertPlaybookSource: upsertPedNew } = await import("@/lib/knowledge/domain-sources");
                await upsertPedNew(playbookId, refSource.id, { tags: ["course-reference"] });

                // Create assertion rows
                for (const row of assertionRows) {
                  await prisma.contentAssertion.create({
                    data: {
                      ...row,
                      sourceId: refSource.id,
                      confidence: 1.0,
                      depth: 0,
                      isActive: true,
                    },
                  });
                }
                console.log(`[wizard] Created ${assertionRows.length} pedagogy assertions from course reference data`);
              }
            } catch (err) {
              console.error("[wizard] Pedagogy assertion creation failed (non-fatal):", (err as Error).message);
            }
          }
        }

        syncInstructionsToIdentitySpec(playbookId).catch(err =>
          console.error("[wizard] instruction spec sync failed (non-fatal):", err.message));

        // 11. Auto-generate curriculum + lesson plan (background, chained)
        //
        // Both steps run in the background so the wizard response returns fast, but
        // they are chained sequentially: curriculum first (which waits for extractions
        // to finish), then lesson plan (which uses the freshly-built curriculum).
        //
        // Running in parallel used to produce placeholder modules ("M00-1", "4MD-2")
        // because curriculum gen fired before extractions completed, got zero assertions,
        // and fell through to goals-based generation.
        // Always include the primary subject — after bridging (step 7b),
        // content sources live on subject.id, not just packSubjectIds.
        const curriculumSubjectIds = [subject.id, ...(subjectIdsToLink.length > 0 ? subjectIdsToLink : (packSubjectIds ?? []))];
        const { generateInstantCurriculum } = await import("@/lib/domain/instant-curriculum");
        (async () => {
          try {
            await generateInstantCurriculum({
              domainId,
              playbookId,
              subjectName: subjectDiscipline,
              persona: interactionPattern,
              subjectIds: curriculumSubjectIds,
              intents: {
                sessionCount: input.sessionCount ? Number(input.sessionCount) : undefined,
                durationMins: input.durationMins ? Number(input.durationMins) : undefined,
                emphasis: input.planEmphasis as string | undefined,
              },
            });
          } catch (err: any) {
            console.error("[wizard] Instant curriculum failed (non-fatal):", err.message);
          }

          // Lesson plan generation removed — scheduler handles pacing
        })();

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

        // Post-creation summary — surfaces entity counts so the AI can report them
        const linkedSubjects = await prisma.playbookSubject.findMany({
          where: { playbookId },
          include: { subject: { select: { id: true, name: true } } },
        });
        const linkedSources = await prisma.subjectSource.findMany({
          where: { subjectId: { in: linkedSubjects.map(ls => ls.subject.id) } },
          select: { sourceId: true },
          distinct: ["sourceId"],
        });

        return {
          ...base,
          content: JSON.stringify({
            ok: true,
            domainId,
            playbookId,
            subjectId: subject.id,
            callerId: caller.id,
            callerName,
            ...(demoCaller ? { demoCallerId: demoCaller.id, demoCallerName: demoName } : {}),
            cohortId: cohort.id,
            joinToken,
            firstCallPreview,
            creationSummary: {
              subjectCount: linkedSubjects.length,
              subjectNames: linkedSubjects.map(ls => ls.subject.name),
              documentCount: linkedSources.length,
            },
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

    // 1. Try exact match. Ordered by createdAt so collisions resolve to the
    //    oldest match deterministically (rare — names are ~unique per domain).
    const exact = await prisma.playbook.findFirst({
      where: { domainId, name: { equals: name, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
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

// generateLessonPlanPreview deleted — scheduler replaces session-based lesson plans.
// See ADR: docs/decisions/2026-04-14-outcome-graph-pacing.md
/* generateLessonPlanPreview function deleted (323 lines) */

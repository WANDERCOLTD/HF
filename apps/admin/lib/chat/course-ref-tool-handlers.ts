/**
 * Course Reference Tool Handlers
 *
 * Server-side execution for COURSE_REF tools.
 * Most tools (update_ref, show_ref_preview, show_suggestions) have no
 * server-side effects — they return confirmation messages. The client
 * processes tool_use blocks to update state and UI.
 *
 * finalize_ref has server-side effects: creates entities + assertions.
 */

import type { CourseRefData, AssertionCreateData } from "@/lib/content-trust/course-ref-to-assertions";
import { convertCourseRefToAssertions } from "@/lib/content-trust/course-ref-to-assertions";
import { renderCourseRefMarkdown } from "@/lib/content-trust/course-ref-to-markdown";
import { evaluateSections } from "./course-ref-system-prompt";
import { createHash } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CourseRefToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ── Executor ─────────────────────────────────────────────────────────────────

export async function executeCourseRefTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  refData: CourseRefData,
): Promise<CourseRefToolResult> {
  const base = { tool_use_id: "" };

  switch (toolName) {
    case "update_ref": {
      const section = input.section as string;
      const data = input.data as Record<string, unknown>;
      // No server-side effect — client merges into refData
      return {
        ...base,
        content: JSON.stringify({
          ok: true,
          section,
          message: `Updated ${section}. The preview panel will refresh.`,
        }),
      };
    }

    case "show_ref_preview": {
      const sections = input.sections as string[];
      return {
        ...base,
        content: JSON.stringify({
          ok: true,
          sections,
          message: "Preview panel updated.",
        }),
      };
    }

    case "check_completeness": {
      const sectionStatuses = evaluateSections(refData);
      const mandatoryMissing = sectionStatuses
        .filter((s) => s.mandatory && s.status !== "complete")
        .map((s) => s.label);
      const ready = mandatoryMissing.length === 0;
      const summary: Record<string, { status: string; mandatory: boolean }> = {};
      for (const s of sectionStatuses) {
        summary[s.key] = { status: s.status, mandatory: s.mandatory };
      }
      return {
        ...base,
        content: JSON.stringify({
          ok: true,
          ready,
          mandatoryMissing,
          sections: summary,
          message: ready
            ? "All mandatory sections complete. Ready to finalize."
            : `${mandatoryMissing.length} mandatory section(s) still needed: ${mandatoryMissing.join(", ")}`,
        }),
      };
    }

    case "finalize_ref": {
      return await handleFinalize(input, userId, refData);
    }

    case "show_suggestions": {
      const question = input.question as string;
      const suggestions = input.suggestions as string[];
      return {
        ...base,
        content: JSON.stringify({
          ok: true,
          question,
          suggestions,
        }),
      };
    }

    default:
      return {
        ...base,
        content: JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` }),
        is_error: true,
      };
  }
}

// ── Finalize Handler ─────────────────────────────────────────────────────────

async function handleFinalize(
  input: Record<string, unknown>,
  userId: string,
  refData: CourseRefData,
): Promise<CourseRefToolResult> {
  const base = { tool_use_id: "" };

  // Check completeness first
  const sectionStatuses = evaluateSections(refData);
  const mandatoryMissing = sectionStatuses.filter((s) => s.mandatory && s.status !== "complete");
  if (mandatoryMissing.length > 0) {
    return {
      ...base,
      content: JSON.stringify({
        ok: false,
        error: `Cannot finalize: ${mandatoryMissing.map((s) => s.label).join(", ")} still incomplete.`,
      }),
      is_error: true,
    };
  }

  const existingCourseId = input.courseId as string | undefined;
  const institutionName = (input.institutionName as string) || refData.courseOverview?.subject || "My Institution";
  const courseName = (input.courseName as string) || refData.courseOverview?.subject || "My Course";

  try {
    // Generate markdown
    const markdown = renderCourseRefMarkdown(refData);
    const contentHash = createHash("sha256").update(markdown).digest("hex");

    // Generate assertions
    const assertionData = convertCourseRefToAssertions(refData);

    if (existingCourseId) {
      // Attach to existing course
      return await attachToExistingCourse(existingCourseId, markdown, contentHash, assertionData, base);
    } else {
      // Full auto-create: institution → domain → playbook → caller → content source → assertions
      return await createCourseFromRef(
        institutionName,
        courseName,
        userId,
        refData,
        markdown,
        contentHash,
        assertionData,
        base,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during finalization";
    return {
      ...base,
      content: JSON.stringify({ ok: false, error: message }),
      is_error: true,
    };
  }
}

async function attachToExistingCourse(
  courseId: string,
  markdown: string,
  contentHash: string,
  assertions: AssertionCreateData[],
  base: { tool_use_id: string },
): Promise<CourseRefToolResult> {
  const { prisma } = await import("@/lib/prisma");
  const slugify = (await import("slugify")).default;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    include: { domain: true },
  });
  if (!playbook) {
    return { ...base, content: JSON.stringify({ ok: false, error: "Course not found" }), is_error: true };
  }

  // Resolve the playbook's primary subject (course-scoped — no more
  // domain-shared `${domain.slug}-course-guide` leak). Matches the
  // wizard-tool-executor pattern. Falls back to creating a per-course
  // subject if none exists yet.
  const playbookSubject = await prisma.playbookSubject.findFirst({
    where: { playbookId: playbook.id },
    select: { subjectId: true },
  });

  let subjectId = playbookSubject?.subjectId;
  if (!subjectId) {
    const newSubject = await prisma.subject.create({
      data: {
        name: playbook.name,
        slug: slugify(`${playbook.domain.slug}-${playbook.slug}`, { lower: true, strict: true }),
        isActive: true,
      },
    });
    await prisma.playbookSubject.create({
      data: { playbookId: playbook.id, subjectId: newSubject.id },
    });
    await prisma.subjectDomain.create({
      data: { subjectId: newSubject.id, domainId: playbook.domainId },
    });
    subjectId = newSubject.id;
  }

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.contentSource.create({
      data: {
        name: `Course Reference — ${playbook.name}`,
        slug: slugify(`${playbook.slug}-ref-chat`, { lower: true, strict: true }),
        documentType: "COURSE_REFERENCE",
        trustLevel: "EDUCATOR_AUTHORED",
        textSample: markdown,
        contentHash,
        isActive: true,
      },
    });

    await tx.subjectSource.create({
      data: {
        subjectId: subjectId!,
        sourceId: source.id,
        tags: ["course-reference", "chat-built"],
      },
    });

    if (assertions.length > 0) {
      await tx.contentAssertion.createMany({
        data: assertions.map((a) => ({
          ...a,
          sourceId: source.id,
        })),
      });
    }

    return { contentSourceId: source.id, assertionCount: assertions.length };
  });

  return {
    ...base,
    content: JSON.stringify({
      ok: true,
      courseId,
      playbookId: playbook.id,
      contentSourceId: result.contentSourceId,
      assertionCount: result.assertionCount,
      message: `Course reference attached to "${playbook.name}" with ${result.assertionCount} assertions.`,
    }),
  };
}

async function createCourseFromRef(
  institutionName: string,
  courseName: string,
  userId: string,
  _refData: CourseRefData,
  markdown: string,
  contentHash: string,
  assertions: AssertionCreateData[],
  base: { tool_use_id: string },
): Promise<CourseRefToolResult> {
  const { prisma } = await import("@/lib/prisma");
  const slugify = (await import("slugify")).default;

  const instSlug = slugify(institutionName, { lower: true, strict: true });
  const courseSlug = slugify(courseName, { lower: true, strict: true });

  const result = await prisma.$transaction(async (tx) => {
    // 1. Find or create institution
    let institution = await tx.institution.findFirst({ where: { slug: instSlug } });
    if (!institution) {
      institution = await tx.institution.create({
        data: {
          name: institutionName,
          slug: instSlug,
        },
      });
    }

    // 2. Find or create domain
    let domain = await tx.domain.findFirst({
      where: { institutionId: institution.id, kind: "TEACHING" },
    });
    if (!domain) {
      domain = await tx.domain.create({
        data: {
          name: institutionName,
          slug: instSlug,
          kind: "TEACHING",
          institutionId: institution.id,
        },
      });
    }

    // 3. Create playbook (course)
    const playbook = await tx.playbook.create({
      data: {
        name: courseName,
        slug: courseSlug,
        domainId: domain.id,
        status: "DRAFT",
      },
    });

    // 4. Create default caller
    const caller = await tx.caller.create({
      data: {
        name: "Default Learner",
        slug: `${courseSlug}-learner`,
        domainId: domain.id,
        playbookId: playbook.id,
      },
    });

    // 5. Create a per-course subject (taxonomy node owned by this course).
    //    Keyed by domain.slug + course.slug so each course owns its own
    //    Subject row. No more domain-shared `*-course-guide` leak.
    const subject = await tx.subject.create({
      data: {
        name: courseName,
        slug: slugify(`${domain.slug}-${courseSlug}`, { lower: true, strict: true }),
        isActive: true,
      },
    });
    await tx.subjectDomain.create({
      data: { subjectId: subject.id, domainId: domain.id },
    });
    await tx.playbookSubject.create({
      data: { playbookId: playbook.id, subjectId: subject.id },
    });

    // 6. Create content source
    const source = await tx.contentSource.create({
      data: {
        name: `Course Reference — ${courseName}`,
        slug: slugify(`${courseSlug}-ref-chat`, { lower: true, strict: true }),
        documentType: "COURSE_REFERENCE",
        trustLevel: "EDUCATOR_AUTHORED",
        textSample: markdown,
        contentHash,
        isActive: true,
      },
    });

    // 7. Link to subject
    await tx.subjectSource.create({
      data: {
        subjectId: subject.id,
        sourceId: source.id,
        tags: ["course-reference", "chat-built"],
      },
    });

    // 8. Create assertions
    if (assertions.length > 0) {
      await tx.contentAssertion.createMany({
        data: assertions.map((a) => ({
          ...a,
          sourceId: source.id,
        })),
      });
    }

    return {
      institutionId: institution.id,
      domainId: domain.id,
      playbookId: playbook.id,
      callerId: caller.id,
      contentSourceId: source.id,
      assertionCount: assertions.length,
    };
  });

  return {
    ...base,
    content: JSON.stringify({
      ok: true,
      ...result,
      courseId: result.playbookId,
      message: `Course "${courseName}" created with ${result.assertionCount} teaching assertions.`,
    }),
  };
}

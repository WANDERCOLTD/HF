import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { V5WizardWithSelector } from "./V5WizardWithSelector";

/**
 * Get Started V5 — Graph-driven wizard (now "Build Course").
 *
 * Supports amendment mode: ?courseId=xxx pre-selects an existing course.
 * Shows a course picker when courses exist for the user's domain.
 */
export default async function GetStartedV5Page({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { user } = session;
  const institutionId = user.institutionId;
  const params = await searchParams;
  const courseIdParam = params.courseId ?? null;

  // No assigned institution — SUPERADMIN still gets the selector (fetches all from API)
  if (!institutionId) {
    return <V5WizardWithSelector defaultInstitution={null} userRole={user.role} defaultCourseId={courseIdParam} courses={[]} />;
  }

  // SUPERADMIN is platform-scope — even when seeded with an institutionId
  // (e.g. admin@test.com → Abacus Academy), force an explicit pick via the
  // selector rather than silently scaffolding a course onto someone else's
  // tenant. Other roles still get their assigned institution pre-loaded.
  if (user.role === "SUPERADMIN") {
    return <V5WizardWithSelector defaultInstitution={null} userRole={user.role} defaultCourseId={courseIdParam} courses={[]} />;
  }

  // TODO(institution-lock): non-SUPERADMIN users running the wizard must be
  // hard-locked to their session.user.institutionId — they should never see
  // the organisation selector, regardless of how many institutions they have
  // access to via UserInstitution joins. Today the selector is hidden when
  // V5WizardWithSelector sees `institutions.length < 2`, but that's a UX
  // signal, not a security guard. The wizard accepts a selected id from the
  // client and trusts it. Tighten by either:
  //   (a) drop the institution selector entirely for non-SUPERADMIN, OR
  //   (b) enforce institutionId === session.user.institutionId in the
  //       create-course API for non-SUPERADMIN roles.
  // Track via GitHub issue if you want it in the backlog.

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId, isActive: true },
    select: {
      id: true,
      name: true,
      type: { select: { slug: true } },
      domains: {
        where: { isActive: true },
        select: { id: true, kind: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      },
    },
  });

  if (!institution || institution.domains.length === 0) {
    return <V5WizardWithSelector defaultInstitution={null} userRole={user.role} defaultCourseId={courseIdParam} courses={[]} />;
  }

  let domainId = institution.domains[0].id;
  let domainKind = institution.domains[0].kind as "INSTITUTION" | "COMMUNITY";

  if (user.assignedDomainId) {
    const match = institution.domains.find((d) => d.id === user.assignedDomainId);
    if (match) {
      domainId = match.id;
      domainKind = match.kind as "INSTITUTION" | "COMMUNITY";
    }
  }

  // Load courses for the domain (amendment mode)
  const courses = await prisma.playbook.findMany({
    where: { domainId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      config: true,
      subjects: {
        select: {
          subject: { select: { name: true } },
        },
        take: 1,
      },
    },
  });

  const courseList = courses.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status as string,
    subjectName: c.subjects[0]?.subject.name ?? null,
    config: c.config as Record<string, unknown> | null,
  }));

  const defaultInstitution = {
    id: institution.id,
    name: institution.name,
    domainId,
    domainKind,
    typeSlug: institution.type?.slug ?? null,
  };

  return (
    <V5WizardWithSelector
      defaultInstitution={defaultInstitution}
      userRole={user.role}
      defaultCourseId={courseIdParam}
      courses={courseList}
    />
  );
}

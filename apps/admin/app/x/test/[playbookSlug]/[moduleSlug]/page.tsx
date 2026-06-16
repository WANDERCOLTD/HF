/**
 * /x/test/[playbookSlug]/[moduleSlug] — Tester direct-link route
 * (#1750 follow-on, epic #1700 Theme 12).
 *
 * The MVP entry point for OPERATOR+ testers iterating on a specific module.
 * Walks:
 *
 *   1. Slug → Playbook (UUID match first, then slugified-name match).
 *   2. Slug → CurriculumModule on the Playbook's primary Curriculum.
 *   3. Picks the latest demo Caller on the Playbook
 *      (CallerPlaybook.policyMode = "demo", status = "ACTIVE") as the clone
 *      source — same convention as `precompose_for_fresh_learner` and the
 *      `reprompt_demo_set` admin tools.
 *   4. Calls `cloneDemoCaller(...)` with mode = `searchParams.learnerMode`
 *      (default "fresh"). The helper returns a (possibly new) callerId.
 *   5. Redirects to `/x/callers/<callerId>/sim?module=<moduleId>` —
 *      that's the existing sim playground sized to drive a Mock end-to-end.
 *
 * Generic URL (course-agnostic) per epic #1700 decision 3.
 * OPERATOR+ only. When prerequisites fail (no demo caller, slug not
 * found, missing curriculum) the page renders an actionable error
 * banner with a hint instead of redirecting — testers see WHY the
 * direct-link is unavailable.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import slugify from "slugify";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  cloneDemoCaller,
  type CloneDemoCallerMode,
} from "@/lib/test-harness/clone-demo-caller";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

interface PageProps {
  params: Promise<{ playbookSlug: string; moduleSlug: string }>;
  searchParams: Promise<{ learnerMode?: string }>;
}

function slugFor(name: string): string {
  return slugify(name, { lower: true, strict: true });
}

function parseMode(raw: string | undefined): CloneDemoCallerMode {
  return raw === "return" ? "return" : "fresh";
}

async function resolvePlaybook(playbookSlug: string) {
  if (UUID_RE.test(playbookSlug)) {
    const pb = await prisma.playbook.findUnique({
      where: { id: playbookSlug },
      select: { id: true, name: true },
    });
    if (pb) return pb;
  }
  const candidates = await prisma.playbook.findMany({
    where: { status: { in: ["PUBLISHED", "DRAFT"] } },
    select: { id: true, name: true },
  });
  return candidates.find((c) => slugFor(c.name) === playbookSlug) ?? null;
}

async function resolveDemoSourceCaller(playbookId: string) {
  const enrol = await prisma.callerPlaybook.findFirst({
    where: { playbookId, policyMode: "demo", status: "ACTIVE" },
    orderBy: { enrolledAt: "desc" },
    select: { callerId: true },
  });
  return enrol?.callerId ?? null;
}

export default async function TesterDirectLinkPage({ params, searchParams }: PageProps) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/test");
  }

  const { playbookSlug, moduleSlug } = await params;
  const { learnerMode } = await searchParams;
  const mode = parseMode(learnerMode);

  const playbook = await resolvePlaybook(playbookSlug);
  if (!playbook) {
    return (
      <ErrorPanel
        title="Course not found"
        body={`No published or draft course matched slug "${playbookSlug}".`}
        hint="Use the course's UUID or the slugified course name (lower-case, hyphenated)."
      />
    );
  }

  const primaryCurriculum = await prisma.curriculum.findFirst({
    where: { playbookLinks: { some: { playbookId: playbook.id, role: "primary" } } },
    select: { id: true },
  });
  if (!primaryCurriculum) {
    return (
      <ErrorPanel
        title="No primary curriculum"
        body={`"${playbook.name}" has no primary curriculum linked yet.`}
        hint="Run the curriculum projection (course → modules) before using the tester direct-link."
      />
    );
  }

  const targetModule = await prisma.curriculumModule.findFirst({
    where: { curriculumId: primaryCurriculum.id, slug: moduleSlug },
    select: { id: true, slug: true },
  });
  if (!targetModule) {
    return (
      <ErrorPanel
        title="Module not found"
        body={`Module "${moduleSlug}" does not exist on "${playbook.name}".`}
        hint="Check the curriculum's module list."
      />
    );
  }

  const sourceCallerId = await resolveDemoSourceCaller(playbook.id);
  if (!sourceCallerId) {
    return (
      <ErrorPanel
        title="No demo caller available"
        body={`No demo caller is enrolled on "${playbook.name}" yet.`}
        hint="Mint one via /x/intake/v2 (admin escape hatch — test-admin-*@hf-admin.local) and reopen this link."
      />
    );
  }

  const testerEmail = auth.session.user.email ?? "test-operator@hf-admin.local";

  const clone = await cloneDemoCaller(prisma, {
    sourceCallerId,
    playbookId: playbook.id,
    testerEmail,
    mode,
  });

  redirect(`/x/callers/${clone.callerId}/sim?module=${targetModule.id}`);
}

function ErrorPanel({
  title,
  body,
  hint,
}: {
  title: string;
  body: string;
  hint: string;
}) {
  return (
    <main className="hf-page-shell">
      <h1 className="hf-page-title">{title}</h1>
      <p className="hf-section-desc">{body}</p>
      <p className="hf-section-desc">{hint}</p>
      <Link className="hf-link" href="/x">
        ← Back to admin
      </Link>
    </main>
  );
}

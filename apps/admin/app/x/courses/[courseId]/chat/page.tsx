import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { AI_FORBIDDEN_FIELDS } from "@/lib/chat/ai-forbidden-fields";
import { ChatLauncher } from "./ChatLauncher";
import { ValuesPanel } from "./ValuesPanel";
import "./course-chat.css";

/**
 * @page /x/courses/[courseId]/chat
 *
 * #1225 — course-aware Cmd+K surface. Two-pane:
 *   LHS = the global ChatPanel (Cmd+K), forced into COURSE_MANAGE mode on
 *         mount so the route.ts dispatcher narrows tools to
 *         COURSE_MANAGE_TOOLS and the system prompt carries the snapshot.
 *   RHS = ValuesPanel — a read-only render of the course's editable
 *         surface, refreshed via router.refresh() after a tray apply.
 *
 * The snapshot is built server-side here from Playbook + PlaybookConfig
 * + recent BehaviorTargets, then handed to ChatLauncher which writes it
 * into EntityContext.pageContext.params.courseSnapshot. From there it
 * rides on every /api/chat POST and the server's page-context.ts
 * renders it into the prompt.
 *
 * Forbidden-field defence is layered: this page strips
 * AI_FORBIDDEN_FIELDS.playbook from the snapshot before handing it down;
 * parsePageContext on the server strips again on receipt; existing
 * admin-tools-no-forbidden-fields meta-test catches any tool schema
 * exposure.
 *
 * Auth: OPERATOR or above.
 */
export const dynamic = "force-dynamic";

interface CourseSnapshot {
  courseId: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  behaviorTargets: Array<{
    parameterId: string;
    scope: string;
    targetValue: number;
    updatedAt: string;
  }>;
  curricula: {
    primary: { id: string; name: string } | null;
    linked: Array<{ id: string; name: string }>;
  };
  learnerCount: number;
}

export default async function CourseChatPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    redirect(`/login?callbackUrl=/x/courses/${(await params).courseId}/chat`);
  }

  const { courseId } = await params;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    include: {
      behaviorTargets: {
        select: {
          parameterId: true,
          scope: true,
          targetValue: true,
          updatedAt: true,
        },
        take: 50,
        orderBy: { updatedAt: "desc" },
      },
      playbookCurricula: {
        select: {
          role: true,
          curriculum: { select: { id: true, name: true } },
        },
      },
      _count: { select: { enrollments: true } },
    },
  });

  if (!playbook) notFound();

  // Build the snapshot — keep it tight, only what the AI needs to propose
  // informed deltas. Strip any top-level key in the forbidden set as a
  // defensive belt; the server-side parsePageContext does the same on
  // receipt.
  const forbidden = new Set(AI_FORBIDDEN_FIELDS.playbook ?? []);
  const rawConfig = (playbook.config as Record<string, unknown> | null) ?? {};
  const safeConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawConfig)) {
    if (!forbidden.has(k)) safeConfig[k] = v;
  }

  const primary = playbook.playbookCurricula.find((pc) => pc.role === "primary");
  const linked = playbook.playbookCurricula.filter((pc) => pc.role === "linked");

  const snapshot: CourseSnapshot = {
    courseId: playbook.id,
    name: playbook.name,
    description: playbook.description ?? null,
    config: safeConfig,
    behaviorTargets: playbook.behaviorTargets.map((bt) => ({
      parameterId: bt.parameterId,
      scope: bt.scope,
      targetValue: bt.targetValue,
      updatedAt: bt.updatedAt.toISOString(),
    })),
    curricula: {
      primary: primary ? primary.curriculum : null,
      linked: linked.map((pc) => pc.curriculum),
    },
    learnerCount: playbook._count.enrollments,
  };

  return (
    <main className="hf-page-shell course-chat-shell">
      <nav aria-label="Breadcrumb" className="course-chat-breadcrumb">
        <Link href={`/x/courses/${courseId}`} className="hf-btn hf-btn-secondary">
          ← Back to course
        </Link>
      </nav>

      <h1 className="hf-page-title">
        Chat with <code>{playbook.name}</code>
      </h1>
      <p className="hf-page-subtitle">
        The Cmd+K assistant on this page only sees tools that mutate this
        course. Anything you propose lands in the pending-changes tray for
        your review.
      </p>

      <ChatLauncher
        courseId={courseId}
        courseName={playbook.name}
        snapshot={snapshot}
      />

      <section className="course-chat-grid">
        <div className="course-chat-pane course-chat-pane--chat">
          <div className="course-chat-pane-header">Chat</div>
          <div className="course-chat-pane-hint">
            Open the global assistant (<kbd>⌘K</kbd> or <kbd>Ctrl+K</kbd>) to
            chat. The mode is forced to <code>COURSE_MANAGE</code> for this
            page.
          </div>
        </div>

        <div className="course-chat-pane course-chat-pane--values">
          <div className="course-chat-pane-header">Current values</div>
          <ValuesPanel snapshot={snapshot} />
        </div>
      </section>
    </main>
  );
}

export type { CourseSnapshot };

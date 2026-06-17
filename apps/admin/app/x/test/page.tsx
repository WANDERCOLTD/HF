/**
 * /x/test — Tester index page.
 *
 * Follow-on to #1812 (the per-module direct-link route). Closes the
 * tester-ergonomics gap called out in every unit of
 * `docs/draft-issues/ielts-pre-voice-gap-analysis.md`:
 *
 *   > Tester direct link + fresh/return toggle — GAP (Theme 12)
 *
 * The per-module route at `/x/test/[playbookSlug]/[moduleSlug]` exists
 * but has no discovery surface — testers would have to type the URL +
 * remember the slug forms. This page lists every published Playbook ×
 * each `CurriculumModule.slug` with one-click Fresh + Return buttons
 * per row, so a non-engineer can rerun the same module repeatedly
 * without leaving the page.
 *
 * OPERATOR+ only. Reads only — no DB writes from this page (writes
 * happen on the destination route via `cloneDemoCaller`).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import slugify from "slugify";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import "./test-index.css";

export const dynamic = "force-dynamic";

function slugFor(name: string): string {
  return slugify(name, { lower: true, strict: true });
}

interface CourseRow {
  playbookId: string;
  playbookName: string;
  playbookSlug: string;
  modules: Array<{ slug: string; title: string }>;
}

async function loadCourseRows(): Promise<CourseRow[]> {
  // Pull every Playbook that has a primary curriculum, plus its module
  // list. Restrict to PUBLISHED + DRAFT (ARCHIVED courses aren't useful
  // for testing). N is small (handful per environment); a single
  // findMany is fine.
  const playbooks = await prisma.playbook.findMany({
    where: { status: { in: ["PUBLISHED", "DRAFT"] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      playbookCurricula: {
        where: { role: "primary" },
        select: {
          curriculum: {
            select: {
              modules: {
                orderBy: { sortOrder: "asc" },
                select: { slug: true, title: true },
              },
            },
          },
        },
      },
    },
  });

  return playbooks
    .map((pb) => {
      const modules = pb.playbookCurricula[0]?.curriculum.modules ?? [];
      return {
        playbookId: pb.id,
        playbookName: pb.name,
        playbookSlug: slugFor(pb.name),
        modules,
      };
    })
    .filter((row) => row.modules.length > 0);
}

export default async function TesterIndexPage() {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/test");
  }

  const rows = await loadCourseRows();

  return (
    <main className="hf-page-shell">
      <header className="hf-test-index-header">
        <h1 className="hf-page-title">Tester direct links</h1>
        <p className="hf-section-desc">
          One-click entry points for OPERATOR+ testers. Each button mints (or
          reuses) a demo caller and drops you into the sim for that module.
        </p>
        <ul className="hf-test-index-legend">
          <li>
            <span className="hf-test-index-pill hf-test-index-pill-fresh">Fresh</span>{" "}
            creates a new clone every click (zero progress).
          </li>
          <li>
            <span className="hf-test-index-pill hf-test-index-pill-return">Return</span>{" "}
            reuses your most recent clone for that course.
          </li>
        </ul>
      </header>

      {rows.length === 0 ? (
        <section className="hf-card hf-test-index-empty">
          <p>
            No courses with a primary curriculum found. Mint one via the wizard
            or publish a draft, then refresh.
          </p>
        </section>
      ) : (
        rows.map((row) => (
          <section key={row.playbookId} className="hf-card hf-test-index-course">
            <header className="hf-test-index-course-header">
              <h2 className="hf-section-title">{row.playbookName}</h2>
              <code className="hf-test-index-slug">{row.playbookSlug}</code>
            </header>
            <table className="hf-test-index-modules">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Slug</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {row.modules.map((mod) => {
                  const baseHref = `/x/test/${row.playbookSlug}/${mod.slug}`;
                  return (
                    <tr key={mod.slug}>
                      <td>{mod.title}</td>
                      <td>
                        <code>{mod.slug}</code>
                      </td>
                      <td className="hf-test-index-actions">
                        <Link
                          className="hf-btn hf-btn-primary hf-btn-sm"
                          href={`${baseHref}?learnerMode=fresh`}
                          data-testid={`hf-test-fresh-${row.playbookSlug}-${mod.slug}`}
                        >
                          Fresh
                        </Link>
                        <Link
                          className="hf-btn hf-btn-secondary hf-btn-sm"
                          href={`${baseHref}?learnerMode=return`}
                          data-testid={`hf-test-return-${row.playbookSlug}-${mod.slug}`}
                        >
                          Return
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </main>
  );
}

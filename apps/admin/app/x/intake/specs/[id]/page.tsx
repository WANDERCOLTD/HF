import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { loadRow } from "@/lib/intake/spec-store-adapter";
import "./intake-spec-detail.css";

// Phase 2b — uncomment when @tallyseal/admin-editor@0.1.0 is vendored
// (tallyseal TKT-ADMIN-EDITOR-LIB-EXTRACT, ETA EOD Tue 2026-06-09):
// import { EditorShell } from "@tallyseal/admin-editor";
// import { createSpecStoreAdapter } from "@/lib/intake/spec-store-adapter";

/**
 * @page /x/intake/specs/[id]
 *
 * #1182 Phase 2b-prep — IntakeSpec detail page stub.
 *
 * Renders a placeholder card while the editor surface is blocked on
 * `@tallyseal/admin-editor@0.1.0` (tallyseal
 * TKT-ADMIN-EDITOR-LIB-EXTRACT, ETA EOD Tue 2026-06-09). Once the
 * tarball is vendored:
 *   1. uncomment the EditorShell import above
 *   2. replace this placeholder card with `<EditorShell store={...} />`
 *   3. smoke test per the tallyseal spec §7 "HF unblock" checklist
 *
 * Phase 2b proper is a separate follow-up issue; this prep ensures the
 * route, ADMIN gate, RSC data fetch, and adapter wiring all hold.
 *
 * ADMIN+ gate (matches the Phase 2a list page at
 * app/x/intake/specs/page.tsx).
 */
export const dynamic = "force-dynamic";

export default async function IntakeSpecDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/intake/specs");
  }

  const { id } = await params;
  const row = await loadRow(id);
  if (row === null) notFound();

  // Best-effort field count from the stored body (defensive in case the
  // body shape drifts before the editor lands).
  const fieldCount =
    row.body && typeof row.body === "object" && !Array.isArray(row.body) &&
    "fields" in row.body && typeof row.body.fields === "object" &&
    row.body.fields !== null
      ? Object.keys(row.body.fields).length
      : 0;

  return (
    <main className="hf-page-shell">
      <nav aria-label="Breadcrumb" className="intake-spec-detail-breadcrumb">
        <Link href="/x/intake/specs" className="hf-btn hf-btn-secondary">
          ← Back to Intake Specs
        </Link>
      </nav>

      <h1 className="hf-page-title">
        <code>{row.key}</code>
        <span className="intake-spec-detail-version">@{row.version}</span>
      </h1>

      <section className="hf-card">
        <h2 className="hf-section-title">Spec metadata</h2>
        <dl className="intake-spec-detail-meta">
          <dt>Status</dt>
          <dd>
            <span
              className={`hf-badge ${row.status === "PUBLISHED" ? "hf-badge-success" : "hf-badge-warning"}`}
            >
              {row.status}
            </span>
          </dd>
          <dt>Field count</dt>
          <dd>{fieldCount}</dd>
          <dt>Extends</dt>
          <dd>{row.parentKey ?? "—"}</dd>
          <dt>Updated</dt>
          <dd>{row.updatedAt.toISOString()}</dd>
          <dt>Published</dt>
          <dd>{row.publishedAt ? row.publishedAt.toISOString() : "—"}</dd>
        </dl>
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">Editor</h2>
        <div className="hf-banner hf-banner-info">
          Editor surface is blocked on{" "}
          <code>@tallyseal/admin-editor@0.1.0</code> (tallyseal{" "}
          <a href="https://github.com/tallyseal/tallyseal/pull/74">
            TKT-ADMIN-EDITOR-LIB-EXTRACT
          </a>
          , ETA EOD Tue 2026-06-09). The route, ADMIN gate, RSC data
          fetch, and adapter wiring are all in place — Phase 2b
          integration is npm install + uncomment + smoke test.
        </div>
        <pre className="intake-spec-detail-body">
          {JSON.stringify(row.body, null, 2)}
        </pre>
      </section>
    </main>
  );
}

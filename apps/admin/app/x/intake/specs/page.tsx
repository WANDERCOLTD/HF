import { redirect } from "next/navigation";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { list, type SpecSummary } from "@/lib/intake/spec-store";
import "./intake-specs.css";

/**
 * @page /x/intake/specs
 *
 * #1140 Phase 2a — IntakeSpec list page. Shows every admin-authored
 * CrawcusSpec entry (DRAFT + PUBLISHED) read from the `IntakeSpec`
 * table via `lib/intake/spec-store.list()`.
 *
 * Editor surface (`/x/intake/specs/[id]`) is Phase 2b — blocked on
 * tallyseal Ask 2 (library extraction from apps/admin-viewer/). Until
 * then "New spec" + "Open" buttons render disabled with a tooltip
 * explaining the block. See:
 *   docs/feedback/tallyseal/hf-feedback-sprint-e-followups-20260606.md
 *
 * ADMIN+ gate.
 */
export const dynamic = "force-dynamic";

export default async function IntakeSpecsPage() {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/intake/specs");
  }

  const summaries = await list();

  return (
    <main className="hf-page-shell">
      <h1 className="hf-page-title">Intake Specs</h1>
      <p className="hf-section-desc intake-specs-subtitle">
        Admin-authored CrawcusSpec entries. Each row defines a structured
        intake (course, recipe, community, …). Downstream consumers —
        wizard chat, static forms, REST validators, CSV import — all read
        from the same row.
      </p>

      <section className="hf-card">
        <div className="intake-specs-toolbar">
          <span
            className="hf-btn hf-btn-primary intake-specs-btn-disabled"
            aria-disabled="true"
            title="Editor surface blocked on tallyseal Ask 2 — see docs/feedback/tallyseal/hf-feedback-sprint-e-followups-20260606.md"
          >
            New spec
          </span>
          <span className="hf-category-label">
            {summaries.length} spec{summaries.length === 1 ? "" : "s"} total
          </span>
        </div>

        {summaries.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="hf-table-container intake-specs-table">
            <div className="hf-table-header intake-specs-row">
              <span>Key</span>
              <span>Version</span>
              <span>Status</span>
              <span>Fields</span>
              <span>Extends</span>
              <span>Updated</span>
              <span aria-label="Actions" />
            </div>
            {summaries.map((row) => (
              <SpecRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="hf-empty">
      <h2 className="hf-section-title">No specs yet</h2>
      <p className="hf-section-desc">
        Run{" "}
        <code>cd apps/admin &amp;&amp; npx tsx scripts/seed-intake-specs.ts</code>{" "}
        on the VM to load the demonstration specs (CreateRecipe@1.0.0
        PUBLISHED and CreateCourse@0.1.0 DRAFT).
      </p>
      <div className="hf-banner hf-banner-info">
        Editor UI lands when <code>@tallyseal/admin-editor</code> ships per{" "}
        <a href="https://github.com/tallyseal/tallyseal/pull/72">
          tallyseal PR #72
        </a>
        {" "}
        (Ask 2).
      </div>
    </div>
  );
}

function SpecRow({ row }: { row: SpecSummary }) {
  const badgeClass =
    row.status === "PUBLISHED" ? "hf-badge-success" : "hf-badge-warning";
  return (
    <div className="hf-table-row intake-specs-row">
      <span>
        <code>{row.key}</code>
      </span>
      <span>{row.version}</span>
      <span>
        <span className={`hf-badge ${badgeClass}`} data-status={row.status}>
          {row.status}
        </span>
      </span>
      <span>{row.fieldCount}</span>
      <span>{row.parentKey ?? "—"}</span>
      <span>{row.updatedAt.toISOString().slice(0, 10)}</span>
      <span>
        <span
          className="hf-btn hf-btn-secondary intake-specs-btn-disabled"
          aria-disabled="true"
          title="Editor surface blocked on tallyseal Ask 2"
        >
          Open
        </span>
      </span>
    </div>
  );
}

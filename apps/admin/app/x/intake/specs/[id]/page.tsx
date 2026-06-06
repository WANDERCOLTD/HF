import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { loadRow, createSpecStoreAdapter } from "@/lib/intake/spec-store-adapter";
import { updateDraft } from "@/lib/intake/spec-store";
import type {
  SaveSpecCallback,
  DeploySpecCallback,
} from "@tallyseal/admin-editor";
import { EditorMount } from "./editor-mount";
import "./intake-spec-detail.css";

/**
 * @page /x/intake/specs/[id]
 *
 * #1194 Phase 2b — IntakeSpec detail page with mounted admin-editor.
 *
 * Renders <EditorShell> from @tallyseal/admin-editor inside a client
 * wrapper (editor-mount.tsx). Spec source is parsed by
 * @tallyseal/spec-emitter on the client; server actions defined
 * inline below call into the SpecStore adapter for saveDraft and
 * publish.
 *
 * Source-column compatibility:
 *   - Phase 2b+ rows always have `source` (seed populates; editor
 *     saveDraft populates)
 *   - Phase 2a rows (pre-#1194) may have `source = NULL` — page
 *     renders a "re-seed needed" banner instead of mounting the
 *     editor (clear UX, not a crash)
 *
 * ADMIN+ gate.
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

  const currentRole = auth.session.user.role ?? null;
  const canEdit = row.status === "DRAFT";
  const canDeploy = row.status === "DRAFT";
  const rowBody = row.body;

  // ────────────────────────────────────────────────────────────────
  // Server actions — invoked by EditorShell via its save / deploy
  // callback props. Each captures the spec id by closure.
  // ────────────────────────────────────────────────────────────────

  const saveSpecAction: SaveSpecCallback = async (input) => {
    "use server";
    try {
      // Phase 2b persists source verbatim; the body JSON cache stays
      // as last-seen (re-derivation lands Phase 2c via a parse+project
      // pass server-side per save).
      await updateDraft({
        id,
        body: rowBody,
        source: input.source,
      });
      return { kind: "ok" };
    } catch (err) {
      return {
        kind: "fail",
        detail: err instanceof Error ? err.message : "Unknown save error",
      };
    }
  };

  const deploySpecAction: DeploySpecCallback = async (input) => {
    "use server";
    try {
      // input.humanDescription is captured for audit (would land in
      // a SpecDeployRecord row in a Phase 2c follow-up). Phase 2b
      // publishes by id only; the editor-side description goes
      // through unused for now.
      void input;
      const store = createSpecStoreAdapter();
      const { deployOutcome } = await store.publish(id);
      if (deployOutcome.kind === "ok") {
        return {
          kind: "ok",
          prUrl: deployOutcome.prUrl,
          prNumber: deployOutcome.prNumber,
          commitSha: deployOutcome.commitSha,
          bridgeAccessEventId: deployOutcome.bridgeAccessEventId,
        };
      }
      return { kind: "fail", detail: deployOutcome.detail };
    } catch (err) {
      return {
        kind: "fail",
        detail: err instanceof Error ? err.message : "Unknown deploy error",
      };
    }
  };

  // ────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────

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
          <dt>Extends</dt>
          <dd>{row.parentKey ?? "—"}</dd>
          <dt>Updated</dt>
          <dd>{row.updatedAt.toISOString()}</dd>
          <dt>Published</dt>
          <dd>{row.publishedAt ? row.publishedAt.toISOString() : "—"}</dd>
        </dl>
      </section>

      {row.source ? (
        <section className="hf-card intake-spec-detail-editor">
          <EditorMount
            specName={row.key}
            source={row.source}
            canEdit={canEdit}
            canDeploy={canDeploy}
            currentRole={currentRole}
            saveSpecAction={saveSpecAction}
            deploySpecAction={deploySpecAction}
          />
        </section>
      ) : (
        <section className="hf-card">
          <div className="hf-banner hf-banner-warning">
            <strong>No source on record.</strong> This row pre-dates the{" "}
            <code>source</code> column (#1194). Re-run{" "}
            <code>scripts/seed-intake-specs.ts</code> on the VM to populate.
          </div>
          <pre className="intake-spec-detail-body">
            {JSON.stringify(row.body, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import "./help-demos.css";

/**
 * Demo Knob Reference — Epic #1442 Layer 3 Slice 1 (#1482) + Slice 2 (#1483).
 *
 * Operator-facing schema-driven catalogue of cascade-resolvable knobs
 * (Slice 1) plus the curated list of API surfaces operators touch during
 * demo prep / debugging (Slice 2). Both sections read generated JSON at
 * request time so the page is automatically current when CI regenerates.
 * Subsequent slices add live cascade-effective-value reads per course,
 * role-filtering, and Cmd+K shortcuts.
 *
 * Auth: OPERATOR+ only. STUDENT / VIEWER bounce back to /x.
 */

type KnobRow = {
  knobKey: string;
  family: string;
  label: string;
  description: string;
  recommendedLayer: "DOMAIN" | "PLAYBOOK";
  demoKnob: boolean;
  composeAffecting: boolean;
};

type DemoKnobsManifest = {
  $schema: string;
  generatedAt: string;
  knobs: KnobRow[];
};

type SurfaceCategory =
  | "courses"
  | "callers"
  | "voice"
  | "playbooks"
  | "settings"
  | "other";

type OperatorSurface = {
  route: string;
  file: string;
  methods: string[];
  authLevels: string[];
  description: string;
  category: SurfaceCategory;
};

type OperatorSurfacesManifest = {
  $schema: string;
  generatedAt: string;
  surfaces: OperatorSurface[];
};

function loadKnobs(): DemoKnobsManifest {
  // The generated JSON lives at repo root; this page lives in apps/admin.
  // Resolve from `process.cwd()` (apps/admin) up to the repo root.
  const path = resolve(process.cwd(), "..", "..", "docs/kb/generated/demo-knobs.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as DemoKnobsManifest;
}

function loadSurfaces(): OperatorSurfacesManifest {
  const path = resolve(
    process.cwd(),
    "..",
    "..",
    "docs/kb/generated/operator-surfaces.json",
  );
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as OperatorSurfacesManifest;
}

const OPERATOR_PLUS = new Set(["OPERATOR", "ADMIN", "SUPERADMIN"]);

export default async function HelpDemosPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user?.role ?? "DEMO";
  if (!OPERATOR_PLUS.has(role)) redirect("/x");

  const manifest = loadKnobs();
  const demoKnobs = manifest.knobs.filter((k) => k.demoKnob);
  const otherKnobs = manifest.knobs.filter((k) => !k.demoKnob);
  const familyGroups = groupByFamily(otherKnobs);

  const surfaces = loadSurfaces();
  const surfaceGroups = groupByCategory(surfaces.surfaces);

  return (
    <main className="hf-help-demos">
      <header className="hf-help-demos-header">
        <h1 className="hf-page-title">Demo Knob Reference</h1>
        <p className="hf-page-subtitle">
          Every cascade-resolvable knob that drives the demo experience, with
          its recommended override layer. Bookmarked here so you can tune a
          demo course in under five minutes.
        </p>
        <p className="hf-text-xs hf-text-muted">
          Generated from <code>lib/cascade/knob-keys.ts</code> on{" "}
          {new Date(manifest.generatedAt).toISOString().slice(0, 10)}.
        </p>
      </header>

      <section className="hf-card hf-help-demos-section">
        <h2 className="hf-section-title">Demo preset knobs ({demoKnobs.length})</h2>
        <p className="hf-section-desc">
          The four knobs the &quot;apply demo preset&quot; action will set in one click
          (Slice 4 — coming). Override these to tune a fresh demo caller to
          the OCEAN / Persuasion / CIO-CTO standard.
        </p>
        <KnobTable rows={demoKnobs} />
      </section>

      <section className="hf-card hf-help-demos-section">
        <h2 className="hf-section-title">
          All cascade knobs ({manifest.knobs.length})
        </h2>
        <p className="hf-section-desc">
          Every knob `lib/cascade/effective-value.ts` knows how to resolve.
          Grouped by family. If a knob isn&apos;t here, the cascade inspector
          will tell you why (Layer 2, #1469).
        </p>
        {Object.entries(familyGroups).map(([family, rows]) => (
          <details key={family} className="hf-help-demos-family">
            <summary>
              <span className="hf-help-demos-family-name">{family}</span>{" "}
              <span className="hf-text-xs hf-text-muted">({rows.length})</span>
            </summary>
            <KnobTable rows={rows} />
          </details>
        ))}
      </section>

      <section className="hf-card hf-help-demos-section">
        <h2 className="hf-section-title">
          Surfaces operators touch ({surfaces.surfaces.length})
        </h2>
        <p className="hf-section-desc">
          The API routes you&apos;ll hit in the admin UI during demo prep or
          debugging. Curated, not exhaustive — annotate more routes with{" "}
          <code>@operator-surface yes</code> as the demo workflow widens.
          Grouped by URL prefix.
        </p>
        <p className="hf-text-xs hf-text-muted">
          Generated from <code>scripts/capture/operator-surfaces.ts</code> on{" "}
          {new Date(surfaces.generatedAt).toISOString().slice(0, 10)}.
        </p>
        {SURFACE_CATEGORY_ORDER.filter((cat) => surfaceGroups[cat]?.length).map(
          (category) => {
            const rows = surfaceGroups[category] ?? [];
            return (
              <details
                key={category}
                className="hf-help-demos-family"
                open
              >
                <summary>
                  <span className="hf-help-demos-family-name">{category}</span>{" "}
                  <span className="hf-text-xs hf-text-muted">
                    ({rows.length})
                  </span>
                </summary>
                <SurfaceTable rows={rows} />
              </details>
            );
          },
        )}
      </section>
    </main>
  );
}

function KnobTable({ rows }: { rows: KnobRow[] }) {
  if (rows.length === 0) {
    return <p className="hf-text-xs hf-text-muted">No knobs in this group.</p>;
  }
  return (
    <table className="hf-help-demos-table">
      <thead>
        <tr>
          <th>Knob</th>
          <th>Description</th>
          <th>Family</th>
          <th>Recommended layer</th>
          <th>Compose-affecting?</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.knobKey}>
            <td>
              <code>{row.knobKey}</code>
              <div className="hf-text-xs hf-text-muted">{row.label}</div>
            </td>
            <td>{row.description}</td>
            <td>
              <span className="hf-category-label" data-tone="info">
                {row.family}
              </span>
            </td>
            <td>
              <span className="hf-category-label" data-tone="info">
                {row.recommendedLayer}
              </span>
            </td>
            <td>
              {row.composeAffecting ? (
                <span className="hf-category-label" data-tone="warning">
                  Yes — bumps composeInputsUpdatedAt
                </span>
              ) : (
                <span className="hf-text-xs hf-text-muted">No</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function groupByFamily(knobs: KnobRow[]): Record<string, KnobRow[]> {
  const out: Record<string, KnobRow[]> = {};
  for (const knob of knobs) {
    (out[knob.family] ??= []).push(knob);
  }
  return out;
}

const SURFACE_CATEGORY_ORDER: SurfaceCategory[] = [
  "courses",
  "callers",
  "voice",
  "playbooks",
  "settings",
  "other",
];

function groupByCategory(
  surfaces: OperatorSurface[],
): Partial<Record<SurfaceCategory, OperatorSurface[]>> {
  const out: Partial<Record<SurfaceCategory, OperatorSurface[]>> = {};
  for (const surface of surfaces) {
    (out[surface.category] ??= []).push(surface);
  }
  return out;
}

function SurfaceTable({ rows }: { rows: OperatorSurface[] }) {
  if (rows.length === 0) {
    return (
      <p className="hf-text-xs hf-text-muted">No surfaces in this group.</p>
    );
  }
  return (
    <table className="hf-help-demos-table">
      <thead>
        <tr>
          <th>Method</th>
          <th>Route</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.route}>
            <td>
              {row.methods.map((method) => (
                <span
                  key={method}
                  className="hf-category-label"
                  data-tone="info"
                >
                  {method}
                </span>
              ))}
            </td>
            <td>
              <code>{row.route}</code>
              {row.authLevels.length > 0 ? (
                <div className="hf-text-xs hf-text-muted">
                  auth: {row.authLevels.join(" / ")}
                </div>
              ) : null}
            </td>
            <td>{row.description || <span className="hf-text-muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

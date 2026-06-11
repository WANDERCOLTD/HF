import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

/**
 * Admin telemetry view — last-7d aggregate of HelpEvent rows.
 *
 * Epic #1442 Layer 3 Slice 3 — #1484.
 *
 * **ADMIN+ only** (not OPERATOR). Cross-operator usage is sensitive: the
 * table shows what other operators are clicking, which would expose
 * incidental behavioural data (Risk row in the issue). The role gate here
 * is intentionally stricter than the API route's OPERATOR gate.
 *
 * Renders the aggregate via Prisma `groupBy` (count + avg durationMs) on
 * (type, target). The aggregate query is intentionally simple — no JOIN
 * against User / Caller because `HelpEvent.userId` / `callerId` are FK-free
 * correlation hints only (see schema model docstring).
 *
 * Empty-set case: the `<EmptyState>` block below renders when zero rows
 * match the 7d window — the page must NEVER crash on an empty result.
 */

const ADMIN_PLUS = new Set(["ADMIN", "SUPERADMIN"]);

type AggregateRow = {
  type: string;
  target: string;
  count: number;
  avgDurationMs: number | null;
};

async function loadAggregate(): Promise<AggregateRow[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // groupBy returns one row per (type, target) tuple, with _count and _avg.
  const grouped = await prisma.helpEvent.groupBy({
    by: ["type", "target"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { durationMs: true },
    orderBy: { _count: { type: "desc" } },
    take: 200,
  });

  return grouped.map((row) => ({
    type: row.type,
    target: row.target,
    count: row._count?._all ?? 0,
    avgDurationMs: row._avg?.durationMs ?? null,
  }));
}

export default async function HelpTelemetryPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user?.role ?? "DEMO";
  if (!ADMIN_PLUS.has(role)) redirect("/x");

  const rows = await loadAggregate();

  return (
    <main className="hf-page">
      <header>
        <h1 className="hf-page-title">Help-surface telemetry</h1>
        <p className="hf-page-subtitle">
          Last-7d aggregate of operator help-surface events (doc views,
          cascade-inspector open/close, Cmd+K /demo fires). ADMIN-only —
          cross-operator usage is sensitive.
        </p>
      </header>

      <section className="hf-card">
        {rows.length === 0 ? (
          <div className="hf-empty">
            <p>No telemetry events in the last 7 days.</p>
            <p className="hf-text-xs hf-text-muted">
              Once operators start clicking <code>/x/help/demos</code>,
              cascade inspector badges, or fire <code>/demo</code> from
              Cmd+K, rows will appear here.
            </p>
          </div>
        ) : (
          <table className="hf-help-demos-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Target</th>
                <th>Count</th>
                <th>Avg durationMs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.type}::${row.target}`}>
                  <td>
                    <code>{row.type}</code>
                  </td>
                  <td>
                    <code>{row.target}</code>
                  </td>
                  <td>{row.count}</td>
                  <td>
                    {row.avgDurationMs === null
                      ? "—"
                      : Math.round(row.avgDurationMs).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

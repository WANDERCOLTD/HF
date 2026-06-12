import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { APPLOG_STAGE_FILTER } from "@/lib/pipeline/adaptive-loop-invariants";

/**
 * Admin pipeline-health view — last-7d aggregate of Adaptive Loop invariant
 * violations (epic #1510, story #1511).
 *
 * Reads AppLog rows with `stage LIKE 'pipeline.invariant.%'`, groups by stage
 * (one per invariant: I-AL1..I-AL5), shows count + first/last occurrence +
 * a sample payload.
 *
 * **ADMIN+ only** — mirrors `/x/help/telemetry`'s auth gate. Pipeline health
 * is operationally sensitive: the dashboard surfaces silent contract gaps
 * that the structural fix slices (epic #1510 Slices 2-6) drive to zero.
 *
 * Per-invariant contracts: see `docs/CHAIN-CONTRACTS.md` §6.
 */

const ADMIN_PLUS = new Set(["ADMIN", "SUPERADMIN"]);

type AggregateRow = {
  invariantId: string;
  stage: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  sampleMetadata: unknown;
  sampleLevel: string | null;
};

const KNOWN_INVARIANTS = ["I-AL1", "I-AL2", "I-AL3", "I-AL4", "I-AL5"] as const;
const INVARIANT_DESCRIPTIONS: Record<string, string> = {
  "I-AL1": "Memory presence — real-engine EXTRACT with substantive transcript produced zero CallerMemory rows.",
  "I-AL2": "Skill score aggregation — skill_* CallScore rows exist but CallerTarget.currentScore is null inside the 6h window.",
  "I-AL3": "Spec config sourcing — AGGREGATE-stage runner fell through to SKILL_DEFAULTS (informational, not a fault).",
  "I-AL4": "PROSODY skip — stage silently no-op'd (no-stereoUrl / no-tierPreset / no-provider). Cache-hit reasons are INFO not WARN.",
  "I-AL5": "Zero BehaviorTargets — SCORE_AGENT loaded zero BehaviorTarget(scope=PLAYBOOK) rows. Escalates to ERROR when SYSTEM defaults are also empty.",
};

function stageToInvariantId(stage: string): string {
  // e.g. "pipeline.invariant.i-al1" → "I-AL1"
  const tail = stage.split(".").pop() ?? "";
  return tail.toUpperCase();
}

async function loadAggregate(): Promise<AggregateRow[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Pull recent rows then aggregate in-memory — we have at most 5 stages and
  // the dashboard is ADMIN-only / low-traffic. Avoids a custom $queryRaw for
  // a small read.
  type LogRow = {
    stage: string;
    level: string | null;
    metadata: unknown;
    createdAt: Date;
  };

  let rows: LogRow[] = [];
  try {
    rows = await prisma.appLog.findMany({
      where: {
        stage: { startsWith: APPLOG_STAGE_FILTER },
        createdAt: { gte: since },
      },
      select: { stage: true, level: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
  } catch {
    // Empty state on read failure rather than crash the dashboard.
    return [];
  }

  const grouped = new Map<string, LogRow[]>();
  for (const r of rows) {
    const key = r.stage;
    const arr = grouped.get(key) ?? [];
    arr.push(r);
    grouped.set(key, arr);
  }

  const out: AggregateRow[] = [];
  for (const [stage, items] of grouped) {
    const sorted = items.slice().sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    out.push({
      invariantId: stageToInvariantId(stage),
      stage,
      count: items.length,
      firstAt: first.createdAt,
      lastAt: last.createdAt,
      sampleMetadata: last.metadata,
      sampleLevel: last.level,
    });
  }

  out.sort((a, b) => a.invariantId.localeCompare(b.invariantId));
  return out;
}

function formatPayload(payload: unknown): string {
  if (payload == null) return "—";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/**
 * Latest `pipeline.canary.run` row — written by the #1514 canary E2E
 * after each run (nightly via `.github/workflows/canary.yml`, or
 * ad-hoc via `npm run test:canary`). Renders the gate-by-gate verdict
 * so an operator can confirm at a glance "did the loop close last
 * night?" without digging through AppLog.
 */
async function loadLatestCanaryRun(): Promise<{
  createdAt: Date;
  level: string | null;
  message: string | null;
  metadata: unknown;
} | null> {
  try {
    return await prisma.appLog.findFirst({
      where: { stage: "pipeline.canary.run" },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        level: true,
        message: true,
        metadata: true,
      },
    });
  } catch {
    return null;
  }
}

export default async function PipelineHealthPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user?.role ?? "DEMO";
  if (!ADMIN_PLUS.has(role)) redirect("/x");

  const rows = await loadAggregate();
  const seen = new Set(rows.map((r) => r.invariantId));
  const latestCanary = await loadLatestCanaryRun();
  const canaryMeta =
    (latestCanary?.metadata as
      | {
          passed?: number;
          failed?: number;
          warns?: number;
          gateResults?: Array<{
            gate: string;
            outcome: string;
            detail: string;
          }>;
          warnOnly?: boolean;
        }
      | null
      | undefined) ?? null;

  return (
    <main className="hf-page">
      <header>
        <h1 className="hf-page-title">Pipeline health — Adaptive Loop invariants</h1>
        <p className="hf-page-subtitle">
          Last-7d aggregate of Adaptive Loop invariant violations (I-AL1..I-AL5).
          WARN-only by design — these signal silent contract gaps the structural
          fix slices in epic <code>#1510</code> are driving to zero. See{" "}
          <code>docs/CHAIN-CONTRACTS.md</code> §6 for the per-invariant contract.
        </p>
      </header>

      <section className="hf-card">
        {rows.length === 0 ? (
          <div className="hf-empty">
            <p>No invariant violations in the last 7 days.</p>
            <p className="hf-text-xs hf-text-muted">
              Either the loop is clean OR no pipeline runs have completed since
              the observability runner shipped. Wait a few real-engine calls
              and refresh.
            </p>
          </div>
        ) : (
          <table className="hf-help-demos-table">
            <thead>
              <tr>
                <th>Invariant</th>
                <th>Count (7d)</th>
                <th>Last severity</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Sample payload</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stage}>
                  <td>
                    <code>{row.invariantId}</code>
                    <div className="hf-text-xs hf-text-muted">
                      {INVARIANT_DESCRIPTIONS[row.invariantId] ?? row.stage}
                    </div>
                  </td>
                  <td>{row.count}</td>
                  <td>
                    <code>{row.sampleLevel ?? "—"}</code>
                  </td>
                  <td>{row.firstAt.toISOString()}</td>
                  <td>{row.lastAt.toISOString()}</td>
                  <td>
                    <pre className="hf-text-xs">{formatPayload(row.sampleMetadata)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">Latest canary run</h2>
        <p className="hf-section-desc">
          The Adaptive Loop canary E2E (story <code>#1514</code>) drives a
          real-engine call through EXTRACT → LEARN → AGGREGATE → COMPOSE and
          asserts the chain closes. Hard FAILs block deploy; WARNs surface
          the dependency stories (G9 / #1515 and G2 / #1516). Schedule:
          nightly via <code>.github/workflows/canary.yml</code>; ad-hoc via{" "}
          <code>npm run test:canary</code>.
        </p>
        {!latestCanary ? (
          <div className="hf-empty">
            <p>No canary run recorded yet.</p>
            <p className="hf-text-xs hf-text-muted">
              Run <code>npm run test:canary</code> with{" "}
              <code>ANTHROPIC_API_KEY</code> set, or wait for the nightly
              workflow to land its first result.
            </p>
          </div>
        ) : (
          <>
            <p className="hf-text-xs hf-text-muted">
              {latestCanary.createdAt.toISOString()} ·{" "}
              <code>{latestCanary.level ?? "info"}</code> ·{" "}
              {latestCanary.message ?? "(no summary)"}
              {canaryMeta?.warnOnly ? " · warn-only mode" : ""}
            </p>
            {canaryMeta?.gateResults && canaryMeta.gateResults.length > 0 && (
              <table className="hf-help-demos-table">
                <thead>
                  <tr>
                    <th>Gate</th>
                    <th>Outcome</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {canaryMeta.gateResults.map((g) => (
                    <tr key={g.gate}>
                      <td>
                        <code>{g.gate}</code>
                      </td>
                      <td>
                        <code>{g.outcome}</code>
                      </td>
                      <td className="hf-text-xs">{g.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="hf-card">
        <h2 className="hf-section-title">All five invariants</h2>
        <p className="hf-section-desc">
          Rows below show every documented invariant whether or not it fired in
          the last 7 days. Helps confirm an invariant is wired (vs silently
          absent because no stage emits it).
        </p>
        <table className="hf-help-demos-table">
          <thead>
            <tr>
              <th>Invariant</th>
              <th>Status (7d)</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {KNOWN_INVARIANTS.map((id) => (
              <tr key={id}>
                <td>
                  <code>{id}</code>
                </td>
                <td>{seen.has(id) ? "active" : "quiet"}</td>
                <td>{INVARIANT_DESCRIPTIONS[id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

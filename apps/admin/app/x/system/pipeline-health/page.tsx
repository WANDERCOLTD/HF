/**
 * /x/system/pipeline-health — admin tile for the silent-writer detector.
 *
 * Reads the last 24h of per-stage write counts from AppLog and renders
 * a grid showing each (stage, table) pair with a red badge when the
 * pair has been silent for the window. Calling the route also fires
 * fresh alarm rows for any silent finding (idempotent semantics
 * documented in `lib/pipeline/detect-silent-writers.ts`).
 *
 * #1622 / Epic #1618 Slice 1.
 */
import { requirePageAuth } from "@/lib/permissions";
import { detectSilentWriters, type SilentWriterFinding } from "@/lib/pipeline/detect-silent-writers";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PipelineHealthPage() {
  await requirePageAuth("OPERATOR");

  let result: Awaited<ReturnType<typeof detectSilentWriters>> | null = null;
  let errorMessage: string | null = null;
  try {
    result = await detectSilentWriters({ windowHours: 24 });
  } catch (err: any) {
    errorMessage = err?.message ?? "detector failed";
  }

  // Group findings by stage for the table render.
  const byStage = new Map<string, SilentWriterFinding[]>();
  for (const f of result?.findings ?? []) {
    const bucket = byStage.get(f.stage) ?? [];
    bucket.push(f);
    byStage.set(f.stage, bucket);
  }
  // Stable stage order matching the pipeline execution sequence.
  const stageOrder = ["EXTRACT", "SCORE_AGENT", "AGGREGATE", "REWARD", "ADAPT", "SUPERVISE", "COMPOSE"];
  const orderedStages = [...byStage.keys()].sort(
    (a, b) => stageOrder.indexOf(a) - stageOrder.indexOf(b),
  );

  const silentCount = (result?.findings ?? []).filter((f) => f.silent).length;

  return (
    <div className="hf-page">
      <div className="hf-page-header">
        <h1 className="hf-page-title">Pipeline Health</h1>
        <p className="hf-page-subtitle">
          Silent-writer detector — rolling 24h window. Red badge means the writer ran on at least one
          call but produced zero rows over the window.
        </p>
      </div>

      {errorMessage ? (
        <div className="hf-banner hf-banner-error">Detector failed: {errorMessage}</div>
      ) : null}

      {result ? (
        <>
          <div className="hf-card hf-mb-lg">
            <div className="hf-flex hf-gap-lg">
              <div>
                <div className="hf-text-xs hf-text-muted">Window</div>
                <div className="hf-text-bold">{result.windowHours}h</div>
              </div>
              <div>
                <div className="hf-text-xs hf-text-muted">Rows scanned</div>
                <div className="hf-text-bold">{result.rowsScanned.toLocaleString()}</div>
              </div>
              <div>
                <div className="hf-text-xs hf-text-muted">Alarms fired</div>
                <div className={result.alarmsFired > 0 ? "hf-text-bold hf-text-danger" : "hf-text-bold"}>
                  {result.alarmsFired}
                </div>
              </div>
              <div>
                <div className="hf-text-xs hf-text-muted">Silent (stage, table) pairs</div>
                <div className={silentCount > 0 ? "hf-text-bold hf-text-danger" : "hf-text-bold"}>
                  {silentCount}
                </div>
              </div>
            </div>
            <div className="hf-text-xs hf-text-muted hf-mt-md">
              Alarm rows land in <Link href="/x/logs">/x/logs</Link> under stage{" "}
              <code>pipeline.stage.silent_writer</code>. Cron / Cloud Scheduler can hit{" "}
              <code>GET /api/system/pipeline-health</code> on a daily cadence to keep the alarm
              stream warm without operator action.
            </div>
          </div>

          {orderedStages.length === 0 ? (
            <div className="hf-empty">
              No write-count rows in the last 24h. Run a pipeline call to populate.
            </div>
          ) : (
            orderedStages.map((stage) => {
              const findings = byStage.get(stage) ?? [];
              return (
                <div className="hf-card hf-mb-md" key={stage}>
                  <h2 className="hf-section-title">{stage}</h2>
                  <table className="hf-table">
                    <thead>
                      <tr>
                        <th>Table</th>
                        <th>Samples</th>
                        <th>Total writes</th>
                        <th>Last non-zero</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findings.map((f) => (
                        <tr key={f.table}>
                          <td><code>{f.table}</code></td>
                          <td>{f.samplesInWindow}</td>
                          <td>{f.totalWrites}</td>
                          <td>
                            {f.lastNonZeroAt
                              ? new Date(f.lastNonZeroAt).toLocaleString()
                              : <span className="hf-text-muted">—</span>}
                          </td>
                          <td>
                            {f.silent ? (
                              <span className="hf-badge hf-badge-danger">SILENT</span>
                            ) : (
                              <span className="hf-badge hf-badge-success">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </>
      ) : null}
    </div>
  );
}

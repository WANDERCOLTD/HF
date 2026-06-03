"use client";

// IntakeCoCPanel — scrollable Chain-of-Custody view over the intake
// event log. Renders one card per Event with the canonical fields
// auditors care about: kind / version / timestamp / actor / lawful
// basis / purpose / prevHash / contentHash / payload summary / AI
// provenance (when present).
//
// Pure presentation; no fetch, no mutations — give it events + an
// optional title and it renders. The chain link is visualised by
// rendering each event's prevHash as a small chip that should match
// the previous event's contentHash.

import type { Event } from "@/lib/intake/tallyseal";

interface IntakeCoCPanelProps {
  readonly events: readonly Event[];
  readonly title?: string;
  readonly maxHeightPx?: number;
}

export function IntakeCoCPanel({
  events,
  title = "Chain of Custody",
  maxHeightPx = 420,
}: IntakeCoCPanelProps) {
  return (
    <section className="intake-coc" data-testid="intake-coc-panel">
      <header className="intake-coc-header">
        <h3 className="hf-section-title">{title}</h3>
        <span className="hf-section-desc">{events.length} event{events.length === 1 ? "" : "s"}</span>
      </header>
      <ol className="intake-coc-list" style={{ maxHeight: `${maxHeightPx}px` }}>
        {events.length === 0 ? (
          <li className="intake-coc-empty">No events yet.</li>
        ) : (
          events.map((e, i) => (
            <CoCRow
              key={e.id}
              event={e}
              prevContentHash={i === 0 ? null : (events[i - 1] as { contentHash?: string }).contentHash ?? null}
            />
          ))
        )}
      </ol>
    </section>
  );
}

interface CoCRowProps {
  readonly event: Event;
  readonly prevContentHash: string | null;
}

function CoCRow({ event, prevContentHash }: CoCRowProps) {
  const e = event as unknown as {
    id: string;
    kind: string;
    version: number;
    timestamp: Date | string;
    actor?: { id?: string };
    lawfulBasis?: string;
    purpose?: string;
    prevHash?: string;
    contentHash?: string;
    payload?: unknown;
    ai?: { model?: string; tokensIn?: number; tokensOut?: number; costUsd?: number };
  };
  const ts = typeof e.timestamp === "string" ? new Date(e.timestamp) : e.timestamp;
  const chainOk = prevContentHash === null || e.prevHash === prevContentHash;
  return (
    <li className="intake-coc-row" data-event-kind={e.kind}>
      <div className="intake-coc-row-head">
        <span className="intake-coc-kind">{e.kind}</span>
        <span className="intake-coc-meta">
          v{e.version} · {ts instanceof Date ? ts.toISOString() : String(ts)}
        </span>
      </div>
      <dl className="intake-coc-dl">
        {e.lawfulBasis ? <Field label="lawfulBasis" value={e.lawfulBasis} /> : null}
        {e.purpose ? <Field label="purpose" value={e.purpose} /> : null}
        {e.actor?.id ? <Field label="actor" value={e.actor.id} /> : null}
        <Field
          label="prevHash"
          value={short(e.prevHash)}
          status={chainOk ? "ok" : "broken"}
          title={e.prevHash ?? ""}
        />
        <Field label="contentHash" value={short(e.contentHash)} title={e.contentHash ?? ""} />
        {e.ai ? (
          <Field
            label="ai"
            value={`${e.ai.model ?? "?"} · in:${e.ai.tokensIn ?? 0} out:${e.ai.tokensOut ?? 0} · $${(e.ai.costUsd ?? 0).toFixed(6)}`}
          />
        ) : null}
      </dl>
      {e.payload !== undefined ? (
        <details className="intake-coc-payload">
          <summary>payload</summary>
          <pre>{JSON.stringify(e.payload, null, 2)}</pre>
        </details>
      ) : null}
    </li>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly title?: string;
  readonly status?: "ok" | "broken";
}

function Field({ label, value, title, status }: FieldProps) {
  return (
    <div className="intake-coc-field" data-status={status ?? "neutral"}>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

function short(hash: string | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

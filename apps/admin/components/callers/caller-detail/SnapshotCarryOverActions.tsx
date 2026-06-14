"use client";

/**
 * SnapshotCarryOverActions — #1666 (Epic #1606 Group C Phase 2).
 *
 * Renders PENDING + IN_PROGRESS `CallAction` rows on the Snapshot tab so
 * the educator can see at a glance what's outstanding for the learner
 * before the next call.
 *
 * Pure UI over the existing `GET /api/callers/[callerId]/actions` route
 * — no new backend. The route already gates STUDENT scope via
 * `studentAllowedToReadCaller` so the Snapshot tab inherits it.
 *
 * Open question 3 from the #1666 grooming (BA body): Group A's planned
 * `carryOverActions` renderer for the Inspector slot serves the admin
 * Inspector preview, not the learner-facing Snapshot. This component is
 * Snapshot-only; the two surfaces don't share a component today. If the
 * Group A renderer lands later, lifting the row-render primitive into a
 * shared `<CarryOverActionRow>` is the natural follow-on.
 */

import { useEffect, useState } from "react";

interface SnapshotCarryOverActionsProps {
  callerId: string;
}

interface CarryOverAction {
  id: string;
  type: string;
  title: string;
  description: string | null;
  assignee: string;
  status: string;
  priority: string | null;
  dueAt: string | null;
  createdAt: string;
}

interface ActionsResponse {
  ok: boolean;
  actions: CarryOverAction[];
  counts: { pending: number; completed: number; total: number };
}

const OPEN_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);
const MAX_ROWS = 6;

function formatDue(iso: string | null): string {
  if (!iso) return "";
  const due = new Date(iso);
  const ms = due.getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return `overdue by ${Math.abs(days)}d`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days < 7) return `due in ${days}d`;
  if (days < 30) return `due in ${Math.round(days / 7)}w`;
  return `due ${due.toISOString().slice(0, 10)}`;
}

function priorityBadgeVariant(priority: string | null): string {
  switch ((priority ?? "").toUpperCase()) {
    case "HIGH":
    case "URGENT":
      return "hf-badge-warning";
    case "LOW":
      return "hf-badge-muted";
    default:
      return "hf-badge-info";
  }
}

export function SnapshotCarryOverActions({
  callerId,
}: SnapshotCarryOverActionsProps) {
  const [data, setData] = useState<ActionsResponse | null | "error">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/callers/${callerId}/actions`)
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setData("error");
          return;
        }
        const json = (await res.json()) as ActionsResponse;
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData("error");
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (data === null) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-carryover-actions"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Carry-over actions</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }

  if (data === "error") {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-carryover-actions"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Carry-over actions</div>
          <span className="hf-badge hf-badge-muted">Unable to load actions</span>
        </div>
      </section>
    );
  }

  const open = (Array.isArray(data.actions) ? data.actions : []).filter((a) =>
    OPEN_STATUSES.has(a.status),
  );

  if (open.length === 0) {
    return (
      <section
        className="hf-snapshot-section"
        data-testid="hf-snapshot-carryover-actions"
      >
        <div className="hf-card-compact">
          <div className="hf-category-label">Carry-over actions</div>
          <span className="hf-badge hf-badge-muted">No open actions</span>
        </div>
      </section>
    );
  }

  const visible = open.slice(0, MAX_ROWS);
  const hiddenCount = open.length - visible.length;

  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-carryover-actions"
    >
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Carry-over actions — {open.length} open
        </div>
        <ol className="hf-list-row">
          {visible.map((a) => {
            const due = formatDue(a.dueAt);
            return (
              <li key={a.id}>
                <span className="hf-badge hf-badge-info">{a.type}</span>{" "}
                <strong>{a.title}</strong>
                {a.priority && (
                  <span
                    className={`hf-badge ${priorityBadgeVariant(a.priority)}`}
                    style={{ marginLeft: 4 }}
                  >
                    {a.priority}
                  </span>
                )}
                <div className="hf-text-sm hf-text-muted">
                  {a.assignee}
                  {due && <> · {due}</>}
                  {a.status === "IN_PROGRESS" && <> · in progress</>}
                </div>
                {a.description && (
                  <div className="hf-text-sm">{a.description}</div>
                )}
              </li>
            );
          })}
        </ol>
        {hiddenCount > 0 && (
          <div className="hf-text-sm hf-text-muted">
            +{hiddenCount} more open action{hiddenCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { RosterCaller } from "@/app/api/callers/roster/route";
import type { Momentum, TriageCategory } from "@/lib/caller-utils";

type RosterRowProps = {
  caller: RosterCaller;
  inCallId?: string;
  isAdmin: boolean;
  routePrefix: string;
  groupLabel: string;
  sessionLabel: string;
  onNavigate: (callerId: string) => void;
  onObserve?: (callId: string) => void;
  onAction?: (action: string, callerId: string) => void;
};

// ─── Mastery Bar ─────────────────────────────────────────────

function MasteryBar({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="ros-mastery">
        <span className="ros-mastery-pct ros-mastery-none">&mdash;</span>
      </div>
    );
  }

  const pct = Math.round(value * 100);
  let colorClass = "ros-mastery-fill-good";
  if (value < 0.3) colorClass = "ros-mastery-fill-low";
  else if (value < 0.6) colorClass = "ros-mastery-fill-mid";
  else if (value >= 0.8) colorClass = "ros-mastery-fill-high";

  return (
    <div className="ros-mastery">
      <div className="ros-mastery-track">
        <div className={`ros-mastery-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="ros-mastery-pct">{pct}%</span>
    </div>
  );
}

// ─── Momentum Badge ──────────────────────────────────────────

const MOMENTUM_CONFIG: Record<Momentum, { icon: string; label: string; className: string }> = {
  accelerating: { icon: "↑", label: "Accel", className: "ros-momentum-up" },
  steady: { icon: "→", label: "Steady", className: "ros-momentum-steady" },
  slowing: { icon: "↓", label: "Slow", className: "ros-momentum-down" },
  new: { icon: "—", label: "New", className: "ros-momentum-new" },
};

function MomentumBadge({ momentum }: { momentum: Momentum }) {
  const config = MOMENTUM_CONFIG[momentum];
  return (
    <span className={`ros-momentum ${config.className}`}>
      {config.icon} {config.label}
    </span>
  );
}

// ─── Triage Icon ─────────────────────────────────────────────

const TRIAGE_ICON: Record<TriageCategory, string> = {
  attention: "⚠",
  advancing: "✅",
  active: "→",
  inactive: "⏸",
  new: "🆕",
};

// ─── Overflow Menu ───────────────────────────────────────────

function OverflowMenu({
  callerId,
  onAction,
}: {
  callerId: string;
  onAction: (action: string, callerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="ros-overflow" ref={ref}>
      <button
        className="ros-overflow-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="More actions"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="ros-overflow-menu">
          <button onClick={(e) => { e.stopPropagation(); onAction("snapshot", callerId); setOpen(false); }}>
            📥 Download Snapshot
          </button>
          <button onClick={(e) => { e.stopPropagation(); onAction("reset", callerId); setOpen(false); }}>
            🔄 Reset Analysis
          </button>
          <button onClick={(e) => { e.stopPropagation(); onAction("archive", callerId); setOpen(false); }}>
            📦 Archive
          </button>
          <div className="ros-overflow-divider" />
          <button
            className="ros-overflow-danger"
            onClick={(e) => { e.stopPropagation(); onAction("delete", callerId); setOpen(false); }}
          >
            🗑️ Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Recency Label ───────────────────────────────────────────

function recencyLabel(lastCallAt: string | null, sessionLabel: string): string {
  if (!lastCallAt) return `No ${sessionLabel.toLowerCase()}`;
  const days = Math.floor((Date.now() - new Date(lastCallAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

// ─── Row Component ───────────────────────────────────────────

export function RosterRow({
  caller,
  inCallId,
  isAdmin,
  routePrefix,
  groupLabel,
  sessionLabel,
  onNavigate,
  onObserve,
  onAction,
}: RosterRowProps) {
  const triageIcon = TRIAGE_ICON[caller.triage];
  const rowClass = `ros-row ${inCallId ? "ros-row-in-call" : `ros-row-${caller.triage}`}`;

  return (
    <div
      className={rowClass}
      onClick={() => inCallId && onObserve ? onObserve(inCallId) : onNavigate(caller.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onNavigate(caller.id); }}
    >
      {/* Triage + Name */}
      <div className="ros-cell-name">
        <span className="ros-triage-icon">{triageIcon}</span>
        <div>
          <div className="ros-name">
            {caller.name || caller.email || caller.phone || "Unknown"}
          </div>
          <div className="ros-name-sub">{caller.diagnostic}</div>
        </div>
      </div>

      {/* Group (classroom/domain) */}
      <div className="ros-cell-group">
        {caller.classroom ? (
          <span className="ros-group-badge">{caller.classroom.name}</span>
        ) : caller.domain ? (
          <span className="ros-group-badge">{caller.domain.name}</span>
        ) : (
          <span className="ros-group-none">—</span>
        )}
      </div>

      {/* Subject (current module) */}
      <div className="ros-cell-subject ros-col-subject">
        <span className="ros-subject">
          {caller.currentModule || (caller.totalModules > 0 ? "All complete" : "—")}
        </span>
      </div>

      {/* Mastery bar */}
      <div className="ros-cell-mastery">
        <MasteryBar value={caller.mastery} />
      </div>

      {/* Momentum */}
      <div className="ros-cell-momentum">
        <MomentumBadge momentum={caller.momentum} />
      </div>

      {/* Recency */}
      <div className="ros-cell-recency">
        {inCallId ? (
          <span className="ros-in-call-badge">
            <span className="ros-in-call-dot" />
            In Call
          </span>
        ) : (
          <span className="ros-recency">{recencyLabel(caller.lastCallAt, sessionLabel)}</span>
        )}
      </div>

      {/* Actions */}
      <div className="ros-cell-actions" onClick={(e) => e.stopPropagation()}>
        {inCallId && onObserve ? (
          <button
            className="hf-btn hf-btn-primary ros-observe-btn"
            onClick={(e) => { e.stopPropagation(); onObserve(inCallId); }}
          >
            Observe
          </button>
        ) : (
          <>
            <button
              className="ros-detail-btn"
              onClick={(e) => { e.stopPropagation(); onNavigate(caller.id); }}
              title="View detail"
            >
              <ChevronRight size={16} />
            </button>
            {isAdmin && onAction && (
              <OverflowMenu callerId={caller.id} onAction={onAction} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import { BookOpen } from "lucide-react";

// ── Types ──────────────────────────────────────────────

export interface TPItem {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  topicSlug: string | null;
  depth: number | null;
}

export interface SessionOption {
  session: number;
  label: string;
}

interface SessionTPListProps {
  /** Current session number (for highlighting in move dropdown) */
  sessionNumber: number;
  /** TPs assigned to this session */
  assertions: TPItem[];
  /** All sessions available as move targets */
  sessions: SessionOption[];
  /** Called when a TP is moved to a different session. toSession=0 means "unassign". */
  onMove: (assertionId: string, toSession: number) => void;
  /** Max TPs to show before "show more" (default 5) */
  maxVisible?: number;
  /** Hide move controls */
  readonly?: boolean;
}

// ── Category config ────────────────────────────────────

const CATEGORY_CSS: Record<string, string> = {
  fact: "hf-tp-category--fact",
  definition: "hf-tp-category--definition",
  rule: "hf-tp-category--rule",
  process: "hf-tp-category--process",
  example: "hf-tp-category--example",
  threshold: "hf-tp-category--threshold",
};

const CATEGORY_SHORT: Record<string, string> = {
  fact: "fact",
  definition: "defn",
  rule: "rule",
  process: "proc",
  example: "exmpl",
  threshold: "thrsh",
  overview: "ovrvw",
  summary: "summ",
};

// ── Component ──────────────────────────────────────────

export function SessionTPList({
  sessionNumber,
  assertions,
  sessions,
  onMove,
  maxVisible = 5,
  readonly = false,
}: SessionTPListProps) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? assertions : assertions.slice(0, maxVisible);
  const remaining = assertions.length - maxVisible;

  if (assertions.length === 0) {
    return (
      <div className="hf-tp-section">
        <div className="hf-tp-section-header">
          <BookOpen size={11} />
          Teaching Points
        </div>
        <div className="hf-tp-empty">No teaching points assigned</div>
      </div>
    );
  }

  return (
    <div className="hf-tp-section">
      <div className="hf-tp-section-header">
        <BookOpen size={11} />
        Teaching Points ({assertions.length})
      </div>
      {visible.map((tp) => (
        <TPRow
          key={tp.id}
          tp={tp}
          sessionNumber={sessionNumber}
          sessions={sessions}
          onMove={onMove}
          readonly={readonly}
        />
      ))}
      {!expanded && remaining > 0 && (
        <button
          className="hf-tp-show-more"
          onClick={() => setExpanded(true)}
        >
          + {remaining} more
        </button>
      )}
      {expanded && remaining > 0 && (
        <button
          className="hf-tp-show-more"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  );
}

// ── TP Row ─────────────────────────────────────────────

function TPRow({
  tp,
  sessionNumber,
  sessions,
  onMove,
  readonly,
}: {
  tp: TPItem;
  sessionNumber: number;
  sessions: SessionOption[];
  onMove: (assertionId: string, toSession: number) => void;
  readonly: boolean;
}) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const target = parseInt(e.target.value, 10);
      if (target !== sessionNumber) {
        onMove(tp.id, target);
      }
    },
    [tp.id, sessionNumber, onMove],
  );

  const catClass = CATEGORY_CSS[tp.category] || "hf-tp-category--fact";
  const catLabel = CATEGORY_SHORT[tp.category] || tp.category.slice(0, 5);

  return (
    <div className="hf-tp-row">
      <span className={`hf-tp-category ${catClass}`}>{catLabel}</span>
      <span className="hf-tp-text" title={tp.assertion}>{tp.assertion}</span>
      {tp.teachMethod && (
        <span className="hf-tp-method">{tp.teachMethod.replace(/_/g, " ")}</span>
      )}
      {!readonly && (
        <select
          className="hf-tp-move"
          value={sessionNumber}
          onChange={handleChange}
          title="Move to session"
        >
          {sessions.map((s) => (
            <option key={s.session} value={s.session}>
              S{s.session}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Unassigned Section ─────────────────────────────────

export function UnassignedTPList({
  assertions,
  sessions,
  onMove,
  onAutoAssign,
}: {
  assertions: TPItem[];
  sessions: SessionOption[];
  onMove: (assertionId: string, toSession: number) => void;
  onAutoAssign?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (assertions.length === 0) return null;

  const visible = expanded ? assertions : assertions.slice(0, 5);
  const remaining = assertions.length - 5;

  return (
    <div className="hf-tp-unassigned">
      <div className="hf-tp-unassigned-header">
        <span>Unassigned Teaching Points ({assertions.length})</span>
        {onAutoAssign && (
          <button className="hf-btn hf-btn-secondary hf-btn-sm" onClick={onAutoAssign}>
            Auto-assign
          </button>
        )}
      </div>
      {visible.map((tp) => (
        <TPRow
          key={tp.id}
          tp={tp}
          sessionNumber={0}
          sessions={sessions}
          onMove={onMove}
          readonly={false}
        />
      ))}
      {!expanded && remaining > 0 && (
        <button
          className="hf-tp-show-more"
          onClick={() => setExpanded(true)}
        >
          + {remaining} more
        </button>
      )}
    </div>
  );
}

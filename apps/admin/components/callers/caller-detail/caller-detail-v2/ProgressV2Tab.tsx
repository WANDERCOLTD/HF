"use client";

/**
 * Progress v2 — Educator Operating Console (BETA).
 *
 * LH menu of lenses + RHS context panel. Active lens lives in the URL
 * (`?view=<lens>`), additive to the existing `?tab=progress-v2`. The shell
 * itself is built here; individual lens components slot into LENSES via
 * the registry over PRs 6-8.
 */

import React, { useEffect } from "react";
import {
  Gauge,
  BarChart3,
  Sliders,
  BookOpen,
  Target,
  MessageSquare,
  ClipboardCheck,
  CheckSquare,
  Compass,
} from "lucide-react";
import { trackTabLoad } from "@/lib/caller-insights/telemetry";
import { useProgressV2View } from "./useProgressV2View";
import {
  LENSES,
  LENS_ORDER,
  type LensDef,
  type LensId,
} from "./lenses/registry";
import "./progress-v2.css";

type Props = {
  callerId: string;
  /** PR 7 — memory summary forwarded for the TopicsLens. */
  memorySummary?: {
    topTopics?: { topic: string; lastMentioned?: string }[];
    topicCount?: number;
    factCount?: number;
    preferenceCount?: number;
    eventCount?: number;
  } | null;
};

const ICON_NODES: Record<string, React.ReactNode> = {
  Gauge: <Gauge size={14} />,
  BarChart3: <BarChart3 size={14} />,
  Sliders: <Sliders size={14} />,
  BookOpen: <BookOpen size={14} />,
  Target: <Target size={14} />,
  MessageSquare: <MessageSquare size={14} />,
  ClipboardCheck: <ClipboardCheck size={14} />,
  CheckSquare: <CheckSquare size={14} />,
  Compass: <Compass size={14} />,
};

export function ProgressV2Tab({
  callerId,
  memorySummary,
}: Props): React.ReactElement {
  useEffect(() => {
    trackTabLoad("progress-v2");
  }, []);

  const { view, setView } = useProgressV2View();
  const activeDef = LENSES[view];

  return (
    <div className="hf-progress-v2-root">
      <div className="hf-progress-v2-beta-strip">
        BETA — new Educator Operating Console. Each lens panel fills in
        across PRs 6–8.
      </div>
      <div className="hf-progress-v2-shell">
        <nav className="hf-progress-v2-nav" aria-label="Insight lenses">
          <ul role="tablist">
            {LENS_ORDER.map((id) => {
              const def = LENSES[id];
              const isActive = id === view;
              return (
                <li key={id} className="hf-progress-v2-nav-item-wrap">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`hf-progress-v2-panel-${id}`}
                    className={`hf-progress-v2-nav-item${isActive ? " hf-progress-v2-nav-item--active" : ""}`}
                    onClick={() => setView(id)}
                  >
                    <span className="hf-progress-v2-nav-icon">
                      {ICON_NODES[def.iconKey] ?? null}
                    </span>
                    <span className="hf-progress-v2-nav-label">{def.label}</span>
                    {!def.Component && (
                      <span className="hf-progress-v2-nav-soon">soon</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <section
          id={`hf-progress-v2-panel-${view}`}
          role="tabpanel"
          className="hf-progress-v2-panel"
          aria-live="polite"
        >
          <LensPanel
            id={view}
            def={activeDef}
            callerId={callerId}
            memorySummary={memorySummary}
          />
        </section>
      </div>
    </div>
  );
}

function LensPanel({
  id,
  def,
  callerId,
  memorySummary,
}: {
  id: LensId;
  def: LensDef;
  callerId: string;
  memorySummary?: Props["memorySummary"];
}): React.ReactElement {
  if (def.Component) {
    const Component = def.Component;
    return <Component callerId={callerId} memorySummary={memorySummary} />;
  }
  return (
    <div className="hf-progress-v2-panel-empty">
      <span className="hf-progress-v2-coming-soon-tag">Coming soon</span>
      <h3 className="hf-progress-v2-panel-title">{def.label}</h3>
      {def.blurb && (
        <p className="hf-progress-v2-panel-blurb">{def.blurb}</p>
      )}
      <p className="hf-progress-v2-panel-meta">
        Lens id: <code>{id}</code>. Use the existing Progress tab
        (<code>?tab=what</code>) until this lens ships.
      </p>
    </div>
  );
}

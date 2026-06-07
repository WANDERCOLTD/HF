"use client";

/**
 * Progress v2 — Educator Operating Console (BETA).
 *
 * Caller-side wrapper around the shared `<ConsoleShell>`. Owns telemetry
 * (`trackTabLoad`), the BETA banner, and the URL-state delegation through
 * `useProgressV2View`. The shell does the rest.
 *
 * Slice 0 of epic #1263 extracted the layout + URL-state + lens-registry
 * shape into `components/shared/console-shell/` so the Course Design
 * Console (#1266 onward) reuses the same chrome.
 */

import React, { useEffect } from "react";
import { trackTabLoad } from "@/lib/caller-insights/telemetry";
import { ConsoleShell } from "@/components/shared/console-shell";
import { useProgressV2View } from "./useProgressV2View";
import { LENSES, LENS_ORDER, type LensId, type LensProps } from "./lenses/registry";
import "./progress-v2.css";

type Props = {
  callerId: string;
  /** PR 7 — memory summary forwarded for the TopicsLens. */
  memorySummary?: LensProps["memorySummary"];
};

const BETA_BANNER = (
  <>BETA — new Educator Operating Console. Each lens panel fills in across PRs 6–8.</>
);

const COMING_SOON_HELP = (
  <>Use the existing Progress tab (<code>?tab=what</code>) until this lens ships.</>
);

export function ProgressV2Tab({ callerId, memorySummary }: Props): React.ReactElement {
  useEffect(() => {
    trackTabLoad("progress-v2");
  }, []);

  const { view, setView } = useProgressV2View();

  return (
    <ConsoleShell<LensId, LensProps>
      lensOrder={LENS_ORDER}
      lenses={LENSES}
      lensProps={{ callerId, memorySummary }}
      activeLensId={view}
      onLensChange={setView}
      headerBanner={BETA_BANNER}
      comingSoonHelpText={COMING_SOON_HELP}
      ariaNavLabel="Insight lenses"
      idPrefix="hf-progress-v2"
    />
  );
}

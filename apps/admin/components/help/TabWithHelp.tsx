"use client";

import React from "react";
import { Tooltip } from "@/components/shared/Tooltip";
import { useTabTooltip } from "@/hooks/useTabTooltip";

interface TabWithHelpProps {
  /** Stable id matching TabHelp.id in lib/help/page-help.ts */
  tabId: string;
  children: React.ReactNode;
}

/**
 * Wraps a tab label with a delayed-hover tooltip sourced from the
 * page-help registry. No (i) icon — the label itself is the hover
 * target (Linear-style).
 */
export function TabWithHelp({ tabId, children }: TabWithHelpProps): React.ReactElement {
  const { about, whenToUse } = useTabTooltip(tabId);
  if (!about) {
    return <>{children}</> as React.ReactElement;
  }
  const content = (
    <>
      {about}
      {whenToUse ? <span className="hf-tooltip-when">{whenToUse}</span> : null}
    </>
  );
  return <Tooltip content={content}>{children}</Tooltip>;
}

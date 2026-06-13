"use client";

/**
 * DesignTab — the eventual replacement for `CourseDesignTab.tsx`. Demonstrates
 * the DesignerShell three-slot wiring with the existing `CourseDesignConsole`
 * mounted in the Canvas slot.
 *
 * S4 of #1555 — **NOT yet routed.** The existing `CourseDesignTab.tsx` stays
 * mounted as the Course Detail page's design lens. This file exists so the
 * follow-on epic (Renderers v2) can flip the import path once the registry
 * is populated; doing so today would prematurely change the layout without
 * any renderers to fill the Inspector slot (the acceptance gate for #1559
 * is **zero Preview behaviour change**).
 *
 * When wiring it in: in `page.tsx` (or wherever `CourseDesignTab` is imported)
 * swap the import + the prop pass-through. Inspector will be empty until at
 * least one renderer is registered via `registerPreviewRenderer(...)`.
 */

import { createElement, useMemo } from "react";

import {
  DesignerShell,
  getPreviewRenderer,
  useDesignerSelection,
} from "@/components/shared/designer-shell";
import type { PlaybookConfig } from "@/lib/types/json-fields";

import { CourseDesignConsole } from "../_components/CourseDesignConsole";

interface DesignTabProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
}

export function DesignTab({ courseId, playbookConfig }: DesignTabProps) {
  const { selectedKey } = useDesignerSelection();

  // Look up the renderer for the currently-selected section. The registry
  // is empty at S4 close — this always resolves to null until follow-ups
  // populate it, so the Inspector slot stays structurally absent and the
  // Canvas reclaims its full width.
  const inspectorNode = useMemo(() => {
    if (!selectedKey) return null;
    const renderer = getPreviewRenderer(selectedKey);
    if (!renderer) return null;
    return createElement(renderer, {
      data: undefined,
      selection: { selectedKey },
    });
  }, [selectedKey]);

  // The Console internally renders its own LH nav, so for S4 we pass `null`
  // to the DesignerShell nav slot and let the Console own both nav + canvas.
  // The follow-on epic will lift the Console's nav into the DesignerShell
  // nav slot once the Inspector is meaningful.
  return (
    <DesignerShell
      nav={null}
      canvas={
        <CourseDesignConsole
          courseId={courseId}
          playbookConfig={playbookConfig}
        />
      }
      inspector={inspectorNode}
    />
  );
}

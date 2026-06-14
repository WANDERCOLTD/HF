"use client";

/**
 * useDesignerSelection — selection-state hook for the DesignerShell.
 *
 * Owns a single `selectedKey: ComposeSectionKey | null` so the Inspector
 * slot can render renderer-specific UI for the section the educator just
 * clicked in the Canvas. Stateless of URL today; future stories may lift
 * to query-string via the standard `useConsoleView` pattern.
 *
 * Intentionally simple — the registry (`section-registry.ts`) does the
 * type-safety + dispatch; this hook just tracks "what is selected".
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import type { ComposeSectionKey } from "@/lib/compose";

export interface DesignerSelection {
  selectedKey: ComposeSectionKey | null;
}

export interface UseDesignerSelectionResult extends DesignerSelection {
  /** Accepts either a raw value or a `(prev) => next` updater — matches
   *  React's `Dispatch<SetStateAction<T>>` so functional updates work in
   *  callbacks without stale-closure pain. */
  setSelectedKey: Dispatch<SetStateAction<ComposeSectionKey | null>>;
  clear: () => void;
}

export function useDesignerSelection(
  initial: ComposeSectionKey | null = null,
): UseDesignerSelectionResult {
  const [selectedKey, setSelectedKey] = useState<ComposeSectionKey | null>(
    initial,
  );
  const clear = useCallback(() => setSelectedKey(null), []);
  return { selectedKey, setSelectedKey, clear };
}

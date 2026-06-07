"use client";

import { useConsoleView } from "@/components/shared/console-shell";
import { isLensId, type LensId } from "./lenses/registry";

/**
 * Thin wrapper around the shared `useConsoleView` hook so the Progress v2
 * call sites keep their original API. The wrapper pins the default lens
 * ("overview") and the console id used for the invalid-value warning.
 *
 * Slice 0 of epic #1263 — was a standalone implementation pre-shell-extract.
 */
export function useProgressV2View(): {
  view: LensId;
  setView: (next: LensId) => void;
} {
  return useConsoleView<LensId>({
    isValidId: isLensId,
    defaultId: "overview",
    consoleId: "progress-v2",
  });
}

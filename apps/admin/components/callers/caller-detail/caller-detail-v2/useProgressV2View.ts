"use client";

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isLensId, type LensId } from "./lenses/registry";

const DEFAULT_VIEW: LensId = "overview";

type State = {
  view: LensId;
  setView: (next: LensId) => void;
};

/**
 * URL-state hook for the Progress v2 lens.
 *
 * `?view=` is additive to `?tab=` — `router.replace` preserves every other
 * query parameter (e.g. `?tab=progress-v2&view=adaptation&requestedModuleId=42`).
 * Unknown `?view=` values fall back to "overview" with a console warning so
 * deep-linked typos don't blow up the page.
 *
 * Back-button works because `replace` (not `push`) keeps a single history
 * entry per lens click, matching the "stay inside Progress" mental model.
 * If users want true per-lens history they can deep-link.
 */
export function useProgressV2View(): State {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("view");
  const view: LensId = isLensId(raw) ? raw : DEFAULT_VIEW;

  // One-time warn on first invalid value so the bug is visible without
  // re-firing every render.
  useEffect(() => {
    if (raw && !isLensId(raw)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[progress-v2] Unknown ?view=${raw} — defaulting to "${DEFAULT_VIEW}".`,
      );
    }
  }, [raw]);

  const setView = useCallback(
    (next: LensId) => {
      const search = new URLSearchParams(params.toString());
      search.set("view", next);
      router.replace(`?${search.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return { view, setView };
}

"use client";

/**
 * URL-state hook for any ConsoleShell-powered surface.
 *
 * Generic version of the original `useProgressV2View`. The consumer supplies:
 *   - `isValidId` — type guard matching the consumer's lens-id union
 *   - `defaultId` — fallback when the URL value is missing/invalid
 *   - optional `paramName` — URL search-param key (defaults to "view")
 *
 * The hook reads the param on every render via `useSearchParams`, falls back
 * to `defaultId` for unknown values (with a one-time `console.warn`), and
 * preserves every other query param when writing via `router.replace`.
 *
 * `replace` (not `push`) is intentional — back-button stays at the page
 * before the console was entered, not at the previous lens. Matches the
 * "stay inside the console" mental model. Deep-links still work because
 * the param is read on every render.
 */

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface UseConsoleViewOptions<TId extends string> {
  isValidId: (raw: string | null | undefined) => raw is TId;
  defaultId: TId;
  /** URL search-param key. Defaults to "view". */
  paramName?: string;
  /** Optional console-id used for the one-time warn message on invalid values. */
  consoleId?: string;
}

export interface UseConsoleViewState<TId extends string> {
  view: TId;
  setView: (next: TId) => void;
}

export function useConsoleView<TId extends string>(
  options: UseConsoleViewOptions<TId>,
): UseConsoleViewState<TId> {
  const { isValidId, defaultId, paramName = "view", consoleId = "console" } = options;
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get(paramName);
  const view: TId = isValidId(raw) ? raw : defaultId;

  useEffect(() => {
    if (raw && !isValidId(raw)) {
      console.warn(
        `[${consoleId}] Unknown ?${paramName}=${raw} — defaulting to "${defaultId}".`,
      );
    }
  }, [raw, isValidId, defaultId, paramName, consoleId]);

  const setView = useCallback(
    (next: TId) => {
      const search = new URLSearchParams(params.toString());
      search.set(paramName, next);
      router.replace(`?${search.toString()}`, { scroll: false });
    },
    [params, router, paramName],
  );

  return { view, setView };
}

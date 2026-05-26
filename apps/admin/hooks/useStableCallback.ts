"use client";

import { useRef, useLayoutEffect, useCallback } from "react";

// ── useStableCallback ─────────────────────────────────────
//
// Returns a callback whose identity is stable across re-renders, while
// always invoking the latest `fn` passed in. Implements the useEvent RFC
// pattern (https://github.com/reactjs/rfcs/pull/220).
//
// Use this whenever a component needs to:
//   • pass a callback into a memoised child or a `useCallback`/`useMemo`
//     dependency array WITHOUT triggering re-creation on every render
//   • read the latest props/state inside a callback that itself must have
//     a stable identity (e.g. event listeners, poll callbacks)
//
// Replaces the manual `useRef(fn); ref.current = fn;` pattern that's
// scattered across the wizard hotspots — see `useAsyncStep.ts`.

export function useStableCallback<T extends (...args: never[]) => unknown>(
  fn: T,
): T {
  const ref = useRef<T>(fn);

  // useLayoutEffect (vs useEffect) keeps the ref current before any child
  // commits read it. Matches the useEvent RFC's "synchronously updated"
  // semantic. Falls back to useEffect on the server (no DOM = no layout).
  useLayoutEffect(() => {
    ref.current = fn;
  });

  // The wrapper itself is stable: useCallback with no deps. It reads from
  // the ref each invocation, so callers always see the latest `fn`.
  const stable = useCallback((...args: Parameters<T>) => {
    return ref.current(...args);
  }, []);

  return stable as T;
}

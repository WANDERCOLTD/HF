/**
 * useGlowState — canonical hook for the `hf-glow-active` save flash.
 *
 * Replaces ~12 ad-hoc `setSavedFlash` / `setSavedRecently` impls scattered
 * across components/course-design/* and components/voice/*. The glow
 * communicates "background save in progress / just succeeded" without
 * blocking the UI — distinct from `hf-spinner` which means "user must wait".
 *
 * Usage:
 *
 *   const glow = useGlowState();
 *   const onSave = async () => {
 *     await glow.run(async () => {
 *       await fetch("/api/...", { method: "PATCH", body });
 *     });
 *   };
 *   return <button className={glow.isActive ? "hf-glow-active" : ""}>Save</button>;
 *
 * Semantics:
 *  - `isActive` flips true as soon as `run` is called
 *  - stays true while the promise pends
 *  - stays true for `durationMs` after it resolves (default 1500ms)
 *  - on rejection: flips off immediately (caller surfaces the error)
 */

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_FLASH_MS = 1500;

export interface UseGlowStateResult {
  /** True while the save promise pends OR for `durationMs` after success. */
  isActive: boolean;
  /** Wrap your save promise. Returns the same promise. */
  run: <T>(promise: Promise<T>) => Promise<T>;
}

export function useGlowState(durationMs: number = DEFAULT_FLASH_MS): UseGlowStateResult {
  const [isActive, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const run = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActive(true);
    return promise.then(
      (value) => {
        timerRef.current = setTimeout(() => setActive(false), durationMs);
        return value;
      },
      (err) => {
        setActive(false);
        throw err;
      },
    );
  }, [durationMs]);

  return { isActive, run };
}

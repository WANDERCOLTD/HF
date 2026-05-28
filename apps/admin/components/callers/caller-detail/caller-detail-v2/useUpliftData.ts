"use client";

import { useEffect, useState } from "react";
import type { UpliftData } from "../types";

type UpliftFetchState = {
  data: UpliftData | null;
  loading: boolean;
  error: string | null;
};

/**
 * Shared fetch hook for `/api/callers/[id]/uplift`. Used by every Uplift v2
 * section so sections don't each issue their own parallel network call.
 *
 * Returns a stable `{ data, loading, error }` shape. Re-fetches when the
 * caller id changes; cancellable so stale state never lands after navigation.
 */
export function useUpliftData(callerId: string): UpliftFetchState {
  const [state, setState] = useState<UpliftFetchState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchUplift(): Promise<void> {
      if (cancelled) return;
      setState({ data: null, loading: true, error: null });
      try {
        const res = await fetch(`/api/callers/${callerId}/uplift`);
        const json = await res.json();
        if (cancelled) return;
        if (json?.ok && json.uplift) {
          setState({ data: json.uplift, loading: false, error: null });
        } else {
          setState({
            data: null,
            loading: false,
            error: json?.error ?? "Failed to load uplift data",
          });
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    }

    fetchUplift();
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  return state;
}

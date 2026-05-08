"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Standard API response shape used by most endpoints.
 * Endpoints return { ok: true, ...data } on success or { ok: false, error: string } on failure.
 */
export type ApiResponse<T> = {
  ok: boolean;
  error?: string;
} & Record<string, any>;

export interface UseApiOptions<T> {
  /** Skip initial fetch (useful for conditional loading) */
  skip?: boolean;
  /** Transform the raw response data before setting state */
  transform?: (data: ApiResponse<T>) => T;
  /** Called on successful fetch */
  onSuccess?: (data: T) => void;
  /** Called on fetch error */
  onError?: (error: string) => void;
  /** Cache TTL in ms. 0 = no cache (default). Set > 0 to cache responses. */
  cacheTtl?: number;
}

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Manually set data (for optimistic updates) */
  setData: (data: T | null) => void;
}

// ── Module-level caches ──────────────────────────────────
// In-flight request dedup: prevents duplicate concurrent fetches to the same URL
const inflightRequests = new Map<string, Promise<any>>();
// Response cache with TTL: stores successful responses for reuse
const responseCache = new Map<string, { data: any; fetchedAt: number }>();

/** Clear cached responses. Pass a URL to clear a specific entry, or omit to clear all. */
export function invalidateApiCache(url?: string): void {
  if (url) {
    responseCache.delete(url);
  } else {
    responseCache.clear();
  }
}

/**
 * Hook for fetching data from API endpoints.
 * Handles loading state, errors, and the standard { ok, ...data } response pattern.
 *
 * Features:
 * - In-flight request deduplication (same URL won't be fetched twice concurrently)
 * - Optional response caching with configurable TTL via `cacheTtl` option
 * - `refetch()` always bypasses cache
 *
 * @example Basic usage
 * ```tsx
 * const { data: goals, loading, error, refetch } = useApi<Goal[]>('/api/goals', {
 *   transform: (res) => res.goals
 * });
 * ```
 *
 * @example With caching (30s TTL)
 * ```tsx
 * const { data } = useApi<Domain[]>('/api/domains', {
 *   transform: (res) => res.domains,
 *   cacheTtl: 30000,
 * });
 * ```
 *
 * @example With dependencies (refetch when they change)
 * ```tsx
 * const { data } = useApi<Goal[]>(
 *   `/api/goals?status=${status}&type=${type}`,
 *   { transform: (res) => res.goals },
 *   [status, type]
 * );
 * ```
 */
export function useApi<T>(
  url: string | null,
  options: UseApiOptions<T> = {},
  deps: unknown[] = []
): UseApiResult<T> {
  const { skip = false, transform, onSuccess, onError, cacheTtl = 0 } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!skip && url !== null);
  const [error, setError] = useState<string | null>(null);

  // Track if component is mounted to avoid state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async (bypassCache = false) => {
    if (!url) {
      setLoading(false);
      return;
    }

    // Check response cache (only if TTL > 0 and not bypassing)
    if (!bypassCache && cacheTtl > 0) {
      const cached = responseCache.get(url);
      if (cached && (Date.now() - cached.fetchedAt) < cacheTtl) {
        if (!mountedRef.current) return;
        const result = transform ? transform(cached.data) : (cached.data as unknown as T);
        setData(result);
        setLoading(false);
        setError(null);
        onSuccess?.(result);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      // Deduplicate concurrent requests to the same URL
      let responsePromise = inflightRequests.get(url);
      if (!responsePromise) {
        responsePromise = fetch(url).then((r) => r.json());
        inflightRequests.set(url, responsePromise);
      }

      const json: ApiResponse<T> = await responsePromise;
      inflightRequests.delete(url);

      if (!mountedRef.current) return;

      if (json.ok) {
        // Cache successful response
        if (cacheTtl > 0) {
          responseCache.set(url, { data: json, fetchedAt: Date.now() });
        }
        const result = transform ? transform(json) : (json as unknown as T);
        setData(result);
        onSuccess?.(result);
      } else {
        const errorMsg = json.error || "Request failed";
        setError(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err) {
      inflightRequests.delete(url);
      if (!mountedRef.current) return;
      const errorMsg = err instanceof Error ? err.message : "Network error";
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [url, transform, onSuccess, onError, cacheTtl]);

  // Initial fetch and refetch on dependency changes. Spread expressions in
  // dep arrays are rejected by the new react-hooks rule — stringify the
  // user-supplied deps so the array shape stays static.
  const initialDepsKey = JSON.stringify(deps);
  useEffect(() => {
    if (!skip && url) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, skip, initialDepsKey]);

  return {
    data,
    loading,
    error,
    refetch: () => fetchData(true), // Always bypass cache on manual refetch
    setData,
  };
}

/**
 * Hook for fetching multiple API endpoints in parallel.
 *
 * @example
 * ```tsx
 * const { data, loading, error } = useApiParallel({
 *   summary: { url: '/api/metering/summary', transform: (r) => r },
 *   events: { url: '/api/metering/events', transform: (r) => r.events }
 * });
 * // data.summary, data.events
 * ```
 */
export function useApiParallel<T extends Record<string, unknown>>(
  endpoints: {
    [K in keyof T]: {
      url: string;
      transform?: (data: ApiResponse<T[K]>) => T[K];
    };
  },
  deps: unknown[] = []
): {
  data: { [K in keyof T]: T[K] | null };
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const keys = Object.keys(endpoints) as (keyof T)[];
  const initialData = keys.reduce(
    (acc, key) => ({ ...acc, [key]: null }),
    {} as { [K in keyof T]: T[K] | null }
  );

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stable dep key for the endpoints map — the new react-hooks rule rejects
  // function calls in dep arrays. Stringifying gives us the same invalidation
  // semantics with a static expression.
  const endpointsKey = JSON.stringify(
    keys.map((k) => [k, endpoints[k].url]),
  );
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const results = await Promise.all(
        keys.map(async (key) => {
          const { url, transform } = endpoints[key];
          const response = await fetch(url);
          const json = await response.json();

          if (!json.ok) {
            throw new Error(json.error || `Failed to fetch ${String(key)}`);
          }

          return { key, value: transform ? transform(json) : json };
        })
      );

      if (!mountedRef.current) return;

      const newData = results.reduce(
        (acc, { key, value }) => ({ ...acc, [key]: value }),
        {} as { [K in keyof T]: T[K] | null }
      );

      setData(newData);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointsKey]);

  // Stable dep key — the new react-hooks rule rejects function calls in
  // dep arrays. Stringifying preserves the original semantics: re-run when
  // the deps array contents change.
  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  return { data, loading, error, refetch: fetchAll };
}

export default useApi;

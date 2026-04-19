/**
 * Tests for useApi in-flight deduplication and optional TTL cache.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useApi, invalidateApiCache } from "@/hooks/useApi";

function mockOkResponse(data: Record<string, any> = {}) {
  return Promise.resolve({
    json: () => Promise.resolve({ ok: true, ...data }),
  });
}

function mockErrorResponse(error = "Not found") {
  return Promise.resolve({
    json: () => Promise.resolve({ ok: false, error }),
  });
}

describe("useApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateApiCache(); // Clear cache between tests
  });

  describe("basic behavior (no cache)", () => {
    it("fetches data on mount", async () => {
      mockFetch.mockReturnValue(mockOkResponse({ items: [1, 2, 3] }));

      const { result } = renderHook(() =>
        useApi("/api/test", { transform: (r) => r.items })
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toEqual([1, 2, 3]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("handles errors", async () => {
      mockFetch.mockReturnValue(mockErrorResponse("Server error"));

      const { result } = renderHook(() => useApi("/api/test"));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe("Server error");
    });

    it("skips fetch when skip=true", async () => {
      const { result } = renderHook(() =>
        useApi("/api/test", { skip: true })
      );

      expect(result.current.loading).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("in-flight deduplication", () => {
    it("deduplicates concurrent requests to the same URL", async () => {
      // Use a slow response to ensure both hooks start before resolution
      let resolveJson: (v: any) => void;
      const jsonPromise = new Promise((resolve) => {
        resolveJson = resolve;
      });

      mockFetch.mockReturnValue(
        Promise.resolve({ json: () => jsonPromise })
      );

      // Mount two hooks with the same URL in sequence
      const { result: result1 } = renderHook(() => useApi("/api/dedup-test"));
      renderHook(() => useApi("/api/dedup-test"));

      // Only one fetch() call should have been made (deduped via inflightRequests)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Resolve and let both hooks settle
      resolveJson!({ ok: true, value: 42 });
      await waitFor(() => expect(result1.current.loading).toBe(false));
    });
  });

  describe("TTL cache", () => {
    it("returns cached data within TTL", async () => {
      mockFetch.mockReturnValue(mockOkResponse({ value: "first" }));

      // First render — fetches fresh
      const { result, unmount } = renderHook(() =>
        useApi("/api/cached", { cacheTtl: 30000, transform: (r) => r.value })
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBe("first");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      unmount();

      // Second render — should use cache
      mockFetch.mockReturnValue(mockOkResponse({ value: "second" }));
      const { result: result2 } = renderHook(() =>
        useApi("/api/cached", { cacheTtl: 30000, transform: (r) => r.value })
      );

      await waitFor(() => expect(result2.current.loading).toBe(false));
      expect(result2.current.data).toBe("first"); // Cached
      expect(mockFetch).toHaveBeenCalledTimes(1); // No new fetch
    });

    it("refetch() bypasses cache", async () => {
      mockFetch.mockReturnValue(mockOkResponse({ value: "v1" }));

      const { result } = renderHook(() =>
        useApi("/api/cached", { cacheTtl: 30000, transform: (r) => r.value })
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBe("v1");

      // Now refetch — should bypass cache
      mockFetch.mockReturnValue(mockOkResponse({ value: "v2" }));
      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.data).toBe("v2");
      expect(mockFetch).toHaveBeenCalledTimes(2); // New fetch
    });

    it("does not cache when cacheTtl=0 (default)", async () => {
      mockFetch.mockReturnValue(mockOkResponse({ value: "a" }));

      const { unmount } = renderHook(() => useApi("/api/no-cache"));
      await waitFor(() => {});
      unmount();

      mockFetch.mockReturnValue(mockOkResponse({ value: "b" }));
      renderHook(() => useApi("/api/no-cache"));
      await waitFor(() => {});

      // Should have fetched twice (no caching)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("invalidateApiCache clears specific URL", async () => {
      mockFetch.mockReturnValue(mockOkResponse({ value: "cached" }));

      const { unmount } = renderHook(() =>
        useApi("/api/invalidate-test", { cacheTtl: 30000 })
      );
      await waitFor(() => {});
      unmount();

      // Invalidate
      invalidateApiCache("/api/invalidate-test");

      // Should fetch again
      mockFetch.mockReturnValue(mockOkResponse({ value: "fresh" }));
      renderHook(() =>
        useApi("/api/invalidate-test", { cacheTtl: 30000, transform: (r) => r.value })
      );
      await waitFor(() => {});

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("invalidateApiCache() clears all entries", async () => {
      mockFetch.mockReturnValue(mockOkResponse({}));

      const { unmount: u1 } = renderHook(() =>
        useApi("/api/a", { cacheTtl: 30000 })
      );
      const { unmount: u2 } = renderHook(() =>
        useApi("/api/b", { cacheTtl: 30000 })
      );
      await waitFor(() => {});
      u1();
      u2();

      invalidateApiCache();

      renderHook(() => useApi("/api/a", { cacheTtl: 30000 }));
      renderHook(() => useApi("/api/b", { cacheTtl: 30000 }));
      await waitFor(() => {});

      // 2 initial + 2 after invalidation = 4
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("does not cache errors", () => {
    it("error responses are not cached", async () => {
      mockFetch.mockReturnValue(mockErrorResponse("fail"));

      const { result, unmount } = renderHook(() =>
        useApi("/api/error-test", { cacheTtl: 30000 })
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe("fail");
      unmount();

      // Should retry (not serve cached error)
      mockFetch.mockReturnValue(mockOkResponse({ value: "recovered" }));
      renderHook(() => useApi("/api/error-test", { cacheTtl: 30000 }));
      await waitFor(() => {});

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

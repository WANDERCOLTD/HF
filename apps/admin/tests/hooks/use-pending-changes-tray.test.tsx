/**
 * Tests for usePendingChangesTray hook (epic #854 / Story #856).
 *
 * Covers: push / remove / clear, conflict resolution (same key+scope
 * replaces, preserves beforeValue, sticky AI flag), sessionStorage
 * round-trip, setCallerInContext, and the test-only mergeEntries helper.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import {
  PendingChangesTrayProvider,
  usePendingChangesTray,
  __testing__,
  type TrayEntry,
} from "@/hooks/use-pending-changes-tray";

const { mergeEntries, STORAGE_KEY, PERSIST_DEBOUNCE_MS } = __testing__;

// Mock sessionStorage
const store: Record<string, string> = {};
const mockSessionStorage = {
  getItem: vi.fn((key: string) => store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
};
Object.defineProperty(window, "sessionStorage", {
  value: mockSessionStorage,
  configurable: true,
});

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(PendingChangesTrayProvider, null, children);
}

function makeEntry(overrides: Partial<TrayEntry> = {}): Omit<TrayEntry, "id"> {
  return {
    key: "tolerances.masteryThreshold",
    label: "Mastery threshold",
    scopeLabel: "Course IELTS Prep",
    beforeValue: "0.7",
    afterValue: "0.6",
    scope: "playbook",
    scopeId: "pb-1",
    aiSuggested: false,
    fanoutScope: "none",
    ...overrides,
  };
}

describe("usePendingChangesTray", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty entries and null caller", () => {
    const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
    expect(result.current.entries).toEqual([]);
    expect(result.current.callerInContext).toBeNull();
  });

  it("push adds a new entry with a generated id", () => {
    const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
    act(() => {
      result.current.push(makeEntry());
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBeTruthy();
    expect(result.current.entries[0].key).toBe("tolerances.masteryThreshold");
  });

  it("remove deletes an entry by id", () => {
    const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
    act(() => {
      result.current.push(makeEntry({ key: "k-1" }));
      result.current.push(makeEntry({ key: "k-2" }));
    });
    const targetId = result.current.entries.find((e) => e.key === "k-1")!.id;
    act(() => {
      result.current.remove(targetId);
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].key).toBe("k-2");
  });

  it("clear empties all entries", () => {
    const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
    act(() => {
      result.current.push(makeEntry({ key: "k-1" }));
      result.current.push(makeEntry({ key: "k-2" }));
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.entries).toEqual([]);
  });

  it("setCallerInContext updates the caller", () => {
    const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
    act(() => {
      result.current.setCallerInContext({ id: "c-1", name: "Mary" });
    });
    expect(result.current.callerInContext).toEqual({ id: "c-1", name: "Mary" });
    act(() => {
      result.current.setCallerInContext(null);
    });
    expect(result.current.callerInContext).toBeNull();
  });

  describe("conflict resolution (same key + scopeId)", () => {
    it("second push for same key replaces afterValue but keeps original beforeValue", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        result.current.push(makeEntry({ beforeValue: "0.7", afterValue: "0.6" }));
      });
      act(() => {
        result.current.push(makeEntry({ beforeValue: "0.6", afterValue: "0.5" }));
      });
      expect(result.current.entries).toHaveLength(1);
      // beforeValue is sticky — diff is against the ORIGINAL DB value
      expect(result.current.entries[0].beforeValue).toBe("0.7");
      expect(result.current.entries[0].afterValue).toBe("0.5");
    });

    it("different scopeId for same key keeps both entries", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        result.current.push(makeEntry({ scopeId: "pb-1" }));
        result.current.push(makeEntry({ scopeId: "pb-2" }));
      });
      expect(result.current.entries).toHaveLength(2);
    });

    it("AI-then-human push for same key keeps aiSuggested true (sticky)", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        result.current.push(makeEntry({ aiSuggested: true }));
      });
      act(() => {
        result.current.push(makeEntry({ aiSuggested: false, afterValue: "0.5" }));
      });
      expect(result.current.entries[0].aiSuggested).toBe(true);
      expect(result.current.entries[0].afterValue).toBe("0.5");
    });
  });

  describe("sessionStorage round-trip", () => {
    it("debounced persist after PERSIST_DEBOUNCE_MS", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        result.current.push(makeEntry());
      });
      // Not persisted before debounce
      expect(store[STORAGE_KEY]).toBeUndefined();
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });
      expect(store[STORAGE_KEY]).toBeDefined();
      const parsed = JSON.parse(store[STORAGE_KEY]);
      expect(parsed.entries).toHaveLength(1);
    });

    it("clears storage when entries become empty and no caller", () => {
      // Pre-seed storage
      store[STORAGE_KEY] = JSON.stringify({
        entries: [{ ...makeEntry(), id: "x" }],
        callerInContext: null,
      });
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      // Wait for hydration + clear
      act(() => {
        result.current.clear();
      });
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
      });
      expect(store[STORAGE_KEY]).toBeUndefined();
    });

    it("hydrates from sessionStorage on mount", () => {
      store[STORAGE_KEY] = JSON.stringify({
        entries: [{ ...makeEntry({ key: "hydrated-key" }), id: "x-1" }],
        callerInContext: { id: "c-h", name: "Hydrated Caller" },
      });
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      // Hydration happens in a useEffect — needs a tick
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.entries[0].key).toBe("hydrated-key");
      expect(result.current.callerInContext?.name).toBe("Hydrated Caller");
    });
  });

  describe("hf:pending-change CustomEvent listener (#873)", () => {
    it("dispatching a valid CustomEvent pushes an aiSuggested entry", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        window.dispatchEvent(
          new CustomEvent("hf:pending-change", {
            detail: {
              key: "tolerances.masteryThreshold",
              label: "Mastery threshold",
              scopeLabel: "Course IELTS Prep",
              beforeValue: "0.7",
              afterValue: "0.6",
              scope: "playbook",
              scopeId: "pb-1",
              fanoutScope: "caller",
            },
          }),
        );
      });
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].aiSuggested).toBe(true);
      expect(result.current.entries[0].key).toBe("tolerances.masteryThreshold");
    });

    it("ignores events with malformed detail", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        window.dispatchEvent(
          new CustomEvent("hf:pending-change", { detail: null }),
        );
        window.dispatchEvent(
          new CustomEvent("hf:pending-change", {
            detail: { key: 123 /* not a string */ },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("hf:pending-change", { detail: "string" }),
        );
      });
      expect(result.current.entries).toHaveLength(0);
    });

    it("coerces unknown scope/fanoutScope to safe defaults", () => {
      const { result } = renderHook(() => usePendingChangesTray(), { wrapper });
      act(() => {
        window.dispatchEvent(
          new CustomEvent("hf:pending-change", {
            detail: {
              key: "k",
              label: "L",
              scopeLabel: "S",
              beforeValue: "a",
              afterValue: "b",
              scope: "bogus",
              scopeId: "x",
              fanoutScope: "all", // not allowed for AI — coerced
            },
          }),
        );
      });
      expect(result.current.entries[0].scope).toBe("playbook");
      expect(result.current.entries[0].fanoutScope).toBe("caller");
      expect(result.current.entries[0].aiSuggested).toBe(true);
    });
  });

  describe("mergeEntries (unit, no React)", () => {
    it("returns a new array when no conflict", () => {
      const existing: TrayEntry[] = [];
      const merged = mergeEntries(existing, makeEntry());
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBeTruthy();
    });

    it("preserves beforeValue on conflict", () => {
      const existing: TrayEntry[] = [
        { ...makeEntry({ beforeValue: "0.7" }), id: "fixed-id" },
      ];
      const merged = mergeEntries(
        existing,
        makeEntry({ beforeValue: "0.6", afterValue: "0.5" }),
      );
      expect(merged).toHaveLength(1);
      expect(merged[0].beforeValue).toBe("0.7");
      expect(merged[0].afterValue).toBe("0.5");
      expect(merged[0].id).toBe("fixed-id"); // id stable across conflict
    });
  });
});

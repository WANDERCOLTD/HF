"use client";

/**
 * Pending-changes tray state (epic #854 / Story #856).
 *
 * Accumulates compose-affecting settings edits from any surface (Course
 * Design page, Tune sidebar, Cmd+K palette, wizard chat, page chat) and
 * holds them until the user explicitly hits Save & apply on the tray.
 *
 * State lives in `sessionStorage` (per `contexts/StepFlowContext.tsx`
 * precedent) so entries survive in-tab navigation between Course Design
 * → caller pages → Tune sidebar without silent data-loss. Tab close
 * still drops the tray; the `beforeunload` warning is the tray
 * component's responsibility.
 *
 * Conflict resolution (#854 spec):
 *   - `push` with same `(key, scopeId)` REPLACES the existing entry,
 *     KEEPING the original `beforeValue` so the eventual save diffs
 *     against the original DB state, not the intermediate edit.
 *   - `aiSuggested` is sticky — an AI push followed by a human push for
 *     the same key keeps `aiSuggested: true`. Mixed AI/human ⇒ Toggle 2
 *     locked disabled (A5). This is defence-in-depth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "hf-pending-tray-v1";
const PERSIST_DEBOUNCE_MS = 3_000;

export type TrayEntryScope = "playbook" | "domain" | "system";
export type FanoutScope = "none" | "caller" | "all";

export interface TrayEntry {
  /** UUID — generated on push; used for stable React keys + remove(). */
  id: string;
  /**
   * Canonical config key path. Used for conflict resolution + for
   * pre-checking Toggle 2 against `FANOUT_CLASS_PLAYBOOK_KEYS`.
   * Examples: `"tolerances.masteryThreshold"`, `"onboardingWelcome"`,
   * `"isActive"` for spec toggles.
   */
  key: string;
  /** Human-readable field label. e.g. `"Mastery threshold"`. */
  label: string;
  /** Human-readable scope label. e.g. `"Course IELTS Prep"`. */
  scopeLabel: string;
  /** Original DB value as a display string. Set on first push for this key. */
  beforeValue: string;
  /** Proposed new value as a display string. Replaced on subsequent pushes. */
  afterValue: string;
  scope: TrayEntryScope;
  /** UUID of the playbook/domain. Ignored for `scope: 'system'`. */
  scopeId: string | null;
  /** True when the change was initiated by AI. Locks Toggle 2 disabled. */
  aiSuggested: boolean;
  /** Echoed from the helper result (`updatePlaybookConfig` etc.). */
  fanoutScope: FanoutScope;
}

export interface CallerInContext {
  id: string;
  name: string;
}

export interface PendingChangesTrayState {
  entries: TrayEntry[];
  callerInContext: CallerInContext | null;
  /** Replaces existing entry with same (key, scopeId), preserving beforeValue. */
  push: (entry: Omit<TrayEntry, "id">) => void;
  remove: (id: string) => void;
  clear: () => void;
  setCallerInContext: (caller: CallerInContext | null) => void;
}

// ── sessionStorage helpers ────────────────────────────────────────────

interface PersistedState {
  entries: TrayEntry[];
  callerInContext: CallerInContext | null;
}

function readStorage(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.entries)) return null;
    return {
      entries: parsed.entries,
      callerInContext: parsed.callerInContext ?? null,
    };
  } catch (err) {
    console.warn("[pending-tray] failed to parse stored state:", err);
    return null;
  }
}

function writeStorage(state: PersistedState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (state && (state.entries.length > 0 || state.callerInContext)) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage quota errors are silent — tray loses persistence but
    // continues to work in-memory until tab close.
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tray-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Conflict-resolved entry merge ─────────────────────────────────────

/**
 * Find an existing entry that conflicts with the incoming push. Conflict
 * is defined as same `(key, scopeId)` — different scopes (`playbook` vs
 * `domain`) with the same key are NOT conflicts.
 */
function findConflict(
  entries: TrayEntry[],
  incoming: Omit<TrayEntry, "id">,
): TrayEntry | undefined {
  return entries.find(
    (e) => e.key === incoming.key && e.scopeId === incoming.scopeId,
  );
}

function mergeEntries(
  entries: TrayEntry[],
  incoming: Omit<TrayEntry, "id">,
): TrayEntry[] {
  const conflict = findConflict(entries, incoming);
  if (!conflict) {
    return [...entries, { ...incoming, id: newId() }];
  }
  // Replace the conflicting entry. Keep ORIGINAL beforeValue (the user's
  // diff is against the DB, not against the intermediate edit). AI-sticky:
  // once AI-sourced, always AI-sourced until explicitly cleared.
  const merged: TrayEntry = {
    ...incoming,
    id: conflict.id,
    beforeValue: conflict.beforeValue,
    aiSuggested: conflict.aiSuggested || incoming.aiSuggested,
  };
  return entries.map((e) => (e.id === conflict.id ? merged : e));
}

// ── Context ───────────────────────────────────────────────────────────

const PendingChangesTrayContext = createContext<PendingChangesTrayState | null>(
  null,
);

export function PendingChangesTrayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState<TrayEntry[]>([]);
  const [callerInContext, setCallerInContextState] =
    useState<CallerInContext | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialise from sessionStorage — deferred to avoid hydration mismatch.
  useEffect(() => {
    const stored = readStorage();
    if (stored) {
      setEntries(stored.entries);
      setCallerInContextState(stored.callerInContext);
    }
    setHydrated(true);
  }, []);

  // Debounced persistence. Mirrors StepFlowContext's 3s pattern — frequent
  // pushes (rapid edits in Course Design) collapse to a single write.
  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      writeStorage({ entries, callerInContext });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [entries, callerInContext, hydrated]);

  const push = useCallback((incoming: Omit<TrayEntry, "id">) => {
    setEntries((prev) => mergeEntries(prev, incoming));
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  const setCallerInContext = useCallback((caller: CallerInContext | null) => {
    setCallerInContextState(caller);
  }, []);

  const value: PendingChangesTrayState = {
    entries,
    callerInContext,
    push,
    remove,
    clear,
    setCallerInContext,
  };

  return (
    <PendingChangesTrayContext.Provider value={value}>
      {children}
    </PendingChangesTrayContext.Provider>
  );
}

export function usePendingChangesTray(): PendingChangesTrayState {
  const ctx = useContext(PendingChangesTrayContext);
  if (!ctx) {
    throw new Error(
      "usePendingChangesTray must be used inside PendingChangesTrayProvider",
    );
  }
  return ctx;
}

/**
 * Internal helpers exported for unit tests only — DO NOT import from app code.
 */
export const __testing__ = {
  STORAGE_KEY,
  PERSIST_DEBOUNCE_MS,
  readStorage,
  writeStorage,
  mergeEntries,
};

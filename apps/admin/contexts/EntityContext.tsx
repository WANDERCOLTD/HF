"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

// Entity types that can be tracked in breadcrumbs
export type EntityType = "caller" | "call" | "spec" | "playbook" | "domain" | "transcript" | "memory" | "flow" | "subject" | "source";

export interface EntityBreadcrumb {
  type: EntityType;
  id: string;
  label: string;
  href?: string;
  data?: Record<string, unknown>; // Cached entity data for quick access
}

interface PageContext {
  page: string;
  params: Record<string, string>;
}

interface EntityContextState {
  breadcrumbs: EntityBreadcrumb[];
  currentEntity: EntityBreadcrumb | null;
  pageContext: PageContext;
}

interface EntityContextActions {
  pushEntity: (entity: EntityBreadcrumb) => void;
  popEntity: () => void;
  clearToEntity: (entityId: string) => void;
  replaceEntity: (entity: EntityBreadcrumb) => void;
  setPageContext: (page: string, params: Record<string, string>) => void;
  reset: () => void;
}

type EntityContextValue = EntityContextState & EntityContextActions;

const EntityContext = createContext<EntityContextValue | null>(null);

const STORAGE_KEY = "hf.entity.context";

function loadPersistedContext(): EntityBreadcrumb[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed: EntityBreadcrumb[] = JSON.parse(stored);
    // Deduplicate by ID (keep first occurrence)
    return parsed.filter(
      (crumb, index, self) => self.findIndex((c) => c.id === crumb.id) === index
    );
  } catch {
    return [];
  }
}

function persistContext(breadcrumbs: EntityBreadcrumb[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(breadcrumbs));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Pure reducer for pushEntity — exported for unit tests.
 *
 * Rules, in order:
 *   1. Same id already at the end → no-op (idempotent re-push).
 *   2. Otherwise → remove any entry with the same id OR the same type,
 *      then append the new entity at the end.
 *
 * Net invariant: at most one entity of each type is in the stack at any
 * time, and the pushed entity is always last.
 *
 * Two design deltas vs the original implementation:
 *
 *   (a) Dedupe by type runs across the WHOLE stack, not just the last
 *       slot. Pre-fix: `Course A → Learner X (publishedPlaybook A) →
 *       Learner Y (publishedPlaybook B)` ended up as `[playbook A,
 *       caller Y, playbook B]` (two playbook chips, the source of the
 *       "which scope?" ambiguity in DATA-mode AI Assistant). Post-fix:
 *       always exactly one of each leaf type.
 *
 *   (b) The previous "slice-to-existing on same id" rule has been
 *       removed. It conflated page-load pushes (CallerDetailPage pushes
 *       caller + publishedPlaybook on mount) with back-stack navigation,
 *       which truncated co-present entities of other types. Pages that
 *       genuinely want back-nav should use `clearToEntity()` directly.
 *       Re-pushing an existing id now just moves that entity to the end.
 */
export function computeNextBreadcrumbs(
  prev: EntityBreadcrumb[],
  entity: EntityBreadcrumb,
): EntityBreadcrumb[] {
  if (prev.length > 0 && prev[prev.length - 1].id === entity.id) {
    return prev;
  }
  const cleaned = prev.filter((e) => e.id !== entity.id && e.type !== entity.type);
  return [...cleaned, entity];
}

export function EntityProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const lastUserIdRef = useRef<string | undefined>(undefined);

  const [breadcrumbs, setBreadcrumbs] = useState<EntityBreadcrumb[]>([]);
  const [pageContext, setPageContextState] = useState<PageContext>({ page: "", params: {} });
  const [initialized, setInitialized] = useState(false);
  const pathname = usePathname();

  // Load persisted context on mount
  useEffect(() => {
    const persisted = loadPersistedContext();
    setBreadcrumbs(persisted);
    setInitialized(true);
  }, []);

  // #809 — reset pageContext when the route changes so a previous page's tab
  // or section state cannot bleed into the next page's chat payload. Pages
  // that own a tab/section setting call setPageContext() in their own effect
  // after this reset fires; pages that don't simply leave it blank.
  useEffect(() => {
    setPageContextState({ page: "", params: {} });
  }, [pathname]);

  // Reset entity context when user changes (login/logout/switch)
  useEffect(() => {
    if (session === undefined) return; // session still loading
    if (lastUserIdRef.current !== undefined && userId !== lastUserIdRef.current) {
      setBreadcrumbs([]);
      setPageContextState({ page: "", params: {} });
      sessionStorage.removeItem(STORAGE_KEY);
    }
    lastUserIdRef.current = userId;
  }, [userId, session]);

  // Persist context when breadcrumbs change
  useEffect(() => {
    if (initialized) {
      persistContext(breadcrumbs);
    }
  }, [breadcrumbs, initialized]);

  const currentEntity = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null;

  const pushEntity = useCallback((entity: EntityBreadcrumb) => {
    setBreadcrumbs((prev) => computeNextBreadcrumbs(prev, entity));
  }, []);

  const popEntity = useCallback(() => {
    setBreadcrumbs((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const clearToEntity = useCallback((entityId: string) => {
    setBreadcrumbs((prev) => {
      const index = prev.findIndex((e) => e.id === entityId);
      if (index >= 0) {
        return prev.slice(0, index + 1);
      }
      return prev;
    });
  }, []);

  const replaceEntity = useCallback((entity: EntityBreadcrumb) => {
    setBreadcrumbs((prev) => {
      if (prev.length === 0) {
        return [entity];
      }
      // Replace the last entity with the new one
      return [...prev.slice(0, -1), entity];
    });
  }, []);

  const setPageContext = useCallback((page: string, params: Record<string, string>) => {
    setPageContextState({ page, params });
  }, []);

  const reset = useCallback(() => {
    setBreadcrumbs([]);
    setPageContextState({ page: "", params: {} });
  }, []);

  const value: EntityContextValue = {
    breadcrumbs,
    currentEntity,
    pageContext,
    pushEntity,
    popEntity,
    clearToEntity,
    replaceEntity,
    setPageContext,
    reset,
  };

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>;
}

export function useEntityContext(): EntityContextValue {
  const context = useContext(EntityContext);
  if (!context) {
    throw new Error("useEntityContext must be used within an EntityProvider");
  }
  return context;
}

// Color mapping for entity types
export const ENTITY_COLORS: Record<EntityType, { bg: string; text: string; border: string }> = {
  caller: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  call: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  spec: { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  playbook: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  domain: { bg: "#fce7f3", text: "#be185d", border: "#f9a8d4" },
  transcript: { bg: "#e5e7eb", text: "#374151", border: "#d1d5db" },
  memory: { bg: "#cffafe", text: "#0e7490", border: "#67e8f9" },
  flow: { bg: "#cffafe", text: "#155e75", border: "#22d3ee" },
  subject: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  source: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
};

"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

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

export function EntityProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<EntityBreadcrumb[]>([]);
  const [pageContext, setPageContextState] = useState<PageContext>({ page: "", params: {} });
  const [initialized, setInitialized] = useState(false);

  // Load persisted context on mount
  useEffect(() => {
    const persisted = loadPersistedContext();
    setBreadcrumbs(persisted);
    setInitialized(true);
  }, []);

  // Persist context when breadcrumbs change
  useEffect(() => {
    if (initialized) {
      persistContext(breadcrumbs);
    }
  }, [breadcrumbs, initialized]);

  const currentEntity = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null;

  const pushEntity = useCallback((entity: EntityBreadcrumb) => {
    setBreadcrumbs((prev) => {
      // Don't add duplicate if same entity is already at the end
      if (prev.length > 0 && prev[prev.length - 1].id === entity.id) {
        return prev;
      }

      // Check if entity already exists in the stack - if so, clear to it
      const existingIndex = prev.findIndex((e) => e.id === entity.id);
      if (existingIndex >= 0) {
        return prev.slice(0, existingIndex + 1);
      }

      // If the last entity is the same type, replace it (e.g., Caller A → Caller B)
      // This prevents stacking multiple entities of the same type
      if (prev.length > 0 && prev[prev.length - 1].type === entity.type) {
        return [...prev.slice(0, -1), entity];
      }

      // Different type - add to breadcrumb trail (e.g., Caller → Call)
      return [...prev, entity];
    });
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

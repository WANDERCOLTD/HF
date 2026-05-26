"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { AssistantContext as AssistantContextType, AssistantLocation } from "@/hooks/useAssistant";

export type LayoutMode = "popout" | "floating" | "docked" | "minimized";
export type DockPosition = "top" | "right" | "bottom" | "left";

interface AssistantState {
  isOpen: boolean;
  layoutMode: LayoutMode;
  dockPosition: DockPosition;
  floatingPosition: { x: number; y: number };
  context?: AssistantContextType;
  location?: AssistantLocation;
}

interface GlobalAssistantContextValue extends AssistantState {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setDockPosition: (position: DockPosition) => void;
  setFloatingPosition: (position: { x: number; y: number }) => void;
  setContext: (context?: AssistantContextType) => void;
  setLocation: (location?: AssistantLocation) => void;
}

const GlobalAssistantContext = createContext<GlobalAssistantContextValue | null>(null);

export function GlobalAssistantProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AssistantState>({
    isOpen: false,
    layoutMode: "popout",
    dockPosition: "right",
    floatingPosition: { x: 0, y: 100 }, // Will be updated on mount
  });

  // Initialize floating position on client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      setState((prev) => ({
        ...prev,
        floatingPosition: { x: window.innerWidth - 500, y: 100 },
      }));
    }
  }, []);

  const open = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: true }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
  }, []);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setState((prev) => ({ ...prev, layoutMode: mode }));
  }, []);

  const setDockPosition = useCallback((position: DockPosition) => {
    setState((prev) => ({ ...prev, dockPosition: position }));
  }, []);

  const setFloatingPosition = useCallback((position: { x: number; y: number }) => {
    setState((prev) => ({ ...prev, floatingPosition: position }));
  }, []);

  const setContext = useCallback((context?: AssistantContextType) => {
    setState((prev) => ({ ...prev, context }));
  }, []);

  const setLocation = useCallback((location?: AssistantLocation) => {
    setState((prev) => ({ ...prev, location }));
  }, []);

  const value: GlobalAssistantContextValue = {
    ...state,
    open,
    close,
    toggle,
    setLayoutMode,
    setDockPosition,
    setFloatingPosition,
    setContext,
    setLocation,
  };

  return (
    <GlobalAssistantContext.Provider value={value}>
      {children}
    </GlobalAssistantContext.Provider>
  );
}

export function useGlobalAssistant(): GlobalAssistantContextValue {
  const context = useContext(GlobalAssistantContext);
  if (!context) {
    throw new Error("useGlobalAssistant must be used within GlobalAssistantProvider");
  }
  return context;
}

/**
 * Like {@link useGlobalAssistant} but returns `null` instead of throwing when
 * the provider is absent. Use this when a component wants the assistant
 * features if present but renders correctly outside the provider (e.g.
 * UnifiedAssistantPanel, which can be mounted standalone on legacy pages).
 *
 * Always called unconditionally — satisfies react-hooks/rules-of-hooks. (#865)
 */
export function useOptionalGlobalAssistant(): GlobalAssistantContextValue | null {
  return useContext(GlobalAssistantContext);
}

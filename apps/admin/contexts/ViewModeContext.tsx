"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { isRoleAtOrAbove } from "@/lib/roles";

export type ViewModePreference = "auto" | "simple" | "advanced";

interface ViewModeContextValue {
  preference: ViewModePreference;
  isAdvanced: boolean;
  setPreference: (pref: ViewModePreference) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

const STORAGE_KEY = "hf.viewMode";

function getStoredPreference(): ViewModePreference {
  if (typeof window === "undefined") return "auto";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "simple" || stored === "advanced" || stored === "auto") {
    return stored;
  }
  return "auto";
}

function resolveAdvanced(preference: ViewModePreference, role: string | undefined): boolean {
  if (preference === "simple") return false;
  if (preference === "advanced") return true;
  // "auto" — OPERATOR+ (level >= 3) defaults to advanced; EDUCATOR also qualifies
  return isRoleAtOrAbove(role, "OPERATOR");
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  // Read localStorage synchronously to avoid flash of wrong mode
  const [preference, setPreferenceState] = useState<ViewModePreference>(getStoredPreference);

  // While session is loading and preference is "auto", default to advanced
  // to avoid layout jump (most users are admin/educator roles)
  const isAdvanced = status === "loading" && preference === "auto"
    ? true
    : resolveAdvanced(preference, role);

  const setPreference = useCallback((pref: ViewModePreference) => {
    setPreferenceState(pref);
    localStorage.setItem(STORAGE_KEY, pref);
  }, []);

  const value: ViewModeContextValue = {
    preference,
    isAdvanced,
    setPreference,
  };

  return (
    <ViewModeContext.Provider value={value}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode(): ViewModeContextValue {
  const context = useContext(ViewModeContext);
  if (!context) {
    throw new Error("useViewMode must be used within a ViewModeProvider");
  }
  return context;
}

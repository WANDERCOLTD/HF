"use client";

/**
 * Holographic Page — Central State Management
 *
 * useReducer + context powering the two-pane holographic page.
 * Tracks: domain data, per-section summaries, readiness map,
 * active section, loading states, dirty fields, save status.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { SectionId } from "@/lib/holographic/permissions";
import type { UserRole } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────

export type ReadinessLevel = "ready" | "almost" | "incomplete" | "none";
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface HoloState {
  /** Domain ID — null in create mode */
  id: string | null;
  name: string;
  slug: string;
  description: string | null;
  institution: {
    id: string;
    name: string;
    type: { slug: string; name: string } | null;
  } | null;

  /** Per-section data (loaded lazily when section is activated) */
  sections: Partial<Record<SectionId, unknown>>;

  /** Raw domain detail from /api/domains/:id (for section components) */
  domainDetail: Record<string, unknown> | null;

  /** Raw readiness checks from /api/domains/:id/readiness (for ReadinessSection) */
  readinessChecks: Array<{
    id: string;
    name: string;
    passed: boolean;
    severity: string;
    message?: string;
    fixAction?: string;
  }>;

  /** Per-section readiness (always loaded — needed for map dots) */
  readinessMap: Record<SectionId, ReadinessLevel>;

  /** Per-section summaries (always loaded — needed for map cards) */
  summaries: Record<SectionId, string>;

  /** Which section is open in the editor pane */
  activeSection: SectionId;

  /** Page-level loading (initial fetch) */
  loading: boolean;

  /** Per-section loading (lazy section data fetch) */
  sectionLoading: SectionId[];

  /** Fields that have been modified since last save */
  dirty: string[];

  /** Auto-save status indicator */
  saveStatus: SaveStatus;

  /** User role for permission gating */
  role: UserRole;

  /** Whether the map panel is collapsed */
  mapCollapsed: boolean;
}

// ─── Actions ────────────────────────────────────────────

type HoloAction =
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_DOMAIN"; payload: Partial<HoloState> }
  | { type: "SET_ACTIVE_SECTION"; section: SectionId }
  | { type: "SET_SECTION_DATA"; section: SectionId; data: unknown }
  | { type: "SET_SECTION_LOADING"; section: SectionId; loading: boolean }
  | { type: "SET_READINESS"; readinessMap: Record<SectionId, ReadinessLevel> }
  | { type: "SET_SUMMARIES"; summaries: Partial<Record<SectionId, string>> }
  | { type: "SET_FIELD"; field: string; value: unknown }
  | { type: "MARK_DIRTY"; field: string }
  | { type: "CLEAR_DIRTY" }
  | { type: "SET_SAVE_STATUS"; status: SaveStatus }
  | { type: "SET_MAP_COLLAPSED"; collapsed: boolean }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_ID"; id: string };

// ─── Initial State ──────────────────────────────────────

const DEFAULT_READINESS: Record<SectionId, ReadinessLevel> = {
  identity: "none",
  curriculum: "none",
  behavior: "none",
  onboarding: "none",
  channels: "none",
  readiness: "none",
  structure: "none",
  "prompt-preview": "none",
};

const DEFAULT_SUMMARIES: Record<SectionId, string> = {
  identity: "",
  curriculum: "",
  behavior: "",
  onboarding: "",
  channels: "",
  readiness: "",
  structure: "",
  "prompt-preview": "",
};

export function createInitialState(
  role: UserRole,
  activeSection: SectionId,
): HoloState {
  return {
    id: null,
    name: "",
    slug: "",
    description: null,
    institution: null,
    sections: {},
    domainDetail: null,
    readinessChecks: [],
    readinessMap: { ...DEFAULT_READINESS },
    summaries: { ...DEFAULT_SUMMARIES },
    activeSection,
    loading: true,
    sectionLoading: [],
    dirty: [],
    saveStatus: "idle",
    role,
    mapCollapsed: false,
  };
}

// ─── Reducer ────────────────────────────────────────────

function holoReducer(state: HoloState, action: HoloAction): HoloState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.loading };

    case "SET_DOMAIN":
      return { ...state, ...action.payload, loading: false };

    case "SET_ACTIVE_SECTION":
      return { ...state, activeSection: action.section };

    case "SET_SECTION_DATA":
      return {
        ...state,
        sections: { ...state.sections, [action.section]: action.data },
      };

    case "SET_SECTION_LOADING": {
      const sectionLoading = action.loading
        ? [...state.sectionLoading, action.section]
        : state.sectionLoading.filter((s) => s !== action.section);
      return { ...state, sectionLoading };
    }

    case "SET_READINESS":
      return { ...state, readinessMap: action.readinessMap };

    case "SET_SUMMARIES":
      return {
        ...state,
        summaries: { ...state.summaries, ...action.summaries },
      };

    case "SET_FIELD":
      return { ...state, [action.field]: action.value };

    case "MARK_DIRTY":
      return {
        ...state,
        dirty: state.dirty.includes(action.field)
          ? state.dirty
          : [...state.dirty, action.field],
      };

    case "CLEAR_DIRTY":
      return { ...state, dirty: [] };

    case "SET_SAVE_STATUS":
      return { ...state, saveStatus: action.status };

    case "SET_MAP_COLLAPSED":
      return { ...state, mapCollapsed: action.collapsed };

    case "SET_NAME":
      return { ...state, name: action.name };

    case "SET_ID":
      return { ...state, id: action.id };

    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────

export interface HoloContextValue {
  state: HoloState;
  dispatch: React.Dispatch<HoloAction>;

  // Convenience actions
  setActiveSection: (section: SectionId) => void;
  setMapCollapsed: (collapsed: boolean) => void;
  markDirty: (field: string) => void;
  setSaveStatus: (status: SaveStatus) => void;
}

export const HoloContext = createContext<HoloContextValue | null>(null);

export function useHolo(): HoloContextValue {
  const ctx = useContext(HoloContext);
  if (!ctx) throw new Error("useHolo must be used within HolographicPage");
  return ctx;
}

export function useHoloReducer(
  role: UserRole,
  activeSection: SectionId,
) {
  const [state, dispatch] = useReducer(
    holoReducer,
    createInitialState(role, activeSection),
  );

  const setActiveSection = useCallback(
    (section: SectionId) => dispatch({ type: "SET_ACTIVE_SECTION", section }),
    [],
  );

  const setMapCollapsed = useCallback(
    (collapsed: boolean) => dispatch({ type: "SET_MAP_COLLAPSED", collapsed }),
    [],
  );

  const markDirty = useCallback(
    (field: string) => dispatch({ type: "MARK_DIRTY", field }),
    [],
  );

  const setSaveStatus = useCallback(
    (status: SaveStatus) => dispatch({ type: "SET_SAVE_STATUS", status }),
    [],
  );

  return {
    state,
    dispatch,
    setActiveSection,
    setMapCollapsed,
    markDirty,
    setSaveStatus,
  };
}

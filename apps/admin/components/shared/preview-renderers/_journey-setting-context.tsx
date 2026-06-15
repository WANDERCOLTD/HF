"use client";

/**
 * Journey-setting mutator context — Phase 2 of epic #1675 (story #1687).
 *
 * Lets the Inspector renderers opt into editability WITHOUT changing the
 * `PreviewRendererProps` signature (which would ripple through 11 sites
 * + DesignTab.tsx). Consumers read `useJourneySetting()` — when
 * `courseId` is present, render `<JourneyField>` primitives; when null,
 * fall back to the legacy read-only display.
 *
 * Phase 3 (#1693) extends the context with optional `playbookConfig` so
 * compound primitives (Banding, Targets) can seed their wrapped
 * editor's initial state.
 *
 * Wired by `DesignTab.tsx` (Phase 4) and `CourseDesignSidetray.tsx`
 * (Phase 2 follow-up). Anywhere a renderer mounts inside an editable
 * surface, wrap with `<JourneySettingMutatorProvider>`.
 *
 * Underscore-prefix = renderer-internal; not in the public barrel.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useJourneySettingMutator } from "./_useJourneySettingMutator";

export interface JourneySettingContextValue {
  /** When null, renderers fall back to read-only mode. */
  courseId: string | null;
  /** Mutator. When `courseId` is null, calling this throws. */
  saveSetting: (settingId: string, value: unknown) => Promise<void>;
  /** When true, the renderer should suppress its edit affordances even
   *  if `courseId` is set. Used by the legacy Preview tab during the
   *  Journey-tab dual-running window. */
  readonly: boolean;
  /** Phase 3: optional playbookConfig snapshot. Compound primitives
   *  (Banding, Targets) read this to seed their wrapped editor. When
   *  absent, those primitives fall back to placeholder mode. */
  playbookConfig?: Record<string, unknown> | null;
  /** Phase 3: optional callback fired when a compound editor saves
   *  via its own internal save loop (bypassing the journey-setting
   *  PATCH route). DesignTab uses this to re-fetch playbookConfig. */
  onCompoundSaved?: () => void;
}

const JourneySettingContext = createContext<JourneySettingContextValue>({
  courseId: null,
  saveSetting: async () => {
    throw new Error("useJourneySetting: no provider mounted");
  },
  readonly: true,
});

export interface JourneySettingMutatorProviderProps {
  courseId: string | null;
  readonly?: boolean;
  /** Phase 3: pass playbookConfig so compound primitives can mount. */
  playbookConfig?: Record<string, unknown> | null;
  /** Phase 3: fired after a compound editor's internal save loop runs. */
  onCompoundSaved?: () => void;
  children: ReactNode;
}

export function JourneySettingMutatorProvider({
  courseId,
  readonly = false,
  playbookConfig,
  onCompoundSaved,
  children,
}: JourneySettingMutatorProviderProps) {
  const mutator = useJourneySettingMutator(courseId);
  const value = useMemo<JourneySettingContextValue>(
    () => ({
      courseId,
      saveSetting: mutator,
      readonly: readonly || courseId === null,
      playbookConfig,
      onCompoundSaved,
    }),
    [courseId, mutator, readonly, playbookConfig, onCompoundSaved],
  );
  return (
    <JourneySettingContext.Provider value={value}>
      {children}
    </JourneySettingContext.Provider>
  );
}

export function useJourneySetting(): JourneySettingContextValue {
  return useContext(JourneySettingContext);
}

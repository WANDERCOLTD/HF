"use client";

/**
 * Journey-setting mutator context — Phase 2 of epic #1675 (story #1687).
 *
 * Lets the Inspector renderers opt into editability WITHOUT changing the
 * `PreviewRendererProps` signature (which would ripple through 11 sites
 * + DesignTab.tsx). Consumers read `useJourneySettingContext()` — when
 * `courseId` is present, render `<JourneyField>` primitives; when null,
 * fall back to the legacy read-only display.
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
  children: ReactNode;
}

export function JourneySettingMutatorProvider({
  courseId,
  readonly = false,
  children,
}: JourneySettingMutatorProviderProps) {
  const mutator = useJourneySettingMutator(courseId);
  const value = useMemo<JourneySettingContextValue>(
    () => ({
      courseId,
      saveSetting: mutator,
      readonly: readonly || courseId === null,
    }),
    [courseId, mutator, readonly],
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

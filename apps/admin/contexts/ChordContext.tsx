"use client";

import React, { createContext, useContext, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useChordShortcut } from "@/hooks/useChordShortcut";
import {
  canSeeOperatorOnly,
  getEffectiveChords,
  type ChordBinding,
} from "@/lib/help/page-help";

interface ChordContextValue {
  /** "H" or "G" while a chord is armed; null otherwise. */
  activePrefix: string | null;
  /** The chord bindings available at the current pathname, post operator-filter. */
  chords: readonly ChordBinding[];
}

const ChordContext = createContext<ChordContextValue>({
  activePrefix: null,
  chords: [],
});

/**
 * Global H+letter / G+letter chord runner + context provider (#966, #970).
 *
 * Mounted once in `app/layout.tsx` wrapping the page tree. Drives the
 * `useChordShortcut` engine against the active pathname's `PAGE_HELP_REGISTRY`
 * entries plus `GLOBAL_CHORDS` (combined via `getEffectiveChords`). Filters
 * `requiresOperator` chords by session role using `canSeeOperatorOnly`
 * — same gate the help overlay already applies for display.
 *
 * Exposes both `activePrefix` and the current `chords` list via context so
 * `ChordHintBadge` (also globally mounted, #970) can render its hint UI
 * anywhere in the page tree without per-page wiring.
 *
 * Replaces the 3 per-page runner mounts that previously lived in
 * CallerDetailPage, courses/[courseId]/page, and V5WizardWithSelector.
 */
export function ChordShortcutProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname() || "/";
  const { data: session } = useSession();
  const isOperator = canSeeOperatorOnly(
    session?.user?.role as string | undefined,
  );
  // Memoise so useChordShortcut's effect only re-registers the keydown
  // listener on real route or role changes — not on every render.
  const effectiveChords = useMemo<ChordBinding[]>(
    () =>
      getEffectiveChords(pathname).filter(
        (c) => !c.requiresOperator || isOperator,
      ),
    [pathname, isOperator],
  );
  const { activePrefix } = useChordShortcut(effectiveChords);
  // Stable context value so consumers (e.g. ChordHintBadge) only re-render on
  // meaningful state changes — not on every parent re-render.
  const value = useMemo<ChordContextValue>(
    () => ({ activePrefix, chords: effectiveChords }),
    [activePrefix, effectiveChords],
  );
  return (
    <ChordContext.Provider value={value}>{children}</ChordContext.Provider>
  );
}

/**
 * Subscribe to the global chord state. Safe to call outside the provider —
 * returns `{ activePrefix: null, chords: [] }` by default so badges in
 * detached test harnesses don't throw.
 */
export function useChordContext(): ChordContextValue {
  return useContext(ChordContext);
}

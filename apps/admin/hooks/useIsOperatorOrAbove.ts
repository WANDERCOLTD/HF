"use client";

/**
 * useIsOperatorOrAbove — shared role-gate hook.
 *
 * Returns `true` when the current session user holds at least OPERATOR
 * level (OPERATOR / ADMIN / SUPERADMIN). Returns `false` when the
 * session is loading, unauthenticated, or held by a STUDENT / TESTER /
 * VIEWER / DEMO.
 *
 * Use this to gate UI that should be visible only to educators /
 * operators, with read-only fallback (or hidden render) for learners.
 * Mirrors the inline pattern already established at
 * `AdaptationsTab.tsx:84-90`; lifted here so the
 * `interpretationHigh/Low` OPERATOR-only sweep (#1664) and any
 * future cross-cutting role-gate has one place to import from.
 *
 * **Decision 5 (Group C grooming) — interpretationHigh/Low chip
 * surfaces.** The 5 sites that render `Parameter.interpretationHigh`
 * or `interpretationLow` consume this hook:
 *   - `components/playbook/playbook-builder/ParametersTab.tsx`
 *   - `components/playbook/PlaybookBuilder.tsx`
 *   - `components/shared/PersonalityRadar.tsx`
 *   - `components/callers/caller-detail/PromptTunerSidebar.tsx`
 *   - `components/callers/caller-detail/CallsTab.tsx`
 *
 * Most of those surfaces are inside admin-only pages today; the hook
 * is belt-and-suspenders defence-in-depth so when (not if) one of
 * them gets reused inside a STUDENT-visible surface, the
 * interpretation chips don't leak.
 */

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import type { UserRole } from "@prisma/client";

import { ROLE_LEVEL } from "@/lib/roles";

export function useIsOperatorOrAbove(): boolean {
  const { data: session } = useSession();
  return useMemo(() => {
    const role = session?.user?.role as UserRole | undefined;
    if (!role) return false;
    const level = ROLE_LEVEL[role] ?? 0;
    return level >= ROLE_LEVEL.OPERATOR;
  }, [session?.user?.role]);
}

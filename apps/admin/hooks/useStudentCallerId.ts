"use client";

import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * Returns the callerId to use for student API calls.
 * - For STUDENT users: returns null (APIs resolve it from session)
 * - For admin users: returns the callerId from the URL param only.
 *   Callers MUST be passed via the URL (?callerId=…); there is no
 *   sessionStorage fallback (removed in #356 — see issue for the
 *   silent-revert bug it caused). Admin entry points that need to
 *   view a learner's student-portal page must include ?callerId in
 *   navigation, and pages should redirect to /x/callers when missing.
 *
 * Also returns a helper to build API URLs with the callerId param.
 */
export function useStudentCallerId() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();

  const isStudent = session?.user?.role === "STUDENT";

  if (isStudent) {
    return {
      callerId: null as string | null,
      isAdmin: false,
      hasSelection: true,
      buildUrl: (base: string, extraParams?: Record<string, string>) => {
        const params = new URLSearchParams(extraParams);
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
      },
    };
  }

  const callerId = searchParams.get("callerId");

  return {
    callerId,
    isAdmin: true,
    hasSelection: !!callerId,
    buildUrl: (base: string, extraParams?: Record<string, string>) => {
      if (!callerId) return base;
      const params = new URLSearchParams(extraParams);
      params.set("callerId", callerId);
      return `${base}?${params.toString()}`;
    },
  };
}

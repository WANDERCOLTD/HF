"use client";

import { useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

// ─── Lens Types ──────────────────────────────────────────────
export type LensType = "guide" | "grow" | "explore" | "showcase";

export type LensConfig = {
  id: LensType;
  label: string;
  icon: string;
  description: string;
};

export const LENSES: LensConfig[] = [
  { id: "guide", label: "Guide", icon: "🧭", description: "Educator view — progress, focus areas, recommendations" },
  { id: "grow", label: "Grow", icon: "🌱", description: "Learner view — achievements, journey, next steps" },
  { id: "explore", label: "Explore", icon: "🔍", description: "Admin view — full data, technical detail" },
  { id: "showcase", label: "Showcase", icon: "✨", description: "Demo view — curated highlights" },
];

// ─── Role → Default Lens Mapping ─────────────────────────────
function getDefaultLens(role: string | undefined): LensType {
  switch (role) {
    case "SUPERADMIN":
    case "ADMIN":
    case "SUPER_TESTER":
      return "explore";
    case "EDUCATOR":
    case "OPERATOR":
      return "guide";
    case "STUDENT":
    case "TESTER":
    case "VIEWER":
      return "grow";
    case "DEMO":
      return "showcase";
    default:
      return "guide";
  }
}

// ─── Role → Permitted Lenses ─────────────────────────────────
function getPermittedLenses(role: string | undefined): LensType[] {
  switch (role) {
    case "SUPERADMIN":
    case "ADMIN":
    case "SUPER_TESTER":
      return ["guide", "grow", "explore", "showcase"];
    case "EDUCATOR":
    case "OPERATOR":
      return ["guide", "grow"];
    case "STUDENT":
    case "TESTER":
    case "VIEWER":
      return ["grow"];
    case "DEMO":
      return ["showcase"];
    default:
      return ["guide", "grow"];
  }
}

// ─── Hook ────────────────────────────────────────────────────
export function useCallerLens() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const userRole = session?.user?.role as string | undefined;
  const defaultLens = getDefaultLens(userRole);
  const permittedLenses = useMemo(() => getPermittedLenses(userRole), [userRole]);

  // Read lens from URL param, fall back to role default
  const urlLens = searchParams.get("lens") as LensType | null;
  const initialLens = urlLens && permittedLenses.includes(urlLens) ? urlLens : defaultLens;

  const [activeLens, setActiveLensState] = useState<LensType>(initialLens);

  const setActiveLens = useCallback((lens: LensType) => {
    if (!permittedLenses.includes(lens)) return;
    setActiveLensState(lens);

    // Update URL param for shareability
    const params = new URLSearchParams(searchParams.toString());
    if (lens === defaultLens) {
      params.delete("lens"); // Don't clutter URL with default
    } else {
      params.set("lens", lens);
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [permittedLenses, defaultLens, searchParams, pathname, router]);

  const visibleLenses = useMemo(
    () => LENSES.filter((l) => permittedLenses.includes(l.id)),
    [permittedLenses]
  );

  return {
    activeLens,
    setActiveLens,
    visibleLenses,
    permittedLenses,
    defaultLens,
    userRole,
  };
}

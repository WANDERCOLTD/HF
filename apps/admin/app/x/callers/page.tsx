"use client";

import { useResponsive } from "@/hooks/useResponsive";
import { CallerRoster } from "@/components/callers/roster/CallerRoster";
import CallersMobile from "./mobile-page";

/**
 * Callers Page - Responsive Wrapper
 *
 * Desktop: CallerRoster (triage-first roster with mastery bars, momentum, diagnostics)
 * Mobile: CallersMobile (simplified card view)
 */
export default function CallersPageRoute() {
  const { showDesktop } = useResponsive();

  if (!showDesktop) {
    return <CallersMobile />;
  }

  return <CallerRoster routePrefix="/x" />;
}

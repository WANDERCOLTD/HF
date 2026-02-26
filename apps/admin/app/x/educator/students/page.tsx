"use client";

import { useSearchParams } from "next/navigation";
import { CallerRoster } from "@/components/callers/roster/CallerRoster";

/**
 * Educator Students Page
 *
 * Uses the same CallerRoster component as the admin callers page,
 * but scoped to the educator's owned cohorts via the roster API.
 * The API handles role-based scoping automatically.
 */
export default function StudentsPage() {
  const searchParams = useSearchParams();
  const institutionId = searchParams.get("institutionId");

  return (
    <CallerRoster
      routePrefix="/x"
      institutionId={institutionId}
    />
  );
}

"use client";

/**
 * PostCallCTA — UX-B B2 (learner affordances pass).
 *
 * Renders a single primary CTA after a call has ended. Choice of
 * button text + navigation is driven by `capabilities.dismissOnEnd`
 * from the typed `LearnerShellCapabilities` frame.
 *
 * Capability-driven by design — NO `.mode === "X"` branching. Every
 * per-shell affordance difference reads from the typed cap map.
 *
 * Surface contract:
 *  - `dismissOnEnd === "home"`         → "Back to home" → learner home
 *  - `dismissOnEnd === "next-module"`  → "Next module"  → picker page
 *  - `dismissOnEnd === "results-screen"` → no CTA rendered (the
 *      ResultsReadoutShell overlay owns the post-call CTA for that
 *      case; this component returns null to avoid double-CTA stacking).
 *
 * Secondary "Back to home" affordance is gated on
 * `capabilities.allowBackToHome` AND only appears when the primary
 * CTA is "Next module" (when primary already navigates home, no
 * secondary needed).
 *
 * Pure for test-ability — `pickPrimaryCTA` is exported so the paired
 * vitest can pin the matrix per cell.
 */

import { useRouter } from "next/navigation";
import type { LearnerShellCapabilities } from "@/lib/types/json-fields";

export interface PostCallCTAProps {
  /** Frozen capability map from `resolveLearnerShell(...)`. */
  capabilities: LearnerShellCapabilities;
  /** Learner identity — used to compose the home route. */
  callerId: string;
  /** Optional course id — when present, "Next module" navigates to
   *  the per-course picker; otherwise falls back to learner home. */
  courseId?: string;
}

export type PrimaryCTAVariant =
  | { kind: "back-to-home"; label: string }
  | { kind: "next-module"; label: string }
  | { kind: "results-owned"; label: null };

/**
 * Pure capability → CTA-variant resolver. Exported for tests.
 */
export function pickPrimaryCTA(
  capabilities: LearnerShellCapabilities,
): PrimaryCTAVariant {
  switch (capabilities.dismissOnEnd) {
    case "home":
      return { kind: "back-to-home", label: "Back to home" };
    case "next-module":
      return { kind: "next-module", label: "Next module" };
    case "results-screen":
      return { kind: "results-owned", label: null };
    default: {
      // Exhaustiveness — TypeScript will fire if `dismissOnEnd`
      // gains a new value without updating this switch.
      const exhaustive: never = capabilities.dismissOnEnd;
      throw new Error(`Unhandled dismissOnEnd: ${String(exhaustive)}`);
    }
  }
}

export function PostCallCTA({
  capabilities,
  callerId,
  courseId,
}: PostCallCTAProps) {
  const router = useRouter();
  const primary = pickPrimaryCTA(capabilities);

  if (primary.kind === "results-owned") return null;

  const homeRoute = `/x/student/${encodeURIComponent(callerId)}`;
  const pickerRoute = courseId
    ? `/x/student/${encodeURIComponent(courseId)}/modules`
    : homeRoute;

  const onPrimaryClick = () => {
    if (primary.kind === "back-to-home") {
      router.push(homeRoute);
      return;
    }
    router.push(pickerRoute);
  };

  // Secondary "Back to home" only when primary is "Next module" and
  // capabilities allow it.
  const showSecondary =
    primary.kind === "next-module" && capabilities.allowBackToHome;

  return (
    <div
      className="hf-card"
      data-testid="post-call-cta"
      data-variant={primary.kind}
    >
      <button
        type="button"
        className="hf-btn hf-btn-primary"
        onClick={onPrimaryClick}
        data-testid="post-call-cta-primary"
      >
        {primary.label}
      </button>
      {showSecondary ? (
        <button
          type="button"
          className="hf-btn hf-btn-secondary"
          onClick={() => router.push(homeRoute)}
          data-testid="post-call-cta-secondary"
        >
          Back to home
        </button>
      ) : null}
    </div>
  );
}

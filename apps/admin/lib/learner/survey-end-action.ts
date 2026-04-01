import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { SurveyEndAction } from "./survey-config";

/** Resolve the final redirect path from an endAction config. */
export function resolveRedirect(action: SurveyEndAction | undefined): string {
  const resolved = action ?? { type: "next_stop" as const };
  switch (resolved.type) {
    case "next_stop":
      return "/x/student";
    case "redirect":
      return resolved.path;
    case "summary": {
      if (resolved.thenAction === "redirect" && resolved.thenPath) return resolved.thenPath;
      return "/x/student";
    }
  }
}

/** Execute the endAction — either redirect immediately or (for summary) let the caller show a card first. */
export function executeEndAction(action: SurveyEndAction | undefined, router: AppRouterInstance): void {
  router.replace(resolveRedirect(action));
}

/** Type guard: does this endAction want a summary card before redirecting? */
export function isSummaryAction(
  action: SurveyEndAction | undefined,
): action is Extract<SurveyEndAction, { type: "summary" }> {
  return action?.type === "summary";
}

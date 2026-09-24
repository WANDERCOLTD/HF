/**
 * Shared types + helpers for mode-aware HOW-card variants.
 *
 * Story #2205 (U4 of #2185). Each AuthoredModuleMode renders a typed
 * variant; the variant declares WHICH G8 contracts surface in priority
 * order and any informational footnotes for knobs the spec calls out
 * but the registry hasn't yet shipped a contract for.
 *
 * The variant components stay thin — they delegate field rendering to
 * the existing JourneyField primitive. The only mode-specific behaviour
 * is the contract filter + ordering + accompanying explainer notes.
 */

import type { ReactNode } from "react";

import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import type {
  AuthoredModuleMode,
  AuthoredModuleSettings,
} from "@/lib/types/json-fields";

/** Props every variant card receives. */
export interface HowCardVariantProps {
  /** The selected module's id — passed through so each row keys
   *  deterministically and the test harness can scope queries. */
  moduleId: string;
  /** The selected module's settings sub-object (from
   *  `/api/courses/:courseId/modules` → `modules[].settings`).
   *  Undefined / null → all rows render with their default value. */
  settings: Partial<AuthoredModuleSettings> | null;
  /** Save handler — accepts the G8 contract id + new value. The parent
   *  is responsible for routing the PATCH (arraySelector, etc.). */
  onSettingChange: (settingId: string, value: unknown) => Promise<void>;
  /** Render function for one G8 contract row. The variant supplies the
   *  filtered + ordered contract list; the panel owns the row chrome
   *  (test-id, RelevanceWrapper, divider) so the variant body stays
   *  declarative. */
  renderRow: (contract: JourneySettingContract) => ReactNode;
}

/** Type guard / fallback for AuthoredModuleMode. */
export function isAuthoredModuleMode(
  value: string | null | undefined,
): value is AuthoredModuleMode {
  return (
    value === "examiner" ||
    value === "tutor" ||
    value === "mixed" ||
    value === "quiz" ||
    value === "mock-exam"
  );
}

/**
 * AgentTunerNlpGate — runtime gate wrapper for the AgentTuner UI.
 *
 * Reads the `config.agentTunerNlpEnabled` flag on the resolved
 * `PlaybookConfig` and:
 *   - renders its `children` (the `<AgentTuner>` mount) when the flag is
 *     true,
 *   - renders `null` otherwise.
 *
 * Mount the gate AT the operator-facing Course Detail surface to honour
 * the per-playbook opt-in (sub-epic G of #2049 / #2056). For wizard
 * surfaces (TeachWizard / CourseConfigStep / OnboardStep) the gate is
 * intentionally NOT applied — the wizard runs before the playbook
 * exists, so there is no per-playbook config to consult.
 *
 * @see lib/journey/runtime-gates.ts::isAgentTunerNlpEnabled — pure
 *      resolver this wrapper delegates to.
 * @see app/x/courses/[courseId]/page.tsx — operator mount site.
 */

"use client";

import React from "react";
import { isAgentTunerNlpEnabled } from "@/lib/journey/runtime-gates";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export interface AgentTunerNlpGateProps {
  /**
   * Per-playbook PlaybookConfig. When undefined or null the gate
   * defaults to OFF (opt-in semantics — see
   * `isAgentTunerNlpEnabled`).
   */
  playbookConfig: PlaybookConfig | null | undefined;
  /** AgentTuner JSX (or any operator-only AgentTuner-adjacent UI). */
  children: React.ReactNode;
}

export function AgentTunerNlpGate({
  playbookConfig,
  children,
}: AgentTunerNlpGateProps): React.ReactElement | null {
  if (!isAgentTunerNlpEnabled(playbookConfig)) {
    return null;
  }
  return <>{children}</>;
}

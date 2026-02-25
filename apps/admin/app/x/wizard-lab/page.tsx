"use client";

// ── Wizard Lab ────────────────────────────────────────
//
// Dev tools test page for the gold-standard wizard framework.
// 3 steps: Intent (sync) → Generate (async) → Summary (done).
// Validates: WizardShell, StepFooter, ChipSelect, useAsyncStep,
// step navigation, data bag, refresh survival, error/retry.

import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig } from "@/components/wizards/types";
import { IntentStep } from "./steps/IntentStep";
import { GenerateStep } from "./steps/GenerateStep";
import { SummaryStep } from "./steps/SummaryStep";

const config: WizardConfig = {
  flowId: "wizard-lab",
  wizardName: "wizard-lab",
  returnPath: "/x/wizard-lab",
  taskType: "wizard_lab_test",
  steps: [
    { id: "intent", label: "Set Goal", activeLabel: "Setting Goal", component: IntentStep },
    { id: "generate", label: "Generate", activeLabel: "Generating", component: GenerateStep },
    { id: "summary", label: "Summary", activeLabel: "Reviewing", component: SummaryStep },
  ],
};

export default function WizardLabPage() {
  return <WizardShell config={config} />;
}

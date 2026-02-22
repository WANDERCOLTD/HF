"use client";

import DemoTeachWizard from "@/components/wizards/DemoTeachWizard";
import type { StepDefinition } from "@/contexts/StepFlowContext";

const TEACH_STEPS: StepDefinition[] = [
  { id: "domain", label: "Select Institution & Learner", activeLabel: "Selecting Institution & Learner" },
  { id: "goal", label: "Set Your Goal", activeLabel: "Setting Your Goal" },
  { id: "readiness", label: "Readiness Checks", activeLabel: "Checking Readiness" },
  { id: "preview", label: "Preview First Prompt", activeLabel: "Previewing First Prompt" },
  { id: "launch", label: "Launch", activeLabel: "Ready to Teach" },
];

export default function TeachPage() {
  return (
    <DemoTeachWizard
      config={{
        flowId: "teach",
        wizardName: "teach",
        returnPath: "/x/teach",
        fallbackSteps: TEACH_STEPS,
        headerTitle: "Teach",
        headerEmoji: "\uD83D\uDC68\u200D\uD83C\uDFEB",
        domainApiFilter: "?onlyInstitution=true",
        useTerminologyLabels: true,
      }}
    />
  );
}

"use client";

import DemoTeachWizard from "@/components/wizards/DemoTeachWizard";
import type { StepDefinition } from "@/contexts/StepFlowContext";

const DEMONSTRATE_STEPS: StepDefinition[] = [
  { id: "domain", label: "Select Institution & Caller", activeLabel: "Selecting Institution & Caller" },
  { id: "goal", label: "Set Your Goal", activeLabel: "Setting Your Goal" },
  { id: "content", label: "Add Content", activeLabel: "Adding Content" },
  { id: "launch", label: "Launch", activeLabel: "Ready to Launch" },
];

export default function DemonstratePage() {
  return (
    <DemoTeachWizard
      config={{
        flowId: "demonstrate",
        wizardName: "demonstrate",
        returnPath: "/x/demonstrate",
        fallbackSteps: DEMONSTRATE_STEPS,
        headerTitle: "Demonstrate",
        headerEmoji: "\uD83C\uDFAC",
        domainApiFilter: "",
        useTerminologyLabels: false,
      }}
    />
  );
}

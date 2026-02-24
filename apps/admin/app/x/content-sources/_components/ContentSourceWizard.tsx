"use client";

import { useRef } from "react";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { ProgressStepper } from "@/components/shared/ProgressStepper";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import SourceStep from "./steps/SourceStep";
import ExtractStep from "./steps/ExtractStep";
import ReviewStep from "./steps/ReviewStep";
import PlanStep from "./steps/PlanStep";
import OnboardStep from "./steps/OnboardStep";
import PreviewStep from "./steps/PreviewStep";
import DoneStep from "./steps/DoneStep";

export const CONTENT_STEPS: StepDefinition[] = [
  { id: "source", label: "Add Material", activeLabel: "Adding Material" },
  { id: "extract", label: "Extract", activeLabel: "Extracting Content" },
  { id: "review", label: "Review", activeLabel: "Reviewing Assertions" },
  { id: "plan", label: "Plan Sessions", activeLabel: "Planning Sessions" },
  { id: "onboard", label: "Onboard", activeLabel: "Configuring Onboarding" },
  { id: "preview", label: "Preview", activeLabel: "Previewing Prompt" },
  { id: "done", label: "Done", activeLabel: "Complete" },
];

/** Flow initialization is handled by the parent page (resume detection + task creation). */
export default function ContentSourceWizard() {
  const { state, setStep, nextStep, prevStep, setData, getData, endFlow } = useStepFlow();

  const currentStep = state?.currentStep ?? 0;

  // Warn on browser refresh/close when user has started working
  useUnsavedGuard(!!getData<string>("sourceId") || !!getData<boolean>("hasFile"));

  // Track visited steps in data bag so stepper survives refresh
  const savedVisited = getData<number[]>("visitedSteps");
  const visitedSteps = useRef(new Set<number>(savedVisited ?? [0]));
  if (!visitedSteps.current.has(currentStep)) {
    visitedSteps.current.add(currentStep);
    setData("visitedSteps", [...visitedSteps.current]);
  }

  const handleNext = () => nextStep();
  const handlePrev = () => prevStep();
  const handleGoToStep = (step: number) => setStep(step);

  // Build ProgressStepper data — only mark visited steps as completed
  // Use spec-loaded steps from flow state when available, fallback to hardcoded
  const activeSteps = state?.steps ?? CONTENT_STEPS;
  const progressSteps = activeSteps.map((s, i) => ({
    label: s.label,
    completed: visitedSteps.current.has(i) && i < currentStep,
    active: i === currentStep,
    onClick: i < currentStep ? () => handleGoToStep(i) : undefined,
  }));

  const stepProps = { setData, getData, onNext: handleNext, onPrev: handlePrev, endFlow, setStep: handleGoToStep };

  // CS-1: Skip ExtractStep when no file — forward and back
  const sourceOnNext = getData<boolean>("hasFile") ? handleNext : () => handleGoToStep(2);
  const reviewOnPrev = getData<boolean>("hasFile") ? handlePrev : () => handleGoToStep(0);

  return (
    <div>
      {/* Progress stepper */}
      <div style={{ marginBottom: 32 }}>
        <ProgressStepper steps={progressSteps} />
      </div>

      {/* Current step */}
      {currentStep === 0 && <SourceStep {...stepProps} onNext={sourceOnNext} />}
      {currentStep === 1 && <ExtractStep {...stepProps} />}
      {currentStep === 2 && <ReviewStep {...stepProps} onPrev={reviewOnPrev} />}
      {currentStep === 3 && (
        <PlanStep
          {...stepProps}
          onPrev={getData<boolean>("existingSource") ? () => handleGoToStep(0) : handlePrev}
        />
      )}
      {currentStep === 4 && <OnboardStep {...stepProps} />}
      {currentStep === 5 && <PreviewStep {...stepProps} />}
      {currentStep === 6 && <DoneStep {...stepProps} />}
    </div>
  );
}

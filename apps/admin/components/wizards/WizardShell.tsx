"use client";

import { useEffect, useRef, useCallback } from "react";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import { ProgressStepper } from "@/components/shared/ProgressStepper";
import { WizardResumeBanner } from "@/components/shared/WizardResumeBanner";
import { useWizardResume } from "@/hooks/useWizardResume";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import type { WizardConfig, StepRenderProps } from "./types";

// ── WizardShell ───────────────────────────────────────
//
// Gold-standard thin wizard orchestrator. Handles ALL lifecycle:
//
// - Initialize StepFlowContext (startFlow)
// - Load steps from /api/wizard-steps (fallback to config.steps)
// - Resume detection via useWizardResume
// - ProgressStepper rendering
// - Route to step component via registry
// - Unsaved guard on browser close
//
// Wizard pages are ~15 lines: define config + render <WizardShell />.

interface WizardShellProps {
  config: WizardConfig;
  /** Optional callback when the wizard completes */
  onComplete?: () => void;
}

export function WizardShell({ config, onComplete }: WizardShellProps) {
  const {
    state,
    isActive,
    startFlow,
    setStep,
    nextStep,
    prevStep,
    setData,
    getData,
    endFlow: rawEndFlow,
  } = useStepFlow();

  const { pendingTask, isLoading: resumeLoading } = useWizardResume(
    config.taskType || "",
  );

  const initialized = useRef(false);

  // ── Load steps from DB spec, fallback to config ─────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      let steps: StepDefinition[] = config.steps.map((s) => ({
        id: s.id,
        label: s.label,
        activeLabel: s.activeLabel || s.label,
      }));

      try {
        const res = await fetch(
          `/api/wizard-steps?wizard=${encodeURIComponent(config.wizardName)}`,
        );
        const data = await res.json();
        if (data.ok && data.steps?.length > 0) {
          steps = data.steps.map(
            (s: { id: string; label: string; activeLabel?: string }) => ({
              id: s.id,
              label: s.label,
              activeLabel: s.activeLabel || s.label,
            }),
          );
        }
      } catch {
        // Silent — use config fallback
      }

      if (!isActive || state?.flowId !== config.flowId) {
        startFlow({
          flowId: config.flowId,
          steps,
          returnPath: config.returnPath,
          taskType: config.taskType,
        });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unsaved guard ───────────────────────────────────
  useUnsavedGuard(isActive && (state?.currentStep ?? 0) > 0);

  // ── End flow with optional callback ─────────────────
  const endFlow = useCallback(() => {
    rawEndFlow();
    onComplete?.();
  }, [rawEndFlow, onComplete]);

  // ── Resume handler ──────────────────────────────────
  const handleResume = useCallback(() => {
    if (!pendingTask) return;
    const steps: StepDefinition[] = config.steps.map((s) => ({
      id: s.id,
      label: s.label,
      activeLabel: s.activeLabel || s.label,
    }));
    startFlow({
      flowId: config.flowId,
      steps,
      returnPath: config.returnPath,
      taskType: config.taskType,
      taskId: pendingTask.id,
      initialData: pendingTask.context,
      initialStep: pendingTask.currentStep,
    });
  }, [pendingTask, config, startFlow]);

  const handleDiscard = useCallback(() => {
    // Just start fresh — the pending task will be orphaned (auto-cleaned by task TTL)
    const steps: StepDefinition[] = config.steps.map((s) => ({
      id: s.id,
      label: s.label,
      activeLabel: s.activeLabel || s.label,
    }));
    startFlow({
      flowId: config.flowId,
      steps,
      returnPath: config.returnPath,
      taskType: config.taskType,
    });
  }, [config, startFlow]);

  // ── Loading state ───────────────────────────────────
  if (!state?.active) {
    // Show resume banner while checking for pending task
    if (resumeLoading) return null;
    if (pendingTask) {
      return (
        <div className="hf-wizard-step" style={{ paddingTop: 64 }}>
          <WizardResumeBanner
            task={pendingTask}
            onResume={handleResume}
            onDiscard={handleDiscard}
            label={config.flowId.replace(/-/g, " ")}
          />
        </div>
      );
    }
    return null;
  }

  // ── Resolve current step component ──────────────────
  const currentStep = state.currentStep;
  const stepId = state.steps[currentStep]?.id;
  const stepConfig = config.steps.find((s) => s.id === stepId) || config.steps[currentStep];
  const StepComponent = stepConfig?.component;

  if (!StepComponent) {
    return (
      <div className="hf-wizard-step">
        <div className="hf-empty">Unknown step: {stepId || currentStep}</div>
      </div>
    );
  }

  // ── ProgressStepper data ────────────────────────────
  const progressSteps = state.steps.map((s, i) => ({
    label: s.label,
    completed: i < currentStep,
    active: i === currentStep,
    onClick: i < currentStep ? () => setStep(i) : undefined,
  }));

  // ── StepRenderProps ─────────────────────────────────
  const stepProps: StepRenderProps = {
    setData,
    getData,
    onNext: nextStep,
    onPrev: prevStep,
    endFlow,
    stepIndex: currentStep,
    totalSteps: state.steps.length,
    isFirst: currentStep === 0,
    isLast: currentStep === state.steps.length - 1,
  };

  return (
    <div className="hf-page-container hf-page-scroll">
      <div className="hf-wizard-stepper">
        <ProgressStepper steps={progressSteps} />
      </div>
      <StepComponent {...stepProps} />
    </div>
  );
}

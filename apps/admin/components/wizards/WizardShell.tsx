"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useStepFlow } from "@/contexts/StepFlowContext";
import type { StepDefinition } from "@/contexts/StepFlowContext";
import WizardSection from "@/components/shared/WizardSection";
import type { SectionStatus } from "@/components/shared/WizardSection";
import { WizardResumeBanner } from "@/components/shared/WizardResumeBanner";
import { useWizardResume } from "@/hooks/useWizardResume";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { WizardDoneContent } from "./WizardDoneContent";
import type { WizardConfig, StepRenderProps } from "./types";

// ── WizardShell ───────────────────────────────────────
//
// Gold-standard thin wizard orchestrator. Handles ALL lifecycle:
//
// - Initialize StepFlowContext (startFlow)
// - Load steps from /api/wizard-steps (fallback to config.steps)
// - Resume detection via useWizardResume
// - Accordion rendering via WizardSection (blue border on active, collapse+summary on done)
// - Unsaved guard on browser close
//
// Wizard pages are ~15 lines: define config + render <WizardShell />.

interface WizardShellProps {
  config: WizardConfig;
  /** Optional callback when the wizard completes */
  onComplete?: () => void;
  /** Optional data to pre-seed into the wizard state bag (e.g. domainId from URL) */
  initialData?: Record<string, unknown>;
}

export function WizardShell({ config, onComplete, initialData }: WizardShellProps) {
  const router = useRouter();
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
          initialData,
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

  // ── Cancel — clears flow state + navigates back ──────
  const handleCancel = useCallback(() => {
    rawEndFlow();
    router.push(config.returnPath);
  }, [rawEndFlow, router, config.returnPath]);

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

  // ── Accordion rendering ─────────────────────────────
  const currentStep = state.currentStep;

  return (
    <div className="hf-page-container hf-page-scroll">
      <div className="hf-ws-accordion">
        {config.cancelLabel && currentStep < config.steps.length - 1 && (
          <button type="button" className="hf-wizard-cancel" onClick={handleCancel}>
            <ArrowLeft size={16} />
            {config.cancelLabel}
          </button>
        )}
        {config.steps.map((stepCfg, i) => {
          const status: SectionStatus =
            i < currentStep ? "done" : i === currentStep ? "active" : "locked";

          const stepProps: StepRenderProps = {
            setData,
            getData,
            onNext: nextStep,
            onPrev: prevStep,
            endFlow,
            stepIndex: i,
            totalSteps: config.steps.length,
            isFirst: i === 0,
            isLast: i === config.steps.length - 1,
          };

          const StepComp = stepCfg.component;

          return (
            <WizardSection
              key={stepCfg.id}
              id={stepCfg.id}
              stepNumber={i + 1}
              status={status}
              title={stepCfg.activeLabel || stepCfg.label}
              summaryLabel={stepCfg.summaryLabel}
              summary={stepCfg.summary ? stepCfg.summary(getData) : stepCfg.label}
              onEdit={status === "done" ? () => setStep(i) : undefined}
              showHeader={false}
            >
              {status === "active" ? (
                <StepComp {...stepProps} />
              ) : status === "done" && stepCfg.doneContent ? (
                <WizardDoneContent items={stepCfg.doneContent(getData)} />
              ) : null}
            </WizardSection>
          );
        })}
      </div>
    </div>
  );
}

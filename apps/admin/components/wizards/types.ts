import type { ReactNode } from "react";

// ── Wizard Framework Types ────────────────────────────
//
// Gold-standard wizard framework. New wizards import these types
// and compose with WizardShell + StepFooter + useAsyncStep.

/** What WizardShell needs to orchestrate a wizard */
export interface WizardConfig {
  /** StepFlowContext flow ID (e.g. "course-setup", "teach") */
  flowId: string;
  /** For GET /api/wizard-steps?wizard= lookup */
  wizardName: string;
  /** Where to redirect on cancel/complete */
  returnPath: string;
  /** For useWizardResume detection (optional) */
  taskType?: string;
  /** Step registry — order matters */
  steps: WizardStepConfig[];
}

/** Step definition with its component */
export interface WizardStepConfig {
  id: string;
  label: string;
  activeLabel?: string;
  component: React.ComponentType<StepRenderProps>;
}

/** What every step component receives from WizardShell */
export interface StepRenderProps {
  /** Store a value in the shared data bag (persisted across steps + refresh) */
  setData: (key: string, value: unknown) => void;
  /** Retrieve a value from the shared data bag */
  getData: <T = unknown>(key: string) => T | undefined;
  /** Advance to the next step */
  onNext: () => void;
  /** Go back to the previous step */
  onPrev: () => void;
  /** End the wizard flow (cleanup + optional redirect) */
  endFlow: () => void;
  /** Current step index (0-based) */
  stepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** True if this is the first step */
  isFirst: boolean;
  /** True if this is the last step */
  isLast: boolean;
}

/** Props for StepFooter */
export interface StepFooterProps {
  onBack?: () => void;
  backLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
  onNext: () => void;
  nextLabel?: string;
  nextIcon?: ReactNode;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  /** Optional secondary action button (e.g. "Generate & Review") */
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
}

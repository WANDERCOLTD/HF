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
  /** Label for the ← cancel/back link shown at top of wizard (e.g. "Courses", "Communities") */
  cancelLabel?: string;
  /** For useWizardResume detection (optional) */
  taskType?: string;
  /** Step registry — order matters */
  steps: WizardStepConfig[];
}

/** A single label-value row shown in the expanded done state */
export interface DoneContentItem {
  /** Left-side label (e.g. "Course Name", "Pattern") */
  label: string;
  /** Right-side value — string for simple text, ReactNode for badges/swatches */
  value: React.ReactNode;
}

/** Step definition with its component */
export interface WizardStepConfig {
  id: string;
  label: string;
  activeLabel?: string;
  component: React.ComponentType<StepRenderProps>;
  /** Short label shown before the summary text in the collapsed done row, e.g. "Hub" */
  summaryLabel?: string;
  /** Returns the summary text shown in the collapsed done row — reads from the data bag */
  summary?: (getData: <T = unknown>(key: string) => T | undefined) => React.ReactNode;
  /** Returns structured label-value pairs shown when a completed step is expanded */
  doneContent?: (getData: <T = unknown>(key: string) => T | undefined) => DoneContentItem[];
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

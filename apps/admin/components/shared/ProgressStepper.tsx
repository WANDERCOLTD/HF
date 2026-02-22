"use client";

import "./progress-stepper.css";

interface ProgressStep {
  label: string;
  completed: boolean;
  active?: boolean;
  onClick?: () => void;
}

interface ProgressStepperProps {
  steps: ProgressStep[];
}

export function ProgressStepper({ steps }: ProgressStepperProps) {
  return (
    <div className="ps-track">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const circleClass = `ps-circle${step.completed ? " ps-circle--done" : step.active ? " ps-circle--active" : ""}`;
        const labelClass = `ps-label${step.active ? " ps-label--active" : step.completed ? " ps-label--done" : ""}`;

        return (
          <div key={i} className="ps-segment">
            <button
              onClick={step.onClick}
              disabled={!step.onClick}
              className={`ps-step${step.onClick ? " ps-step--clickable" : ""}`}
            >
              <div className={circleClass}>
                {step.completed ? "\u2713" : i + 1}
              </div>
              <span className={labelClass}>{step.label}</span>
            </button>

            {!isLast && (
              <div className={`ps-line${step.completed ? " ps-line--done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

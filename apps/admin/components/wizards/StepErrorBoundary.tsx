import React from "react";
import { AlertCircle } from "lucide-react";

interface StepErrorBoundaryProps {
  stepId: string;
  onReportError: (err: Error) => void;
  onBack?: () => void;
  children: React.ReactNode;
}

interface StepErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-step React Error Boundary for WizardShell.
 *
 * Catches render crashes in a single wizard step without killing the
 * entire page. Reports to ErrorCaptureContext via the onReportError prop
 * so the error appears in the status bar badge + BugReportButton.
 *
 * Recovery: "Retry" re-renders the step. "Back" navigates to previous step.
 * Wizard data bag is preserved (StepFlowContext lives above this boundary).
 */
export class StepErrorBoundary extends React.Component<
  StepErrorBoundaryProps,
  StepErrorBoundaryState
> {
  constructor(props: StepErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): StepErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onReportError(error);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="hf-step-error-card">
          <div className="hf-step-error-icon">
            <AlertCircle size={20} />
          </div>
          <h3 className="hf-step-error-title">This step hit a problem</h3>
          <p className="hf-step-error-message">{this.state.error.message}</p>
          <div className="hf-step-error-actions">
            {this.props.onBack && (
              <button
                className="hf-btn hf-btn-secondary"
                onClick={this.props.onBack}
              >
                Back
              </button>
            )}
            <button
              className="hf-btn hf-btn-primary"
              onClick={this.handleRetry}
            >
              Retry This Step
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

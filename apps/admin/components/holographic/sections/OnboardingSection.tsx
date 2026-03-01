"use client";

/**
 * Onboarding Section — Welcome message, INIT-001 flow phases, default targets.
 * Shows how the first call experience is configured.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { Rocket, MessageSquare, ListChecks, Target } from "lucide-react";

interface FlowPhase {
  id?: string;
  name: string;
  description?: string;
  duration?: string;
}

export function OnboardingSection() {
  const { state } = useHolo();
  const domain = state.domainDetail as Record<string, any> | null;

  if (!domain) {
    return <div className="hp-section-empty">No domain data loaded.</div>;
  }

  const welcome: string | null = domain.onboardingWelcome;
  const flowPhases: FlowPhase[] = domain.onboardingFlowPhases || [];
  const defaultTargets: Record<string, unknown> = domain.onboardingDefaultTargets || {};
  const targetKeys = Object.keys(defaultTargets);

  const hasAnyConfig = welcome || flowPhases.length > 0 || targetKeys.length > 0;

  if (!hasAnyConfig) {
    return (
      <div className="hp-section-empty">
        <Rocket size={24} className="hp-section-empty-icon" />
        <div>No onboarding configured.</div>
        <div className="hp-section-empty-hint">
          Set up welcome message and first-call flow on the Domains page.
        </div>
      </div>
    );
  }

  return (
    <div className="hp-section-onboarding">
      {/* Welcome message */}
      {welcome && (
        <div className="hp-onboarding-block">
          <div className="hp-onboarding-block-header">
            <MessageSquare size={15} />
            <span>Welcome Message</span>
          </div>
          <div className="hp-onboarding-welcome">{welcome}</div>
        </div>
      )}

      {/* Flow phases */}
      {flowPhases.length > 0 && (
        <div className="hp-onboarding-block">
          <div className="hp-onboarding-block-header">
            <ListChecks size={15} />
            <span>First Call Phases</span>
          </div>
          <div className="hp-phase-list">
            {flowPhases.map((phase, i) => (
              <div key={phase.id || i} className="hp-phase-item">
                <div className="hp-phase-number">{i + 1}</div>
                <div className="hp-phase-content">
                  <div className="hp-phase-name">{phase.name}</div>
                  {phase.description && (
                    <div className="hp-phase-desc">{phase.description}</div>
                  )}
                </div>
                {phase.duration && (
                  <span className="hp-phase-duration">{phase.duration}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Default targets */}
      {targetKeys.length > 0 && (
        <div className="hp-onboarding-block">
          <div className="hp-onboarding-block-header">
            <Target size={15} />
            <span>Default Targets</span>
          </div>
          <div className="hp-target-grid">
            {targetKeys.map((key) => (
              <div key={key} className="hp-target-item">
                <span className="hp-target-key">{key}</span>
                <span className="hp-target-value">
                  {String(defaultTargets[key])}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

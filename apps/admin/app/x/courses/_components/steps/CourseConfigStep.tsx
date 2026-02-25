'use client';

import { useState, useEffect } from 'react';
import { ArrowRight, Loader2, ChevronRight } from 'lucide-react';
import { AgentTuner } from '@/components/shared/AgentTuner';
import type { AgentTunerOutput, AgentTunerPill } from '@/lib/agent-tuner/types';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepProps } from '../CourseSetupWizard';

// ── Types ──────────────────────────────────────────────

type FlowPhase = {
  phase: string;
  duration: string;
  priority?: string;
  goals: string[];
  avoid?: string[];
};

// ── Component ──────────────────────────────────────────

export function CourseConfigStep({ setData, getData, onNext, onPrev }: StepProps) {
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [defaultWelcome, setDefaultWelcome] = useState('');
  const [loadingWelcome, setLoadingWelcome] = useState(false);
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [tunerPills, setTunerPills] = useState<AgentTunerPill[]>(getData<AgentTunerPill[]>('tunerPills') ?? []);
  const [behaviorTargets, setBehaviorTargets] = useState<Record<string, number>>(getData<Record<string, number>>('behaviorTargets') ?? {});
  const [flowPhases, setFlowPhases] = useState<FlowPhase[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);

  const personaSlug = getData<string>('persona');
  const personaName = getData<string>('personaName');
  const courseName = getData<string>('courseName');

  // Load saved welcome message
  useEffect(() => {
    const saved = getData<string>('welcomeMessage');
    if (saved) setWelcomeMessage(saved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch persona config: welcome template + flow phases
  useEffect(() => {
    if (!personaSlug) return;
    const ac = new AbortController();
    setLoadingWelcome(true);

    (async () => {
      try {
        const res = await fetch(`/api/onboarding?persona=${encodeURIComponent(personaSlug)}`, { signal: ac.signal });
        if (!res.ok) throw new Error('Failed to fetch persona config');
        const data = await res.json();
        if (!ac.signal.aborted && data.ok) {
          setDefaultWelcome(data.welcomeTemplate || '');
          if (data.firstCallFlow?.phases) {
            setFlowPhases(data.firstCallFlow.phases);
          }
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        console.warn('[CourseConfigStep] Failed to load persona config:', e);
      } finally {
        if (!ac.signal.aborted) setLoadingWelcome(false);
      }
    })();

    return () => ac.abort();
  }, [personaSlug]);

  const handleTunerChange = ({ pills, parameterMap }: AgentTunerOutput) => {
    setTunerPills(pills);
    setBehaviorTargets(parameterMap);
    setData('tunerPills', pills);
    setData('behaviorTargets', parameterMap);
  };

  const handleNext = () => {
    setData('welcomeMessage', welcomeMessage || defaultWelcome);
    setData('tunerPills', tunerPills);
    setData('behaviorTargets', behaviorTargets);
    onNext();
  };

  const displayWelcome = welcomeMessage || defaultWelcome || 'Your AI will introduce itself...';

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">

        {/* ── Header ── */}
        <div className="hf-mb-lg">
          <h1 className="hf-page-title">First Call Setup</h1>
          <p className="hf-page-subtitle">Preview how your AI will greet and teach</p>
        </div>

        {/* ── Greeting Preview Card ── */}
        <div className="hf-greeting-card hf-mb-lg">
          <FieldHint label="Greeting" hint={WIZARD_HINTS["course.welcome"]} labelClass="hf-section-title" />

          {/* Persona badge */}
          {personaName && (
            <div className="hf-greeting-persona">
              <span className="hf-greeting-persona-icon">
                {personaSlug === 'tutor' ? '🧑‍🏫' : personaSlug === 'coach' ? '💪' : personaSlug === 'mentor' ? '🤝' : personaSlug === 'socratic' ? '🤔' : '🎭'}
              </span>
              <span>{personaName}</span>
              {courseName && (
                <>
                  <span className="hf-text-muted">·</span>
                  <span className="hf-text-muted hf-text-normal">{courseName}</span>
                </>
              )}
            </div>
          )}

          {/* Welcome text */}
          {loadingWelcome ? (
            <div className="hf-loading-row">
              <Loader2 className="hf-spinner hf-icon-sm" />
              <span className="hf-text-sm">Loading greeting...</span>
            </div>
          ) : (
            <p className="hf-greeting-text">&ldquo;{displayWelcome}&rdquo;</p>
          )}

          {/* Collapse toggle for custom textarea */}
          <button className="hf-greeting-toggle" onClick={() => setGreetingOpen(!greetingOpen)}>
            <ChevronRight
              size={14}
              style={{
                transition: 'transform 0.15s ease',
                transform: greetingOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            Customize greeting
          </button>

          {greetingOpen && (
            <div className="hf-mt-sm">
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder={defaultWelcome || 'Enter a custom welcome message...'}
                rows={3}
                className="hf-input"
                style={{ resize: 'vertical', minHeight: 80 }}
              />
              <p className="hf-hint hf-mt-xs">Leave blank to use the default above</p>
            </div>
          )}
        </div>

        {/* ── Call Flow Phases ── */}
        <div className="hf-mb-lg">
          <FieldHint label="Call Flow" hint={WIZARD_HINTS["course.callFlow"]} labelClass="hf-section-title" />
          <p className="hf-text-xs hf-text-muted hf-mb-sm">
            How the first lesson is structured — loaded from your {personaName || 'persona'} defaults
          </p>

          {flowPhases.length > 0 ? (
            <div className="hf-flow-card">
              {flowPhases.map((phase, i) => {
                const isExpanded = expandedPhase === i;
                const goalsSummary = phase.goals.slice(0, 2).join(' · ');
                return (
                  <div
                    key={`${phase.phase}-${i}`}
                    className="hf-flow-phase"
                    onClick={() => setExpandedPhase(isExpanded ? null : i)}
                  >
                    <span className="hf-flow-phase-num">{i + 1}</span>
                    <div className="hf-flow-phase-body">
                      <div className="hf-flow-phase-header">
                        <span className="hf-flow-phase-name">{phase.phase}</span>
                        <span className="hf-flow-phase-dur">{phase.duration}</span>
                      </div>
                      {!isExpanded && (
                        <div className="hf-flow-phase-goals">{goalsSummary}</div>
                      )}
                      {isExpanded && (
                        <div className="hf-flow-phase-detail">
                          <div className="hf-flow-phase-detail-section">
                            <div className="hf-flow-phase-detail-label">Goals</div>
                            <ul className="hf-flow-phase-detail-list">
                              {phase.goals.map((g, gi) => <li key={gi}>{g}</li>)}
                            </ul>
                          </div>
                          {phase.avoid && phase.avoid.length > 0 && (
                            <div className="hf-flow-phase-detail-section">
                              <div className="hf-flow-phase-detail-label">Avoid</div>
                              <ul className="hf-flow-phase-detail-list hf-flow-phase-avoid">
                                {phase.avoid.map((a, ai) => <li key={ai}>{a}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      size={14}
                      className="hf-text-muted"
                      style={{
                        flexShrink: 0,
                        transition: 'transform 0.15s ease',
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        marginTop: 2,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : loadingWelcome ? (
            <div className="hf-loading-row">
              <Loader2 className="hf-spinner hf-icon-sm" />
              <span className="hf-text-sm">Loading call flow...</span>
            </div>
          ) : (
            <div className="hf-empty-dashed">
              No flow phases defined — the AI will use its default onboarding sequence.
            </div>
          )}
        </div>

        {/* ── Behavior Tuning ── */}
        <div>
          <FieldHint label="Behaviour" hint={WIZARD_HINTS["course.behavior"]} labelClass="hf-section-title" />
          <p className="hf-text-xs hf-text-muted hf-mb-sm">
            Fine-tune how your AI communicates — describe the style you want
          </p>
          <AgentTuner
            bare
            initialPills={tunerPills}
            context={{ personaSlug: personaSlug || undefined, subjectName: courseName || undefined }}
            onChange={handleTunerChange}
          />
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="hf-step-footer">
        <button onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
        <button onClick={handleNext} className="hf-btn hf-btn-primary">
          Next <ArrowRight className="hf-icon-sm" />
        </button>
      </div>
    </div>
  );
}

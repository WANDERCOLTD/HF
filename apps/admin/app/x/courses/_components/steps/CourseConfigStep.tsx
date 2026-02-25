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
    let cancelled = false;
    setLoadingWelcome(true);

    (async () => {
      try {
        const res = await fetch(`/api/onboarding?persona=${encodeURIComponent(personaSlug)}`);
        if (!res.ok) throw new Error('Failed to fetch persona config');
        const data = await res.json();
        if (!cancelled && data.ok) {
          setDefaultWelcome(data.welcomeTemplate || '');
          if (data.firstCallFlow?.phases) {
            setFlowPhases(data.firstCallFlow.phases);
          }
        }
      } catch (e) {
        console.warn('[CourseConfigStep] Failed to load persona config:', e);
      } finally {
        if (!cancelled) setLoadingWelcome(false);
      }
    })();

    return () => { cancelled = true; };
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
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-8 max-w-2xl mx-auto w-full">

        {/* ── Header ── */}
        <div style={{ marginBottom: 32 }}>
          <h1 className="hf-page-title">First Call Setup</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
            Preview how your AI will greet and teach
          </p>
        </div>

        {/* ── Greeting Preview Card ── */}
        <div className="hf-greeting-card" style={{ marginBottom: 28 }}>
          <FieldHint
            label="Greeting"
            hint={WIZARD_HINTS["course.welcome"]}
            labelClass="hf-section-title"
          />

          {/* Persona badge */}
          {personaName && (
            <div className="hf-greeting-persona">
              <span className="hf-greeting-persona-icon">
                {personaSlug === 'tutor' ? '🧑‍🏫' : personaSlug === 'coach' ? '💪' : personaSlug === 'mentor' ? '🤝' : personaSlug === 'socratic' ? '🤔' : '🎭'}
              </span>
              <span>{personaName}</span>
              {courseName && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{courseName}</span>
                </>
              )}
            </div>
          )}

          {/* Welcome text */}
          {loadingWelcome ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
              <Loader2 className="hf-spinner" style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 13 }}>Loading greeting...</span>
            </div>
          ) : (
            <p className="hf-greeting-text">&ldquo;{displayWelcome}&rdquo;</p>
          )}

          {/* Collapse toggle for custom textarea */}
          <button
            className="hf-greeting-toggle"
            onClick={() => setGreetingOpen(!greetingOpen)}
          >
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
            <div style={{ marginTop: 10 }}>
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder={defaultWelcome || 'Enter a custom welcome message...'}
                rows={3}
                className="hf-input"
                style={{ resize: 'vertical', minHeight: 80 }}
              />
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                Leave blank to use the default above
              </p>
            </div>
          )}
        </div>

        {/* ── Call Flow Phases ── */}
        <div style={{ marginBottom: 28 }}>
          <FieldHint
            label="Call Flow"
            hint={WIZARD_HINTS["course.callFlow"]}
            labelClass="hf-section-title"
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
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
                      style={{
                        flexShrink: 0,
                        color: 'var(--text-muted)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: '20px 0' }}>
              <Loader2 className="hf-spinner" style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 13 }}>Loading call flow...</span>
            </div>
          ) : (
            <div style={{
              padding: '20px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
              borderRadius: 10,
              border: '1px dashed var(--border-default)',
            }}>
              No flow phases defined — the AI will use its default onboarding sequence.
            </div>
          )}
        </div>

        {/* ── Behavior Tuning (promoted — no AdvancedSection wrapper) ── */}
        <div>
          <FieldHint
            label="Behaviour"
            hint={WIZARD_HINTS["course.behavior"]}
            labelClass="hf-section-title"
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
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
        <button onClick={onPrev} className="hf-btn hf-btn-ghost">
          Back
        </button>
        <button onClick={handleNext} className="hf-btn hf-btn-primary">
          Next <ArrowRight style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  );
}

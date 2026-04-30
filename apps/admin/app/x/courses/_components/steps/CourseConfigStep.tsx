'use client';

import { useState, useEffect } from 'react';
import { ArrowRight, Loader2, ChevronRight, Plus, X } from 'lucide-react';
import { OnboardingPreview } from '@/components/shared/OnboardingPreview';
import { AgentTuner } from '@/components/shared/AgentTuner';
import type { AgentTunerOutput, AgentTunerPill } from '@/lib/agent-tuner/types';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepProps } from '../CourseSetupWizard';
import { IntakeToggleGroup, type IntakeValues } from '@/components/wizards/IntakeToggleGroup';

// ── Types ──────────────────────────────────────────────

type FlowPhase = {
  _id: string;
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
  const [editingId, setEditingId] = useState<string | null>(null);

  const personaSlug = getData<string>('persona');
  const personaName = getData<string>('personaName');
  const courseName = getData<string>('courseName');

  // First-call intake toggles (#219). Bag keys are stable contract.
  const initialIntake: IntakeValues = {
    goals: getData<boolean>('welcomeGoals') ?? true,
    aboutYou: getData<boolean>('welcomeAboutYou') ?? true,
    knowledgeCheck: getData<boolean>('welcomeKnowledgeCheck') ?? false,
    knowledgeCheckMode: getData<"mcq" | "socratic">('welcomeKnowledgeCheckMode') ?? 'mcq',
    aiIntroCall: getData<boolean>('welcomeAiIntro') ?? false,
  };
  const handleIntakeChange = (next: IntakeValues) => {
    setData('welcomeGoals', next.goals);
    setData('welcomeAboutYou', next.aboutYou);
    setData('welcomeKnowledgeCheck', next.knowledgeCheck);
    setData('welcomeKnowledgeCheckMode', next.knowledgeCheckMode);
    setData('welcomeAiIntro', next.aiIntroCall);
  };

  // Load saved welcome message + phases (from previous visit to this step)
  useEffect(() => {
    const saved = getData<string>('welcomeMessage');
    if (saved) setWelcomeMessage(saved);
    const savedPhases = getData<FlowPhase[]>('flowPhases');
    if (savedPhases?.length) setFlowPhases(savedPhases);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch persona config: welcome template + flow phases (only if not already set)
  useEffect(() => {
    if (!personaSlug) return;
    const savedPhases = getData<FlowPhase[]>('flowPhases');
    if (savedPhases?.length) return; // don't overwrite user edits
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
            setFlowPhases(data.firstCallFlow.phases.map((p: any) => ({
              ...p,
              _id: p._id || crypto.randomUUID(),
            })));
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
  }, [personaSlug]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Strip internal _id before saving
    setData('flowPhases', flowPhases.map(({ _id, ...rest }) => rest));
    onNext();
  };

  const addPhase = () => {
    const id = crypto.randomUUID();
    setFlowPhases(prev => [...prev, { _id: id, phase: '', duration: '', goals: [] }]);
    setEditingId(id);
  };

  const removePhase = (id: string) => {
    setFlowPhases(prev => prev.filter(p => p._id !== id));
    if (editingId === id) setEditingId(null);
  };

  const updatePhase = (id: string, field: 'phase' | 'duration', value: string) => {
    setFlowPhases(prev => prev.map(p => p._id === id ? { ...p, [field]: value } : p));
  };

  const updateGoals = (id: string, raw: string) => {
    const goals = raw.split('\n').filter(g => g.trim());
    setFlowPhases(prev => prev.map(p => p._id === id ? { ...p, goals } : p));
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

        {/* ── First Call Preview (WhatsApp-style) ── */}
        <div className="hf-mb-lg">
          <FieldHint label="Greeting" hint={WIZARD_HINTS["course.welcome"]} labelClass="hf-section-title" />
          <p className="hf-text-xs hf-text-muted hf-mb-sm">
            The welcome message is the first thing students hear when they call.
          </p>

          {loadingWelcome ? (
            <div className="hf-loading-row">
              <Loader2 className="hf-spinner hf-icon-sm" />
              <span className="hf-text-sm">Loading greeting...</span>
            </div>
          ) : (
            <OnboardingPreview
              greeting={displayWelcome}
              personaName={personaName || undefined}
              phases={flowPhases.map(({ _id, ...rest }) => rest)}
              hint={flowPhases.length === 0 ? `Your ${personaName || 'AI'} will use its built-in call structure` : undefined}
              maxHeight={280}
            />
          )}

          {/* Collapse toggle for custom greeting */}
          <button className="hf-greeting-toggle hf-mt-sm" onClick={() => setGreetingOpen(!greetingOpen)}>
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

        {/* ── First-call intake (#219) ── */}
        <div className="hf-mb-lg">
          <IntakeToggleGroup initial={initialIntake} onChange={handleIntakeChange} />
        </div>

        {/* ── Call Flow Phases ── */}
        <div className="hf-mb-lg">
          <FieldHint label="Call Flow" hint={WIZARD_HINTS["course.callFlow"]} labelClass="hf-section-title" />
          <p className="hf-text-xs hf-text-muted hf-mb-sm">
            How the first lesson is structured — loaded from your {personaName || 'persona'} defaults. Click a phase to edit.
          </p>

          {loadingWelcome ? (
            <div className="hf-loading-row">
              <Loader2 className="hf-spinner hf-icon-sm" />
              <span className="hf-text-sm">Loading call flow...</span>
            </div>
          ) : (
            <>
              {/* Phase chips */}
              <div className="hf-phase-chips">
                {flowPhases.map((phase) => (
                  <button
                    key={phase._id}
                    type="button"
                    className={`hf-phase-chip${editingId === phase._id ? ' hf-phase-chip--active' : ''}`}
                    onClick={() => setEditingId(editingId === phase._id ? null : phase._id)}
                  >
                    <span className="hf-phase-chip-name">{phase.phase || 'Unnamed'}</span>
                    {phase.duration && <span className="hf-phase-chip-dur">· {phase.duration}</span>}
                    <span
                      className="hf-phase-chip-x"
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); removePhase(phase._id); }}
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))}
                <button type="button" className="hf-phase-chip hf-phase-chip--add" onClick={addPhase}>
                  <Plus size={12} /> Add
                </button>
              </div>

              {/* Inline edit panel for selected chip */}
              {editingId && flowPhases.find(p => p._id === editingId) && (() => {
                const phase = flowPhases.find(p => p._id === editingId)!;
                return (
                  <div className="hf-phase-edit-panel">
                    <div className="hf-phase-edit-row">
                      <input
                        type="text"
                        value={phase.phase}
                        onChange={(e) => updatePhase(phase._id, 'phase', e.target.value)}
                        placeholder="Phase name"
                        className="hf-input"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={phase.duration}
                        onChange={(e) => updatePhase(phase._id, 'duration', e.target.value)}
                        placeholder="e.g. 5 min"
                        className="hf-input hf-phase-edit-dur"
                      />
                      <button
                        type="button"
                        className="hf-btn hf-btn-ghost hf-flow-phase-remove"
                        onClick={() => removePhase(phase._id)}
                        title="Remove phase"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <textarea
                      value={phase.goals.join('\n')}
                      onChange={(e) => updateGoals(phase._id, e.target.value)}
                      placeholder="Goals (one per line)"
                      rows={2}
                      className="hf-input hf-flow-phase-edit-goals"
                    />
                  </div>
                );
              })()}

              {flowPhases.length === 0 && (
                <p className="hf-text-xs hf-text-muted">
                  Default structure shown in preview above. Click <strong>+ Add</strong> to customise phases.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Behavior Tuning ── */}
        <div>
          <FieldHint label="AI personality" hint={WIZARD_HINTS["course.behavior"]} labelClass="hf-section-title" />
          <p className="hf-text-xs hf-text-muted hf-mb-sm">
            Fine-tune how your AI communicates — describe the personality you want
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

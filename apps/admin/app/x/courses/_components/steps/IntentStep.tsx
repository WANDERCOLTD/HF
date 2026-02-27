'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ExternalLink, Sparkles, Loader2 } from 'lucide-react';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import {
  INTERACTION_PATTERN_ORDER,
  INTERACTION_PATTERN_LABELS,
  suggestInteractionPattern,
  type InteractionPattern,
} from '@/lib/content-trust/resolve-config';
import { LessonPlanModelPicker } from '@/components/shared/LessonPlanModelPicker';
import type { LessonPlanModel } from '@/lib/lesson-plan/types';
import type { StepProps } from '../CourseSetupWizard';

interface ExistingCourse {
  name: string;
  id: string;
  domainId?: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface DomainOption {
  id: string;
  name: string;
}

export function IntentStep({ setData, getData, onNext, onPrev, endFlow }: StepProps) {
  const router = useRouter();
  const [courseName, setCourseName] = useState('');
  const [outcomes, setOutcomes] = useState<string[]>(['', '', '']);
  const [pattern, setPattern] = useState<InteractionPattern | undefined>();
  const [suggestedPattern, setSuggestedPattern] = useState<InteractionPattern | null>(null);
  const [existingCourse, setExistingCourse] = useState<ExistingCourse | null>(null);
  const [hoveredPattern, setHoveredPattern] = useState<InteractionPattern | null>(null);
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>('direct_instruction');

  // Cascade-resolved lesson plan defaults (System → Domain → Runtime)
  const [resolvedDefaults, setResolvedDefaults] = useState<{
    sessionCount: number;
    durationMins: number;
    emphasis: string;
    assessments: string;
    lessonPlanModel: string;
  } | null>(null);

  // AI outcome suggestions
  const [outcomeSuggestions, setOutcomeSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const lastSuggestName = useRef('');
  const outcomesRef = useRef<string[]>(['', '', '']);

  // Institution (domain) state
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [selectedDomainId, setSelectedDomainId] = useState('');

  // Department selector state
  const [groupId, setGroupId] = useState<string | null>(null);
  const [availableGroups, setAvailableGroups] = useState<GroupOption[]>([]);

  // Whether the domain was pre-set from URL context (institution → create course)
  const presetDomainId = getData<string>('domainId');

  // Load domains on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/domains');
        const data = await res.json();
        if (data.ok && data.domains) {
          setDomains(data.domains);
          if (presetDomainId) {
            setSelectedDomainId(presetDomainId);
          } else if (data.domains.length === 1) {
            setSelectedDomainId(data.domains[0].id);
          }
        }
      } catch {
        // Non-critical
      } finally {
        setLoadingDomains(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved data
  useEffect(() => {
    const saved = getData<string>('courseName');
    const savedOutcomes = getData<string[]>('learningOutcomes');
    const savedPattern = getData<InteractionPattern>('interactionPattern');
    const savedGroupId = getData<string>('groupId');
    const savedModel = getData<LessonPlanModel>('lessonPlanModel');
    const savedSuggestions = getData<string[]>('outcomeSuggestions');

    if (saved) setCourseName(saved);
    if (savedOutcomes) {
      const padded = [...savedOutcomes, '', '', ''].slice(0, 3);
      setOutcomes(padded);
    }
    if (savedPattern) setPattern(savedPattern);
    if (savedGroupId) setGroupId(savedGroupId);
    if (savedModel) setLessonPlanModel(savedModel);
    if (savedSuggestions) setOutcomeSuggestions(savedSuggestions);
  }, [getData]);

  // Load available groups when domain is selected
  useEffect(() => {
    if (!selectedDomainId) return;
    setAvailableGroups([]);
    (async () => {
      try {
        const res = await fetch(`/api/playbook-groups?domainId=${selectedDomainId}`);
        const data = await res.json();
        if (data.ok && data.groups.length > 0) {
          setAvailableGroups(data.groups.map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })));
        }
      } catch {
        // Non-critical
      }
    })();
  }, [selectedDomainId]);

  // Load cascade-resolved lesson plan defaults when domain is selected
  useEffect(() => {
    if (!selectedDomainId) return;
    (async () => {
      try {
        const res = await fetch(`/api/lesson-plan-defaults?domainId=${selectedDomainId}`);
        const data = await res.json();
        if (data.ok && data.defaults) {
          setResolvedDefaults(data.defaults);
          // Pre-populate teaching model from resolved defaults (unless user already changed it)
          if (!getData<LessonPlanModel>('lessonPlanModel')) {
            setLessonPlanModel(data.defaults.lessonPlanModel as LessonPlanModel);
          }
        }
      } catch {
        // Non-critical — falls back to LESSON_PLAN_DEFAULTS on server side
      }
    })();
  }, [selectedDomainId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-suggest pattern from course name
  useEffect(() => {
    if (!pattern) {
      setSuggestedPattern(suggestInteractionPattern(courseName));
    } else {
      setSuggestedPattern(null);
    }
  }, [courseName, pattern]);

  // Check for existing course when name changes
  useEffect(() => {
    if (!courseName.trim()) { setExistingCourse(null); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/courses?q=${encodeURIComponent(courseName)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.existingCourse) {
            setExistingCourse({
              name: data.existingCourse.name,
              id: data.existingCourse.id,
              domainId: data.existingCourse.domain?.id,
            });
          } else {
            setExistingCourse(null);
          }
        }
      } catch {
        // Silent
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [courseName]);

  // Keep ref in sync so fetchOutcomeSuggestions can read current value without stale closure
  useEffect(() => { outcomesRef.current = outcomes; }, [outcomes]);

  // Fetch AI outcome suggestions (called on blur or when name is committed)
  const fetchOutcomeSuggestions = useCallback(async (name: string) => {
    if (name.length < 3 || name === lastSuggestName.current) return;
    lastSuggestName.current = name;
    setLoadingSuggestions(true);
    try {
      const res = await fetch('/api/courses/suggest-outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseName: name }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.outcomes) && data.outcomes.length > 0) {
        // Auto-fill outcomes if all slots are still empty
        const allEmpty = outcomesRef.current.every(o => !o.trim());
        if (allEmpty) {
          const autoFilled = [...data.outcomes.slice(0, 3), '', '', ''].slice(0, 3);
          setOutcomes(autoFilled);
          const remaining = data.outcomes.slice(3);
          setOutcomeSuggestions(remaining);
          setData('outcomeSuggestions', remaining);
        } else {
          setOutcomeSuggestions(data.outcomes);
          setData('outcomeSuggestions', data.outcomes);
        }
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingSuggestions(false);
    }
  }, [setData]);

  const handleOutcomeChange = (index: number, value: string) => {
    const updated = [...outcomes];
    updated[index] = value;
    setOutcomes(updated);
  };

  // Click a suggestion chip → fill next empty outcome slot
  const handleSuggestionClick = (suggestion: string) => {
    const emptyIdx = outcomes.findIndex(o => !o.trim());
    const updated = [...outcomes];
    if (emptyIdx >= 0) {
      updated[emptyIdx] = suggestion;
    } else {
      updated[updated.length - 1] = suggestion;
    }
    setOutcomes(updated);
    setOutcomeSuggestions(prev => prev.filter(s => s !== suggestion));
  };

  const handlePatternSelect = (p: InteractionPattern) => {
    setPattern(p);
    setSuggestedPattern(null);
  };

  const handleNext = async () => {
    const selectedPattern = pattern || suggestedPattern || 'directive';
    const patternInfo = INTERACTION_PATTERN_LABELS[selectedPattern as InteractionPattern];
    const trimmedName = courseName.trim();
    const filteredOutcomes = outcomes.filter(o => o.trim());

    setData('courseName', trimmedName);
    setData('domainId', selectedDomainId);
    setData('learningOutcomes', filteredOutcomes);
    setData('interactionPattern', selectedPattern);
    setData('interactionPatternName', patternInfo?.label || selectedPattern);
    setData('teachingStyle', 'tutor');
    setData('lessonPlanModel', lessonPlanModel);
    if (groupId) setData('groupId', groupId);

    // Store resolved defaults in data bag for LessonPlanStep
    const defaults = resolvedDefaults ?? {
      sessionCount: 12, durationMins: 30, emphasis: 'balanced', assessments: 'light', lessonPlanModel: 'direct_instruction',
    };
    setData('resolvedDefaults', defaults);

    // Eager plan generation — fires in background, LessonPlanStep polls for result
    try {
      const res = await fetch('/api/courses/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName: trimmedName,
          learningOutcomes: filteredOutcomes,
          teachingStyle: 'tutor',
          interactionPattern: selectedPattern,
          sessionCount: defaults.sessionCount,
          durationMins: defaults.durationMins,
          emphasis: defaults.emphasis,
          assessments: defaults.assessments,
          lessonPlanModel,
        }),
      });
      const data = await res.json();
      if (data.ok && data.taskId) {
        setData('planTaskId', data.taskId);
        setData('stepProcessing_lesson-plan', true);
      }
    } catch {
      // Non-fatal — LessonPlanStep handles manual generation if no taskId
    }

    onNext();
  };

  // ── Progressive disclosure conditions ───────────────────────
  const showOutcomes = courseName.trim().length >= 3;
  const hasOutcome = outcomes.some(o => o.trim());
  const effectivePattern = pattern || suggestedPattern;
  const showPattern = showOutcomes && (hasOutcome || !!suggestedPattern);
  const showModel = !!pattern; // only when explicitly selected

  const isValid = courseName.trim().length > 0 && !!effectivePattern && !!selectedDomainId;

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">

        {/* ── Hero heading ─────────────────────────── */}
        <div className="hf-mb-lg">
          <h1 className="hf-page-title">Create your course</h1>
          <p className="hf-page-subtitle">Name your course, set learning outcomes, and choose how the AI should teach</p>
        </div>

        {/* ── Section 1: Institution + Course Name ─────── */}
        <div className="hf-mb-lg">
          {!loadingDomains && domains.length === 0 && (
            <div className="hf-banner hf-banner-warning hf-mb-lg">
              No institutions found. <a href="/x/domains" className="hf-link">Create an institution</a> first.
            </div>
          )}
          {!loadingDomains && domains.length > 1 && (
            <div className="hf-mb-md">
              <label className="hf-label">Institution</label>
              {presetDomainId ? (
                <p className="hf-input hf-text-muted" style={{ cursor: 'default', userSelect: 'none' }}>
                  {domains.find(d => d.id === presetDomainId)?.name ?? presetDomainId}
                </p>
              ) : (
                <select
                  className="hf-input"
                  value={selectedDomainId}
                  onChange={(e) => { setSelectedDomainId(e.target.value); setGroupId(null); }}
                >
                  <option value="">Select an institution…</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <FieldHint label="What's your course called?" hint={WIZARD_HINTS["course.name"]} labelClass="hf-label" />
          <input
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            onBlur={() => {
              if (courseName.trim().length >= 3) fetchOutcomeSuggestions(courseName.trim());
            }}
            placeholder="e.g., High School Biology 101"
            className="hf-input"
          />

          {existingCourse && (
            <div className="hf-banner hf-banner-warning hf-mt-xs hf-flex hf-flex-wrap hf-items-start hf-gap-sm">
              <AlertCircle className="hf-icon-md hf-flex-shrink-0" />
              <div className="hf-flex-1">
                <p className="hf-text-sm hf-text-bold">Course exists: &quot;{existingCourse.name}&quot;</p>
                <div className="hf-flex hf-gap-sm hf-mt-xs">
                  <button
                    type="button"
                    onClick={() => { endFlow(); router.push(existingCourse.domainId ? `/x/teach?domainId=${existingCourse.domainId}` : '/x/courses'); }}
                    className="hf-btn hf-btn-secondary hf-btn-sm"
                  >
                    Go to existing <ExternalLink className="hf-icon-xs" />
                  </button>
                  <button type="button" onClick={() => setExistingCourse(null)} className="hf-btn hf-btn-ghost hf-btn-sm">
                    Create new anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 2: Outcomes (unlocks when name entered) ─── */}
        {showOutcomes && (
          <div className="hf-phase-reveal hf-mb-lg">
            {availableGroups.length > 0 && (
              <div className="hf-mb-md">
                <FieldHint
                  label="Department (optional)"
                  hint={{ why: "Groups related courses by subject area.", effect: "Course appears under this department in filters.", examples: "Science Department, Year 10, Leadership Track" }}
                  labelClass="hf-label"
                />
                <select
                  className="hf-input"
                  value={groupId || ''}
                  onChange={(e) => setGroupId(e.target.value || null)}
                >
                  <option value="">None</option>
                  {availableGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="hf-label-row hf-mb-xs">
              <FieldHint label="What will students learn? (1–3 outcomes)" hint={WIZARD_HINTS["course.outcomes"]} labelClass="hf-label" />
              {(loadingSuggestions || outcomeSuggestions.length > 0) && (
                <span className={`hf-field-hint-ai${loadingSuggestions ? ' hf-field-hint-ai--loading' : ''}`} title="AI is generating outcome suggestions">
                  <Sparkles size={14} />
                </span>
              )}
            </div>

            <div className="hf-flex hf-flex-col hf-gap-sm">
              {outcomes.map((outcome, i) => (
                <div key={i} className="hf-flex hf-items-center hf-gap-sm">
                  <span className="hf-text-sm hf-text-muted hf-bullet-spacer">•</span>
                  <input
                    type="text"
                    value={outcome}
                    onChange={(e) => handleOutcomeChange(i, e.target.value)}
                    placeholder={`Outcome ${i + 1}`}
                    className="hf-input"
                  />
                </div>
              ))}
            </div>

            {/* AI suggestion chips */}
            {loadingSuggestions && (
              <div className="hf-ai-loading-row hf-mt-sm">
                <Loader2 size={12} className="hf-spinner" />
                <span className="hf-text-xs hf-text-muted">Generating outcome suggestions…</span>
              </div>
            )}
            {!loadingSuggestions && outcomeSuggestions.length > 0 && (
              <div className="hf-mt-sm">
                <p className="hf-ai-inline-hint hf-mb-xs">
                  <Sparkles size={11} /> Suggestions — click to use:
                </p>
                <div className="hf-suggestion-chips">
                  {outcomeSuggestions.map((s, i) => (
                    <button key={i} type="button" className="hf-suggestion-chip" onClick={() => handleSuggestionClick(s)}>
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Section 3: Pattern (unlocks when outcomes visible + 1 outcome or pattern suggested) ─── */}
        {showPattern && (
          <div className="hf-phase-reveal hf-mb-lg">
            <FieldHint
              label="How should the AI teach?"
              hint={WIZARD_HINTS["course.interactionPattern"]}
              labelClass="hf-label"
            />
            <div className="hf-chip-row">
              {INTERACTION_PATTERN_ORDER.map((p) => {
                const info = INTERACTION_PATTERN_LABELS[p];
                const isSelected = pattern === p;
                const isSuggested = !pattern && suggestedPattern === p;
                return (
                  <button
                    key={p}
                    onClick={() => handlePatternSelect(p)}
                    onMouseEnter={() => setHoveredPattern(p)}
                    onMouseLeave={() => setHoveredPattern(null)}
                    className={isSelected || isSuggested ? 'hf-chip hf-chip-selected' : 'hf-chip'}
                  >
                    <span>{info.icon}</span>
                    <span>{info.label}</span>
                    {isSuggested && <span className="hf-chip-badge">AI pick</span>}
                  </button>
                );
              })}
            </div>

            {(() => {
              const preview = hoveredPattern || effectivePattern;
              if (!preview) return (
                <div className="hf-chip-preview">
                  <span className="hf-chip-preview-empty">Hover to preview each style</span>
                </div>
              );
              const info = INTERACTION_PATTERN_LABELS[preview];
              return (
                <div className="hf-chip-preview">
                  <span className="hf-chip-preview-label">{info.icon} {info.label}:</span>
                  <span className="hf-chip-preview-desc">{info.description}</span>
                  <span className="hf-chip-preview-examples">{info.examples}</span>
                </div>
              );
            })()}

            {suggestedPattern && !pattern && (
              <p className="hf-ai-inline-hint hf-mt-xs">
                <Sparkles size={11} />
                AI suggests <strong>{INTERACTION_PATTERN_LABELS[suggestedPattern].label}</strong> for this type of course — click to confirm or pick another
              </p>
            )}
          </div>
        )}

        {/* ── Section 4: Teaching model (unlocks when pattern is explicitly selected) ─── */}
        {showModel && (
          <div className="hf-phase-reveal hf-mb-lg">
            <div className="hf-mb-xs">
              <FieldHint label="Teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
            </div>
            <LessonPlanModelPicker value={lessonPlanModel} onChange={setLessonPlanModel} />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="hf-step-footer">
        <button onClick={onPrev} disabled className="hf-btn hf-btn-ghost">Back</button>
        <button onClick={handleNext} disabled={!isValid} className="hf-btn hf-btn-primary">Next</button>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import {
  INTERACTION_PATTERN_ORDER,
  INTERACTION_PATTERN_LABELS,
  suggestInteractionPattern,
  type InteractionPattern,
} from '@/lib/content-trust/resolve-config';
import type { StepProps } from '../CourseSetupWizard';

interface ExistingCourse {
  name: string;
  id: string;
  domainId?: string;
}

export function IntentStep({ setData, getData, onNext, onPrev, endFlow }: StepProps) {
  const router = useRouter();
  const [courseName, setCourseName] = useState('');
  const [outcomes, setOutcomes] = useState<string[]>(['', '', '']);
  const [pattern, setPattern] = useState<InteractionPattern | undefined>();
  const [suggestedPattern, setSuggestedPattern] = useState<InteractionPattern | null>(null);
  const [existingCourse, setExistingCourse] = useState<ExistingCourse | null>(null);

  // Load saved data
  useEffect(() => {
    const saved = getData<string>('courseName');
    const savedOutcomes = getData<string[]>('learningOutcomes');
    const savedPattern = getData<InteractionPattern>('interactionPattern');

    if (saved) setCourseName(saved);
    if (savedOutcomes) setOutcomes(savedOutcomes);
    if (savedPattern) setPattern(savedPattern);
  }, [getData]);

  // Auto-suggest pattern from course name
  useEffect(() => {
    if (!pattern) {
      const suggestion = suggestInteractionPattern(courseName);
      setSuggestedPattern(suggestion);
    } else {
      setSuggestedPattern(null);
    }
  }, [courseName, pattern]);

  // Check for existing course when name changes
  useEffect(() => {
    if (!courseName.trim()) {
      setExistingCourse(null);
      return;
    }

    const checkCourse = async () => {
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
        // Silent — course check is optional UX hint, not critical
      }
    };

    const timer = setTimeout(checkCourse, 500);
    return () => clearTimeout(timer);
  }, [courseName]);

  const handleOutcomeChange = (index: number, value: string) => {
    const newOutcomes = [...outcomes];
    newOutcomes[index] = value;
    setOutcomes(newOutcomes);
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
    setData('learningOutcomes', filteredOutcomes);
    setData('interactionPattern', selectedPattern);
    setData('interactionPatternName', patternInfo?.label || selectedPattern);
    // Keep teachingStyle for backward compat with lesson plan generation
    setData('teachingStyle', 'tutor');

    // Eager generation — fire background plan generation so it's ready before user
    // reaches LessonPlanStep. The POST returns ~50ms (just creates task + returns taskId).
    try {
      const res = await fetch('/api/courses/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseName: trimmedName,
          learningOutcomes: filteredOutcomes,
          teachingStyle: 'tutor',
          interactionPattern: selectedPattern,
          sessionCount: 12,
          durationMins: 30,
          emphasis: 'balanced',
          assessments: 'light',
        }),
      });
      const data = await res.json();
      if (data.ok && data.taskId) {
        setData('planTaskId', data.taskId);
        setData('stepProcessing_lesson-plan', true);
      }
    } catch {
      // Non-fatal — LessonPlanStep will handle manual generation if no taskId
    }

    onNext();
  };

  const effectivePattern = pattern || suggestedPattern;
  const isValid = courseName.trim().length > 0 && !!effectivePattern;

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Create Your Course</h1>
          <p className="hf-page-subtitle">Tell us about your course and how you want to teach</p>
        </div>

        {/* Course Name */}
        <div className="hf-mb-lg">
          <FieldHint label="What's your course called?" hint={WIZARD_HINTS["course.name"]} labelClass="hf-label" />
          <input
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
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
                    onClick={() => {
                      endFlow();
                      router.push(existingCourse.domainId
                        ? `/x/teach?domainId=${existingCourse.domainId}`
                        : '/x/courses');
                    }}
                    className="hf-btn hf-btn-secondary hf-btn-sm"
                  >
                    Go to existing <ExternalLink className="hf-icon-xs" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExistingCourse(null)}
                    className="hf-btn hf-btn-ghost hf-btn-sm"
                  >
                    Create new anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Learning Outcomes */}
        <div className="hf-mb-lg">
          <FieldHint label="What will students learn? (1-3 outcomes)" hint={WIZARD_HINTS["course.outcomes"]} labelClass="hf-label" />
          <div className="hf-flex hf-flex-col hf-gap-sm">
            {outcomes.map((outcome, i) => (
              <div key={i} className="hf-flex hf-items-center hf-gap-sm">
                <span className="hf-text-sm hf-text-tertiary hf-bullet-spacer">•</span>
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
          <p className="hf-hint hf-mt-xs">
            Examples: &quot;Understand photosynthesis&quot; · &quot;Explain cellular respiration&quot; · &quot;Design experiments&quot;
          </p>
        </div>

        {/* Interaction Pattern */}
        <div className="hf-mb-lg">
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
                  className={isSelected || isSuggested ? "hf-chip hf-chip-selected" : "hf-chip"}
                  title={info.description}
                >
                  <span>{info.icon}</span>
                  <span>{info.label}</span>
                  {isSuggested && (
                    <span className="hf-chip-badge">Suggested</span>
                  )}
                </button>
              );
            })}
          </div>
          {effectivePattern && (
            <p className="hf-hint hf-mt-xs">
              <strong>{INTERACTION_PATTERN_LABELS[effectivePattern].label}:</strong>{' '}
              {INTERACTION_PATTERN_LABELS[effectivePattern].description}
              {' · '}
              <em>{INTERACTION_PATTERN_LABELS[effectivePattern].examples}</em>
            </p>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="hf-step-footer">
        <button onClick={onPrev} disabled className="hf-btn hf-btn-ghost">
          Back
        </button>
        <button onClick={handleNext} disabled={!isValid} className="hf-btn hf-btn-primary">
          Next
        </button>
      </div>
    </div>
  );
}

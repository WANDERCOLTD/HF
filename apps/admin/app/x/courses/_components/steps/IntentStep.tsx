'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertCircle, ExternalLink } from 'lucide-react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepProps } from '../CourseSetupWizard';

type PersonaOption = {
  slug: string;
  name: string;
  description: string | null;
  icon: string;
};

interface ExistingCourse {
  name: string;
  id: string;
  domainId?: string;
}

export function IntentStep({ setData, getData, onNext, onPrev, endFlow }: StepProps) {
  const { lower } = useTerminology();
  const router = useRouter();
  const [courseName, setCourseName] = useState('');
  const [outcomes, setOutcomes] = useState<string[]>(['', '', '']);
  const [persona, setPersona] = useState<string | undefined>();
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [personasLoading, setPersonasLoading] = useState(true);
  const [existingCourse, setExistingCourse] = useState<ExistingCourse | null>(null);

  // Load saved data
  useEffect(() => {
    const saved = getData<string>('courseName');
    const savedOutcomes = getData<string[]>('learningOutcomes');
    const savedPersona = getData<string>('persona') || getData<string>('teachingStyle');

    if (saved) setCourseName(saved);
    if (savedOutcomes) setOutcomes(savedOutcomes);
    if (savedPersona) setPersona(savedPersona);
  }, [getData]);

  // Fetch personas from API (same source as Quick Launch)
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/onboarding', { signal: ac.signal });
        if (!res.ok) throw new Error('Failed to fetch personas');
        const data = await res.json();
        if (!ac.signal.aborted && data.ok && data.personasList?.length > 0) {
          setPersonas(data.personasList.map((p: any) => ({
            slug: p.slug,
            name: p.name,
            description: p.description || null,
            icon: p.icon || '🎭',
          })));
        } else if (!ac.signal.aborted) {
          throw new Error(data.error || 'No personas returned');
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        console.warn('[IntentStep] Failed to load personas, using fallback:', e);
        if (!ac.signal.aborted) {
          setPersonas([
            { slug: 'tutor', name: 'Tutor', description: 'Patient teaching expert', icon: '🧑‍🏫' },
          ]);
        }
      } finally {
        if (!ac.signal.aborted) setPersonasLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

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

  const handleNext = () => {
    const selected = personas.find(p => p.slug === persona);
    setData('courseName', courseName.trim());
    setData('learningOutcomes', outcomes.filter(o => o.trim()));
    setData('persona', persona);
    setData('personaName', selected?.name || persona);
    setData('teachingStyle', persona);
    onNext();
  };

  const isValid = courseName.trim().length > 0 && persona;

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

        {/* Persona Selection */}
        <div className="hf-mb-lg">
          <FieldHint label={`Choose a ${lower('persona')}`} hint={WIZARD_HINTS["course.persona"]} labelClass="hf-label" />
          {personasLoading ? (
            <div className="hf-loading-row">
              <div className="hf-spinner hf-icon-sm" />
              <span className="hf-text-sm">Loading {lower('persona')}s...</span>
            </div>
          ) : (
            <div className="hf-chip-row">
              {personas.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => setPersona(p.slug)}
                  className={persona === p.slug ? "hf-chip hf-chip-selected" : "hf-chip"}
                >
                  <span>{p.icon}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}
          {persona && personas.find(p => p.slug === persona)?.description && (
            <p className="hf-hint">
              {personas.find(p => p.slug === persona)!.description}
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
          Next <ArrowRight className="hf-icon-sm" />
        </button>
      </div>
    </div>
  );
}

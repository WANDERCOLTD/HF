'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
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
  const { terms, lower } = useTerminology();
  const router = useRouter();
  const [courseName, setCourseName] = useState('');
  const [outcomes, setOutcomes] = useState<string[]>(['', '', '']);
  const [persona, setPersona] = useState<string | undefined>();
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [personasLoading, setPersonasLoading] = useState(true);
  const [existingCourse, setExistingCourse] = useState<ExistingCourse | null>(null);
  const [checkingCourse, setCheckingCourse] = useState(false);

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
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/onboarding');
        if (!res.ok) throw new Error('Failed to fetch personas');
        const data = await res.json();
        if (!cancelled && data.ok && data.personasList?.length > 0) {
          setPersonas(data.personasList.map((p: any) => ({
            slug: p.slug,
            name: p.name,
            description: p.description || null,
            icon: p.icon || '🎭',
          })));
        } else if (!cancelled) {
          // API returned ok:false or empty list — use fallback
          throw new Error(data.error || 'No personas returned');
        }
      } catch (e) {
        console.warn('[IntentStep] Failed to load personas, using fallback:', e);
        if (!cancelled) {
          setPersonas([
            { slug: 'tutor', name: 'Tutor', description: 'Patient teaching expert', icon: '🧑‍🏫' },
          ]);
        }
      } finally {
        if (!cancelled) setPersonasLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Check for existing course when name changes
  useEffect(() => {
    if (!courseName.trim()) {
      setExistingCourse(null);
      return;
    }

    const checkCourse = async () => {
      setCheckingCourse(true);
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
      } catch (err) {
        console.error('Error checking course:', err);
      } finally {
        setCheckingCourse(false);
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
    // Keep teachingStyle for backwards compat with course-setup API
    setData('teachingStyle', persona);
    onNext();
  };

  const isValid = courseName.trim().length > 0 && persona;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Content */}
      <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Create Your Course</h1>
          <p className="text-[var(--text-secondary)]">Tell us about your course and how you want to teach</p>
        </div>

        {/* Course Name */}
        <div className="mb-8">
          <FieldHint label="What's your course called?" hint={WIZARD_HINTS["course.name"]} labelClass="block text-sm font-semibold text-[var(--text-primary)] mb-2" />
          <input
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="e.g., High School Biology 101"
            className="hf-input"
          />
          {existingCourse && (
            <div className="hf-banner hf-banner-warning" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <AlertCircle style={{ width: 20, height: 20, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 13 }}>
                <p style={{ fontWeight: 600, margin: 0 }}>Course exists: &quot;{existingCourse.name}&quot;</p>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      endFlow();
                      router.push(existingCourse.domainId
                        ? `/x/teach?domainId=${existingCourse.domainId}`
                        : '/x/courses');
                    }}
                    className="hf-btn hf-btn-secondary"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                  >
                    Go to existing <ExternalLink style={{ width: 12, height: 12 }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExistingCourse(null)}
                    className="hf-btn hf-btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                  >
                    Create new anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Learning Outcomes */}
        <div className="mb-8">
          <FieldHint label="What will students learn? (1-3 outcomes)" hint={WIZARD_HINTS["course.outcomes"]} labelClass="block text-sm font-semibold text-[var(--text-primary)] mb-2" />
          <div className="space-y-2">
            {outcomes.map((outcome, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)] w-6">•</span>
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
          <p className="text-xs text-[var(--text-tertiary)] mt-2">
            Examples: &quot;Understand photosynthesis&quot; • &quot;Explain cellular respiration&quot; • &quot;Design experiments&quot;
          </p>
        </div>

        {/* Persona Selection */}
        <div className="mb-8">
          <FieldHint label={`Choose a ${lower('persona')}`} hint={WIZARD_HINTS["course.persona"]} labelClass="block text-sm font-semibold text-[var(--text-primary)] mb-3" />
          {personasLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 0", color: "var(--text-muted)" }}>
              <div className="hf-spinner" style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 14 }}>Loading {lower('persona')}s...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {personas.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => setPersona(p.slug)}
                  className={persona === p.slug ? "hf-chip hf-chip-selected" : "hf-chip"}
                  style={{ padding: 16, textAlign: "left", display: "block", borderRadius: 10, borderWidth: 2 }}
                >
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{p.icon}</div>
                  <h3 style={{ fontWeight: 600, color: "var(--text-primary)" }}>{p.name}</h3>
                  {p.description && (
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{p.description}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="hf-step-footer">
        <button
          onClick={onPrev}
          disabled
          className="hf-btn hf-btn-ghost"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={!isValid}
          className="hf-btn hf-btn-primary"
        >
          Next <ArrowRight style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  );
}

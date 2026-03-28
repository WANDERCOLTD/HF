'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import { OnboardingPreview, type OnboardingPhase as OBPhase } from '@/components/shared/OnboardingPreview';
import { OnboardingEditor } from '@/components/shared/OnboardingEditor';

// ── Types ──────────────────────────────────────────────

export type CourseOnboardingTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    domain: { id: string; name: string; slug: string };
  };
  isOperator: boolean;
};

import { SectionHeader } from './SectionHeader';

// ── Main Component ─────────────────────────────────────

export function CourseOnboardingTab({
  courseId,
  detail,
  isOperator,
}: CourseOnboardingTabProps) {
  // ── Onboarding preview data (lazy-loaded) ──────────────
  const [onboarding, setOnboarding] = useState<{
    source: string;
    phases: OBPhase[];
    personaName?: string;
    domainWelcome?: string;
    domainName?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnboarding = useCallback(() => {
    setLoading(true);
    fetch(`/api/courses/${courseId}/onboarding`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setOnboarding({
            source: data.source,
            phases: data.phases || [],
            personaName: data.personaName,
            domainWelcome: data.domainWelcome,
            domainName: data.domainName,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { fetchOnboarding(); }, [fetchOnboarding]);

  const inheritedHint =
    onboarding?.source === 'domain' && onboarding?.domainName
      ? `Inherited from ${onboarding.domainName}`
      : onboarding?.source === 'fallback'
        ? 'Using system default'
        : undefined;

  return (
    <>
      {/* ── First Call Preview ──────────────────────────── */}
      <SectionHeader title="First Call Preview" icon={MessageCircle} />
      <div className="hf-card-compact hf-mb-lg">
        {loading ? (
          <div className="hf-text-sm hf-text-muted hf-glow-active">Loading first call structure...</div>
        ) : onboarding && onboarding.phases.length > 0 ? (
          <>
            <OnboardingPreview
              phases={onboarding.phases}
              personaName={onboarding.personaName}
              greeting={onboarding.domainWelcome}
              maxHeight={360}
              hint={inheritedHint}
            />
          </>
        ) : (
          <div className="hf-text-sm hf-text-muted">
            No first call flow configured. The onboarding wizard generates this automatically.
          </div>
        )}
      </div>

      {/* ── Onboarding Editor ──────────────────────────── */}
      <SectionHeader title="First Call Structure &amp; Phases" icon={MessageCircle} />
      <OnboardingEditor
        courseId={courseId}
        domainId={detail.domain.id}
        domainName={detail.domain.name}
        isOperator={isOperator}
      />
    </>
  );
}

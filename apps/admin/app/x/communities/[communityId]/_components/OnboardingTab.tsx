'use client';

import { useState, useEffect, useCallback } from 'react';
import { OnboardingTabContent } from '@/app/x/domains/components/OnboardingTab';
import type { DomainDetail } from '@/app/x/domains/components/types';

interface OnboardingTabProps {
  communityId: string;
}

export function OnboardingTab({ communityId }: OnboardingTabProps) {
  const [domain, setDomain] = useState<DomainDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDomain = useCallback(async () => {
    try {
      const res = await fetch(`/api/domains/${communityId}`);
      const data = await res.json();
      if (data.ok && data.domain) {
        setDomain(data.domain as DomainDetail);
        setError(null);
      } else {
        setError(data.error || 'Failed to load onboarding configuration');
      }
    } catch (e) {
      console.warn('[OnboardingTab] Failed to fetch domain:', e);
      setError('Failed to load onboarding configuration');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { fetchDomain(); }, [fetchDomain]);

  if (loading) {
    return <div className="hf-spinner" style={{ margin: '48px auto' }} />;
  }

  if (error || !domain) {
    return <div className="hf-banner hf-banner-error">{error || 'Failed to load'}</div>;
  }

  return <OnboardingTabContent domain={domain} onDomainRefresh={fetchDomain} />;
}

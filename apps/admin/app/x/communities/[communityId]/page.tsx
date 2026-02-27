'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DraggableTabs, type TabDefinition } from '@/components/shared/DraggableTabs';
import type { CommunityDetail } from './_components/types';
import { IdentityTab } from './_components/IdentityTab';
import { OnboardingTab } from './_components/OnboardingTab';
import { MembersTab } from './_components/MembersTab';
import { SettingsTab } from './_components/SettingsTab';
import { TopicsTab } from './_components/TopicsTab';

type Tab = 'identity' | 'topics' | 'members' | 'onboarding' | 'settings';

export default function CommunityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const communityId = params.communityId as string;

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('identity');
  const [saving, setSaving] = useState(false);

  const loadCommunity = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('Community not found');
        } else {
          throw new Error('Failed to load community');
        }
        return;
      }
      const data = await res.json();
      if (data.ok && data.community) {
        setCommunity(data.community);
        setError(null);
      } else {
        setError(data.error || 'Failed to load community');
      }
    } catch (err) {
      console.error('Error loading community:', err);
      setError(err instanceof Error ? err.message : 'Failed to load community');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { loadCommunity(); }, [loadCommunity]);

  const handleSave = async (patch: Record<string, any>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.ok) {
        // Refresh to get full data (PATCH returns partial)
        await loadCommunity();
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="hf-page-container hf-page-scroll">
        <div className="hf-spinner" style={{ margin: '64px auto' }} />
      </div>
    );
  }

  if (error && !community) {
    return (
      <div className="hf-page-container hf-page-scroll">
        <div className="hf-banner hf-banner-error">{error}</div>
      </div>
    );
  }

  if (!community) return null;

  const isTopicBased = community.config?.communityKind === 'TOPIC_BASED';

  const tabs: TabDefinition[] = [
    { id: 'identity', label: 'Identity' },
    ...(isTopicBased ? [{ id: 'topics' as Tab, label: `Topics (${community.playbookCount})` }] : []),
    { id: 'members', label: `Members (${community.memberCount})` },
    { id: 'onboarding', label: 'Onboarding' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="hf-page-container hf-page-scroll">
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-sm">{error}</div>
      )}

      {/* Community header */}
      <div className="hf-mb-lg">
        <h1 className="hf-page-title hf-mb-xs">{community.name}</h1>
        {community.description && (
          <p className="hf-text-sm hf-text-muted">{community.description}</p>
        )}
        <div className="hf-flex hf-gap-lg hf-mt-sm hf-text-xs hf-text-muted">
          <span><strong>{community.memberCount}</strong> members</span>
          <span><strong>{community.playbookCount}</strong> playbooks</span>
          <span>Persona: <strong>{community.personaName}</strong></span>
        </div>
      </div>

      {/* Tabs */}
      <DraggableTabs
        storageKey="community-detail-tabs"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as Tab)}
      />

      {/* Tab Content */}
      <div className="hf-mt-lg">
      {activeTab === 'identity' && (
        <IdentityTab community={community} onSave={handleSave} saving={saving} />
      )}
      {activeTab === 'topics' && isTopicBased && (
        <TopicsTab communityId={communityId} />
      )}
      {activeTab === 'members' && (
        <MembersTab community={community} onRefresh={loadCommunity} />
      )}
      {activeTab === 'onboarding' && (
        <OnboardingTab communityId={communityId} />
      )}
      {activeTab === 'settings' && (
        <SettingsTab community={community} onSave={handleSave} saving={saving} />
      )}
      </div>
    </div>
  );
}

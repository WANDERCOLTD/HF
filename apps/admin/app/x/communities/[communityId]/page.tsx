'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { CommunityDetail } from './_components/types';
import { IdentityTab } from './_components/IdentityTab';
import { OnboardingTab } from './_components/OnboardingTab';
import { MembersTab } from './_components/MembersTab';
import { SettingsTab } from './_components/SettingsTab';

type Tab = 'identity' | 'members' | 'onboarding' | 'settings';

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
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <div className="hf-spinner" style={{ margin: '64px auto' }} />
      </div>
    );
  }

  if (error && !community) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <button
          onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 24, fontSize: 14 }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="hf-banner hf-banner-error">{error}</div>
      </div>
    );
  }

  if (!community) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'identity', label: 'Identity' },
    { id: 'members', label: `Members (${community.memberCount})` },
    { id: 'onboarding', label: 'Onboarding' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <button
        onClick={() => router.push('/x/communities')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, fontSize: 14 }}
      >
        <ArrowLeft size={16} /> Communities
      </button>

      {error && (
        <div className="hf-banner hf-banner-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {/* Community header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="hf-page-title" style={{ marginBottom: 4 }}>{community.name}</h1>
        {community.description && (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{community.description}</p>
        )}
        <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span><strong>{community.memberCount}</strong> members</span>
          <span><strong>{community.playbookCount}</strong> playbooks</span>
          <span>Persona: <strong>{community.personaName}</strong></span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-default)', marginBottom: 24 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent-primary)' : 'transparent'}`,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'identity' && (
        <IdentityTab community={community} onSave={handleSave} saving={saving} />
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
  );
}

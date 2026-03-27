'use client';

import { useState, useEffect } from 'react';

interface ChannelConfig {
  id: string;
  channelType: string;
  domainId: string | null;
  domain: { id: string; name: string; slug: string } | null;
  isEnabled: boolean;
  config: Record<string, any>;
  priority: number;
}

const CHANNEL_TYPES = [
  { type: 'sim', label: 'Practice Chat', description: 'Built-in text chat practice', icon: '\u{1F4AC}' },
  { type: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp Business Cloud API', icon: '\u{1F4F1}' },
  { type: 'sms', label: 'SMS/MMS', description: 'Twilio SMS/MMS delivery', icon: '\u{1F4E8}' },
];

export function ChannelsPanel() {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/channels')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setChannels(data.channels);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleChannel(channelType: string, isEnabled: boolean) {
    setSaving(channelType);
    try {
      const res = await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelType, isEnabled, domainId: null }),
      });
      const data = await res.json();
      if (data.ok) {
        setChannels((prev) => {
          const existing = prev.find((c) => c.channelType === channelType && !c.domainId);
          if (existing) return prev.map((c) => (c.id === existing.id ? data.channel : c));
          return [...prev, data.channel];
        });
      }
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Loading channels...</div>;
  }

  return (
    <div style={{ padding: '16px 0' }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Configure delivery channels for sharing content with learners. Enable channels globally or per-domain.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {CHANNEL_TYPES.map((ct) => {
          const config = channels.find((c) => c.channelType === ct.type && !c.domainId);
          const isEnabled = config?.isEnabled ?? ct.type === 'sim'; // sim enabled by default

          return (
            <div
              key={ct.type}
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 8,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                opacity: isEnabled ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 24 }}>{ct.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{ct.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ct.description}</div>
                {ct.type !== 'sim' && isEnabled && (
                  <div style={{ fontSize: 11, color: 'var(--status-warning-text)', marginTop: 4 }}>
                    Configuration required — set API keys in channel config
                  </div>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => toggleChannel(ct.type, e.target.checked)}
                  disabled={saving === ct.type}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {saving === ct.type ? 'Saving...' : isEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>
          );
        })}
      </div>

      {/* Domain-specific overrides summary */}
      {channels.filter((c) => c.domainId).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Institution Overrides</h4>
          {channels.filter((c) => c.domainId).map((c) => (
            <div key={c.id} style={{ fontSize: 12, color: 'var(--text-primary)', padding: '4px 0' }}>
              <strong>{c.domain?.name}</strong>: {c.channelType} {c.isEnabled ? '(enabled)' : '(disabled)'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

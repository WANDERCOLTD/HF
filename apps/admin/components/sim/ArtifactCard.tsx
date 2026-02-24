'use client';

import { useState } from 'react';

interface Artifact {
  id: string;
  type: string;
  title: string;
  content: string;
  trustLevel: string;
  confidence: number;
  createdAt: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  media?: { id: string; fileName: string; mimeType: string; title?: string | null } | null;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  SUMMARY: { icon: '\u{1F4CB}', label: 'Summary', color: 'var(--status-success-text)' },
  KEY_FACT: { icon: '\u{1F4A1}', label: 'Key Fact', color: 'var(--status-warning-text)' },
  FORMULA: { icon: '\u{1F9EE}', label: 'Formula', color: 'var(--text-muted)' },
  EXERCISE: { icon: '\u{270F}\u{FE0F}', label: 'Exercise', color: 'var(--accent-primary)' },
  RESOURCE_LINK: { icon: '\u{1F4D6}', label: 'Resource', color: 'var(--accent-primary)' },
  STUDY_NOTE: { icon: '\u{1F4DD}', label: 'Study Note', color: 'var(--status-success-text)' },
  REMINDER: { icon: '\u{23F0}', label: 'Reminder', color: 'var(--status-error-text)' },
  MEDIA: { icon: '\u{1F4CE}', label: 'Media', color: 'var(--text-primary)' },
};

const TRUST_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  VERIFIED: { label: 'Verified', bg: 'var(--status-success-bg)', fg: 'var(--status-success-text)' },
  INFERRED: { label: 'AI Generated', bg: 'color-mix(in srgb, var(--status-warning) 12%, transparent)', fg: 'var(--status-warning-text)' },
  UNVERIFIED: { label: 'Unverified', bg: 'var(--surface-secondary)', fg: 'var(--text-muted)' },
};

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TYPE_CONFIG[artifact.type] || TYPE_CONFIG.KEY_FACT;
  const trust = TRUST_BADGE[artifact.trustLevel] || TRUST_BADGE.INFERRED;

  // Resolve media URL — prefer structured media reference, fall back to legacy mediaUrl
  const mediaUrl = artifact.media ? `/api/media/${artifact.media.id}` : artifact.mediaUrl || null;
  const mediaMime = artifact.media?.mimeType || artifact.mediaType || null;
  const time = new Date(artifact.createdAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const contentPreview =
    !expanded && artifact.content.length > 150
      ? artifact.content.slice(0, 150) + '...'
      : artifact.content;

  return (
    <div
      style={{
        alignSelf: 'center',
        width: '90%',
        maxWidth: 400,
        background: 'var(--surface-primary)',
        borderRadius: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          background: typeInfo.color,
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>{typeInfo.icon}</span>
        <span style={{ color: 'var(--surface-primary)', fontSize: 12, fontWeight: 600, flex: 1 }}>
          {typeInfo.label}
        </span>
        <span
          style={{
            background: trust.bg,
            color: trust.fg,
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {trust.label}
        </span>
      </div>

      {/* Content */}
      <div
        style={{ padding: '10px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Media preview */}
        {mediaUrl && mediaMime?.startsWith('image/') && (
          <img
            src={mediaUrl}
            alt={artifact.title}
            style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 4, marginBottom: 8, objectFit: 'cover' }}
          />
        )}
        {mediaUrl && mediaMime === 'application/pdf' && (
          <a href={mediaUrl}
            download={artifact.media?.fileName || 'document.pdf'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--surface-secondary)', borderRadius: 4, marginBottom: 8, textDecoration: 'none', color: 'var(--text-primary)', fontSize: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            {'\u{1F4C4}'} {artifact.media?.fileName || 'Document'} <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>Download ↓</span>
          </a>
        )}
        {mediaUrl && mediaMime?.startsWith('audio/') && (
          <div style={{ marginBottom: 8 }} onClick={(e) => e.stopPropagation()}>
            <audio controls preload="metadata" style={{ width: '100%', height: 36 }}>
              <source src={mediaUrl} type={mediaMime} />
            </audio>
          </div>
        )}

        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}
        >
          {artifact.title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {contentPreview}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{time}</span>
          {artifact.content.length > 150 && (
            <span style={{ fontSize: 11, color: typeInfo.color, fontWeight: 500 }}>
              {expanded ? 'Show less' : 'Read more'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

export interface MediaInfo {
  id: string;
  fileName: string;
  mimeType: string;
  title?: string | null;
  url: string; // /api/media/{id}
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'teacher';
  content: string;
  timestamp?: Date;
  senderName?: string;
  media?: MediaInfo | null;
  /** True when this is NOT the first message in a consecutive same-speaker run */
  isRunContinuation?: boolean;
  /** True when this is the last message in a consecutive same-speaker run (shows timestamp) */
  isLastInRun?: boolean;
}

function MediaRenderer({ media }: { media: MediaInfo }) {
  const [expanded, setExpanded] = useState(false);

  const isImage = media.mimeType.startsWith('image/');
  const isPdf = media.mimeType === 'application/pdf';
  const isAudio = media.mimeType.startsWith('audio/');

  if (isImage) {
    return (
      <>
        <img
          src={media.url}
          alt={media.title || media.fileName}
          onClick={() => setExpanded(!expanded)}
          style={{
            maxWidth: '100%',
            maxHeight: expanded ? 'none' : 280,
            borderRadius: 6,
            cursor: 'pointer',
            objectFit: 'cover',
            display: 'block',
            marginBottom: 4,
          }}
        />
        {media.title && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
            {media.title}
          </div>
        )}
      </>
    );
  }

  if (isPdf) {
    return (
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'rgba(0,0,0,0.04)',
          borderRadius: 6,
          textDecoration: 'none',
          color: 'inherit',
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 24 }}>{'\u{1F4C4}'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {media.title || media.fileName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PDF Document</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Open</span>
      </a>
    );
  }

  if (isAudio) {
    return (
      <div style={{ marginBottom: 4 }}>
        {media.title && (
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
            {media.title}
          </div>
        )}
        <audio
          controls
          preload="metadata"
          style={{ width: '100%', maxWidth: 280, height: 36 }}
        >
          <source src={media.url} type={media.mimeType} />
        </audio>
      </div>
    );
  }

  // Fallback: generic file link
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'block', fontSize: 13, color: 'var(--accent-primary)', marginBottom: 4 }}
    >
      {'\u{1F4CE}'} {media.title || media.fileName}
    </a>
  );
}

export function MessageBubble({ role, content, timestamp, senderName, media, isRunContinuation, isLastInRun = true }: MessageBubbleProps) {
  const isUser = role === 'user';
  const isTeacher = role === 'teacher';
  const showTime = isLastInRun && timestamp;
  const timeStr = timestamp
    ? timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  if (isTeacher) {
    return (
      <div className="wa-bubble wa-bubble-teacher">
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-warning-text)', marginBottom: 2 }}>
          {senderName || 'Teacher'}
        </div>
        {media && <MediaRenderer media={media} />}
        <span>{content}</span>
        {timeStr && <span className="wa-bubble-time">{timeStr}</span>}
      </div>
    );
  }

  const dirClass = isUser ? 'wa-bubble-out' : 'wa-bubble-in';
  const runClass = isRunContinuation ? 'wa-run-cont' : '';

  return (
    <div className={`wa-bubble ${dirClass} ${runClass}`}>
      {media && <MediaRenderer media={media} />}
      <span>{content}</span>
      {showTime && <span className="wa-bubble-time">{timeStr}</span>}
    </div>
  );
}

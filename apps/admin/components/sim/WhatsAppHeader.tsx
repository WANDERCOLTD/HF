'use client';

import { ArrowLeft, PhoneOff, FolderOpen, Mic, MicOff } from 'lucide-react';

interface WhatsAppHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onEndCall?: () => void;
  onMediaLibrary?: () => void;
  onAvatarClick?: () => void;
  onVoiceToggle?: () => void;
  mediaLibraryActive?: boolean;
  voiceActive?: boolean;
  callActive?: boolean;
  avatarColor?: string;
}

export function WhatsAppHeader({ title, subtitle, onBack, onEndCall, onMediaLibrary, onAvatarClick, onVoiceToggle, mediaLibraryActive, voiceActive, callActive, avatarColor = 'var(--text-muted)' }: WhatsAppHeaderProps) {
  const initials = title.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="wa-header">
      {onBack && (
        <button className="wa-back-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={24} />
        </button>
      )}
      <div
        className="wa-avatar"
        style={{ background: avatarColor, cursor: onAvatarClick ? 'pointer' : undefined }}
        onClick={onAvatarClick}
        role={onAvatarClick ? 'button' : undefined}
        aria-label={onAvatarClick ? `View ${title} details` : undefined}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0, cursor: onAvatarClick ? 'pointer' : undefined }} onClick={onAvatarClick}>
        <div className="wa-header-title">{title}</div>
        {subtitle && <div className="wa-header-subtitle">{subtitle}</div>}
      </div>
      {onMediaLibrary && (
        <button
          className="wa-back-btn"
          onClick={onMediaLibrary}
          aria-label="Shared files"
          title="Shared files"
          style={{ color: mediaLibraryActive ? 'var(--accent-primary)' : undefined }}
        >
          <FolderOpen size={20} />
        </button>
      )}
      {onVoiceToggle && (
        <button
          className="wa-back-btn"
          onClick={onVoiceToggle}
          aria-label={voiceActive ? 'Exit voice mode' : 'Enter voice mode'}
          title={voiceActive ? 'Exit voice mode' : 'Voice mode'}
          style={{ color: voiceActive ? 'var(--wa-green-primary)' : undefined }}
        >
          {voiceActive ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
      )}
      {callActive && onEndCall && (
        <button
          className="wa-back-btn"
          onClick={onEndCall}
          aria-label="End call"
          style={{ color: 'var(--status-error-text)' }}
        >
          <PhoneOff size={22} />
        </button>
      )}
    </div>
  );
}

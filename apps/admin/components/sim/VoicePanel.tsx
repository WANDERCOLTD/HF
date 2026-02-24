'use client';

import { Mic, MicOff, Square, X } from 'lucide-react';
import type { VoiceMode, VoiceState } from './useVoiceMode';

interface VoicePanelProps {
  voiceMode: VoiceMode;
  callId: string | null;
  onContentPicker: () => void;
  showContentPicker: boolean;
}

const WAVEFORM_BARS = 5;

function WaveformBars({ level, state }: { level: number; state: VoiceState }) {
  // Heights: idle/ai-speaking use CSS pulse animation; recording uses live level
  const isLive = state === 'recording';
  const isPulsing = state === 'idle' || state === 'ai-speaking';

  return (
    <div className="wa-voice-waveform">
      {Array.from({ length: WAVEFORM_BARS }).map((_, i) => {
        // Spread the live level across bars with slight variation per bar
        const spread = isLive ? Math.min(1, level * (0.6 + (i % 3) * 0.2)) : 0;
        const heightPct = isLive ? Math.max(8, spread * 100) : undefined;
        return (
          <div
            key={i}
            className={`wa-voice-bar${isPulsing ? ' wa-voice-bar--pulse' : ''}`}
            style={heightPct !== undefined ? { height: `${heightPct}%` } : undefined}
          />
        );
      })}
    </div>
  );
}

function stateLabel(state: VoiceState): string {
  switch (state) {
    case 'idle':         return 'Tap to speak';
    case 'recording':   return 'Listening...';
    case 'transcribing': return 'Transcribing...';
    case 'ai-speaking': return 'AI speaking';
    default:            return '';
  }
}

export function VoicePanel({ voiceMode, callId, onContentPicker, showContentPicker }: VoicePanelProps) {
  const { state, waveformLevel, startRecording, stopRecording, interrupt, toggle } = voiceMode;

  function handleActionBtn() {
    if (state === 'ai-speaking') {
      interrupt();
    } else if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      startRecording();
    }
    // transcribing: button disabled
  }

  const actionDisabled = state === 'transcribing';
  const isRecording = state === 'recording';
  const isSpeaking = state === 'ai-speaking';

  return (
    <div className="wa-voice-bar-panel">
      {/* Content picker — same as text mode */}
      {callId && (
        <button
          onClick={onContentPicker}
          title="Share content"
          className="wa-voice-exit-btn"
          style={{ color: showContentPicker ? 'var(--accent-primary)' : undefined, fontSize: 20 }}
        >
          {'\u{1F4CE}'}
        </button>
      )}

      {/* Waveform + label strip */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <WaveformBars level={waveformLevel} state={state} />
        <div className="wa-voice-label">{stateLabel(state)}</div>
      </div>

      {/* Primary action button — mic / stop / interrupt */}
      <button
        className={`wa-voice-action-btn${isRecording ? ' wa-voice-action-btn--recording' : ''}${isSpeaking ? ' wa-voice-action-btn--speaking' : ''}`}
        onClick={handleActionBtn}
        disabled={actionDisabled}
        aria-label={isSpeaking ? 'Stop AI' : isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isSpeaking ? <Square size={18} /> : isRecording ? <MicOff size={20} /> : <Mic size={20} />}
      </button>

      {/* Exit voice mode */}
      <button
        className="wa-voice-exit-btn"
        onClick={toggle}
        aria-label="Exit voice mode"
        title="Exit voice mode"
      >
        <X size={18} />
      </button>
    </div>
  );
}

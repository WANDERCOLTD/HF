'use client';

/**
 * LiveTranscript — reusable live-call transcript surface.
 *
 * Drops into any page that has a Call.id. Opens an EventSource on
 * `/api/voice/calls/[id]/stream` and renders incremental bubbles as
 * the conversation arrives. Same coalesce semantics as SimChat
 * (REPLACE-not-APPEND within a same-role turn — #1365).
 *
 * Does NOT depend on SimChat state. Pure consumer of the voice SSE
 * registry (`lib/voice/sse-registry.ts`). Server-side gating via the
 * `transcriptStreamEnabled` cascade (#1373) still applies — when the
 * gate is false, the SSE connection still serves `call-started` /
 * `call-ended` but `transcript-partial` broadcasts are suppressed
 * upstream.
 *
 * Usage:
 *   <LiveTranscript callId={call.id} />
 *
 *   <LiveTranscript
 *     callId={call.id}
 *     emptyState={<p>Waiting for the conversation to start…</p>}
 *     onCallEnded={({ totalDurationMs }) => router.refresh()}
 *   />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageBubble } from '@/components/sim/MessageBubble';
import type { VoiceCallSseEvent } from '@/lib/voice/sse-registry';

export interface LiveTranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type LiveTranscriptConnectionState =
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

export interface LiveTranscriptProps {
  /** Local Call.id. SSE connects to /api/voice/calls/[callId]/stream. */
  callId: string;
  /** Auto-scroll to newest bubble. Default true. */
  autoScroll?: boolean;
  /** Container className. The component owns layout inside. */
  className?: string;
  /** Rendered before the first transcript event arrives. */
  emptyState?: React.ReactNode;
  /**
   * Fires when the SSE delivers `call-started`. `transcriptStreamEnabled`
   * is the cascade-resolved gate (#1373) — when false, no bubbles will
   * arrive over this connection regardless of what VAPI sends. Surface
   * it as a header pill so the user knows whether silence means
   * "config says off" or "nobody's spoken yet".
   */
  onCallStarted?: (info: {
    durationLimitMs: number | null;
    transcriptStreamEnabled: boolean;
  }) => void;
  /** Fires when the SSE delivers `call-ended` (parent can refresh state). */
  onCallEnded?: (info: {
    reason: string | null;
    totalDurationMs: number | null;
  }) => void;
  /** Surface connection lifecycle (status pills, diagnostic UIs, etc.). */
  onConnectionStateChange?: (state: LiveTranscriptConnectionState) => void;
}

export function LiveTranscript({
  callId,
  autoScroll = true,
  className,
  emptyState,
  onCallStarted,
  onCallEnded,
  onConnectionStateChange,
}: LiveTranscriptProps): React.ReactElement {
  const [messages, setMessages] = useState<LiveTranscriptMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const handleEvent = useCallback(
    (event: VoiceCallSseEvent) => {
      if (event.type === 'transcript-partial') {
        const role: 'user' | 'assistant' =
          event.role === 'learner' ? 'user' : 'assistant';
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === role) {
            if (last.content === event.text) return prev;
            return [...prev.slice(0, -1), { ...last, content: event.text }];
          }
          return [
            ...prev,
            {
              id: `voice-${event.timestampMs}-${event.role}`,
              role,
              content: event.text,
              timestamp: new Date(event.timestampMs),
            },
          ];
        });
        return;
      }
      if (event.type === 'call-started') {
        onCallStarted?.({
          durationLimitMs: event.durationLimitMs,
          transcriptStreamEnabled: event.transcriptStreamEnabled,
        });
        return;
      }
      if (event.type === 'call-ended') {
        onCallEnded?.({
          reason: event.reason,
          totalDurationMs: event.totalDurationMs,
        });
      }
    },
    [onCallStarted, onCallEnded],
  );

  useEffect(() => {
    if (!callId) return;
    onConnectionStateChange?.('connecting');
    const url = `/api/voice/calls/${encodeURIComponent(callId)}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    const dispatch = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as VoiceCallSseEvent;
        handleEvent(parsed);
      } catch (err) {
        console.warn('[LiveTranscript] parse error:', err);
      }
    };
    es.onopen = () => onConnectionStateChange?.('open');
    es.onmessage = dispatch;
    const eventNames = [
      'call-started',
      'transcript-partial',
      'share-content',
      'send-text',
      'request-artifact',
      'call-ended',
    ] as const;
    for (const name of eventNames) {
      es.addEventListener(name, dispatch as EventListener);
    }
    es.onerror = () => onConnectionStateChange?.('error');
    return () => {
      es.close();
      onConnectionStateChange?.('closed');
    };
  }, [callId, handleEvent, onConnectionStateChange]);

  useEffect(() => {
    if (!autoScroll) return;
    const node = endRef.current;
    if (typeof node?.scrollIntoView !== 'function') return;
    node.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, autoScroll]);

  if (messages.length === 0) {
    return <div className={className}>{emptyState ?? null}</div>;
  }

  return (
    <div className={className}>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const isRunContinuation = prev?.role === m.role;
        const isLastInRun = !next || next.role !== m.role;
        return (
          <MessageBubble
            key={m.id}
            role={m.role}
            content={m.content}
            timestamp={m.timestamp}
            isRunContinuation={isRunContinuation}
            isLastInRun={isLastInRun}
          />
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

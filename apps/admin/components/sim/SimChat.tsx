'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { WhatsAppHeader } from './WhatsAppHeader';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { MessageInput } from './MessageInput';
import { ArtifactCard } from './ArtifactCard';
import { ActionCard } from './ActionCard';
import { ContentPicker } from './ContentPicker';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import { VoicePanel } from './VoicePanel';
import { useVoiceMode } from './useVoiceMode';
import type { MediaInfo } from './MessageBubble';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'teacher';
  content: string;
  timestamp: Date;
  senderName?: string;
  media?: MediaInfo | null;
}

export interface SimChatProps {
  callerId: string;
  callerName: string;
  domainName?: string;
  playbookId?: string;
  playbookName?: string;
  pastCalls?: { transcript: string; createdAt: string }[];
  mode: 'standalone' | 'embedded';
  sessionGoal?: string;
  onCallEnd?: () => void;
  onNewCall?: () => void;
  onBack?: () => void;
}

const AVATAR_COLORS = [
  'var(--text-muted)', 'var(--status-error-text)', 'var(--accent-secondary, #7c6bc4)', 'var(--status-success-text)', 'var(--status-warning-text)',
  'var(--accent-primary)', 'var(--badge-pink-text, #c45baa)', 'var(--status-success-text)', 'var(--status-warning-text)', 'var(--text-muted)',
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function parseTranscript(transcript: string): { role: 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  const lines = transcript.split('\n');
  let current: { role: 'user' | 'assistant'; content: string } | null = null;
  for (const line of lines) {
    if (line.startsWith('User: ')) {
      if (current) messages.push(current);
      current = { role: 'user', content: line.slice(6) };
    } else if (line.startsWith('Assistant: ')) {
      if (current) messages.push(current);
      current = { role: 'assistant', content: line.slice(11) };
    } else if (current) {
      current.content += '\n' + line;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function formatDateChip(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - target.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (now.getFullYear() !== date.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface HistoryGroup {
  dateLabel: string;
  messages: Message[];
}

export function SimChat({
  callerId,
  callerName,
  domainName,
  playbookId,
  playbookName,
  pastCalls,
  mode,
  sessionGoal,
  onCallEnd,
  onNewCall,
  onBack,
}: SimChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [showEndSheet, setShowEndSheet] = useState(false);
  const [runPipeline, setRunPipeline] = useState(true);
  const [isEnding, setIsEnding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [callEnded, setCallEnded] = useState(false);
  const [newPromptId, setNewPromptId] = useState<string | null>(null);
  const [showContentPicker, setShowContentPicker] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const callIdRef = useRef<string | null>(null);

  // Voice mode — wired so transcribed speech sends as user message
  const voiceMode = useVoiceMode(useCallback((transcript: string) => {
    sendVoiceMessage(transcript);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // Abort in-flight stream on unmount (prevents orphaned fetches during key-based remount)
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Parse past calls into grouped history (computed once)
  const historyGroups: HistoryGroup[] = useMemo(() => {
    if (!pastCalls?.length) return [];
    const groups: HistoryGroup[] = [];
    let lastLabel = '';
    for (const call of pastCalls) {
      const parsed = parseTranscript(call.transcript);
      if (parsed.length === 0) continue;
      const callDate = new Date(call.createdAt);
      const label = formatDateChip(callDate);
      const msgs: Message[] = parsed.map((m, i) => ({
        id: `history-${call.createdAt}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: callDate,
      }));
      if (label === lastLabel && groups.length > 0) {
        // Same date — merge into existing group with a separator
        groups[groups.length - 1].messages.push(...msgs);
      } else {
        groups.push({ dateLabel: label, messages: msgs });
        lastLabel = label;
      }
    }
    return groups;
  }, [pastCalls]);

  const hasHistory = historyGroups.length > 0;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, artifacts, actions]);

  // Poll for server-side messages (teacher interjections + AI-shared media)
  const lastInterjectionCheck = useRef(new Date().toISOString());
  useEffect(() => {
    if (!callId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/calls/${callId}/messages?after=${lastInterjectionCheck.current}`
        );
        const data = await res.json();
        if (data.ok && data.messages?.length > 0) {
          lastInterjectionCheck.current = new Date().toISOString();
          for (const msg of data.messages) {
            // Skip messages we created client-side (user/assistant without media)
            // Only inject: teacher messages, or any message with media attached
            const isServerSide = msg.role === 'teacher' || msg.media;
            if (!isServerSide) continue;

            // Avoid duplicates
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, {
                id: msg.id,
                role: msg.role as 'user' | 'assistant' | 'teacher',
                content: msg.content,
                timestamp: new Date(msg.createdAt),
                senderName: msg.senderName,
                media: msg.media ? {
                  id: msg.media.id,
                  fileName: msg.media.fileName,
                  mimeType: msg.media.mimeType,
                  title: msg.media.title,
                  url: `/api/media/${msg.media.id}`,
                } : null,
              }];
            });
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [callId]);

  // Show toast then auto-hide
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Initialize: resume active call if one exists, otherwise compose prompt + create call + AI greets
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Check for an existing active sim call (non-ended, within last 2 hours)
        let activeCall: { id: string } | null = null;
        try {
          const activeRes = await fetch(`/api/callers/${callerId}/calls?active=true`);
          if (activeRes.ok) {
            const activeData = await activeRes.json();
            if (activeData.ok && activeData.call) {
              activeCall = activeData.call;
            }
          } else {
            console.warn('[sim] Active call check returned', activeRes.status);
          }
        } catch (e) {
          console.warn('[sim] Active call check failed:', e);
        }

        if (!cancelled && activeCall) {
          // Resume the active call — load its messages
          console.log('[sim] Resuming active call:', activeCall.id);
          callIdRef.current = activeCall.id;
          setCallId(activeCall.id);

          const msgsRes = await fetch(`/api/calls/${activeCall.id}/messages`);
          const msgsData = await msgsRes.json();

          if (!cancelled && msgsData.ok && msgsData.messages?.length > 0) {
            const restored: Message[] = msgsData.messages.map((m: any) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant' | 'teacher',
              content: m.content,
              timestamp: new Date(m.createdAt),
              senderName: m.senderName,
              media: m.media ? {
                id: m.media.id,
                fileName: m.media.fileName,
                mimeType: m.media.mimeType,
                title: m.media.title,
                url: `/api/media/${m.media.id}`,
              } : null,
            }));
            setMessages(restored);
            console.log(`[sim] Restored ${restored.length} messages from active call`);
          } else if (!cancelled) {
            // Active call exists but has no messages (e.g. greeting was aborted) — re-send greeting
            console.log('[sim] Active call has no messages, sending greeting');
            await streamAIResponse(
              sessionGoal
                ? `The user just opened the chat. The admin has set a session goal: "${sessionGoal}". Greet them warmly as if answering a phone call, and gently orient toward this goal. Be brief and natural.`
                : 'The user just opened the chat. Greet them warmly as if answering a phone call. Be brief and natural.',
              []
            );
          }
          return; // Don't create a new call
        }

        // No active call — compose a fresh prompt and start new conversation
        // Bail early if cancelled (prevents ghost calls from React strict mode double-mount)
        if (cancelled) return;

        let usedPromptId: string | null = null;
        const composeRes = await fetch(`/api/callers/${callerId}/compose-prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggerType: 'sim', ...(playbookId ? { playbookIds: [playbookId] } : {}) }),
        });
        if (composeRes.ok) {
          const composeData = await composeRes.json();
          usedPromptId = composeData.prompt?.id || null;
        } else {
          console.warn('[sim] compose-prompt failed, continuing with existing prompt');
        }

        // Create a new call record, linked to the composed prompt
        if (cancelled) return;
        const callRes = await fetch(`/api/callers/${callerId}/calls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'sim', usedPromptId, ...(playbookId ? { playbookId } : {}) }),
        });
        const callData = await callRes.json();
        if (!cancelled && callData.ok) {
          console.log('[sim] Call created:', callData.call.id);
          callIdRef.current = callData.call.id;
          setCallId(callData.call.id);
        } else if (!cancelled) {
          console.error('[sim] Failed to create call:', callData.error || callRes.status);
          setError('Failed to create call record');
          return;
        }

        // AI sends greeting
        if (!cancelled) {
          await streamAIResponse(
            sessionGoal
                ? `The user just opened the chat. The admin has set a session goal: "${sessionGoal}". Greet them warmly as if answering a phone call, and gently orient toward this goal. Be brief and natural.`
                : 'The user just opened the chat. Greet them warmly as if answering a phone call. Be brief and natural.',
            []
          );
        }
      } catch {
        if (!cancelled) setError('Failed to start conversation');
      }
    }

    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerId]);

  // Stream AI response
  async function streamAIResponse(
    message: string,
    history: { role: string; content: string }[]
  ) {
    setIsStreaming(true);
    setError(null);

    const assistantMsgId = `msg-${Date.now()}-ai`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, assistantMsg]);

    let fullContent = '';

    try {
      abortRef.current = new AbortController();

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          mode: 'CALL',
          entityContext: [
            { type: 'caller', id: callerId, label: callerName },
            ...(sessionGoal ? [{ type: 'demonstrationGoal', id: 'goal', label: sessionGoal }] : []),
          ],
          conversationHistory: history.slice(-10),
          callId: callIdRef.current,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || 'AI response failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: fullContent }
              : m
          )
        );
      }

      // Relay assistant message to server for observers (fire-and-forget)
      const currentCallId = callIdRef.current;
      if (currentCallId && fullContent) {
        fetch(`/api/calls/${currentCallId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: fullContent }),
        }).catch((err) => console.warn("[sim] Observer relay failed:", err));
      }

      // Auto-play TTS when voice mode is active
      if (fullContent && voiceMode.state !== 'off') {
        voiceMode.speakText(fullContent).catch((err) => console.warn("[sim] TTS failed:", err));
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Stream was aborted (e.g. component unmount) — save any partial content
        const currentCallId = callIdRef.current;
        if (currentCallId && fullContent) {
          fetch(`/api/calls/${currentCallId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: fullContent }),
          }).catch((err) => console.warn("[sim] Observer relay failed:", err));
        }
        return;
      }
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: m.content || '(Failed to get response)' }
            : m
        )
      );
      setError(e.message || 'Failed to get AI response');
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  // Send user message
  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');

    // Relay user message to server for observers (fire-and-forget)
    if (callIdRef.current) {
      fetch(`/api/calls/${callIdRef.current}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: input.trim() }),
      }).catch((err) => console.warn("[sim] Observer relay failed:", err));
    }

    const history = updatedMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    streamAIResponse(input.trim(), history);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isStreaming, messages]);

  // Send a voice-transcribed message (bypasses text input state)
  function sendVoiceMessage(transcript: string) {
    if (isStreaming) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: transcript,
      timestamp: new Date(),
    };

    setMessages(prev => {
      const updated = [...prev, userMsg];

      if (callIdRef.current) {
        fetch(`/api/calls/${callIdRef.current}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: transcript }),
        }).catch((err) => console.warn("[sim] Observer relay failed:", err));
      }

      const history = updated.map(m => ({ role: m.role, content: m.content }));
      streamAIResponse(transcript, history);
      return updated;
    });
  }

  // End call
  const handleEndCall = useCallback(async () => {
    setIsEnding(true);

    try {
      // Build transcript from messages
      const transcript = messages
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

      if (!callId) {
        console.error('[sim] No callId — call record was never created');
        showToast('Error: call was not created');
        setIsEnding(false);
        return;
      }

      console.log('[sim] Saving transcript to call:', callId, `(${transcript.length} chars)`);

      // Save transcript to call record
      const patchRes = await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, endedAt: new Date().toISOString() }),
      });

      if (!patchRes.ok) {
        console.error('[sim] Failed to save transcript:', await patchRes.text());
        showToast('Failed to save transcript');
        setIsEnding(false);
        return;
      }

      console.log('[sim] Transcript saved successfully');

      // Fire pipeline async — don't block the UI
      if (runPipeline) {
        console.log('[sim] Starting pipeline (mode: prompt, engine: claude)');
        fetch(`/api/calls/${callId}/pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callerId,
            mode: 'prompt',
            engine: 'claude',
          }),
        })
          .then(res => res.json())
          .then(data => {
            if (!data.ok) console.error('[sim] Pipeline failed:', data.error, data.logs);
            else {
              console.log('[sim] Pipeline complete:', data.message);
              // Fetch artifacts + actions + new prompt after pipeline completes
              Promise.all([
                fetch(`/api/callers/${callerId}/artifacts?callId=${callId}`).then(r => r.json()).catch(() => null),
                fetch(`/api/callers/${callerId}/actions?callId=${callId}`).then(r => r.json()).catch(() => null),
                fetch(`/api/callers/${callerId}/compose-prompt`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ triggerType: 'post-call', ...(playbookId ? { playbookIds: [playbookId] } : {}) }),
                }).then(r => r.json()).catch(() => null),
              ]).then(([artData, actData, promptData]) => {
                const artCount = artData?.ok && artData.artifacts?.length > 0 ? artData.artifacts.length : 0;
                const actCount = actData?.ok && actData.actions?.length > 0 ? actData.actions.length : 0;
                if (artCount > 0) setArtifacts(artData.artifacts);
                if (actCount > 0) setActions(actData.actions);
                if (promptData?.prompt?.id) {
                  setNewPromptId(promptData.prompt.id);
                  console.log('[sim] New prompt composed:', promptData.prompt.id);
                }
                const parts = [];
                if (artCount > 0) parts.push(`${artCount} artifact${artCount > 1 ? 's' : ''}`);
                if (actCount > 0) parts.push(`${actCount} action${actCount > 1 ? 's' : ''}`);
                if (promptData?.prompt?.id) parts.push('new prompt');
                if (parts.length > 0) showToast(`${parts.join(' & ')} generated`);
              });
            }
          })
          .catch(e => console.error('[sim] Pipeline error:', e));
      }

      showToast(runPipeline ? 'Call saved — analysis running in background' : 'Call saved');

      // Transition to post-call state
      setShowEndSheet(false);
      setIsEnding(false);
      setCallEnded(true);

      // Notify parent (refresh data, etc.)
      onCallEnd?.();

      // Standalone mode with no pipeline: navigate back
      if (!runPipeline && onBack) {
        setTimeout(() => onBack(), 1000);
      }
    } catch {
      showToast('Failed to save call');
      setIsEnding(false);
    }
  }, [callId, callerId, messages, runPipeline, showToast, onCallEnd, onBack]);

  const isEmbedded = mode === 'embedded';

  const content = (
    <>
      {/* Header */}
      <WhatsAppHeader
        title={callerName}
        subtitle={playbookName || domainName}
        onBack={onBack}
        onEndCall={() => setShowEndSheet(true)}
        onMediaLibrary={() => {
          setShowMediaLibrary(prev => !prev);
          setShowContentPicker(false);
        }}
        onVoiceToggle={!callEnded ? voiceMode.toggle : undefined}
        onAvatarClick={() => router.push(`/x/callers/${callerId}`)}
        mediaLibraryActive={showMediaLibrary}
        voiceActive={voiceMode.state !== 'off'}
        callActive={messages.length > 0 && !callEnded}
        avatarColor={hashColor(callerId)}
      />

      {/* Messages */}
      <div
        className="wa-chat-bg"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '8px 12px 12px',
        }}
      >
        {/* History — past calls grouped by date */}
        {historyGroups.map((group, gi) => (
          <div key={`hg-${gi}`}>
            <div style={{
              alignSelf: 'center',
              background: 'rgba(255,255,255,0.9)',
              padding: '4px 12px',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-muted)',
              margin: '8px 0',
              boxShadow: '0 1px 0.5px rgba(0,0,0,0.1)',
              textAlign: 'center',
              width: 'fit-content',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}>
              {group.dateLabel}
            </div>
            {group.messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.timestamp}
              />
            ))}
          </div>
        ))}

        {/* Separator between history and live session */}
        {hasHistory && (
          <div style={{
            alignSelf: 'center',
            background: 'rgba(255,255,255,0.9)',
            padding: '4px 12px',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: '12px 0 8px',
            boxShadow: '0 1px 0.5px rgba(0,0,0,0.1)',
            textAlign: 'center',
            width: 'fit-content',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            New conversation
          </div>
        )}

        {/* Live session date chip */}
        {!hasHistory && (
          <div style={{
            alignSelf: 'center',
            background: 'rgba(255,255,255,0.9)',
            padding: '4px 12px',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: '8px 0',
            boxShadow: '0 1px 0.5px rgba(0,0,0,0.1)',
            textAlign: 'center',
            width: 'fit-content',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Today
          </div>
        )}

        {/* Live session messages */}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
            senderName={msg.senderName}
            media={msg.media}
          />
        ))}

        {isStreaming && messages[messages.length - 1]?.content === '' && (
          <TypingIndicator />
        )}

        {/* Post-call: new prompt notification */}
        {newPromptId && (
          <div style={{
            alignSelf: 'center',
            background: 'linear-gradient(135deg, var(--status-success-bg), var(--status-success-bg))',
            border: '1px solid var(--status-success-border)',
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            color: 'var(--status-success-text)',
            margin: '12px 16px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
            onClick={() => window.open(`/x/callers/${callerId}?tab=prompt`, '_blank')}
          >
            <span style={{ fontWeight: 700 }}>Prompt 1 generated</span>
            <span style={{ fontSize: 12, color: 'var(--status-success-text)' }}>View &rarr;</span>
          </div>
        )}

        {/* Post-call content — artifacts & actions from pipeline */}
        {(artifacts.length > 0 || actions.length > 0) && (
          <>
            <div style={{
              alignSelf: 'center',
              background: 'rgba(255,255,255,0.9)',
              padding: '4px 12px',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-muted)',
              margin: '12px 0 4px',
              boxShadow: '0 1px 0.5px rgba(0,0,0,0.1)',
            }}>
              Shared after call
            </div>
            {artifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
            {actions.map((a) => (
              <ActionCard key={a.id} action={a} />
            ))}
          </>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'var(--status-warning-bg)',
          padding: '8px 16px',
          fontSize: 13,
          color: 'var(--status-warning-text)',
          borderTop: '1px solid var(--status-warning-border)',
        }}>
          {error}
        </div>
      )}

      {/* Content Picker overlay */}
      {showContentPicker && callId && (
        <ContentPicker
          callerId={callerId}
          callId={callId}
          onClose={() => setShowContentPicker(false)}
          onShared={() => showToast('Content shared')}
        />
      )}

      {/* Media Library overlay */}
      {showMediaLibrary && (
        <MediaLibraryPanel
          callerId={callerId}
          onClose={() => setShowMediaLibrary(false)}
        />
      )}

      {/* Input — text mode or voice mode */}
      {!callEnded && (
        voiceMode.state !== 'off' ? (
          <VoicePanel
            voiceMode={voiceMode}
            callId={callId}
            onContentPicker={() => { setShowContentPicker(prev => !prev); setShowMediaLibrary(false); }}
            showContentPicker={showContentPicker}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {callId && (
              <button
                onClick={() => { setShowContentPicker(!showContentPicker); setShowMediaLibrary(false); }}
                title="Share content"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '8px 8px 8px 12px',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: showContentPicker ? 'var(--accent-primary)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                {'\u{1F4CE}'}
              </button>
            )}
            <div style={{ flex: 1 }}>
              <MessageInput
                value={input}
                onChange={setInput}
                onSend={handleSend}
                disabled={isStreaming}
              />
            </div>
          </div>
        )
      )}

      {/* Post-call: start new call (embedded mode only) */}
      {callEnded && onNewCall && (
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-primary)',
        }}>
          <button
            onClick={onNewCall}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--status-success-text)',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Start New Call
          </button>
        </div>
      )}

      {/* End call confirmation sheet */}
      {showEndSheet && (
        <>
          <div className="wa-sheet-overlay" onClick={() => !isEnding && setShowEndSheet(false)} />
          <div className="wa-sheet">
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 16px' }}>
              End this call?
            </h3>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderTop: '1px solid var(--border-default)',
              borderBottom: '1px solid var(--border-default)',
              marginBottom: 20,
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>Run analysis pipeline</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  Extract memories, measure traits, adapt targets
                </div>
              </div>
              <button
                className={`wa-toggle ${runPipeline ? 'active' : ''}`}
                onClick={() => setRunPipeline(!runPipeline)}
                disabled={isEnding}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowEndSheet(false)}
                disabled={isEnding}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'white',
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEndCall}
                disabled={isEnding}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--status-error-text)',
                  color: 'white',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isEnding ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="hf-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> Saving...</span> : 'End Call'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && <div className="wa-toast">{toast}</div>}
    </>
  );

  if (isEmbedded) {
    return <div className="sim-embedded">{content}</div>;
  }

  // Standalone: rendered inside sim layout (which provides the container)
  return content;
}

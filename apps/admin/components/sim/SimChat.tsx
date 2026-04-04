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
import { ChatSurveyInput } from './ChatSurveyInput';
import type { ChatItem, UseJourneyChatResult } from '@/hooks/useJourneyChat';
import type { SurveyStep } from '@/components/student/ChatSurvey';

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
  subjectDiscipline?: string;
  pastCalls?: { transcript: string; createdAt: string }[];
  mode: 'standalone' | 'embedded';
  sessionGoal?: string;
  targetOverrides?: Record<string, number>;
  forceFirstCall?: boolean;
  onCallEnd?: () => void;
  onNewCall?: () => void;
  onBack?: () => void;
  /** Journey chat integration — items rendered before call history */
  journey?: UseJourneyChatResult;
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
  sessionLabel?: string;
  messages: Message[];
}

export function SimChat({
  callerId,
  callerName,
  domainName,
  playbookId,
  playbookName,
  subjectDiscipline,
  pastCalls,
  mode,
  sessionGoal,
  targetOverrides,
  forceFirstCall,
  onCallEnd,
  onNewCall,
  onBack,
  journey,
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
  const [callPhase, setCallPhase] = useState<'loading' | 'lobby' | 'active' | 'ended'>('loading');
  const [callEndedAt, setCallEndedAt] = useState<Date | null>(null);
  const [newPromptId, setNewPromptId] = useState<string | null>(null);
  const [showContentPicker, setShowContentPicker] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [isGreeting, setIsGreeting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const callIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const msgCounter = useRef(0);

  // Voice mode — wired so transcribed speech sends as user message
  const voiceMode = useVoiceMode(useCallback((transcript: string) => {
    sendVoiceMessage(transcript);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // Abort in-flight stream on unmount (prevents orphaned fetches during key-based remount)
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Parse past calls into grouped history — one group per call, never merged
  const historyGroups: HistoryGroup[] = useMemo(() => {
    if (!pastCalls?.length) return [];
    const groups: HistoryGroup[] = [];
    for (let ci = 0; ci < pastCalls.length; ci++) {
      const call = pastCalls[ci];
      const parsed = parseTranscript(call.transcript);
      if (parsed.length === 0) continue;
      const callDate = new Date(call.createdAt);
      const label = formatDateChip(callDate);
      const timeStr = callDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const msgs: Message[] = parsed.map((m, i) => ({
        id: `history-${call.createdAt}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: callDate,
      }));
      groups.push({
        dateLabel: label,
        sessionLabel: `Session ${ci + 1} · ${label}, ${timeStr} · ${parsed.length} messages`,
        messages: msgs,
      });
    }
    return groups;
  }, [pastCalls]);

  const hasHistory = historyGroups.length > 0;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, artifacts, actions]);

  // Poll for server-side messages (teacher interjections only)
  // AI-shared media is now handled via the X-Shared-Media response header
  // and attached to the streaming message directly — no need to poll for it.
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
            // Only inject teacher interjections (sent via observation panel)
            if (msg.role !== 'teacher') continue;

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

  // On mount: check for an active call to resume, otherwise show lobby
  useEffect(() => {
    let cancelled = false;

    async function checkForActiveCall() {
      try {
        // If forceFirstCall, skip active-call check and auto-start
        if (forceFirstCall) {
          if (!cancelled) startNewCall();
          return;
        }

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
            setCallPhase('active');
            console.log(`[sim] Restored ${restored.length} messages from active call`);
          } else if (!cancelled) {
            // Active call exists but has no messages — re-send greeting
            console.log('[sim] Active call has no messages, sending greeting');
            setCallPhase('active');
            setIsGreeting(true);
            await streamAIResponse(
              sessionGoal
                ? `The user just opened the chat. The admin has set a session goal: "${sessionGoal}". Greet them warmly as if answering a phone call, and gently orient toward this goal. Be brief and natural.`
                : 'The user just opened the chat. Greet them warmly as if answering a phone call. Be brief and natural.',
              []
            );
            setIsGreeting(false);
          }
          return;
        }

        // No active call — show lobby
        if (!cancelled) setCallPhase('lobby');
      } catch {
        if (!cancelled) setCallPhase('lobby'); // Fail open
      }
    }

    checkForActiveCall();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerId]);

  // Start a new call — triggered by lobby phone button
  async function startNewCall() {
    // Guard: prevent double invocation (React strict mode / rapid clicks)
    if (startingRef.current) return;
    startingRef.current = true;

    setCallPhase('active');
    setIsGreeting(true);
    setError(null);

    try {
      let usedPromptId: string | null = null;
      let firstLine: string | null = null;
      const composeRes = await fetch(`/api/callers/${callerId}/compose-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'sim', ...(playbookId ? { playbookIds: [playbookId] } : {}), ...(targetOverrides ? { targetOverrides } : {}), ...(forceFirstCall ? { forceFirstCall: true } : {}) }),
      });
      if (composeRes.ok) {
        const composeData = await composeRes.json();
        const rawPromptId = composeData.prompt?.id;
        usedPromptId = (rawPromptId && !rawPromptId.startsWith('preview-')) ? rawPromptId : null;
        firstLine = (composeData.prompt?.llmPrompt as any)?._quickStart?.first_line || null;
      } else {
        console.warn('[sim] compose-prompt failed, continuing with existing prompt');
      }

      // Create a new call record, linked to the composed prompt
      const callRes = await fetch(`/api/callers/${callerId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'sim', usedPromptId, ...(playbookId ? { playbookId } : {}) }),
      });
      const callData = await callRes.json();
      if (callData.ok) {
        console.log('[sim] Call created:', callData.call.id);
        callIdRef.current = callData.call.id;
        setCallId(callData.call.id);
      } else {
        console.error('[sim] Failed to create call:', callData.error || callRes.status);
        setError('Failed to create call record');
        setCallPhase('lobby');
        setIsGreeting(false);
        return;
      }

      // AI sends greeting — mirror VAPI's firstMessage behaviour
      await streamAIResponse(
        sessionGoal
          ? `The user just opened the chat. The admin has set a session goal: "${sessionGoal}". Greet them warmly as if answering a phone call, and gently orient toward this goal. Be brief and natural.${firstLine ? ` Open with: "${firstLine}"` : ''}`
          : firstLine
            ? `The user just opened the chat. Open with exactly: "${firstLine}"`
            : 'The user just opened the chat. Greet them warmly as if answering a phone call. Be brief and natural.',
        []
      );
      setIsGreeting(false);
    } catch {
      setError('Failed to start conversation');
      setCallPhase('lobby');
      setIsGreeting(false);
    } finally {
      startingRef.current = false;
    }
  }

  // Stream AI response
  async function streamAIResponse(
    message: string,
    history: { role: string; content: string }[]
  ) {
    setIsStreaming(true);
    setError(null);

    const assistantMsgId = `msg-${Date.now()}-${++msgCounter.current}-ai`;
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

      // Read shared media from tool calls (e.g. share_content) before streaming
      let sharedMediaInfo: MediaInfo | null = null;
      const sharedMediaHeader = res.headers.get('X-Shared-Media');
      if (sharedMediaHeader) {
        try {
          const items = JSON.parse(sharedMediaHeader);
          if (items.length > 0) {
            const mi = items[0];
            sharedMediaInfo = {
              id: mi.id,
              fileName: mi.fileName,
              mimeType: mi.mimeType,
              title: mi.title,
              url: `/api/media/${mi.id}`,
            };
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId ? { ...m, media: sharedMediaInfo } : m
              )
            );
          }
        } catch { /* ignore malformed header */ }
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

      // Relay assistant message to server for observers.
      // Always await — fire-and-forget caused two bugs:
      // 1. buildContentCatalog race: next turn ran before relay persisted, AI re-shared docs
      // 2. Double-intro: page navigation before relay completed → resume found 0 messages → re-greeted
      const currentCallId = callIdRef.current;
      if (currentCallId && fullContent) {
        await fetch(`/api/calls/${currentCallId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content: fullContent,
            ...(sharedMediaInfo ? { mediaId: sharedMediaInfo.id } : {}),
          }),
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
            body: JSON.stringify({
              role: 'assistant',
              content: fullContent,
              ...(sharedMediaInfo ? { mediaId: sharedMediaInfo.id } : {}),
            }),
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
      id: `msg-${Date.now()}-${++msgCounter.current}`,
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
      id: `msg-${Date.now()}-${++msgCounter.current}`,
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
                  body: JSON.stringify({ triggerType: 'post-call', ...(playbookId ? { playbookIds: [playbookId] } : {}), ...(targetOverrides ? { targetOverrides } : {}) }),
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
      setCallPhase('ended');
      setCallEndedAt(new Date());

      // Notify parent (refresh data, etc.)
      onCallEnd?.();
      journey?.onCallEnd();

      // Standalone mode with no pipeline: navigate back
      if (!runPipeline && onBack) {
        setTimeout(() => onBack(), 1000);
      }
    } catch {
      showToast('Failed to save call');
      setIsEnding(false);
    }
  }, [callId, callerId, messages, runPipeline, showToast, onCallEnd, onBack, journey]);

  const isEmbedded = mode === 'embedded';

  const content = (
    <>
      {/* Header */}
      <WhatsAppHeader
        title={callerName}
        subtitle={(() => {
          // Breadcrumb: "Subject: Course" when both exist and differ, else best available
          if (subjectDiscipline && playbookName && subjectDiscipline !== playbookName) {
            return `${subjectDiscipline}: ${playbookName}`;
          }
          return playbookName || subjectDiscipline || domainName;
        })()}
        onBack={onBack}
        onEndCall={() => setShowEndSheet(true)}
        onMediaLibrary={() => {
          setShowMediaLibrary(prev => !prev);
          setShowContentPicker(false);
        }}
        onVoiceToggle={callPhase === 'active' ? voiceMode.toggle : undefined}
        onAvatarClick={() => router.push(`/x/callers/${callerId}`)}
        mediaLibraryActive={showMediaLibrary}
        voiceActive={voiceMode.state !== 'off'}
        callActive={callPhase === 'active' && messages.length > 0}
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
          gap: 4,
          padding: '8px 12px 12px',
        }}
      >
        {/* Journey items — surveys, onboarding, dividers */}
        {journey?.items.map((item) => {
          if (item.kind === 'text') {
            return (
              <MessageBubble
                key={item.id}
                role={item.role}
                content={item.content}
                timestamp={item.timestamp}
                isRunContinuation={false}
                isLastInRun={true}
              />
            );
          }
          if (item.kind === 'divider') {
            return (
              <div key={item.id} className="wa-date-chip" style={{ margin: '12px auto 8px' }}>
                {item.label}
              </div>
            );
          }
          if (item.kind === 'survey_prompt') {
            return (
              <div key={item.id}>
                {item.progress && (
                  <div className="wa-date-chip wa-journey-progress" style={{ margin: '8px auto 4px', fontSize: 11 }}>
                    {item.progress.label}
                  </div>
                )}
                <MessageBubble
                  role="assistant"
                  content={item.step.prompt}
                  timestamp={item.timestamp}
                  isRunContinuation={false}
                  isLastInRun={true}
                />
                {item.answered && (
                  <MessageBubble
                    role="user"
                    content={item.answered.displayText}
                    timestamp={item.timestamp}
                    isRunContinuation={false}
                    isLastInRun={true}
                  />
                )}
              </div>
            );
          }
          if (item.kind === 'next_stop') {
            return (
              <div key={item.id} style={{
                display: 'flex',
                justifyContent: 'center',
                margin: '16px auto 8px',
              }}>
                <button
                  className="wa-lobby-start-btn"
                  onClick={item.action}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 24,
                    border: 'none',
                    background: 'var(--wa-green-primary)',
                    color: 'white',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    width: 'auto',
                    height: 'auto',
                  }}
                >
                  {item.label}
                </button>
              </div>
            );
          }
          return null;
        })}

        {/* History — past calls, one group per session */}
        {historyGroups.map((group, gi) => (
          <div key={`hg-${gi}`}>
            <div className="wa-date-chip">
              {group.sessionLabel || group.dateLabel}
            </div>
            {group.messages.map((msg, mi) => {
              const prev = group.messages[mi - 1];
              const next = group.messages[mi + 1];
              const sameAsPrev = prev && prev.role === msg.role;
              const sameAsNext = next && next.role === msg.role;
              return (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  isRunContinuation={sameAsPrev}
                  isLastInRun={!sameAsNext}
                />
              );
            })}
          </div>
        ))}

        {/* Lobby: green phone CTA to start a practice session (hidden during journey survey/onboarding) */}
        {callPhase === 'lobby' && (!journey || journey.state === 'teaching' || journey.state === 'bypassed') && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            margin: '32px auto 8px',
            padding: '24px',
          }}>
            <p style={{
              fontSize: 14,
              color: 'var(--wa-text-secondary)',
              textAlign: 'center',
              margin: 0,
            }}>
              Start your practice session
            </p>
            <button
              className="wa-lobby-start-btn"
              onClick={startNewCall}
              aria-label="Start practice call"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </button>
          </div>
        )}

        {/* Loading spinner while checking for active call (or journey loading) */}
        {callPhase === 'loading' && (!journey || journey.state === 'loading') && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div className="hf-spinner" style={{ width: 28, height: 28 }} />
          </div>
        )}

        {/* Active/ended: session separator + live messages */}
        {(callPhase === 'active' || callPhase === 'ended') && (
          <>
            {/* Separator between history and live session */}
            {hasHistory && (
              <div className="wa-date-chip" style={{ margin: '12px auto 8px' }}>
                New conversation
              </div>
            )}

            {/* Live session date chip */}
            {!hasHistory && (
              <div className="wa-date-chip">Today</div>
            )}

            {/* Live session messages */}
            {messages.map((msg, mi) => {
              const prev = messages[mi - 1];
              const next = messages[mi + 1];
              const sameAsPrev = prev && prev.role === msg.role && msg.role !== 'teacher';
              const sameAsNext = next && next.role === msg.role && msg.role !== 'teacher';
              return (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.timestamp}
                  senderName={msg.senderName}
                  media={msg.media}
                  isRunContinuation={sameAsPrev}
                  isLastInRun={!sameAsNext}
                />
              );
            })}

            {(isGreeting || (isStreaming && messages[messages.length - 1]?.content === '')) && (
              <TypingIndicator />
            )}
          </>
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

        {/* Call ended marker — WhatsApp-style voice call card */}
        {callPhase === 'ended' && (
          <div className="wa-call-marker">
            <div className="wa-call-marker-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--wa-green-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--wa-text-primary)' }}>Call ended</div>
              <div style={{ fontSize: 12 }}>
                {(() => {
                  if (!callEndedAt || messages.length === 0) return '';
                  const firstMsg = messages[0]?.timestamp;
                  if (!firstMsg) return '';
                  const mins = Math.round((callEndedAt.getTime() - firstMsg.getTime()) / 60000);
                  if (mins < 1) return 'Less than a minute';
                  return `${mins} min${mins !== 1 ? 's' : ''}`;
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Post-call content — artifacts & actions from pipeline */}
        {(artifacts.length > 0 || actions.length > 0) && (
          <>
            <div className="wa-date-chip" style={{ margin: '12px auto 4px' }}>
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

      {/* Input — survey mode, text mode, or voice mode */}
      {journey?.activeSurveyStep && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-default)',
          background: 'var(--surface-primary)',
        }}>
          <ChatSurveyInput
            step={journey.activeSurveyStep}
            onAnswer={journey.onSurveyAnswer}
          />
        </div>
      )}

      {callPhase === 'active' && !journey?.activeSurveyStep && (
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
                onVoiceToggle={voiceMode.toggle}
                disabled={isStreaming}
              />
            </div>
          </div>
        )
      )}

      {/* Post-call: start new call — works in both standalone and embedded mode */}
      {callPhase === 'ended' && (
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-primary)',
        }}>
          <button
            onClick={() => {
              // Reset state for a fresh call
              setMessages([]);
              setArtifacts([]);
              setActions([]);
              setNewPromptId(null);
              setCallEndedAt(null);
              setCallId(null);
              callIdRef.current = null;
              if (onNewCall) {
                onNewCall(); // Embedded mode: parent handles remount
              } else {
                startNewCall(); // Standalone mode: start directly
              }
            }}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--wa-green-primary)',
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

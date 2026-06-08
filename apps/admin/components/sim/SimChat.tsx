'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ROLE_LEVEL } from '@/lib/roles';
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
import { useProviderCall } from './useProviderCall';
import { labelForEndSource } from '@/lib/voice/end-source';
import { useOutboundDial } from './useOutboundDial';
import { config } from '@/lib/config';
import type { MediaInfo } from './MessageBubble';
import { ChatSurveyInput } from './ChatSurveyInput';
import { SimAdminPanel } from './SimAdminPanel';
import { SimProgressPanel } from './SimProgressPanel';
import { PostCallProgressCard } from './PostCallProgressCard';
import { QualificationSessionSummary } from './qualification/QualificationContextStrip';
import { useStudentProgress } from '@/hooks/useStudentProgress';
import { useJourneyPosition } from '@/hooks/useJourneyPosition';
import type { ChatItem, UseJourneyChatResult } from '@/hooks/useJourneyChat';
import type { SurveyStep } from '@/components/student/ChatSurvey';
import type { UserRole } from '@prisma/client';

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
  /**
   * Notifies the parent when the call goes active or back to a non-active
   * state. "Active" means `callPhase === 'active'` with at least one message
   * exchanged (i.e. the greeting has streamed). Issue #396 — drives the
   * SimStateBreadcrumb "(Active)" vs "(Pre-call)" pill.
   *
   * Race-safe: the `false` transition fires alongside `onCallEnd?.()` inside
   * `handleEndCall` rather than tracking `callPhase === 'ended'` so the
   * breadcrumb doesn't snap back to "Pre-call" before post-call UI settles.
   */
  onCallStateChange?: (active: boolean) => void;
  /**
   * #242 Slice 2: learner's pre-call module pick from the picker. When set,
   * forwarded to POST /api/callers/[id]/calls so the pipeline's module
   * context loader overrides the scheduler-selected module.
   */
  requestedModuleId?: string;
  /** Journey chat integration — items rendered before call history */
  journey?: UseJourneyChatResult;
  /**
   * Notifies the parent when the caller has been renamed inline from the SIM
   * header. Parent should update its own caller state so any other surfaces
   * (e.g. the page-level breadcrumb) reflect the new name. #618.
   */
  onNameChange?: (next: string) => void;
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
  // VAPI transcripts use "AI: ", sim transcripts use "Assistant: ". Both map
  // to the assistant role. #1236 fix applied here too — without "AI: " VAPI
  // transcripts collapse into a single learner block when viewed through Sim.
  for (const line of lines) {
    if (line.startsWith('User: ')) {
      if (current) messages.push(current);
      current = { role: 'user', content: line.slice(6) };
    } else if (line.startsWith('AI: ')) {
      if (current) messages.push(current);
      current = { role: 'assistant', content: line.slice(4) };
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
  onCallStateChange,
  requestedModuleId,
  journey,
  onNameChange,
}: SimChatProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const roleLevel = ROLE_LEVEL[(session?.user?.role ?? 'STUDENT') as UserRole] ?? 0;
  const isOperator = roleLevel >= 3;
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showProgressPanel, setShowProgressPanel] = useState(false);
  const studentProgress = useStudentProgress(callerId);
  const journeyPosition = useJourneyPosition(callerId);
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
  // `wrapping` covers the gap between phone-hangup detected (via the SDK
  // `call-end` event or SSE `call-ended`) and the pipeline returning. Input
  // is disabled and a glowing "Wrapping up…" marker renders inline. #1241.
  const [callPhase, setCallPhase] = useState<'loading' | 'lobby' | 'active' | 'wrapping' | 'ended'>('loading');
  const [callEndedAt, setCallEndedAt] = useState<Date | null>(null);
  // #1241 Slice 6 — tracks the local guess at how the call ended so the
  // wrap-marker can label it ("Ended on phone" / "Connection lost" / etc.)
  // without an extra round-trip. The DB stamp (also `endSource`) is the
  // source of truth across surfaces — this is the live in-page mirror.
  const [callEndSource, setCallEndSource] = useState<string | null>(null);
  const [newPromptId, setNewPromptId] = useState<string | null>(null);
  const [quickStart, setQuickStart] = useState<Record<string, unknown> | null>(null);
  const [showContentPicker, setShowContentPicker] = useState(false);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [isGreeting, setIsGreeting] = useState(false);
  // #618: local override for inline rename from the SIM header. Falls back
  // to the prop until the parent's own state catches up via `onNameChange`.
  const [callerNameOverride, setCallerNameOverride] = useState<string | null>(null);
  const displayName = callerNameOverride ?? callerName;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const callIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const msgCounter = useRef(0);
  const durationBudgetRef = useRef<number | null>(null);
  const wrapUpSentRef = useRef(false);
  const [timeChip, setTimeChip] = useState<string | null>(null);

  // Voice mode — wired so transcribed speech sends as user message
  const voiceMode = useVoiceMode(useCallback((transcript: string) => {
    sendVoiceMessage(transcript);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // #1092 — local Whisper voice mode is feature-flagged off by default
  // once provider voice ships. Tests set the flag true in setup.ts so
  // the existing useVoiceMode coverage stays green.
  const localSimVoiceModeEnabled = config.features.localSimVoiceMode;

  // #1092 — provider-backed "Call me" mixed mode. Lazy-imports the
  // VAPI Web SDK on first click; opens an SSE stream keyed on Call.id
  // and pushes incoming events into the chat surface as messages.
  const providerCall = useProviderCall({
    callerId,
    intent: 'chat',
    onSseEvent: useCallback((event: import('@/lib/voice/sse-registry').VoiceCallSseEvent) => {
      if (event.type === 'transcript-partial') {
        const id = `voice-${event.timestampMs}-${event.role}`;
        const isLearner = event.role === 'learner';
        setMessages((prev) => {
          // #1364 — Coalesce same-role chunks by REPLACE, not APPEND.
          // VAPI's `transcript` events carry the latest Deepgram interim
          // result for the current speaker turn — each chunk is the FULL
          // transcript-so-far, not a delta to concatenate. APPEND
          // produced duplication like "hello hello there hello there how
          // are you". REPLACE shows a single growing bubble per turn.
          // Pre-existing bug, masked until #1361 made the bubbles appear.
          const last = prev[prev.length - 1];
          if (
            last &&
            last.id.startsWith('voice-') &&
            ((isLearner && last.role === 'user') ||
              (!isLearner && last.role === 'assistant'))
          ) {
            // Drop no-op events (same text as the bubble already shows).
            if (last.content === event.text) {
              return prev;
            }
            const updated = { ...last, content: event.text };
            return [...prev.slice(0, -1), updated];
          }
          return [
            ...prev,
            {
              id,
              role: isLearner ? 'user' : 'assistant',
              content: event.text,
              timestamp: new Date(event.timestampMs),
            },
          ];
        });
      } else if (event.type === 'share-content') {
        setMessages((prev) => [
          ...prev,
          {
            id: `share-${event.timestampMs}`,
            role: 'assistant',
            content: event.caption ?? `[Shared media: ${event.mediaId}]`,
            timestamp: new Date(event.timestampMs),
          },
        ]);
      } else if (event.type === 'send-text') {
        setMessages((prev) => [
          ...prev,
          {
            id: `text-${event.timestampMs}`,
            role: 'assistant',
            content: event.message,
            timestamp: new Date(event.timestampMs),
          },
        ]);
      }
    }, []),
  });

  // PSTN [Call me] hook — separate from the browser WebRTC [Talk Here]
  // above. VAPI rings the learner's actual phone. Just-in-time phone
  // capture handles the "no number on file" case.
  const outboundDial = useOutboundDial({ callerId });
  const [phoneDraft, setPhoneDraft] = useState('');

  // Abort in-flight stream on unmount (prevents orphaned fetches during key-based remount)
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // #396: notify the parent when the call is truly "active" — i.e. the
  // greeting has streamed and at least one message exists. Mirrors the same
  // truth value the WhatsAppHeader uses on line below for `callActive`.
  // The `false` transition for end-call is fired in handleEndCall alongside
  // onCallEnd?.() so post-call UI doesn't flash through "Pre-call".
  const lastCallActiveFiredRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!onCallStateChange) return;
    const active = callPhase === 'active' && messages.length > 0;
    if (lastCallActiveFiredRef.current === active) return;
    lastCallActiveFiredRef.current = active;
    onCallStateChange(active);
  }, [callPhase, messages.length, onCallStateChange]);

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
  }, [messages, isStreaming, artifacts, actions, journey?.items, journey?.state, callPhase, timeChip, newPromptId]);

  // #1241 Slice 5 — 30s silence watchdog. While a call is active and the
  // provider has acknowledged it, expect at least one transcript-partial
  // (or chat-side message) every 30s. Silence beyond that strongly
  // suggests a dropped phone call or a stalled SSE stream. Surface a
  // banner with a "Mark as ended" escape hatch so the learner doesn't
  // sit staring at a frozen UI for the 90s server-poll backstop. The
  // banner clears automatically once activity resumes.
  const lastActivityRef = useRef<number>(Date.now());
  const [silenceWarning, setSilenceWarning] = useState(false);
  useEffect(() => {
    lastActivityRef.current = Date.now();
    setSilenceWarning(false);
  }, [messages.length]);
  useEffect(() => {
    if (callPhase !== 'active') {
      setSilenceWarning(false);
      return;
    }
    const inLiveVoice =
      providerCall.status === 'connecting' || providerCall.status === 'active';
    if (!inLiveVoice) return;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 30_000) {
        setSilenceWarning(true);
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [callPhase, providerCall.status]);

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

            // #1241 Slice 5 — drop recovery. If the last message is more
            // than 5 minutes old the voice channel almost certainly died
            // (dropped call, browser crash, tab close) — the DB row is
            // still "non-ended" because nothing fired the end-of-call
            // writer. Treat the call as ended so the wrap UI renders and
            // the learner can start fresh. Operator confirmed dropped
            // calls do NOT continue — no resume-mid-call complexity.
            const lastTs = restored[restored.length - 1]?.timestamp;
            const staleMs = lastTs ? Date.now() - lastTs.getTime() : 0;
            if (staleMs > 5 * 60 * 1000) {
              console.log(`[sim] Active call is stale (${Math.round(staleMs / 60000)}m since last message) — sealing as ended`);
              setCallEndedAt(lastTs ?? new Date());
              setCallEndSource('drop');
              setCallPhase('ended');
              // #1241 Slice 6 — also seal the DB row so the 90s server
              // poll doesn't keep finding it. endSource='drop' so the
              // wrap-marker labels it "Connection lost". Fire-and-forget
              // — failure is non-fatal because the local UI already shows
              // ended and the server poll is the safety net.
              fetch(`/api/calls/${activeCall.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  endedAt: (lastTs ?? new Date()).toISOString(),
                  endSource: 'drop',
                }),
              }).catch((err) => console.warn('[sim] stale-resume seal failed:', err));
            } else {
              setCallPhase('active');
              console.log(`[sim] Restored ${restored.length} messages from active call`);
            }
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

      // Use the existing enrolled prompt (from autoComposeForCaller) — don't recompose.
      // Post-call pipeline will compose the next prompt after this call ends.
      // TODO: if course config changes after enrollment, advise/offer educator to regen relevant prompts
      const composeRes = await fetch(`/api/callers/${callerId}/compose-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'sim',
          // #274 Slice A: when a module was picked, the prompt content
          // depends on it; the route bypasses the freshness cache when
          // requestedModuleId is set so we don't return a stale prompt
          // composed before the pick.
          skipIfFreshMs: 24 * 60 * 60 * 1000, // reuse any prompt from last 24h — effectively "use enrolled prompt"
          ...(playbookId ? { playbookIds: [playbookId] } : {}),
          ...(targetOverrides ? { targetOverrides } : {}),
          ...(forceFirstCall ? { forceFirstCall: true } : {}),
          ...(requestedModuleId ? { requestedModuleId } : {}),
        }),
      });
      if (composeRes.ok) {
        const composeData = await composeRes.json();
        const rawPromptId = composeData.prompt?.id;
        usedPromptId = (rawPromptId && !rawPromptId.startsWith('preview-')) ? rawPromptId : null;
        const qs = (composeData.prompt?.llmPrompt as any)?._quickStart;
        if (qs) setQuickStart(qs);
        firstLine = qs?.first_line || null;
        // Extract duration budget for wrap-up cue
        const pacingMatch = qs?.session_pacing?.match(/(\d+)\s*min/);
        durationBudgetRef.current = pacingMatch ? parseInt(pacingMatch[1], 10) : null;
        wrapUpSentRef.current = false;
      } else {
        console.warn('[sim] compose-prompt failed, continuing with existing prompt');
      }

      // Create a new call record, linked to the composed prompt
      const callRes = await fetch(`/api/callers/${callerId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'sim',
          usedPromptId,
          ...(playbookId ? { playbookId } : {}),
          ...(requestedModuleId ? { requestedModuleId } : {}),
        }),
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
            { type: 'caller', id: callerId, label: displayName },
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

    let history: { role: string; content: string }[] = updatedMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Wrap-up cue: inject system message when near the session time budget
    const budget = durationBudgetRef.current;
    if (budget && !wrapUpSentRef.current) {
      const userMsgCount = updatedMessages.filter(m => m.role === 'user').length;
      const estimatedMins = userMsgCount * 2; // ~2 min per text exchange
      if (estimatedMins >= budget * 0.8) {
        const remaining = Math.max(1, budget - estimatedMins);
        history = [...history, {
          role: 'system',
          content: `[Session time check] About ${estimatedMins} of ~${budget} minutes used. Begin wrapping up: summarise key points covered, suggest one thing to practice before next session, and close warmly.`,
        }];
        wrapUpSentRef.current = true;
        setTimeChip(`~${remaining} min${remaining !== 1 ? 's' : ''} remaining`);
      }
    }

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
  // #1241 — `endSource` tags the row with which path closed it:
  //   sdk     VAPI Web SDK call-end
  //   sse     SSE call-ended (server-side end-of-call broadcast)
  //   manual  Operator sheet "End Call" / STUDENT red-X auto-end
  //   drop    30s silence watchdog / stale-resume reconciliation
  //   poll    server-side stale-call reconciler (handled in its own writer)
  // Default is "manual" because the sheet path is the historical caller;
  // every other invocation site MUST pass an explicit value.
  const handleEndCall = useCallback(async (opts?: { endSource?: 'sdk' | 'sse' | 'manual' | 'drop' }) => {
    const endSource = opts?.endSource ?? 'manual';
    setCallEndSource(endSource);
    setIsEnding(true);

    // Tear down any live voice channel BEFORE saving the transcript.
    // WebRTC: providerCall.end() calls vapi.stop() so the mic/audio
    // socket closes immediately. PSTN: reset local UI; the actual VAPI
    // call ends via the user hanging up or hitting the max-duration cap.
    const voiceWasActive =
      providerCall.status === 'starting' ||
      providerCall.status === 'connecting' ||
      providerCall.status === 'active' ||
      outboundDial.status === 'dialing' ||
      outboundDial.status === 'ringing' ||
      outboundDial.status === 'needs-phone' ||
      outboundDial.status === 'saving-phone';
    try {
      if (
        providerCall.status === 'starting' ||
        providerCall.status === 'connecting' ||
        providerCall.status === 'active'
      ) {
        await providerCall.end();
      }
      if (
        outboundDial.status === 'dialing' ||
        outboundDial.status === 'ringing' ||
        outboundDial.status === 'needs-phone' ||
        outboundDial.status === 'saving-phone'
      ) {
        outboundDial.reset();
      }
    } catch (voiceErr) {
      console.warn('[sim] Voice teardown failed:', voiceErr);
      // Non-fatal — continue with transcript save.
    }

    try {
      // Build transcript from messages
      const transcript = messages
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

      if (!callId) {
        if (voiceWasActive) {
          // Voice-only bail-out: no chat callId was ever created (e.g.
          // user hung up while still in lobby). Voice is already torn
          // down — just close the sheet and reset cleanly.
          setShowEndSheet(false);
          setIsEnding(false);
          return;
        }
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
        body: JSON.stringify({ transcript, endedAt: new Date().toISOString(), endSource }),
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
              // Pipeline COMPOSE stage already persisted the next prompt — fetch artifacts + actions only
              const pipelinePromptId = data.data?.promptId as string | undefined;
              if (pipelinePromptId) {
                setNewPromptId(pipelinePromptId);
                console.log('[sim] Pipeline composed prompt:', pipelinePromptId);
              }
              Promise.all([
                fetch(`/api/callers/${callerId}/artifacts?callId=${callId}`).then(r => r.json()).catch(() => null),
                fetch(`/api/callers/${callerId}/actions?callId=${callId}`).then(r => r.json()).catch(() => null),
                // Fetch the pipeline-composed prompt to get quickStart data
                pipelinePromptId
                  ? fetch(`/api/callers/${callerId}/compose-prompt?status=active&limit=1`).then(r => r.json()).catch(() => null)
                  : Promise.resolve(null),
              ]).then(([artData, actData, promptData]) => {
                const artCount = artData?.ok && artData.artifacts?.length > 0 ? artData.artifacts.length : 0;
                const actCount = actData?.ok && actData.actions?.length > 0 ? actData.actions.length : 0;
                if (artCount > 0) setArtifacts(artData.artifacts);
                if (actCount > 0) setActions(actData.actions);
                if (promptData?.ok && promptData.prompts?.[0]) {
                  const postQs = (promptData.prompts[0]?.llmPrompt as any)?._quickStart;
                  if (postQs) setQuickStart(postQs);
                }
                const parts = [];
                if (artCount > 0) parts.push(`${artCount} artifact${artCount > 1 ? 's' : ''}`);
                if (actCount > 0) parts.push(`${actCount} action${actCount > 1 ? 's' : ''}`);
                if (pipelinePromptId) parts.push('new prompt');
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
      // #396: fire onCallStateChange(false) here — NOT on the raw `ended`
      // phase transition — so the breadcrumb stays "Active" through any
      // post-call UI settle and only flips back once the call is fully
      // wrapped. Sync the ref so the watcher effect won't re-fire.
      onCallEnd?.();
      lastCallActiveFiredRef.current = false;
      onCallStateChange?.(false);
      journey?.onCallEnd();

      // Standalone mode with no pipeline: navigate back
      if (!runPipeline && onBack) {
        setTimeout(() => onBack(), 1000);
      }
    } catch {
      showToast('Failed to save call');
      setIsEnding(false);
    }
  }, [callId, callerId, messages, runPipeline, showToast, onCallEnd, onCallStateChange, onBack, journey, providerCall, outboundDial]);

  // #1241 — Reactive auto-wrap on provider call-end.
  //
  // `useProviderCall` already flips `status` to 'ended' from two paths:
  //   (a) the VAPI Web SDK `call-end` event (Talk-Here / WebRTC),
  //   (b) the SSE `call-ended` event (server-side end-of-call writer).
  //
  // SimChat used to ignore that signal — the operator/learner had to tap
  // the red X and confirm a sheet to advance the phase. This effect closes
  // that gap: when the provider says ended, flip the phase straight into
  // `wrapping` and let `handleEndCall` finish the save + pipeline run.
  //
  // Idempotency: guarded by `isEnding` (set inside `handleEndCall` on the
  // first call) plus a phase check so this never re-fires once we leave
  // the active phase.
  const autoEndFiredRef = useRef(false);
  useEffect(() => {
    if (providerCall.status !== 'ended') return;
    if (callPhase !== 'active') return;
    // If the manual sheet path is already running (or any other
    // handleEndCall invocation), don't double-fire when the SDK's
    // call-end event flips status mid-save.
    if (isEnding) return;
    // No chat-side call record means there's nothing to save (e.g. user
    // dialled Talk-Here from the lobby and hung up before sending any chat
    // message). `handleEndCall` would early-return; keep the phase at
    // 'active' so the lobby UI can recover via the existing reset paths.
    if (!callId) return;
    if (autoEndFiredRef.current) return;
    autoEndFiredRef.current = true;
    setCallPhase('wrapping');
    // #1241 — `providerCall.endedBy` distinguishes the SDK call-end event
    // from the SSE call-ended broadcast so analytics can tell browser
    // hangups apart from PSTN/webhook closures. Falls back to 'sdk' if
    // the source wasn't captured (shouldn't happen — defensive).
    void handleEndCall({ endSource: providerCall.endedBy ?? 'sdk' });
  }, [providerCall.status, providerCall.endedBy, callPhase, callId, isEnding, handleEndCall]);

  // Reset the latch when a fresh call starts so a subsequent call can
  // auto-wrap too.
  useEffect(() => {
    if (callPhase === 'lobby' || callPhase === 'loading') {
      autoEndFiredRef.current = false;
    }
  }, [callPhase]);

  // #1241 Slice 4 — reset and start the next call. Shared by the in-card
  // CTA on the composed session-complete card and the existing footer
  // "Start New Call" button so they behave identically.
  const handleStartNextCall = useCallback(() => {
    setMessages([]);
    setArtifacts([]);
    setActions([]);
    setNewPromptId(null);
    setCallEndedAt(null);
    setCallEndSource(null);
    setCallId(null);
    callIdRef.current = null;
    durationBudgetRef.current = null;
    wrapUpSentRef.current = false;
    setTimeChip(null);
    if (onNewCall) {
      onNewCall();
    } else {
      startNewCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNewCall]);

  const isEmbedded = mode === 'embedded';

  // #618: inline rename from the SIM header. PATCHes the caller, updates
  // local display state, and notifies the parent page so the breadcrumb
  // and any other surfaces stay in sync without a refetch.
  const handleRenameFromSim = useCallback(async (next: string) => {
    const res = await fetch(`/api/callers/${callerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      throw new Error(result.error || 'Rename failed');
    }
    setCallerNameOverride(next);
    onNameChange?.(next);
  }, [callerId, onNameChange]);

  const content = (
    <>
      {/* Header */}
      <WhatsAppHeader
        title={displayName}
        subtitle={(() => {
          // Breadcrumb: "Subject: Course" when both exist and differ, else best available
          if (subjectDiscipline && playbookName && subjectDiscipline !== playbookName) {
            return `${subjectDiscipline}: ${playbookName}`;
          }
          return playbookName || subjectDiscipline || domainName;
        })()}
        onBack={onBack}
        onEndCall={() => {
          // #1241 Slice 2 — learners (STUDENT) skip the sheet entirely.
          // The toggle ("Run analysis pipeline") is a system concept
          // they can't reason about; pipeline runs by default for them.
          // Operators keep the sheet for now — Slice 3 moves the toggle
          // to Playbook config and Slice 4 collapses the wrap UI.
          if (!isOperator) {
            if (callPhase === 'active') setCallPhase('wrapping');
            void handleEndCall();
            return;
          }
          setShowEndSheet(true);
        }}
        onMediaLibrary={() => {
          setShowMediaLibrary(prev => !prev);
          setShowContentPicker(false);
        }}
        onVoiceToggle={
          // #1092 — local Whisper mic icon is feature-flagged off by
          // default; learners use [Call me] instead. Flag is true in
          // tests/setup.ts so the existing useVoiceMode coverage stays
          // green, and true in dev under LOCAL_SIM_VOICE_MODE=true.
          localSimVoiceModeEnabled && callPhase === 'active'
            ? voiceMode.toggle
            : undefined
        }
        onAvatarClick={() => router.push(`/x/callers/${callerId}`)}
        onTitleEdit={handleRenameFromSim}
        titleEditDisabled={callPhase === 'active'}
        mediaLibraryActive={showMediaLibrary}
        voiceActive={localSimVoiceModeEnabled && voiceMode.state !== 'off'}
        callActive={
          // Chat-call active (had at least one message exchanged) OR a
          // voice channel is anywhere between launching and ended. The
          // operator must always have an out — without this, the [Talk
          // Here] / [Call me] flows stranded users with no way to hang up.
          (callPhase === 'active' && messages.length > 0) ||
          providerCall.status === 'starting' ||
          providerCall.status === 'connecting' ||
          providerCall.status === 'active' ||
          outboundDial.status === 'dialing' ||
          outboundDial.status === 'ringing'
        }
        avatarColor={hashColor(callerId)}
        onProgressPanel={() => {
          setShowProgressPanel(prev => !prev);
          setShowAdminPanel(false);
          setShowMediaLibrary(false);
        }}
        progressPanelActive={showProgressPanel}
        onAdminPanel={isOperator ? () => { setShowAdminPanel(prev => !prev); setShowProgressPanel(false); } : undefined}
        adminPanelActive={showAdminPanel}
      />

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="wa-chat-bg"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 12px 12px',
          position: 'relative',
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setShowScrollTop(el.scrollTop > 300);
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
            {gi === historyGroups.length - 1 && journeyPosition.position && journeyPosition.position.totalStops > 0 && (
              <div className="wa-session-indicator">
                {journeyPosition.position.isContinuous
                  ? `${journeyPosition.position.progressPercentage ?? 0}% mastered`
                  : `Session ${journeyPosition.position.currentPosition} of ${journeyPosition.position.totalStops}`
                }
                {studentProgress.data && studentProgress.data.goals.length > 0 && ` · ${studentProgress.data.goals.length} goal${studentProgress.data.goals.length !== 1 ? 's' : ''}`}
                {studentProgress.data && studentProgress.data.topicCount > 0 && ` · ${studentProgress.data.topicCount} topic${studentProgress.data.topicCount !== 1 ? 's' : ''}`}
              </div>
            )}
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
            {journeyPosition.position && journeyPosition.position.totalStops > 0 && (() => {
              const pos = journeyPosition.position;
              const pct = pos.isContinuous
                ? (pos.progressPercentage ?? 0)
                : (pos.totalStops > 0 ? (pos.completedStops / pos.totalStops) * 100 : 0);
              return (
              <div className="wa-lobby-journey">
                <div className="wa-lobby-journey-bar">
                  <div
                    className="wa-lobby-journey-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="wa-lobby-journey-label">
                  {pos.isContinuous
                    ? `${pos.progressPercentage ?? 0}% mastered`
                    : `Session ${pos.currentPosition} of ${pos.totalStops}`
                  }
                </span>
              </div>
              );
            })()}
            <p style={{
              fontSize: 14,
              color: 'var(--wa-text-secondary)',
              textAlign: 'center',
              margin: 0,
            }}>
              Start your practice session
            </p>
            {/* Three-button lobby: [Chat] (text) · [Talk Here] (browser
                WebRTC, no phone needed) · [Call me] (VAPI rings the
                learner's actual phone). Provider name never appears in
                learner UI; operator chip lives elsewhere. */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
              <button
                className="wa-lobby-start-btn"
                onClick={startNewCall}
                aria-label="Start chat session"
                title="Chat"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
              </button>
              <button
                className="wa-lobby-start-btn"
                onClick={() => { void providerCall.start(); }}
                disabled={providerCall.status === 'starting' || providerCall.status === 'connecting'}
                aria-label="Talk here in your browser"
                title="Talk Here (browser microphone)"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  {/* microphone */}
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z"/>
                </svg>
              </button>
              <button
                className="wa-lobby-start-btn"
                onClick={() => { void outboundDial.start(); }}
                disabled={
                  outboundDial.status === 'loading-phone' ||
                  outboundDial.status === 'saving-phone' ||
                  outboundDial.status === 'dialing' ||
                  outboundDial.status === 'ringing' ||
                  outboundDial.status === 'needs-phone'
                }
                aria-label="Call my phone"
                title="Call me (VAPI calls your phone)"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  {/* phone handset */}
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </button>
            </div>
            {/* Talk Here status (browser WebRTC) */}
            {providerCall.status === 'starting' && (
              <p style={{ fontSize: 13, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                Setting up your voice session&hellip;
              </p>
            )}
            {providerCall.status === 'connecting' && (
              <p style={{ fontSize: 13, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                Connecting&hellip; (you&apos;ll be asked for microphone access)
              </p>
            )}
            {providerCall.status === 'active' && (
              <button
                onClick={() => { void providerCall.end(); }}
                style={{ fontSize: 13, color: 'var(--status-error-text)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                End voice session
              </button>
            )}
            {providerCall.status === 'error' && providerCall.errorMessage && (
              <p style={{ fontSize: 13, color: 'var(--status-error-text)', textAlign: 'center', margin: 0 }}>
                {providerCall.errorMessage}
              </p>
            )}

            {/* Call me status + phone-capture form (PSTN outbound) */}
            {outboundDial.status === 'loading-phone' && (
              <p style={{ fontSize: 13, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                Checking your number&hellip;
              </p>
            )}
            {outboundDial.status === 'needs-phone' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 280, margin: '0 auto' }}>
                <p style={{ fontSize: 13, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                  What&apos;s your phone number? We&apos;ll call you.
                </p>
                <input
                  type="tel"
                  className="hf-input"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+44 7700 900123"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && phoneDraft.trim().length >= 7) {
                      void outboundDial.savePhoneAndDial(phoneDraft.trim());
                    }
                  }}
                  aria-label="Your phone number"
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button
                    className="hf-btn hf-btn-primary"
                    disabled={phoneDraft.trim().length < 7}
                    onClick={() => { void outboundDial.savePhoneAndDial(phoneDraft.trim()); }}
                  >
                    Save &amp; call me
                  </button>
                  <button
                    className="hf-btn hf-btn-secondary"
                    onClick={() => { outboundDial.reset(); setPhoneDraft(''); }}
                  >
                    Cancel
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                  Include your country code (e.g. +44 for the UK).
                </p>
              </div>
            )}
            {outboundDial.status === 'saving-phone' && (
              <p style={{ fontSize: 13, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                Saving your number&hellip;
              </p>
            )}
            {outboundDial.status === 'dialing' && (
              <p style={{ fontSize: 13, color: 'var(--wa-text-secondary)', textAlign: 'center', margin: 0 }}>
                Calling {outboundDial.phoneMasked}&hellip;
              </p>
            )}
            {outboundDial.status === 'ringing' && (
              <p style={{ fontSize: 13, color: 'var(--status-success-text)', textAlign: 'center', margin: 0 }}>
                Ringing {outboundDial.phoneMasked} — pick up your phone.
              </p>
            )}
            {outboundDial.status === 'error' && outboundDial.errorMessage && (
              <p style={{ fontSize: 13, color: 'var(--status-error-text)', textAlign: 'center', margin: 0 }}>
                {outboundDial.errorMessage}
              </p>
            )}
          </div>
        )}

        {/* Loading spinner while checking for active call */}
        {callPhase === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div className="hf-spinner" style={{ width: 28, height: 28 }} />
          </div>
        )}

        {/* Active/wrapping/ended: session separator + live messages */}
        {(callPhase === 'active' || callPhase === 'wrapping' || callPhase === 'ended') && (
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

            {/* Time-remaining chip — appears once when session nears its time budget */}
            {timeChip && (
              <div className="wa-date-chip" style={{ margin: '12px auto 8px' }}>
                {timeChip}
              </div>
            )}

            {(isGreeting || (isStreaming && messages[messages.length - 1]?.content === '')) && (
              <TypingIndicator />
            )}
          </>
        )}

        {/* Post-call: new prompt notification (operator-only — breaks learner immersion) */}
        {newPromptId && isOperator && (
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

        {/* #1241 Slice 5 — 30s silence watchdog banner. Surfaces when no
            transcript activity for >30s during a live call. Provides a
            "Mark as ended" escape hatch so the learner isn't stuck if the
            provider event never lands. Cleared on any new message. */}
        {silenceWarning && callPhase === 'active' && (
          <div
            className="hf-banner hf-banner-warning"
            role="status"
            aria-live="polite"
            style={{ margin: '8px auto', maxWidth: 380 }}
          >
            <span>Connection has been quiet for a while — call may have ended.</span>
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={() => {
                setSilenceWarning(false);
                if (callPhase === 'active') setCallPhase('wrapping');
                void handleEndCall({ endSource: 'drop' });
              }}
            >
              Mark as ended
            </button>
          </div>
        )}

        {/* #1241 — Wrapping-up marker. Renders while the pipeline runs
            after a phone hangup. Non-blocking glow (hf-glow-active) — the
            transcript stays scrollable, only the input is disabled. */}
        {callPhase === 'wrapping' && (
          <div className="wa-call-marker">
            <div className="wa-call-marker-icon hf-glow-active" aria-hidden="true" />
            <div>
              <div className="sim-wrapping-title">Wrapping up…</div>
              <div className="sim-wrapping-sub">Saving the call and analysing in the background.</div>
            </div>
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
              <div style={{ fontWeight: 500, color: 'var(--wa-text-primary)' }}>{labelForEndSource(callEndSource)}</div>
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

        {/* #1241 Slice 4 — Composed "Up next" card. Lands in the
            transcript when the call ends, giving the learner one strong
            forward-looking action. Pipeline runs in background; while
            newPromptId is unresolved the CTA shows a glow with
            "Preparing next session…" — never a stale prompt. */}
        {callPhase === 'ended' && (
          <div className="hf-card sim-up-next-card">
            <div className="sim-up-next-eyebrow">Up next</div>
            <div className="sim-up-next-headline">
              {(() => {
                const qs = quickStart as Record<string, unknown> | null;
                const progress = qs?.curriculum_progress as string | undefined;
                const session = qs?.this_session as string | undefined;
                return progress || session || 'Ready when you are.';
              })()}
            </div>
            {newPromptId ? (
              <button
                type="button"
                className="hf-btn hf-btn-primary sim-up-next-cta"
                onClick={handleStartNextCall}
              >
                Start next call
              </button>
            ) : (
              <button
                type="button"
                className="hf-btn hf-btn-secondary sim-up-next-cta hf-glow-active"
                disabled
                aria-live="polite"
              >
                Preparing next session…
              </button>
            )}
          </div>
        )}

        {/* #1098 Slice C — Qualification readiness recap after the call settles.
            Slice D — moved ABOVE PostCallProgressCard per ux-reviewer #3: the
            qualification summary directly answers "how did that session move the
            needle on my certification?", which is the higher-signal item at the
            attention peak post-call. The generic progress card sits below as
            secondary context. Renders only when the learner's active Curriculum
            has a qualificationAnchor; silent otherwise. Refetches inside so the
            AGGREGATE rollup for the just-ended call is reflected. */}
        {callPhase === 'ended' && <QualificationSessionSummary />}

        {/* Post-call learning progress card */}
        {callPhase === 'ended' && (
          <PostCallProgressCard callerId={callerId} />
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

        {/* Scroll-to-top button */}
        {showScrollTop && (
          <button
            className="wa-scroll-top-btn"
            onClick={() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Scroll to top"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        )}
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

      {/* Post-call: start new call — hidden when journey has pending stops (surveys, onboarding) */}
      {callPhase === 'ended' && (!journey || journey.state === 'teaching' || journey.state === 'complete' || journey.state === 'bypassed') && (
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-primary)',
        }}>
          <button
            onClick={handleStartNextCall}
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

      {/* Progress panel — all roles */}
      {showProgressPanel && (
        <SimProgressPanel
          onClose={() => setShowProgressPanel(false)}
          callerId={callerId}
          callerName={displayName}
        />
      )}

      {/* Admin debug panel — OPERATOR+ only */}
      {isOperator && showAdminPanel && (
        <SimAdminPanel
          onClose={() => setShowAdminPanel(false)}
          callId={callId}
          callPhase={callPhase}
          messageCount={messages.length}
          isStreaming={isStreaming}
          error={error}
          newPromptId={newPromptId}
          callerId={callerId}
          callerName={displayName}
          domainName={domainName}
          playbookId={playbookId}
          playbookName={playbookName}
          subjectDiscipline={subjectDiscipline}
          sessionGoal={sessionGoal}
          journeyState={journey?.state}
          activeSurveyStep={journey?.activeSurveyStep}
          quickStart={quickStart}
        />
      )}
    </>
  );

  if (isEmbedded) {
    return <div className="sim-embedded">{content}</div>;
  }

  // Standalone: rendered inside sim layout (which provides the container)
  return content;
}

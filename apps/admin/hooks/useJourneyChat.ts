'use client';

/**
 * useJourneyChat — state machine that drives the unified WhatsApp journey.
 *
 * On mount, resolves journey position for the caller. Based on the next stop type,
 * loads the appropriate content (survey questions, onboarding data, or signals
 * "ready for teaching"). Exposes items and callbacks for SimChat to render.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ROLE_LEVEL } from '@/lib/roles';
import type { UserRole } from '@prisma/client';
import type { SurveyStep } from '@/components/student/ChatSurvey';
import type { SurveyStepConfig } from '@/lib/types/json-fields';
import { SURVEY_SCOPES, POST_SURVEY_KEYS } from '@/lib/learner/survey-keys';
import { DEFAULT_PERSONALITY_QUESTIONS } from '@/lib/assessment/personality-defaults';
import { DEFAULT_OFFBOARDING_SURVEY } from '@/lib/learner/survey-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatItemKind = 'text' | 'survey_prompt' | 'divider' | 'next_stop';

interface BaseItem {
  id: string;
  timestamp: Date;
}

export interface TextItem extends BaseItem {
  kind: 'text';
  role: 'assistant' | 'user';
  content: string;
}

export interface SurveyPromptItem extends BaseItem {
  kind: 'survey_prompt';
  step: SurveyStep;
  answered?: { value: string | number; displayText: string };
  progress?: { current: number; total: number; label: string };
}

export interface DividerItem extends BaseItem {
  kind: 'divider';
  label: string;
}

export interface NextStopItem extends BaseItem {
  kind: 'next_stop';
  label: string;
  action: () => void;
}

export type ChatItem = TextItem | SurveyPromptItem | DividerItem | NextStopItem;

type JourneyState =
  | 'loading'
  | 'survey_active'
  | 'survey_submitting'
  | 'onboarding'
  | 'teaching'         // SimChat takes over
  | 'between_stops'    // showing NextStopCTA after a call ends
  | 'complete'
  | 'bypassed';        // forceFirstCall or non-LEARNER

export interface UseJourneyChatResult {
  items: ChatItem[];
  activeSurveyStep: SurveyStep | null;
  state: JourneyState;
  onSurveyAnswer: (stepId: string, value: string | number, displayText: string) => void;
  onCallEnd: () => void;
}

interface UseJourneyChatOptions {
  callerId: string;
  forceFirstCall?: boolean;
  /** Caller's role from API — journey only runs for LEARNER callers. Undefined = still loading. */
  callerRole?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function url(base: string, callerId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  params.set('callerId', callerId);
  return `${base}?${params.toString()}`;
}

let itemCounter = 0;
function nextId(): string {
  return `ji-${++itemCounter}-${Date.now()}`;
}

function textItem(role: 'assistant' | 'user', content: string): TextItem {
  return { id: nextId(), kind: 'text', role, content, timestamp: new Date() };
}

function dividerItem(label: string): DividerItem {
  return { id: nextId(), kind: 'divider', label, timestamp: new Date() };
}

// Build personality survey steps with greeting
function buildPersonalitySteps(configs: SurveyStepConfig[], subject: string, teacherName: string): SurveyStep[] {
  return [
    { id: '_greeting', type: 'message', prompt: `Hey! I'm your AI study partner for ${subject}. ${teacherName ? `${teacherName} set this up for you.` : ''} Before we dive in, I'd love to learn a bit about you.` },
    ...configs.map((c) => ({ ...c, prompt: c.prompt.replace(/\{subject\}/g, subject) })),
  ];
}

function buildPreTestSteps(configs: SurveyStepConfig[], subject: string): SurveyStep[] {
  return [
    { id: '_pretest_intro', type: 'message' as const, prompt: `Now let's do a quick knowledge check on ${subject} — just ${configs.length} questions. Don't worry about getting them right, this just helps me understand where you're starting from.` },
    ...configs.map((c) => ({ ...c, prompt: c.prompt.replace(/\{subject\}/g, subject) })),
    { id: '_pretest_done', type: 'message' as const, prompt: "Brilliant! I've got everything I need. Let's start your first practice session — you're going to do great." },
  ];
}

function buildPostTestSteps(configs: SurveyStepConfig[], subject: string): SurveyStep[] {
  return [
    { id: '_posttest_intro', type: 'message' as const, prompt: `One last thing — let's see how much your ${subject} comprehension has grown. ${configs.length} questions, same skills we've been working on.` },
    ...configs.map((c) => ({ ...c, prompt: c.prompt.replace(/\{subject\}/g, subject) })),
    { id: '_posttest_done', type: 'message' as const, prompt: "Brilliant! Let's wrap up with some quick feedback." },
  ];
}

function buildPostSteps(configs: SurveyStepConfig[]): SurveyStep[] {
  return [
    { id: '_post_greeting', type: 'message' as const, prompt: "You've finished all your sessions — amazing work! Before you go, I'd love to hear how it went." },
    ...configs,
    { id: '_post_thanks', type: 'message' as const, prompt: "Thanks so much for your feedback! You've been brilliant. Good luck with everything!" },
  ];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useJourneyChat({ callerId, forceFirstCall, callerRole }: UseJourneyChatOptions): UseJourneyChatResult {
  // #242 Slice 4: navigate to the picker when journey-position returns
  // module_picker. Skipped when ?requestedModuleId=… is already in the URL
  // (treated as "already picked, proceed to teaching") so we don't loop.
  const router = useRouter();
  const searchParams = useSearchParams();
  // Operator/admin viewers (level >= 3) are simming, not learning. The picker
  // page rejects them with no `?callerId=` in the URL and bounces to
  // `/x/callers`, trapping them. Sim/[callerId]/page.tsx already gives them a
  // banner CTA as the non-blocking entry — so the hook must not force the
  // redirect for them. Real students still get auto-routed to the picker.
  // Wait for session hydration before deciding — initial `undefined` role
  // would default to STUDENT and falsely trigger the non-operator redirect
  // for admins. The init effect below holds off on resolveJourneyPosition
  // until `sessionStatus !== 'loading'`.
  const { data: session, status: sessionStatus } = useSession();
  const viewerRoleLevel = ROLE_LEVEL[(session?.user?.role ?? 'STUDENT') as UserRole] ?? 0;
  const viewerIsOperator = viewerRoleLevel >= 3;

  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<JourneyState>('loading');
  const [activeSurveyStep, setActiveSurveyStep] = useState<SurveyStep | null>(null);

  // Refs for mutable state accessed in callbacks
  const surveyStepsRef = useRef<SurveyStep[]>([]);
  const surveyIndexRef = useRef(0);
  const surveyAnswersRef = useRef<Record<string, string | number | boolean>>({});
  const surveyPhaseRef = useRef<'personality' | 'pre_test' | 'post_test' | 'post'>('personality');
  const preTestQuestionIdsRef = useRef<string[]>([]);
  const mcqQuestionIdsRef = useRef<string[]>([]);
  const subjectRef = useRef('this subject');
  const resolving = useRef(false);
  /** Remaining welcome phases to run after the current one completes */
  const welcomeQueueRef = useRef<Array<'onboarding' | 'aboutYou' | 'knowledgeCheck'>>([]);
  /** Ref to break circular dep: advanceWelcomeQueue ↔ phase loaders */
  const advanceRef = useRef<() => Promise<void>>(async () => {});
  /** Stashed WelcomeConfig from resolveJourneyPosition for phase loaders */
  const welcomeConfigRef = useRef<{ goals?: { enabled: boolean }; aboutYou?: { enabled: boolean }; knowledgeCheck?: { enabled: boolean } } | null>(null);

  const pushItems = useCallback((...newItems: ChatItem[]) => {
    setItems(prev => [...prev, ...newItems]);
  }, []);

  // ── Advance to the next survey step (or finish survey) ──
  const advanceSurveyStep = useCallback(() => {
    const steps = surveyStepsRef.current;
    let idx = surveyIndexRef.current;

    // Skip message-type steps by pushing them as text items
    while (idx < steps.length && steps[idx].type === 'message') {
      pushItems(textItem('assistant', steps[idx].prompt));
      idx++;
    }

    surveyIndexRef.current = idx;

    if (idx >= steps.length) {
      // All steps done — submit
      setActiveSurveyStep(null);
      return 'complete' as const;
    }

    const step = steps[idx];
    const interactiveSteps = steps.filter(s => s.type !== 'message');
    const currentInteractive = interactiveSteps.indexOf(step) + 1;
    const totalInteractive = interactiveSteps.length;

    const promptItem: SurveyPromptItem = {
      id: nextId(),
      kind: 'survey_prompt',
      step,
      timestamp: new Date(),
      progress: { current: currentInteractive, total: totalInteractive, label: `${currentInteractive} of ${totalInteractive}` },
    };
    pushItems(promptItem);
    setActiveSurveyStep(step);
    return 'active' as const;
  }, [pushItems]);

  // ── Submit survey answers ──
  const submitSurvey = useCallback(async () => {
    setState('survey_submitting');
    const phase = surveyPhaseRef.current;
    const answers = surveyAnswersRef.current;

    try {
      if (phase === 'personality') {
        const surveyAnswers: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(answers)) {
          if (!key.startsWith('_') && typeof value !== 'boolean') surveyAnswers[key] = value;
        }
        // POST personality scope
        await fetch(url('/api/student/survey', callerId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: SURVEY_SCOPES.PERSONALITY, answers: surveyAnswers }),
        });
        // Legacy compat
        await fetch(url('/api/student/survey', callerId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: SURVEY_SCOPES.PRE, answers: surveyAnswers }),
        });
      } else if (phase === 'pre_test') {
        const assessmentAnswers: Record<string, { answer: string; correct: boolean }> = {};
        for (const [key, value] of Object.entries(answers)) {
          if (key.startsWith('_') || key.endsWith('_correct')) continue;
          assessmentAnswers[key] = {
            answer: String(value),
            correct: answers[`${key}_correct`] === true,
          };
        }
        await fetch(url('/api/student/assessment', callerId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: SURVEY_SCOPES.PRE_TEST,
            answers: assessmentAnswers,
            questionIds: preTestQuestionIdsRef.current,
          }),
        });
      } else if (phase === 'post_test') {
        // MCQ assessment phase — submit to assessment endpoint
        const assessmentAnswers: Record<string, { answer: string; correct: boolean }> = {};
        for (const [key, value] of Object.entries(answers)) {
          if (key.startsWith('_') || key.endsWith('_correct')) continue;
          assessmentAnswers[key] = {
            answer: String(value),
            correct: answers[`${key}_correct`] === true,
          };
        }
        await fetch(url('/api/student/assessment', callerId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: 'POST_TEST',
            answers: assessmentAnswers,
            questionIds: mcqQuestionIdsRef.current,
          }),
        });
      } else if (phase === 'post') {
        const surveyAnswers: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(answers)) {
          if (!key.startsWith('_') && typeof value !== 'boolean') surveyAnswers[key] = value;
        }
        await fetch(url('/api/student/survey', callerId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: SURVEY_SCOPES.POST, answers: surveyAnswers }),
        });
      }
    } catch (err) {
      console.error('[journey] survey submit failed:', err);
    }
  }, [callerId]);

  // ── Start a survey phase ──
  const startSurveyPhase = useCallback((phase: 'personality' | 'pre_test' | 'post_test' | 'post', steps: SurveyStep[], questionIds?: string[]) => {
    surveyPhaseRef.current = phase;
    surveyStepsRef.current = steps;
    surveyIndexRef.current = 0;
    surveyAnswersRef.current = {};
    if (questionIds) {
      if (phase === 'pre_test') preTestQuestionIdsRef.current = questionIds;
      else mcqQuestionIdsRef.current = questionIds;
    }
    setState('survey_active');
    advanceSurveyStep();
  }, [advanceSurveyStep]);

  // ── Load and start post-survey (with optional MCQ post-test) ──
  const loadPostSurvey = useCallback(async () => {
    try {
      pushItems(dividerItem('Course Feedback'));

      const [surveyRes, configRes, postTestRes] = await Promise.all([
        fetch(url('/api/student/survey', callerId, { scope: SURVEY_SCOPES.POST })),
        fetch(url('/api/student/survey-config', callerId)),
        fetch(url('/api/student/assessment-questions', callerId, { type: 'post_test' })),
      ]);
      const [surveyData, configData, postTestData] = await Promise.all([
        surveyRes.json(), configRes.json(), postTestRes.json(),
      ]);

      // Already done?
      if (surveyData?.ok && surveyData.answers?.[POST_SURVEY_KEYS.SUBMITTED_AT]) {
        resolveJourneyPosition();
        return;
      }

      // If post-test MCQs available and enabled, show them first
      const postTestEnabled = configData?.ok && configData.assessment?.postTest?.enabled;
      if (postTestEnabled && postTestData?.ok && !postTestData.skipped && postTestData.questions?.length > 0) {
        const subject = configData.subject || subjectRef.current;
        startSurveyPhase('post_test', buildPostTestSteps(postTestData.questions, subject), postTestData.questionIds);
        return;
      }

      // No post-test or not enabled — go straight to satisfaction survey
      let postConfigs: SurveyStepConfig[] = DEFAULT_OFFBOARDING_SURVEY;
      if (configData?.ok && configData.postSurvey?.surveySteps?.length > 0) {
        postConfigs = configData.postSurvey.surveySteps;
      }

      startSurveyPhase('post', buildPostSteps(postConfigs));
    } catch (err) {
      console.error('[journey] post-survey load failed:', err);
      setState('teaching');
    }
  }, [callerId, pushItems, startSurveyPhase]);

  // ── Load onboarding (welcome message + optional goals) ──
  const loadOnboardingPhase = useCallback(async () => {
    try {
      const progressRes = await fetch(url('/api/student/progress', callerId));
      const progressData = await progressRes.json();

      const inst = progressData.institutionName;
      const teacher = progressData.teacherName;
      const goals = progressData.goals ?? [];

      const greeting = inst
        ? `Welcome to ${inst}! ${teacher ? `${teacher} set this up for you. ` : ''}I'm your AI study partner — ready to help you learn through conversation.`
        : `Welcome! ${teacher ? `${teacher} set this up for you. ` : ''}I'm your AI study partner — ready to help you learn through conversation.`;

      pushItems(
        dividerItem('Welcome'),
        textItem('assistant', greeting),
      );

      const goalsEnabled = welcomeConfigRef.current?.goals?.enabled !== false;
      if (goalsEnabled && goals.length > 0) {
        const MAX_VISIBLE_GOALS = 4;
        const visibleGoals = goals.slice(0, MAX_VISIBLE_GOALS);
        const overflow = goals.length - visibleGoals.length;
        const goalList = visibleGoals.map((g: { name: string }) => `• ${g.name}`).join('\n');
        const tail = overflow > 0 ? `\n• …and ${overflow} more` : '';
        pushItems(textItem('assistant', `Here's what we'll work on:\n${goalList}${tail}`));
      }

      pushItems(textItem('assistant', "We'll adapt as we go. Let's get started!"));

      const hasMorePhases = welcomeQueueRef.current.length > 0;

      // Push a NextStopCTA
      const ctaItem: NextStopItem = {
        id: nextId(),
        kind: 'next_stop',
        label: hasMorePhases ? 'Continue ▶' : 'Start Your First Session ▶',
        timestamp: new Date(),
        action: async () => {
          // Mark onboarding complete
          try {
            const res = await fetch(url('/api/student/onboarding', callerId), { method: 'POST' });
            if (!res.ok) throw new Error('Failed');
            await advanceRef.current();
          } catch {
            pushItems(textItem('assistant', "Something went wrong. Tap below to try again."));
            pushItems({
              id: nextId(),
              kind: 'next_stop',
              label: 'Try Again ▶',
              timestamp: new Date(),
              action: async () => {
                const res2 = await fetch(url('/api/student/onboarding', callerId), { method: 'POST' }).catch(() => null);
                if (res2?.ok) await advanceRef.current();
                else pushItems(textItem('assistant', "Still having trouble. Please refresh the page."));
              },
            });
          }
        },
      };
      pushItems(ctaItem);
      setState('onboarding');
    } catch (err) {
      console.error('[journey] onboarding load failed:', err);
      setState('teaching');
    }
  }, [callerId, pushItems]);

  // ── Load a single pre-survey phase (aboutYou = personality, knowledgeCheck = pre-test) ──
  const loadPreSurveyPhase = useCallback(async (phase: 'aboutYou' | 'knowledgeCheck') => {
    try {
      const [teacherRes, configRes, personalityRes, preTestRes] = await Promise.all([
        fetch(url('/api/student/teacher', callerId)),
        fetch(url('/api/student/survey-config', callerId)),
        fetch(url(`/api/student/survey`, callerId, { scope: SURVEY_SCOPES.PERSONALITY })),
        fetch(url('/api/student/assessment-questions', callerId, { type: 'pre_test' })),
      ]);
      const [teacherData, configData, personalityData, preTestData] = await Promise.all([
        teacherRes.json(), configRes.json(), personalityRes.json(), preTestRes.json(),
      ]);

      let subject = 'this subject';
      let teacherName = '';
      let personalityConfigs: SurveyStepConfig[] = DEFAULT_PERSONALITY_QUESTIONS;

      if (teacherData.ok) {
        subject = teacherData.domain || subject;
        teacherName = teacherData.teacher?.name || '';
      }
      if (configData.ok) {
        if (configData.subject) subject = configData.subject;
        if (configData.assessment?.personality?.questions?.length > 0) {
          personalityConfigs = configData.assessment.personality.questions;
        }
      }
      subjectRef.current = subject;

      if (phase === 'aboutYou') {
        // Check if personality already done
        const personalityDone = personalityData.ok && personalityData.answers?.submitted_at;
        if (!personalityDone) {
          pushItems(dividerItem('About You'));
          startSurveyPhase('personality', buildPersonalitySteps(personalityConfigs, subject, teacherName));
          return;
        }
        // Already done — advance to next phase
        await advanceRef.current();
      } else if (phase === 'knowledgeCheck') {
        if (preTestData.ok && !preTestData.skipped && preTestData.questions?.length > 0) {
          pushItems(dividerItem('Knowledge Check'));
          startSurveyPhase('pre_test', buildPreTestSteps(preTestData.questions, subject), preTestData.questionIds);
          return;
        }
        // No pre-test available — advance
        await advanceRef.current();
      }
    } catch (err) {
      console.error(`[journey] ${phase} load failed:`, err);
      setState('teaching'); // fail open
    }
  }, [callerId, pushItems, startSurveyPhase]);

  // ── Advance to next welcome phase (or fall through to teaching) ──
  // Uses advanceRef to break circular dependency with phase loaders.
  const advanceWelcomeQueue = useCallback(async () => {
    const next = welcomeQueueRef.current.shift();
    if (!next) {
      // All welcome phases done — go to teaching
      setState('teaching');
      return;
    }
    if (next === 'onboarding') {
      await loadOnboardingPhase();
    } else if (next === 'aboutYou' || next === 'knowledgeCheck') {
      await loadPreSurveyPhase(next);
    }
  }, [loadOnboardingPhase, loadPreSurveyPhase]);

  // Keep ref in sync
  advanceRef.current = advanceWelcomeQueue;

  // ── Resolve journey position ──
  const resolveJourneyPosition = useCallback(async () => {
    if (resolving.current) return;
    resolving.current = true;

    try {
      const res = await fetch(url('/api/student/journey-position', callerId));
      const data = await res.json();

      if (!data.ok || !data.nextStop) {
        setState('teaching');
        return;
      }

      const stopType = data.nextStop.type;

      if (stopType === 'module_picker') {
        // #242 Slice 4: route real learners to the picker before each session.
        // Skip when the URL already has requestedModuleId — that means the
        // learner has just picked, came back via returnTo, and is ready to
        // teach. Without this guard the picker → SIM round-trip loops.
        const alreadyPicked = !!searchParams?.get('requestedModuleId');
        if (alreadyPicked) {
          setState('teaching');
        } else if (viewerIsOperator) {
          // Operator/admin simming: don't auto-route — the banner CTA on the
          // sim page is the non-blocking entry. Auto-routing traps admins on
          // /x/callers because the picker page requires `?callerId=` in URL.
          setState('teaching');
        } else if (data.nextStop.redirect) {
          router.push(data.nextStop.redirect);
        } else {
          setState('teaching');
        }
      } else if (stopType === 'post_survey') {
        await loadPostSurvey();
      } else if (stopType === 'onboarding') {
        // Fetch WelcomeConfig to decide which pre-course phases to show
        const configRes = await fetch(url('/api/student/survey-config', callerId));
        const configData = await configRes.json();
        const welcome = configData.ok ? configData.welcome : null;

        // Build queue of enabled phases
        const queue: Array<'onboarding' | 'aboutYou' | 'knowledgeCheck'> = [];
        // Onboarding (welcome message) always shows unless ALL toggles are off
        const goalsOn = welcome?.goals?.enabled !== false;
        const aboutYouOn = welcome?.aboutYou?.enabled === true;
        const knowledgeCheckOn = welcome?.knowledgeCheck?.enabled === true;

        if (goalsOn || aboutYouOn || knowledgeCheckOn) {
          queue.push('onboarding');
        }
        if (aboutYouOn) queue.push('aboutYou');
        if (knowledgeCheckOn) queue.push('knowledgeCheck');

        if (queue.length === 0) {
          // All disabled — mark onboarding complete and go straight to teaching
          await fetch(url('/api/student/onboarding', callerId), { method: 'POST' }).catch(() => {});
          setState('teaching');
          return;
        }

        welcomeQueueRef.current = queue;
        welcomeConfigRef.current = welcome;
        await advanceRef.current();
      } else if (stopType === 'complete') {
        pushItems(dividerItem('Journey Complete'), textItem('assistant', "You've completed all your learning sessions. Great work!"));
        setState('complete');
      } else {
        // teaching, continuous, or unknown — start teaching
        setState('teaching');
      }
    } catch {
      pushItems(textItem('assistant', "Couldn't load your next step. Starting a practice session."));
      setState('teaching');
    } finally {
      resolving.current = false;
    }
  }, [callerId, pushItems, loadPostSurvey]);

  // ── Handle survey answer ──
  const onSurveyAnswer = useCallback((stepId: string, value: string | number, displayText: string) => {
    // Store answer
    surveyAnswersRef.current[stepId] = value;

    // For MCQ: also store correctness
    const step = surveyStepsRef.current[surveyIndexRef.current];
    if (step && (step.type === 'mcq' || step.type === 'true_false') && step.correctAnswer) {
      surveyAnswersRef.current[`${stepId}_correct`] = String(value) === step.correctAnswer;
    }

    // Push user answer bubble
    pushItems(textItem('user', displayText));

    // Advance after a short delay — conversational feel
    surveyIndexRef.current++;
    setTimeout(() => {
      const result = advanceSurveyStep();

      if (result === 'complete') {
        (async () => {
          await submitSurvey();
          const completedPhase = surveyPhaseRef.current;

          // After post-test MCQs → transition to post satisfaction survey
          if (completedPhase === 'post_test') {
            try {
              const configRes = await fetch(url('/api/student/survey-config', callerId));
              const configData = await configRes.json();
              let postConfigs: SurveyStepConfig[] = DEFAULT_OFFBOARDING_SURVEY;
              if (configData?.ok && configData.offboarding?.surveySteps?.length > 0) {
                postConfigs = configData.offboarding.surveySteps;
              }
              startSurveyPhase('post', buildPostSteps(postConfigs));
              return;
            } catch {}
          }

          // Pre-course phases (personality, pre-test) → advance welcome queue
          if (completedPhase === 'personality' || completedPhase === 'pre_test') {
            if (welcomeQueueRef.current.length > 0) {
              await advanceRef.current();
              return;
            }
          }

          // Default: re-resolve journey position (post-survey done, or queue empty)
          resolving.current = false;
          await resolveJourneyPosition();
        })();
      }
    }, 400);
  }, [callerId, pushItems, advanceSurveyStep, submitSurvey, startSurveyPhase, resolveJourneyPosition]);

  // ── Handle call end (from SimChat) ──
  const onCallEnd = useCallback(() => {
    setState('between_stops');
    // After a delay, push a NextStopCTA
    setTimeout(() => {
      const ctaItem: NextStopItem = {
        id: nextId(),
        kind: 'next_stop',
        label: 'Continue ▶',
        timestamp: new Date(),
        action: () => resolveJourneyPosition(),
      };
      pushItems(ctaItem);
    }, 1500);
  }, [pushItems, resolveJourneyPosition]);

  // ── Init ──
  // Wait for callerRole before deciding. Only LEARNER callers have a journey.
  // Also wait for session hydration: an unresolved session defaults the role
  // to STUDENT, which makes `viewerIsOperator` false and trips the module_picker
  // redirect for admins simming a learner — bouncing them to /x/callers.
  useEffect(() => {
    if (forceFirstCall) {
      setState('bypassed');
      return;
    }
    if (callerRole === undefined) {
      // Still loading caller data — stay in 'loading' (no API calls yet)
      return;
    }
    if (callerRole !== 'LEARNER') {
      setState('bypassed');
      return;
    }
    if (sessionStatus === 'loading') {
      // Don't make journey-position decisions while session is loading —
      // viewer role is unknown until next-auth resolves.
      return;
    }
    resolveJourneyPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerRole, forceFirstCall, sessionStatus]);

  return {
    items,
    activeSurveyStep,
    state,
    onSurveyAnswer,
    onCallEnd,
  };
}

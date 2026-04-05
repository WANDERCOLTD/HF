'use client';

/**
 * useJourneyChat — state machine that drives the unified WhatsApp journey.
 *
 * On mount, resolves journey position for the caller. Based on the next stop type,
 * loads the appropriate content (survey questions, onboarding data, or signals
 * "ready for teaching"). Exposes items and callbacks for SimChat to render.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SurveyStep } from '@/components/student/ChatSurvey';
import type { SurveyStepConfig } from '@/lib/types/json-fields';
import { SURVEY_SCOPES, PRE_SURVEY_KEYS, MID_SURVEY_KEYS, POST_SURVEY_KEYS } from '@/lib/learner/survey-keys';
import { DEFAULT_PERSONALITY_QUESTIONS } from '@/lib/assessment/personality-defaults';
import { DEFAULT_MID_SURVEY, DEFAULT_OFFBOARDING_SURVEY } from '@/lib/learner/survey-config';

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

function buildMidSteps(configs: SurveyStepConfig[]): SurveyStep[] {
  return [
    { id: '_mid_greeting', type: 'message' as const, prompt: "Hey! You're making great progress. Before your next session, I'd love a quick check-in." },
    ...configs,
    { id: '_mid_thanks', type: 'message' as const, prompt: "Thanks for sharing! Let's keep going — your next session is ready." },
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
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<JourneyState>('loading');
  const [activeSurveyStep, setActiveSurveyStep] = useState<SurveyStep | null>(null);

  // Refs for mutable state accessed in callbacks
  const surveyStepsRef = useRef<SurveyStep[]>([]);
  const surveyIndexRef = useRef(0);
  const surveyAnswersRef = useRef<Record<string, string | number | boolean>>({});
  const surveyPhaseRef = useRef<'personality' | 'pre_test' | 'mid' | 'post'>('personality');
  const preTestQuestionIdsRef = useRef<string[]>([]);
  const subjectRef = useRef('this subject');
  const resolving = useRef(false);

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
      } else if (phase === 'mid') {
        const surveyAnswers: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(answers)) {
          if (!key.startsWith('_') && typeof value !== 'boolean') surveyAnswers[key] = value;
        }
        await fetch(url('/api/student/survey', callerId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: SURVEY_SCOPES.MID, answers: surveyAnswers }),
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
  const startSurveyPhase = useCallback((phase: 'personality' | 'pre_test' | 'mid' | 'post', steps: SurveyStep[], questionIds?: string[]) => {
    surveyPhaseRef.current = phase;
    surveyStepsRef.current = steps;
    surveyIndexRef.current = 0;
    surveyAnswersRef.current = {};
    if (questionIds) preTestQuestionIdsRef.current = questionIds;
    setState('survey_active');
    advanceSurveyStep();
  }, [advanceSurveyStep]);

  // ── Load and start pre-survey (personality + pre-test) ──
  const loadPreSurvey = useCallback(async () => {
    try {
      pushItems(dividerItem('About You'));

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

      // Check if personality already done
      const personalityDone = personalityData.ok && personalityData.answers?.submitted_at;

      if (!personalityDone) {
        startSurveyPhase('personality', buildPersonalitySteps(personalityConfigs, subject, teacherName));
        return;
      }

      // Personality done — try pre-test
      if (preTestData.ok && !preTestData.skipped && preTestData.questions?.length > 0) {
        pushItems(dividerItem('Knowledge Check'));
        startSurveyPhase('pre_test', buildPreTestSteps(preTestData.questions, subject), preTestData.questionIds);
        return;
      }

      // Both done or no pre-test — re-resolve
      resolveJourneyPosition();
    } catch (err) {
      console.error('[journey] pre-survey load failed:', err);
      setState('teaching'); // fail open
    }
  }, [callerId, pushItems, startSurveyPhase]);

  // ── Load and start mid-survey ──
  const loadMidSurvey = useCallback(async () => {
    try {
      pushItems(dividerItem('Quick Check-in'));

      const [surveyRes, configRes] = await Promise.all([
        fetch(url(`/api/student/survey`, callerId, { scope: SURVEY_SCOPES.MID })),
        fetch(url('/api/student/survey-config', callerId)),
      ]);
      const [surveyData, configData] = await Promise.all([surveyRes.json(), configRes.json()]);

      // Already done?
      if (surveyData?.ok && surveyData.answers?.[MID_SURVEY_KEYS.SUBMITTED_AT]) {
        resolveJourneyPosition();
        return;
      }

      let midConfigs: SurveyStepConfig[] = DEFAULT_MID_SURVEY;
      if (configData?.ok && configData.midSurvey?.surveySteps?.length > 0) {
        midConfigs = configData.midSurvey.surveySteps;
      }

      startSurveyPhase('mid', buildMidSteps(midConfigs));
    } catch (err) {
      console.error('[journey] mid-survey load failed:', err);
      setState('teaching');
    }
  }, [callerId, pushItems, startSurveyPhase]);

  // ── Load and start post-survey ──
  const loadPostSurvey = useCallback(async () => {
    try {
      pushItems(dividerItem('Course Feedback'));

      const [surveyRes, configRes] = await Promise.all([
        fetch(url('/api/student/survey', callerId, { scope: SURVEY_SCOPES.POST })),
        fetch(url('/api/student/survey-config', callerId)),
      ]);
      const [surveyData, configData] = await Promise.all([surveyRes.json(), configRes.json()]);

      // Already done?
      if (surveyData?.ok && surveyData.answers?.[POST_SURVEY_KEYS.SUBMITTED_AT]) {
        resolveJourneyPosition();
        return;
      }

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

  // ── Load onboarding ──
  const loadOnboarding = useCallback(async () => {
    try {
      const progressRes = await fetch(url('/api/student/progress', callerId));
      const progressData = await progressRes.json();

      const inst = progressData.institutionName || 'your institution';
      const teacher = progressData.teacherName;
      const goals = progressData.goals ?? [];

      pushItems(
        dividerItem('Welcome'),
        textItem('assistant', `Welcome to ${inst}! ${teacher ? `${teacher} set this up for you. ` : ''}I'm your AI study partner — ready to help you learn through conversation.`),
      );

      if (goals.length > 0) {
        const goalList = goals.map((g: { name: string }) => `• ${g.name}`).join('\n');
        pushItems(textItem('assistant', `Here are your learning goals:\n${goalList}`));
      }

      pushItems(textItem('assistant', "You'll have AI-powered practice sessions that adapt to how you're doing. Let's get started!"));

      // Push a NextStopCTA
      const ctaItem: NextStopItem = {
        id: nextId(),
        kind: 'next_stop',
        label: 'Start Your First Session ▶',
        timestamp: new Date(),
        action: async () => {
          // Mark onboarding complete
          try {
            const res = await fetch(url('/api/student/onboarding', callerId), { method: 'POST' });
            if (!res.ok) throw new Error('Failed');
            resolveJourneyPosition();
          } catch {
            pushItems(textItem('assistant', "Something went wrong. Tap below to try again."));
            // Re-push the same CTA so user can retry
            pushItems({
              id: nextId(),
              kind: 'next_stop',
              label: 'Try Again ▶',
              timestamp: new Date(),
              action: async () => {
                const res2 = await fetch(url('/api/student/onboarding', callerId), { method: 'POST' }).catch(() => null);
                if (res2?.ok) resolveJourneyPosition();
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

      if (stopType === 'pre_survey') {
        await loadPreSurvey();
      } else if (stopType === 'mid_survey') {
        await loadMidSurvey();
      } else if (stopType === 'post_survey') {
        await loadPostSurvey();
      } else if (stopType === 'onboarding') {
        await loadOnboarding();
      } else if (stopType === 'complete') {
        pushItems(dividerItem('Journey Complete'), textItem('assistant', "You've completed all your learning sessions. Great work!"));
        setState('complete');
      } else {
        // Teaching session
        setState('teaching');
      }
    } catch {
      pushItems(textItem('assistant', "Couldn't load your next step. Starting a practice session."));
      setState('teaching');
    } finally {
      resolving.current = false;
    }
  }, [callerId, pushItems, loadPreSurvey, loadMidSurvey, loadPostSurvey, loadOnboarding]);

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

          if (surveyPhaseRef.current === 'personality') {
            try {
              const preTestRes = await fetch(url('/api/student/assessment-questions', callerId, { type: 'pre_test' }));
              const preTestData = await preTestRes.json();
              if (preTestData.ok && !preTestData.skipped && preTestData.questions?.length > 0) {
                pushItems(dividerItem('Knowledge Check'));
                startSurveyPhase('pre_test', buildPreTestSteps(preTestData.questions, subjectRef.current), preTestData.questionIds);
                return;
              }
            } catch {}
          }

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
    resolveJourneyPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerRole, forceFirstCall]);

  return {
    items,
    activeSurveyStep,
    state,
    onSurveyAnswer,
    onCallEnd,
  };
}

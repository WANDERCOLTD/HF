"use client";

/**
 * WelcomeSurveyFlow — multi-phase pre-survey (personality + pre-test).
 *
 * Extracted from /x/student/welcome/page.tsx so it can be embedded in both:
 * - The student welcome page (via page wrapper)
 * - The sim page (inline, for journey-aware sim)
 *
 * Accepts optional `callerId` for admin-context usage.
 */

import { useEffect, useState, useCallback } from "react";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import type { SurveyStepConfig } from "@/lib/types/json-fields";
import {
  DEFAULT_ONBOARDING_SURVEY,
  type SurveyEndAction,
} from "@/lib/learner/survey-config";
import { DEFAULT_PERSONALITY_QUESTIONS } from "@/lib/assessment/personality-defaults";
import { isSummaryAction } from "@/lib/learner/survey-end-action";
import { StopSummaryCard } from "@/components/student/StopSummaryCard";
import "@/app/x/student/welcome/welcome.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WelcomeSurveyFlowProps {
  /** Caller ID — required for admin-in-sim context, omit for student context */
  callerId?: string | null;
  /** Called when all survey phases are complete */
  onComplete: (endAction?: SurveyEndAction) => void;
  /** Called when survey is already done (skip rendering) */
  onAlreadyDone: () => void;
}

type Phase = "personality" | "pre_test";

const PHASE_LABELS: Record<Phase, string> = {
  personality: "About You",
  pre_test: "Knowledge Check",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrl(base: string, callerId?: string | null, extraParams?: Record<string, string>): string {
  const params = new URLSearchParams(extraParams);
  if (callerId) params.set("callerId", callerId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function buildPersonalitySteps(
  configs: SurveyStepConfig[],
  subject: string,
  teacherName: string,
): SurveyStep[] {
  const steps: SurveyStep[] = configs.map((c) => ({
    ...c,
    prompt: c.prompt.replace(/\{subject\}/g, subject),
  }));

  return [
    {
      id: "_greeting",
      type: "message",
      prompt: `Hey! I'm your AI study partner for ${subject}. ${teacherName ? `${teacherName} set this up for you.` : ""} Before we dive in, I'd love to learn a bit about you.`,
    },
    ...steps,
  ];
}

function buildPreTestSteps(configs: SurveyStepConfig[], subject: string): SurveyStep[] {
  const steps: SurveyStep[] = configs.map((c) => ({
    ...c,
    prompt: c.prompt.replace(/\{subject\}/g, subject),
  }));

  return [
    {
      id: "_pretest_intro",
      type: "message",
      prompt: `Now let's do a quick knowledge check on ${subject} — just ${configs.length} questions. Don't worry about getting them right, this just helps me understand where you're starting from.`,
    },
    ...steps,
    {
      id: "_pretest_done",
      type: "message",
      prompt: "Brilliant! I've got everything I need. Let's start your first practice session — you're going to do great.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WelcomeSurveyFlow({ callerId, onComplete, onAlreadyDone }: WelcomeSurveyFlowProps): React.ReactElement | null {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [subject, setSubject] = useState("this subject");
  const [teacherName, setTeacherName] = useState("");
  const [endAction, setEndAction] = useState<SurveyEndAction | undefined>(undefined);
  const [lastAnswers, setLastAnswers] = useState<Record<string, string | number>>({});

  // Multi-phase state
  const [currentPhase, setCurrentPhase] = useState<Phase>("personality");
  const [personalityConfigs, setPersonalityConfigs] = useState<SurveyStepConfig[]>(DEFAULT_PERSONALITY_QUESTIONS);
  const [preTestConfigs, setPreTestConfigs] = useState<SurveyStepConfig[]>([]);
  const [preTestQuestionIds, setPreTestQuestionIds] = useState<string[]>([]);
  const [phases, setPhases] = useState<Phase[]>(["personality"]);

  // Persona tone
  const [tone, setTone] = useState("default");

  const url = useCallback((base: string, extra?: Record<string, string>) => buildUrl(base, callerId, extra), [callerId]);

  // Init: check completion + load config + assessment questions
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const [surveyRes, teacherRes, configRes, personalityRes, preTestRes] = await Promise.all([
          fetch(url(`/api/student/survey`, { scope: SURVEY_SCOPES.PRE })),
          fetch(url("/api/student/teacher")),
          fetch(url("/api/student/survey-config")),
          fetch(url(`/api/student/survey`, { scope: SURVEY_SCOPES.PERSONALITY })),
          fetch(url("/api/student/assessment-questions", { type: "pre_test" })),
        ]);
        const [surveyData, teacherData, configData, personalityData, preTestData] = await Promise.all([
          surveyRes.json(),
          teacherRes.json(),
          configRes.json(),
          personalityRes.json(),
          preTestRes.json(),
        ]);

        if (teacherData.ok) {
          setSubject(teacherData.domain || "this subject");
          setTeacherName(teacherData.teacher?.name || "");
        }

        if (configData.ok) {
          if (configData.subject) setSubject(configData.subject);
          if (configData.tone) setTone(configData.tone);
          if (configData.onboarding?.endAction) {
            setEndAction(configData.onboarding.endAction);
          }
          if (configData.assessment?.personality?.questions?.length > 0) {
            setPersonalityConfigs(configData.assessment.personality.questions);
          }
        }

        // Check if personality phase already completed
        const personalityDone = personalityData.ok && personalityData.answers?.submitted_at;
        const preSurveyDone = surveyData.ok && surveyData.answers?.[PRE_SURVEY_KEYS.SUBMITTED_AT];

        if (personalityDone && preSurveyDone) {
          onAlreadyDone();
          return;
        }

        // Load pre-test questions
        if (preTestData.ok && !preTestData.skipped && preTestData.questions?.length > 0) {
          setPreTestConfigs(preTestData.questions);
          setPreTestQuestionIds(preTestData.questionIds);
        }

        // Determine which phases to run
        const activePhases: Phase[] = [];

        if (!personalityDone) {
          activePhases.push("personality");
        }

        if (preTestData.ok && !preTestData.skipped && preTestData.questions?.length > 0) {
          const preTestCheck = await fetch(url(`/api/student/survey`, { scope: SURVEY_SCOPES.PRE_TEST }));
          const preTestCheckData = await preTestCheck.json();
          const preTestDone = preTestCheckData.ok && preTestCheckData.answers?.submitted_at;
          if (!preTestDone) {
            activePhases.push("pre_test");
          }
        } else if (preTestData.ok && preTestData.skipped) {
          // No questions available — store skip marker
          fetch(url("/api/student/survey"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: SURVEY_SCOPES.PRE_TEST,
              answers: { skipped: preTestData.skipReason ?? "no_questions" },
            }),
          }).catch(() => {});
        }

        if (activePhases.length === 0) {
          onAlreadyDone();
          return;
        }

        setPhases(activePhases);
        setCurrentPhase(activePhases[0]);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase: Personality complete ──
  const handlePersonalityComplete = useCallback(async (answers: Record<string, string | number | boolean>) => {
    setSubmitting(true);
    try {
      const surveyAnswers: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (!key.startsWith("_") && typeof value !== "boolean") {
          surveyAnswers[key] = value;
        }
      }

      const res = await fetch(url("/api/student/survey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SURVEY_SCOPES.PERSONALITY, answers: surveyAnswers }),
      });
      const data = await res.json();

      if (data.ok) {
        // Legacy backward compat
        await fetch(url("/api/student/survey"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: SURVEY_SCOPES.PRE, answers: surveyAnswers }),
        });

        const nextPhaseIndex = phases.indexOf("personality") + 1;
        if (nextPhaseIndex < phases.length) {
          setCurrentPhase(phases[nextPhaseIndex]);
        } else {
          setLastAnswers(surveyAnswers);
          if (isSummaryAction(endAction)) {
            setSubmitted(true);
          } else {
            onComplete(endAction);
          }
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [endAction, phases, onComplete, url]);

  // ── Phase: Pre-test complete ──
  const handlePreTestComplete = useCallback(async (answers: Record<string, string | number | boolean>) => {
    setSubmitting(true);
    try {
      const assessmentAnswers: Record<string, { answer: string; correct: boolean }> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (key.startsWith("_")) continue;
        if (key.endsWith("_correct")) continue;
        const correctKey = `${key}_correct`;
        assessmentAnswers[key] = {
          answer: String(value),
          correct: answers[correctKey] === true,
        };
      }

      const res = await fetch(url("/api/student/assessment"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: SURVEY_SCOPES.PRE_TEST,
          answers: assessmentAnswers,
          questionIds: preTestQuestionIds,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        onComplete(endAction);
      }
    } finally {
      setSubmitting(false);
    }
  }, [endAction, preTestQuestionIds, onComplete, url]);

  const handleContinueAfterSummary = useCallback(() => {
    if (phases.includes("pre_test") && currentPhase !== "pre_test") {
      setCurrentPhase("pre_test");
      setSubmitted(false);
      return;
    }
    onComplete(endAction);
  }, [endAction, phases, currentPhase, onComplete]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="welcome-page">
        <div className="welcome-loading"><div className="hf-spinner" /></div>
      </div>
    );
  }

  // ── Summary card ──
  if (submitted) {
    return (
      <div className="welcome-page">
        <StopSummaryCard
          answers={lastAnswers}
          steps={personalityConfigs}
          onContinue={handleContinueAfterSummary}
          continueLabel={phases.includes("pre_test") ? "Next: Knowledge Check →" : "Start Learning →"}
        />
      </div>
    );
  }

  // ── Phase indicator ──
  const phaseIndicator = phases.length > 1 ? (
    <div className="welcome-phases">
      {phases.map((phase) => (
        <div
          key={phase}
          className={`welcome-phase-pill ${phase === currentPhase ? "welcome-phase-pill--active" : ""} ${phases.indexOf(phase) < phases.indexOf(currentPhase) ? "welcome-phase-pill--done" : ""}`}
        >
          {PHASE_LABELS[phase]}
        </div>
      ))}
    </div>
  ) : null;

  // ── Personality phase ──
  if (currentPhase === "personality") {
    return (
      <div className="welcome-page">
        <div className="welcome-phase-wrap">
          {phaseIndicator}
        </div>
        <ChatSurvey
          steps={buildPersonalitySteps(personalityConfigs, subject, teacherName)}
          tutorName="AI Tutor"
          onComplete={handlePersonalityComplete}
          submitting={submitting}
          submitLabel={phases.includes("pre_test") ? "Next →" : "Start Learning →"}
        />
      </div>
    );
  }

  // ── Pre-test phase ──
  if (currentPhase === "pre_test") {
    return (
      <div className="welcome-page">
        <div className="welcome-phase-wrap">
          {phaseIndicator}
        </div>
        <ChatSurvey
          steps={buildPreTestSteps(preTestConfigs, subject)}
          tutorName="AI Tutor"
          onComplete={handlePreTestComplete}
          submitting={submitting}
          submitLabel="Start Learning →"
          showProgress
          showSummary
          tone={tone}
        />
      </div>
    );
  }

  return null;
}

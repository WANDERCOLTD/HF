"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import type { SurveyStepConfig } from "@/lib/types/json-fields";
import {
  DEFAULT_ONBOARDING_SURVEY,
  type SurveyEndAction,
} from "@/lib/learner/survey-config";
import { isSummaryAction, resolveRedirect } from "@/lib/learner/survey-end-action";
import { StopSummaryCard } from "@/components/student/StopSummaryCard";
import "./welcome.css";

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

type Phase = "personality" | "pre_test";

const PHASE_LABELS: Record<Phase, string> = {
  personality: "About You",
  pre_test: "Knowledge Check",
};

// ---------------------------------------------------------------------------
// Default personality questions (contract fallback)
// ---------------------------------------------------------------------------

const DEFAULT_PERSONALITY_QUESTIONS: SurveyStepConfig[] = [
  {
    id: "learning_style",
    type: "options",
    prompt: "How do you prefer to learn?",
    options: [
      { value: "visual", label: "Pictures and diagrams" },
      { value: "auditory", label: "Listening and discussing" },
      { value: "reading", label: "Reading and writing" },
      { value: "kinesthetic", label: "Hands-on practice" },
    ],
  },
  {
    id: "pace_preference",
    type: "options",
    prompt: "What pace works best for you?",
    options: [
      { value: "fast", label: "Move quickly through material" },
      { value: "moderate", label: "Steady pace with time to think" },
      { value: "slow", label: "Take it slow, lots of examples" },
    ],
  },
  {
    id: "interaction_style",
    type: "options",
    prompt: "How do you like to be taught?",
    options: [
      { value: "conversational", label: "Chat naturally" },
      { value: "direct", label: "Straight to the point" },
      { value: "exploratory", label: "Let me figure things out" },
      { value: "guided", label: "Step-by-step guidance" },
    ],
  },
  {
    id: "confidence",
    type: "stars",
    prompt: "How confident are you in {subject} right now?",
  },
  {
    id: "goal_text",
    type: "text",
    prompt: "What's your main goal for this course?",
    placeholder: "e.g. Pass my exam, understand the fundamentals...",
    maxLength: 200,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert SurveyStepConfig[] to SurveyStep[] with greeting/transition messages */
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

export default function WelcomeSurveyPage(): React.ReactElement {
  const router = useRouter();
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
  const [phases, setPhases] = useState<Phase[]>(["personality"]); // phases that will run

  // Legacy fallback state
  const [useLegacyFlow, setUseLegacyFlow] = useState(false);
  const [legacyConfigs, setLegacyConfigs] = useState<SurveyStepConfig[]>(DEFAULT_ONBOARDING_SURVEY);

  // Check if already submitted + load context + survey config + assessment questions
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const [surveyRes, teacherRes, configRes, personalityRes, preTestRes] = await Promise.all([
          fetch(`/api/student/survey?scope=${SURVEY_SCOPES.PRE}`),
          fetch("/api/student/teacher"),
          fetch("/api/student/survey-config"),
          fetch(`/api/student/survey?scope=${SURVEY_SCOPES.PERSONALITY}`),
          fetch("/api/student/assessment-questions?type=pre_test"),
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
          if (configData.onboarding?.endAction) {
            setEndAction(configData.onboarding.endAction);
          }
          // Load personality questions from assessment config if available
          if (configData.assessment?.personality?.questions?.length > 0) {
            setPersonalityConfigs(configData.assessment.personality.questions);
          }
          // Legacy fallback: if no assessment config, use old survey flow
          if (configData.onboarding?.surveySteps?.length > 0) {
            setLegacyConfigs(configData.onboarding.surveySteps);
          }
        }

        // Check if personality phase already completed
        const personalityDone = personalityData.ok && personalityData.answers?.submitted_at;

        // Check if old pre-survey already completed (backward compat)
        const preSurveyDone = surveyData.ok && surveyData.answers?.[PRE_SURVEY_KEYS.SUBMITTED_AT];

        if (personalityDone && preSurveyDone) {
          // Both old and new flows completed — skip
          router.push("/x/student");
          return;
        }

        // If old pre-survey done but personality not done, still show new flow
        // If personality done but pre-test not done, skip to pre-test

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
          // Check if pre-test already submitted
          const preTestCheck = await fetch(`/api/student/survey?scope=${SURVEY_SCOPES.PRE_TEST}`);
          const preTestCheckData = await preTestCheck.json();
          const preTestDone = preTestCheckData.ok && preTestCheckData.answers?.submitted_at;
          if (!preTestDone) {
            activePhases.push("pre_test");
          }
        } else if (preTestData.ok && preTestData.skipped) {
          // No questions available — store skip marker for journey position resolver
          fetch("/api/student/survey", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scope: SURVEY_SCOPES.PRE_TEST,
              answers: { skipped: preTestData.skipReason ?? "no_questions" },
            }),
          }).catch(() => {}); // fire-and-forget
        }

        if (activePhases.length === 0) {
          // Everything already done
          router.push("/x/student");
          return;
        }

        setPhases(activePhases);
        setCurrentPhase(activePhases[0]);

        // If no personality questions available from contract AND no pre-test,
        // fall back to legacy pre-survey flow
        if (activePhases.length === 1 && activePhases[0] === "personality") {
          // Use new personality flow — it's the default
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router]);

  // ── Phase: Personality complete ──
  const handlePersonalityComplete = useCallback(async (answers: Record<string, string | number | boolean>) => {
    setSubmitting(true);
    try {
      // Filter out internal message step IDs
      const surveyAnswers: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (!key.startsWith("_") && typeof value !== "boolean") {
          surveyAnswers[key] = value;
        }
      }

      // Submit to personality scope
      const res = await fetch("/api/student/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SURVEY_SCOPES.PERSONALITY, answers: surveyAnswers }),
      });
      const data = await res.json();

      if (data.ok) {
        // Also submit to legacy PRE_SURVEY scope for backward compat
        await fetch("/api/student/survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: SURVEY_SCOPES.PRE, answers: surveyAnswers }),
        });

        // Advance to next phase or finish
        const nextPhaseIndex = phases.indexOf("personality") + 1;
        if (nextPhaseIndex < phases.length) {
          setCurrentPhase(phases[nextPhaseIndex]);
        } else {
          // No more phases — show summary or redirect
          setLastAnswers(surveyAnswers);
          if (isSummaryAction(endAction)) {
            setSubmitted(true);
          } else {
            router.replace(resolveRedirect(endAction));
          }
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [router, endAction, phases]);

  // ── Phase: Pre-test complete ──
  const handlePreTestComplete = useCallback(async (answers: Record<string, string | number | boolean>) => {
    setSubmitting(true);
    try {
      // Build assessment answer payload
      const assessmentAnswers: Record<string, { answer: string; correct: boolean }> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (key.startsWith("_")) continue;
        if (key.endsWith("_correct")) continue; // skip the _correct keys, we'll pair them
        const correctKey = `${key}_correct`;
        assessmentAnswers[key] = {
          answer: String(value),
          correct: answers[correctKey] === true,
        };
      }

      const res = await fetch("/api/student/assessment", {
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
        // All phases done — redirect
        router.replace(resolveRedirect(endAction));
      }
    } finally {
      setSubmitting(false);
    }
  }, [router, endAction, preTestQuestionIds]);

  const handleContinueAfterSummary = useCallback(() => {
    // If there's a pre-test phase remaining, go to it
    if (phases.includes("pre_test") && currentPhase !== "pre_test") {
      setCurrentPhase("pre_test");
      setSubmitted(false);
      return;
    }
    router.replace(resolveRedirect(endAction));
  }, [router, endAction, phases, currentPhase]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="welcome-page">
        <div className="welcome-loading"><div className="hf-spinner" /></div>
      </div>
    );
  }

  // ── Summary card (after personality if no pre-test) ──
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
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px" }}>
          {phaseIndicator}
          <div className="hf-flex hf-justify-end hf-mb-sm">
            <button
              className="hf-btn hf-btn-xs hf-btn-outline"
              onClick={() => {
                // Skip personality — advance to pre-test or redirect
                const nextPhaseIndex = phases.indexOf("personality") + 1;
                if (nextPhaseIndex < phases.length) {
                  setCurrentPhase(phases[nextPhaseIndex]);
                } else {
                  router.replace(resolveRedirect(endAction));
                }
              }}
              type="button"
            >
              Skip →
            </button>
          </div>
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
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px" }}>
          {phaseIndicator}
        </div>
        <ChatSurvey
          steps={buildPreTestSteps(preTestConfigs, subject)}
          tutorName="AI Tutor"
          onComplete={handlePreTestComplete}
          submitting={submitting}
          submitLabel="Start Learning →"
        />
      </div>
    );
  }

  return null;
}

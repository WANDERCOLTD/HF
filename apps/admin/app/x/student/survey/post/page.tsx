"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, POST_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";
import type { SurveyStepConfig } from "@/lib/types/json-fields";
import { DEFAULT_OFFBOARDING_SURVEY, type SurveyEndAction } from "@/lib/learner/survey-config";
import { isSummaryAction, resolveRedirect } from "@/lib/learner/survey-end-action";
import { StopSummaryCard } from "@/components/student/StopSummaryCard";
import "./post-survey.css";

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

type Phase = "post_test" | "feedback";

const PHASE_LABELS: Record<Phase, string> = {
  post_test: "Knowledge Check",
  feedback: "Feedback",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPostTestSteps(configs: SurveyStepConfig[]): SurveyStep[] {
  return [
    {
      id: "_posttest_intro",
      type: "message",
      prompt: `Let's see how much you've learned — same ${configs.length} questions as before. Don't overthink it!`,
    },
    ...configs,
  ];
}

function buildFeedbackSteps(configs: SurveyStepConfig[]): SurveyStep[] {
  return [
    {
      id: "_greeting",
      type: "message",
      prompt: "Great job! Now I'd love to hear how the experience went — just a few quick questions.",
    },
    ...configs,
    {
      id: "_thanks",
      type: "message",
      prompt: "That's really helpful — thank you! Your feedback makes the experience better for everyone.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PostSurveyPage(): React.ReactElement {
  const router = useRouter();
  const { buildUrl } = useStudentCallerId();
  const [loading, setLoading] = useState(true);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [postConfigs, setPostConfigs] = useState<SurveyStepConfig[]>(DEFAULT_OFFBOARDING_SURVEY);
  const [endAction, setEndAction] = useState<SurveyEndAction | undefined>(undefined);
  const [lastAnswers, setLastAnswers] = useState<Record<string, string | number>>({});

  // Multi-phase state
  const [currentPhase, setCurrentPhase] = useState<Phase>("post_test");
  const [postTestConfigs, setPostTestConfigs] = useState<SurveyStepConfig[]>([]);
  const [postTestQuestionIds, setPostTestQuestionIds] = useState<string[]>([]);
  const [phases, setPhases] = useState<Phase[]>(["feedback"]); // default: feedback only
  const [upliftResult, setUpliftResult] = useState<{ score: number; uplift?: { absolute: number; normalised: number } } | null>(null);

  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const [surveyRes, configRes, postTestRes, postTestCheckRes] = await Promise.all([
          fetch(buildUrl(`/api/student/survey?scope=${SURVEY_SCOPES.POST}`)).then((r) => r.json()),
          fetch(buildUrl("/api/student/survey-config")).then((r) => r.json()).catch(() => null),
          fetch(buildUrl("/api/student/assessment-questions?type=post_test")).then((r) => r.json()).catch(() => null),
          fetch(buildUrl(`/api/student/survey?scope=${SURVEY_SCOPES.POST_TEST}`)).then((r) => r.json()).catch(() => null),
        ]);

        if (surveyRes?.ok && surveyRes.answers?.[POST_SURVEY_KEYS.SUBMITTED_AT]) {
          // Check if post-test also done
          const postTestDone = postTestCheckRes?.ok && postTestCheckRes.answers?.submitted_at;
          if (postTestDone || !postTestRes?.ok || postTestRes?.skipped) {
            setAlreadyDone(true);
            return;
          }
        }

        if (configRes?.ok) {
          if (configRes.offboarding?.surveySteps?.length > 0) {
            setPostConfigs(configRes.offboarding.surveySteps);
          }
          if (configRes.offboarding?.endAction) {
            setEndAction(configRes.offboarding.endAction);
          }
        }

        // Determine phases
        const activePhases: Phase[] = [];

        // Post-test phase (if pre-test was taken and post-test not yet done)
        if (postTestRes?.ok && !postTestRes.skipped && postTestRes.questions?.length > 0) {
          const postTestDone = postTestCheckRes?.ok && postTestCheckRes.answers?.submitted_at;
          if (!postTestDone) {
            setPostTestConfigs(postTestRes.questions);
            setPostTestQuestionIds(postTestRes.questionIds);
            activePhases.push("post_test");
          }
        }

        // Feedback phase (if not already done)
        const feedbackDone = surveyRes?.ok && surveyRes.answers?.[POST_SURVEY_KEYS.SUBMITTED_AT];
        if (!feedbackDone) {
          activePhases.push("feedback");
        }

        if (activePhases.length === 0) {
          setAlreadyDone(true);
          return;
        }

        setPhases(activePhases);
        setCurrentPhase(activePhases[0]);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [buildUrl]);

  // ── Post-test complete ──
  const handlePostTestComplete = useCallback(async (answers: Record<string, string | number | boolean>) => {
    setSubmitting(true);
    try {
      const assessmentAnswers: Record<string, { answer: string; correct: boolean }> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (key.startsWith("_") || key.endsWith("_correct")) continue;
        assessmentAnswers[key] = {
          answer: String(value),
          correct: answers[`${key}_correct`] === true,
        };
      }

      const res = await fetch(buildUrl("/api/student/assessment"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: SURVEY_SCOPES.POST_TEST,
          answers: assessmentAnswers,
          questionIds: postTestQuestionIds,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setUpliftResult({ score: data.score, uplift: data.uplift });

        // Advance to feedback phase or finish
        const nextPhaseIndex = phases.indexOf("post_test") + 1;
        if (nextPhaseIndex < phases.length) {
          setCurrentPhase(phases[nextPhaseIndex]);
        } else {
          router.replace(resolveRedirect(endAction));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [buildUrl, endAction, router, phases, postTestQuestionIds]);

  // ── Feedback complete ──
  const handleFeedbackComplete = useCallback(async (answers: Record<string, string | number | boolean>) => {
    setSubmitting(true);
    try {
      const surveyAnswers: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (!key.startsWith("_") && typeof value !== "boolean") {
          surveyAnswers[key] = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
        }
      }

      const res = await fetch(buildUrl("/api/student/survey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SURVEY_SCOPES.POST, answers: surveyAnswers }),
      });
      const data = await res.json();
      if (data.ok) {
        setLastAnswers(surveyAnswers);
        if (isSummaryAction(endAction)) {
          setSubmitted(true);
        } else {
          router.replace(resolveRedirect(endAction));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [buildUrl, endAction, router]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="post-survey-wrap">
        <div className="hf-spinner" />
      </div>
    );
  }

  // ── Already done ──
  if (alreadyDone) {
    return (
      <div className="post-survey-wrap">
        <div className="hf-card post-survey-thanks">
          <div className="post-survey-thanks-icon">✓</div>
          <div className="post-survey-thanks-title">Thanks! Your feedback has been recorded.</div>
          <div className="post-survey-thanks-desc">
            Your responses help us improve the experience for everyone.
          </div>
          <button className="hf-btn hf-btn-primary" onClick={() => router.replace(resolveRedirect(endAction))}>
            Back to Progress
          </button>
        </div>
      </div>
    );
  }

  // ── Summary card ──
  if (submitted) {
    return (
      <div className="post-survey-wrap">
        <StopSummaryCard
          answers={lastAnswers}
          steps={postConfigs}
          onContinue={() => router.replace(resolveRedirect(endAction))}
          continueLabel="Back to Progress"
        />
      </div>
    );
  }

  // ── Phase indicator ──
  const phaseIndicator = phases.length > 1 ? (
    <div className="post-survey-phases">
      {phases.map((phase) => (
        <div
          key={phase}
          className={`post-survey-phase-pill ${phase === currentPhase ? "post-survey-phase-pill--active" : ""} ${phases.indexOf(phase) < phases.indexOf(currentPhase) ? "post-survey-phase-pill--done" : ""}`}
        >
          {PHASE_LABELS[phase]}
        </div>
      ))}
    </div>
  ) : null;

  // ── Post-test phase ──
  if (currentPhase === "post_test") {
    return (
      <div className="post-survey-wrap">
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px" }}>
          {phaseIndicator}
        </div>
        <ChatSurvey
          steps={buildPostTestSteps(postTestConfigs)}
          tutorName="AI Tutor"
          onComplete={handlePostTestComplete}
          submitting={submitting}
          submitLabel={phases.includes("feedback") ? "Next →" : "Done!"}
        />
      </div>
    );
  }

  // ── Feedback phase ──
  if (currentPhase === "feedback") {
    return (
      <div className="post-survey-wrap">
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px" }}>
          {phaseIndicator}
          {upliftResult && upliftResult.uplift && (
            <div className="post-survey-uplift-card">
              <div className="post-survey-uplift-label">Your knowledge uplift</div>
              <div className="post-survey-uplift-score">+{Math.round(upliftResult.uplift.normalised)}%</div>
              <div className="post-survey-uplift-detail">
                Score: {Math.round(upliftResult.score * 100)}%
                {upliftResult.uplift.absolute > 0 && ` (up from ${Math.round((upliftResult.score - upliftResult.uplift.absolute) * 100)}%)`}
              </div>
            </div>
          )}
          <div className="hf-flex hf-justify-end hf-mb-sm">
            <button
              className="hf-btn hf-btn-xs hf-btn-outline"
              onClick={() => router.replace(resolveRedirect(endAction))}
              type="button"
            >
              Skip →
            </button>
          </div>
        </div>
        <ChatSurvey
          steps={buildFeedbackSteps(postConfigs)}
          tutorName="AI Tutor"
          onComplete={handleFeedbackComplete}
          submitting={submitting}
          submitLabel="Done!"
        />
      </div>
    );
  }

  return null;
}

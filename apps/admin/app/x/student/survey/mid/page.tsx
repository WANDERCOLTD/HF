"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, MID_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";
import type { SurveyStepConfig } from "@/lib/types/json-fields";
import { DEFAULT_MID_SURVEY, type SurveyEndAction } from "@/lib/learner/survey-config";
import { isSummaryAction, resolveRedirect } from "@/lib/learner/survey-end-action";
import { StopSummaryCard } from "@/components/student/StopSummaryCard";

function buildMidSteps(configs: SurveyStepConfig[]): SurveyStep[] {
  return [
    {
      id: '_greeting',
      type: 'message',
      prompt: "Hey! You're making great progress. Before your next session, I'd love a quick check-in.",
    },
    ...configs,
    {
      id: '_thanks',
      type: 'message',
      prompt: "Thanks for sharing! Let's keep going — your next session is ready.",
    },
  ];
}

export default function MidSurveyPage(): React.ReactElement {
  const router = useRouter();
  const { buildUrl } = useStudentCallerId();
  const [loading, setLoading] = useState(true);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [midConfigs, setMidConfigs] = useState<SurveyStepConfig[]>(DEFAULT_MID_SURVEY);
  const [endAction, setEndAction] = useState<SurveyEndAction | undefined>(undefined);
  const [lastAnswers, setLastAnswers] = useState<Record<string, string | number>>({});

  useEffect(() => {
    Promise.all([
      fetch(buildUrl(`/api/student/survey?scope=${SURVEY_SCOPES.MID}`)).then((r) => r.json()),
      fetch(buildUrl("/api/student/survey-config")).then((r) => r.json()).catch(() => null),
    ])
      .then(([surveyData, configData]) => {
        if (surveyData?.ok && surveyData.answers?.[MID_SURVEY_KEYS.SUBMITTED_AT]) {
          setAlreadyDone(true);
        }
        if (configData?.ok && configData.midSurvey?.endAction) {
          setEndAction(configData.midSurvey.endAction);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [buildUrl]);

  const handleComplete = useCallback(async (answers: Record<string, string | number>) => {
    setSubmitting(true);
    try {
      const surveyAnswers: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (!key.startsWith('_')) {
          surveyAnswers[key] = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
        }
      }

      const res = await fetch(buildUrl("/api/student/survey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SURVEY_SCOPES.MID, answers: surveyAnswers }),
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

  const handleSkip = useCallback(() => {
    router.replace(resolveRedirect(endAction));
  }, [router, endAction]);

  const handleContinue = useCallback(() => {
    router.replace(resolveRedirect(endAction));
  }, [router, endAction]);

  if (loading) {
    return (
      <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: "60vh" }}>
        <div className="hf-spinner" />
      </div>
    );
  }

  if (alreadyDone) {
    return (
      <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: "60vh" }}>
        <div className="hf-card" style={{ maxWidth: 400, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div className="hf-text-sm hf-text-bold hf-mb-sm">Already checked in!</div>
          <div className="hf-text-xs hf-text-muted hf-mb-md">
            Your feedback helps your teacher support you better.
          </div>
          <button className="hf-btn hf-btn-primary" onClick={handleContinue}>
            Continue Learning →
          </button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <StopSummaryCard
        answers={lastAnswers}
        steps={midConfigs}
        onContinue={handleContinue}
        continueLabel="Continue Learning →"
      />
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 16px" }}>
      <div className="hf-flex hf-justify-end hf-mb-sm">
        <button
          className="hf-btn hf-btn-xs hf-btn-outline"
          onClick={handleSkip}
          type="button"
        >
          Skip →
        </button>
      </div>
      <ChatSurvey
        steps={buildMidSteps(midConfigs)}
        tutorName="AI Tutor"
        onComplete={handleComplete}
        submitting={submitting}
        submitLabel="Continue →"
      />
    </div>
  );
}

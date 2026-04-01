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

/** Convert SurveyStepConfig[] to SurveyStep[] with greeting + ready bookends */
function buildSteps(
  configs: SurveyStepConfig[],
  subject: string,
  teacherName: string,
): SurveyStep[] {
  // Replace {subject} placeholder in prompts
  const steps: SurveyStep[] = configs.map((c) => ({
    ...c,
    prompt: c.prompt.replace(/\{subject\}/g, subject),
  }));

  return [
    {
      id: '_greeting',
      type: 'message',
      prompt: `Hey! I'm your AI study partner for ${subject}. ${teacherName ? `${teacherName} set this up for you.` : ''} Before we dive in, I'd love to learn a bit about you.`,
    },
    ...steps,
    {
      id: '_ready',
      type: 'message',
      prompt: "Brilliant! I've got everything I need. Let's start your first practice session — you're going to do great.",
    },
  ];
}

export default function WelcomeSurveyPage(): React.ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [subject, setSubject] = useState('this subject');
  const [teacherName, setTeacherName] = useState('');
  const [surveyConfigs, setSurveyConfigs] = useState<SurveyStepConfig[]>(DEFAULT_ONBOARDING_SURVEY);
  const [endAction, setEndAction] = useState<SurveyEndAction | undefined>(undefined);
  const [lastAnswers, setLastAnswers] = useState<Record<string, string | number>>({});

  // Check if already submitted + load context + survey config
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const [surveyRes, teacherRes, configRes] = await Promise.all([
          fetch(`/api/student/survey?scope=${SURVEY_SCOPES.PRE}`),
          fetch("/api/student/teacher"),
          fetch("/api/student/survey-config"),
        ]);
        const surveyData = await surveyRes.json();
        const teacherData = await teacherRes.json();
        const configData = await configRes.json();

        if (teacherData.ok) {
          setSubject(teacherData.domain || 'this subject');
          setTeacherName(teacherData.teacher?.name || '');
        }

        if (configData.ok) {
          if (configData.subject) setSubject(configData.subject);
          if (configData.onboarding?.surveySteps?.length > 0) {
            setSurveyConfigs(configData.onboarding.surveySteps);
          }
          if (configData.onboarding?.endAction) {
            setEndAction(configData.onboarding.endAction);
          }
        }

        if (surveyData.ok && surveyData.answers?.[PRE_SURVEY_KEYS.SUBMITTED_AT]) {
          router.push("/x/sim");
          return;
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router]);

  const handleComplete = useCallback(async (answers: Record<string, string | number>) => {
    setSubmitting(true);
    try {
      // Filter out internal message step IDs
      const surveyAnswers: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(answers)) {
        if (!key.startsWith('_')) surveyAnswers[key] = value;
      }

      const res = await fetch("/api/student/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SURVEY_SCOPES.PRE, answers: surveyAnswers }),
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
  }, [router, endAction]);

  const handleContinueAfterSummary = useCallback(() => {
    router.replace(resolveRedirect(endAction));
  }, [router, endAction]);

  if (loading) {
    return (
      <div className="welcome-page">
        <div className="welcome-loading"><div className="hf-spinner" /></div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="welcome-page">
        <StopSummaryCard
          answers={lastAnswers}
          steps={surveyConfigs}
          onContinue={handleContinueAfterSummary}
          continueLabel="Start Learning →"
        />
      </div>
    );
  }

  return (
    <div className="welcome-page">
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 16px" }}>
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
        steps={buildSteps(surveyConfigs, subject, teacherName)}
        tutorName="AI Tutor"
        onComplete={handleComplete}
        submitting={submitting}
        submitLabel="Start Learning →"
      />
    </div>
  );
}

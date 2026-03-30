"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import type { SurveyStepConfig } from "@/lib/types/json-fields";
import {
  DEFAULT_ONBOARDING_SURVEY,
} from "@/lib/learner/survey-config";
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
  const [subject, setSubject] = useState('this subject');
  const [teacherName, setTeacherName] = useState('');
  const [surveyConfigs, setSurveyConfigs] = useState<SurveyStepConfig[]>(DEFAULT_ONBOARDING_SURVEY);

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
      if (data.ok) router.push("/x/sim");
    } finally {
      setSubmitting(false);
    }
  }, [router]);

  if (loading) {
    return (
      <div className="welcome-page">
        <div className="welcome-loading"><div className="hf-spinner" /></div>
      </div>
    );
  }

  return (
    <div className="welcome-page">
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

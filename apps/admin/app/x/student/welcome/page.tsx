"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import "./welcome.css";

function buildSteps(subject: string, teacherName: string): SurveyStep[] {
  return [
    {
      id: '_greeting',
      type: 'message',
      prompt: `Hey! I'm your AI study partner for ${subject}. ${teacherName ? `${teacherName} set this up for you.` : ''} Before we dive in, I'd love to learn a bit about you.`,
    },
    {
      id: PRE_SURVEY_KEYS.CONFIDENCE,
      type: 'stars',
      prompt: `How confident are you in ${subject} right now?`,
    },
    {
      id: PRE_SURVEY_KEYS.PRIOR_KNOWLEDGE,
      type: 'options',
      prompt: 'And how much do you already know about it?',
      options: [
        { value: 'never', label: "Never studied it" },
        { value: 'little', label: "Know a little" },
        { value: 'basics', label: "Know the basics" },
        { value: 'well', label: "Know it well" },
      ],
    },
    {
      id: PRE_SURVEY_KEYS.GOAL_TEXT,
      type: 'text',
      prompt: "What's your main goal for this course? Pass an exam, understand the fundamentals, something else?",
      placeholder: "e.g. Pass my GCSE, understand budgeting...",
      maxLength: 200,
    },
    {
      id: PRE_SURVEY_KEYS.CONCERN_TEXT,
      type: 'text',
      prompt: "Is there anything that worries you about learning this? No pressure — you can skip this one.",
      placeholder: "e.g. I struggle with the maths side...",
      maxLength: 200,
      optional: true,
    },
    {
      id: '_ready',
      type: 'message',
      prompt: "Brilliant! I've got everything I need. Let's start your first practice session — you're going to do great. 💪",
    },
  ];
}

export default function WelcomeSurveyPage(): React.ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState('this subject');
  const [teacherName, setTeacherName] = useState('');

  // Check if already submitted + load context
  useEffect(() => {
    async function init(): Promise<void> {
      try {
        const [surveyRes, teacherRes] = await Promise.all([
          fetch(`/api/student/survey?scope=${SURVEY_SCOPES.PRE}`),
          fetch("/api/student/teacher"),
        ]);
        const surveyData = await surveyRes.json();
        const teacherData = await teacherRes.json();

        if (teacherData.ok) {
          setSubject(teacherData.domain || 'this subject');
          setTeacherName(teacherData.teacher?.name || '');
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
        steps={buildSteps(subject, teacherName)}
        tutorName="AI Tutor"
        onComplete={handleComplete}
        submitting={submitting}
        submitLabel="Start Learning →"
      />
    </div>
  );
}

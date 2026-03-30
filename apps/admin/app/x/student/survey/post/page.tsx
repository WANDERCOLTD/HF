"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChatSurvey, type SurveyStep } from "@/components/student/ChatSurvey";
import { SURVEY_SCOPES, POST_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";
import "./post-survey.css";

const POST_STEPS: SurveyStep[] = [
  {
    id: '_greeting',
    type: 'message',
    prompt: "Hey! Thanks for putting in the practice sessions. I'd love to hear how it went — just a few quick questions.",
  },
  {
    id: POST_SURVEY_KEYS.CONFIDENCE_LIFT,
    type: 'options',
    prompt: 'Compared to when you started, how much more confident do you feel?',
    options: [
      { value: '1', label: 'About the same' },
      { value: '2', label: 'A little more' },
      { value: '3', label: 'Somewhat more' },
      { value: '4', label: 'Much more' },
      { value: '5', label: 'Completely different!' },
    ],
  },
  {
    id: POST_SURVEY_KEYS.SATISFACTION,
    type: 'stars',
    prompt: 'How would you rate your experience practising with me?',
  },
  {
    id: POST_SURVEY_KEYS.NPS,
    type: 'nps',
    prompt: 'Would you recommend this to a friend? 0 means definitely not, 10 means absolutely.',
  },
  {
    id: POST_SURVEY_KEYS.FEEDBACK_TEXT,
    type: 'text',
    prompt: "Anything else you'd like to share? Compliments, complaints, ideas — all welcome. Or skip if you're done!",
    placeholder: "Your thoughts...",
    maxLength: 500,
    optional: true,
  },
  {
    id: '_thanks',
    type: 'message',
    prompt: "That's really helpful — thank you! Your feedback makes the experience better for everyone. Keep practising whenever you want. 🎉",
  },
];

export default function PostSurveyPage(): React.ReactElement {
  const router = useRouter();
  const { buildUrl } = useStudentCallerId();
  const [loading, setLoading] = useState(true);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(buildUrl(`/api/student/survey?scope=${SURVEY_SCOPES.POST}`))
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.answers?.[POST_SURVEY_KEYS.SUBMITTED_AT]) {
          setAlreadyDone(true);
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
          // Convert string numbers back to numbers for options
          surveyAnswers[key] = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
        }
      }

      const res = await fetch(buildUrl("/api/student/survey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SURVEY_SCOPES.POST, answers: surveyAnswers }),
      });
      const data = await res.json();
      if (data.ok) setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }, [buildUrl]);

  if (loading) {
    return (
      <div className="post-survey-wrap">
        <div className="hf-spinner" />
      </div>
    );
  }

  if (alreadyDone || submitted) {
    return (
      <div className="post-survey-wrap">
        <div className="hf-card post-survey-thanks">
          <div className="post-survey-thanks-icon">✓</div>
          <div className="post-survey-thanks-title">Thanks! Your feedback has been recorded.</div>
          <div className="post-survey-thanks-desc">
            Your responses help us improve the experience for everyone.
          </div>
          <Link href="/x/student/progress" className="hf-btn hf-btn-primary">
            Back to Progress
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="post-survey-wrap">
      <ChatSurvey
        steps={POST_STEPS}
        tutorName="AI Tutor"
        onComplete={handleComplete}
        submitting={submitting}
        submitLabel="Done!"
      />
    </div>
  );
}

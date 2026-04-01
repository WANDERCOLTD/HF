"use client";

import { useState, useEffect } from "react";
import { PRE_SURVEY_KEYS, POST_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import "./survey-section.css";

type SurveyData = Record<string, string | number | null>;

const PRIOR_KNOWLEDGE_LABELS: Record<string, string> = {
  never: "Never studied it",
  little: "Know a little",
  basics: "Know the basics",
  well: "Know it well",
};

function Stars({ value, max = 5 }: { value: number; max?: number }): JSX.Element {
  return (
    <span className="ss-stars">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? "ss-star-filled" : "ss-star-empty"}>
          {i < value ? "\u2605" : "\u2606"}
        </span>
      ))}
      <span className="ss-suffix">({value}/{max})</span>
    </span>
  );
}

function formatDate(iso: string | number | null): string {
  if (!iso) return "";
  const d = new Date(typeof iso === "number" ? iso : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function PrePanel({ data }: { data: SurveyData }): JSX.Element {
  const confidence = data[PRE_SURVEY_KEYS.CONFIDENCE];
  const priorKnowledge = data[PRE_SURVEY_KEYS.PRIOR_KNOWLEDGE];
  const goal = data[PRE_SURVEY_KEYS.GOAL_TEXT];
  const concern = data[PRE_SURVEY_KEYS.CONCERN_TEXT];
  const submittedAt = data[PRE_SURVEY_KEYS.SUBMITTED_AT];

  return (
    <div className="ss-panel">
      <div className="ss-panel-title">
        Pre-Survey
        {submittedAt && <span className="ss-panel-date">completed {formatDate(submittedAt)}</span>}
      </div>

      {confidence != null && (
        <div className="ss-row">
          <span className="ss-label">Confidence:</span>
          <Stars value={Number(confidence)} />
        </div>
      )}

      {priorKnowledge != null && (
        <div className="ss-row">
          <span className="ss-label">Prior knowledge:</span>
          <span className="ss-value">{PRIOR_KNOWLEDGE_LABELS[String(priorKnowledge)] ?? String(priorKnowledge)}</span>
        </div>
      )}

      {goal != null && (
        <div className="ss-row">
          <span className="ss-label">Goal:</span>
          <span className="ss-value-quote">&ldquo;{String(goal)}&rdquo;</span>
        </div>
      )}

      {concern != null && (
        <div className="ss-row">
          <span className="ss-label">Concern:</span>
          <span className="ss-value-quote">&ldquo;{String(concern)}&rdquo;</span>
        </div>
      )}
    </div>
  );
}

function PostPanel({ data }: { data: SurveyData }): JSX.Element {
  const confidenceLift = data[POST_SURVEY_KEYS.CONFIDENCE_LIFT];
  const satisfaction = data[POST_SURVEY_KEYS.SATISFACTION];
  const nps = data[POST_SURVEY_KEYS.NPS];
  const feedback = data[POST_SURVEY_KEYS.FEEDBACK_TEXT];
  const submittedAt = data[POST_SURVEY_KEYS.SUBMITTED_AT];

  return (
    <div className="ss-panel">
      <div className="ss-panel-title">
        Post-Survey
        {submittedAt && <span className="ss-panel-date">completed {formatDate(submittedAt)}</span>}
      </div>

      {confidenceLift != null && (
        <div className="ss-row">
          <span className="ss-label">Confidence lift:</span>
          <Stars value={Number(confidenceLift)} />
        </div>
      )}

      {satisfaction != null && (
        <div className="ss-row">
          <span className="ss-label">Satisfaction:</span>
          <Stars value={Number(satisfaction)} />
        </div>
      )}

      {nps != null && (
        <div className="ss-row">
          <span className="ss-label">NPS:</span>
          <span className="ss-value">{String(nps)}<span className="ss-suffix">/10</span></span>
        </div>
      )}

      {feedback != null && (
        <div className="ss-row">
          <span className="ss-label">Feedback:</span>
          <span className="ss-value-quote">&ldquo;{String(feedback)}&rdquo;</span>
        </div>
      )}
    </div>
  );
}

function MidPanel({ data }: { data: SurveyData }): JSX.Element {
  const progressFeeling = data["progress_feeling"];
  const midSatisfaction = data["mid_satisfaction"];
  const helpNeeded = data["help_needed"];
  const submittedAt = data["submitted_at"];

  const FEELING_LABELS: Record<string, string> = {
    struggling: "Struggling",
    ok: "Getting there",
    good: "Feeling good",
    great: "Loving it",
  };

  return (
    <div className="ss-panel">
      <div className="ss-panel-title">
        Mid-Survey
        {submittedAt && <span className="ss-panel-date">completed {formatDate(submittedAt)}</span>}
      </div>

      {progressFeeling != null && (
        <div className="ss-row">
          <span className="ss-label">Feeling:</span>
          <span className="ss-value">{FEELING_LABELS[String(progressFeeling)] ?? String(progressFeeling)}</span>
        </div>
      )}

      {midSatisfaction != null && (
        <div className="ss-row">
          <span className="ss-label">Satisfaction:</span>
          <Stars value={Number(midSatisfaction)} />
        </div>
      )}

      {helpNeeded != null && (
        <div className="ss-row">
          <span className="ss-label">Needs help with:</span>
          <span className="ss-value-quote">&ldquo;{String(helpNeeded)}&rdquo;</span>
        </div>
      )}
    </div>
  );
}

export function SurveySection({ callerId }: { callerId: string }): JSX.Element {
  const [pre, setPre] = useState<SurveyData | null>(null);
  const [mid, setMid] = useState<SurveyData | null>(null);
  const [post, setPost] = useState<SurveyData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/callers/${callerId}/survey`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          const hasPre = Object.keys(result.pre ?? {}).length > 0;
          const hasMid = Object.keys(result.mid ?? {}).length > 0;
          const hasPost = Object.keys(result.post ?? {}).length > 0;
          setPre(hasPre ? result.pre : null);
          setMid(hasMid ? result.mid : null);
          setPost(hasPost ? result.post : null);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [callerId]);

  if (!loaded) return <></>;

  if (!pre && !mid && !post) {
    return <p className="ss-empty">No survey data yet</p>;
  }

  return (
    <div className="ss-wrap">
      {pre && <PrePanel data={pre} />}
      {mid && <MidPanel data={mid} />}
      {post && <PostPanel data={post} />}
    </div>
  );
}

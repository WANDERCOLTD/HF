"use client";

import { useState, useEffect } from "react";
import { PRE_SURVEY_KEYS, POST_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import "./survey-section.css";

type SurveyData = Record<string, string | number | boolean | null>;

const PRIOR_KNOWLEDGE_LABELS: Record<string, string> = {
  never: "Never studied it",
  little: "Know a little",
  basics: "Know the basics",
  well: "Know it well",
};

const LEARNING_STYLE_LABELS: Record<string, string> = {
  visual: "Visual learner",
  reading: "Reading/writing",
  listening: "Listening",
  doing: "Hands-on / doing",
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

function ScoreBar({ score, label }: { score: number; label?: string }): JSX.Element {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "var(--status-success-text)" : pct >= 40 ? "var(--status-warning-text)" : "var(--status-error-text)";
  return (
    <div className="ss-score-bar">
      {label && <span className="ss-label">{label}</span>}
      <div className="ss-score-track">
        <div className="ss-score-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="ss-score-pct" style={{ color }}>{pct}%</span>
    </div>
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

function PersonalityPanel({ data }: { data: SurveyData }): JSX.Element {
  const submittedAt = data["submitted_at"];

  // Filter out metadata keys to show only actual answers
  const answerEntries = Object.entries(data).filter(
    ([key]) => key !== "submitted_at" && key !== "skipped",
  );

  if (answerEntries.length === 0) return <></>;

  return (
    <div className="ss-panel">
      <div className="ss-panel-title">
        About You
        {submittedAt && <span className="ss-panel-date">completed {formatDate(submittedAt)}</span>}
      </div>

      {answerEntries.map(([key, value]) => {
        if (value == null) return null;
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const displayValue = key === "learning_style"
          ? LEARNING_STYLE_LABELS[String(value)] ?? String(value)
          : typeof value === "number" ? <Stars value={value} /> : String(value);
        return (
          <div key={key} className="ss-row">
            <span className="ss-label">{label}:</span>
            <span className="ss-value">{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}

function TestScorePanel({
  preTest,
  postTest,
}: {
  preTest: SurveyData | null;
  postTest: SurveyData | null;
}): JSX.Element {
  const preScore = preTest?.score != null ? Number(preTest.score) : null;
  const postScore = postTest?.score != null ? Number(postTest.score) : null;
  const upliftAbs = postTest?.uplift_absolute != null ? Number(postTest.uplift_absolute) : null;
  const upliftNorm = postTest?.uplift_normalised != null ? Number(postTest.uplift_normalised) : null;

  if (preScore == null && postScore == null) return <></>;

  return (
    <div className="ss-panel ss-panel-wide">
      <div className="ss-panel-title">Knowledge Assessment</div>

      {preScore != null && (
        <div className="ss-test-row">
          <ScoreBar score={preScore} label="Pre-test:" />
          {preTest?.submitted_at && (
            <span className="ss-panel-date">{formatDate(preTest.submitted_at)}</span>
          )}
        </div>
      )}

      {postScore != null && (
        <div className="ss-test-row">
          <ScoreBar score={postScore} label="Post-test:" />
          {postTest?.submitted_at && (
            <span className="ss-panel-date">{formatDate(postTest.submitted_at)}</span>
          )}
        </div>
      )}

      {preScore != null && postScore != null && upliftAbs != null && (
        <div className="ss-delta">
          <span className="ss-delta-label">Improvement:</span>
          <span className={`ss-delta-value ${upliftAbs > 0 ? "ss-delta-positive" : upliftAbs < 0 ? "ss-delta-negative" : ""}`}>
            {upliftAbs > 0 ? "+" : ""}{Math.round(upliftAbs * 100)}pp
          </span>
          {upliftNorm != null && (
            <span className="ss-delta-norm">
              ({upliftNorm > 0 ? "+" : ""}{upliftNorm}% normalised gain)
            </span>
          )}
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
  const [personality, setPersonality] = useState<SurveyData | null>(null);
  const [preTest, setPreTest] = useState<SurveyData | null>(null);
  const [postTest, setPostTest] = useState<SurveyData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/callers/${callerId}/survey`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          const hasData = (d: Record<string, unknown> | undefined) => Object.keys(d ?? {}).length > 0;
          setPre(hasData(result.pre) ? result.pre : null);
          setMid(hasData(result.mid) ? result.mid : null);
          setPost(hasData(result.post) ? result.post : null);
          setPersonality(hasData(result.personality) ? result.personality : null);
          setPreTest(hasData(result.preTest) ? result.preTest : null);
          setPostTest(hasData(result.postTest) ? result.postTest : null);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [callerId]);

  if (!loaded) return <></>;

  const hasAny = pre || mid || post || personality || preTest || postTest;
  if (!hasAny) {
    return <p className="ss-empty">No survey data yet</p>;
  }

  return (
    <div className="ss-wrap">
      {personality && <PersonalityPanel data={personality} />}
      {pre && <PrePanel data={pre} />}
      <TestScorePanel preTest={preTest} postTest={postTest} />
      {mid && <MidPanel data={mid} />}
      {post && <PostPanel data={post} />}
    </div>
  );
}

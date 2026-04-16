'use client';

type ConfidenceLift = {
  avgPre: number | null;
  avgPost: number | null;
  meanDelta: number | null;
  stdDev: number | null;
  sigma: number | null;
  n: number;
};

type KnowledgeLift = {
  avgPre: number | null;
  avgPost: number | null;
  meanDelta: number | null;
  stdDev: number | null;
  sigma: number | null;
  n: number;
};

type MasteryOverview = {
  avgMastery: number | null;
  completionRate: number | null;
  learnersWithProgress: number;
  stdDev: number | null;
  sigma: number | null;
};

type Engagement = {
  totalCallers: number;
  activeCallers: number;
  avgCallsPerStudent: number;
  totalCalls: number;
};

type Props = {
  confidenceLift: ConfidenceLift;
  knowledgeLift: KnowledgeLift;
  mastery: MasteryOverview;
  engagement: Engagement;
};

function DeltaBadge({ value, suffix = "" }: { value: number | null; suffix?: string }): React.ReactElement | null {
  if (value == null) return null;
  const cls = value > 0 ? "cp-agg-delta--positive"
    : value < 0 ? "cp-agg-delta--negative"
    : "cp-agg-delta--neutral";
  const sign = value > 0 ? "+" : "";
  return <span className={`cp-agg-delta ${cls}`}>{sign}{value.toFixed(1)}{suffix}</span>;
}

export function CohortAggregateCards({ confidenceLift, knowledgeLift, mastery, engagement }: Props): React.ReactElement {
  const activePercent = engagement.totalCallers > 0
    ? Math.round((engagement.activeCallers / engagement.totalCallers) * 100)
    : 0;

  return (
    <div className="cp-agg-strip">
      <div className="hf-card-compact cp-agg-card">
        <div className="cp-agg-label">Avg Mastery</div>
        <div className="cp-agg-value">
          {mastery.avgMastery != null ? `${Math.round(mastery.avgMastery * 100)}%` : '—'}
        </div>
        <div className="cp-agg-sub">
          {mastery.learnersWithProgress} learner{mastery.learnersWithProgress !== 1 ? 's' : ''} with data
        </div>
      </div>

      <div className="hf-card-compact cp-agg-card">
        <div className="cp-agg-label">Confidence Lift</div>
        <div className="cp-agg-value">
          {confidenceLift.meanDelta != null ? (
            <DeltaBadge value={confidenceLift.meanDelta} />
          ) : '—'}
        </div>
        <div className="cp-agg-sub">
          {confidenceLift.n > 0
            ? `n=${confidenceLift.n}${confidenceLift.stdDev != null ? ` σ=${confidenceLift.stdDev.toFixed(1)}` : ''}`
            : 'no surveys yet'}
        </div>
      </div>

      <div className="hf-card-compact cp-agg-card">
        <div className="cp-agg-label">Knowledge Lift</div>
        <div className="cp-agg-value">
          {knowledgeLift.meanDelta != null ? (
            <DeltaBadge value={Math.round(knowledgeLift.meanDelta * 100)} suffix="pp" />
          ) : '—'}
        </div>
        <div className="cp-agg-sub">
          {knowledgeLift.n > 0
            ? `n=${knowledgeLift.n}${knowledgeLift.stdDev != null ? ` σ=${(knowledgeLift.stdDev * 100).toFixed(0)}` : ''}`
            : 'no tests yet'}
        </div>
      </div>

      <div className="hf-card-compact cp-agg-card">
        <div className="cp-agg-label">Engagement</div>
        <div className="cp-agg-value">{activePercent}%</div>
        <div className="cp-agg-sub">
          {engagement.activeCallers}/{engagement.totalCallers} active · {engagement.avgCallsPerStudent.toFixed(1)} calls/student
        </div>
      </div>
    </div>
  );
}

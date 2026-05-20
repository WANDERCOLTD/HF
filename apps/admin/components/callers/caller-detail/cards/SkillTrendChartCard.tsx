"use client";

/**
 * SkillTrendChartCard — multi-line chart of per-skill EMA across calls.
 *
 * Lives on the Uplift tab. Shows the four IELTS criteria (or whichever
 * skill_* parameters have history) trending over the caller's calls.
 * A horizontal reference line marks the target value (from CallerTarget)
 * so educators see how close each criterion is to its target.
 *
 * Self-contained SVG renderer — no external chart dependency. Uses CSS
 * variables for colours so dark/light theming works out of the box.
 *
 * Issue: per-learner UI follow-up to #564 / #575 — completes the
 * "data points MOVING" story.
 */

type ScoreLite = {
  callId: string;
  parameterId: string;
  score: number;
  scoredAt?: string | Date;
  createdAt?: string | Date;
  parameter?: { parameterId?: string; name?: string | null } | null;
};

type TargetLite = {
  parameterId: string;
  targetValue: number | null;
  currentScore: number | null;
};

interface SkillTrendChartCardProps {
  scores: ScoreLite[];
  callerTargets: TargetLite[];
}

const SKILL_COLOR_PALETTE = [
  "var(--accent-primary)",
  "var(--status-success-text)",
  "var(--status-warning-text)",
  "var(--status-info-text)",
  "var(--status-error-text)",
];

function skillName(parameterId: string): string {
  return parameterId
    .replace(/^skill_/i, "")
    .replace(/_(fc|lr|gra|p|a1|a2|b1|b2|c1|c2|band\d+)$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function skillSuffix(parameterId: string): string {
  const m = parameterId.match(/_([a-z0-9]+)$/i);
  return m ? m[1].toUpperCase() : "";
}

export function SkillTrendChartCard({ scores, callerTargets }: SkillTrendChartCardProps) {
  const skillScores = (scores ?? []).filter((s) => {
    const id = (s.parameter?.parameterId ?? s.parameterId ?? "").toLowerCase();
    return id.startsWith("skill_");
  });
  if (skillScores.length < 2) return null;

  // Group by parameterId, sort by date ascending.
  const grouped = new Map<string, Array<{ score: number; date: number }>>();
  for (const s of skillScores) {
    const key = s.parameter?.parameterId ?? s.parameterId;
    const date = new Date(s.scoredAt ?? s.createdAt ?? 0).getTime();
    const list = grouped.get(key) ?? [];
    list.push({ score: s.score, date });
    grouped.set(key, list);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => a.date - b.date);

  // Keep only parameters with at least 2 data points — single dots aren't
  // a trend.
  for (const [key, arr] of Array.from(grouped.entries())) {
    if (arr.length < 2) grouped.delete(key);
  }
  if (grouped.size === 0) return null;

  // Build a unified call sequence X-axis. Use insertion order from the
  // earliest skill's data (most calls).
  const allDates = Array.from(
    new Set(
      Array.from(grouped.values())
        .flatMap((arr) => arr.map((p) => p.date)),
    ),
  ).sort((a, b) => a - b);

  // Chart geometry.
  const W = 640;
  const H = 220;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xForIndex = (i: number, n: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yForScore = (s: number) => padT + (1 - s) * plotH;

  // Y-axis gridlines at 0.25 increments.
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, y: yForScore(v) }));

  const targetByParam = new Map<string, number>();
  for (const t of callerTargets ?? []) {
    if (typeof t.targetValue === "number") targetByParam.set(t.parameterId, t.targetValue);
  }

  // First non-null target is treated as the cohort line (educator usually
  // sets one global target band per playbook).
  const cohortTarget = Array.from(targetByParam.values())[0] ?? null;

  const series = Array.from(grouped.entries()).map(([parameterId, arr], idx) => ({
    parameterId,
    name: skillName(parameterId),
    suffix: skillSuffix(parameterId),
    color: SKILL_COLOR_PALETTE[idx % SKILL_COLOR_PALETTE.length],
    points: arr,
    target: targetByParam.get(parameterId) ?? null,
  }));

  return (
    <div className="hf-card">
      <div className="hf-section-title">Skill trends</div>
      <div className="hf-section-desc">
        Per-call score history across {allDates.length} call{allDates.length === 1 ? "" : "s"}. Higher is better; the dashed line marks the target.
      </div>
      <div className="skill-trend-chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Per-skill score trends across calls"
          width="100%"
          height={H}
        >
          {/* Y-axis gridlines + labels */}
          {gridLines.map(({ v, y }) => (
            <g key={v}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke="var(--border-default)"
                strokeDasharray={v === 0 || v === 1 ? "0" : "2,4"}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          ))}

          {/* Cohort target line */}
          {cohortTarget !== null && (
            <line
              x1={padL}
              x2={W - padR}
              y1={yForScore(cohortTarget)}
              y2={yForScore(cohortTarget)}
              stroke="var(--status-success-text)"
              strokeDasharray="4,4"
              strokeWidth="1.5"
              opacity="0.7"
            />
          )}

          {/* Per-skill series */}
          {series.map((s) => {
            const pts = s.points
              .map((p, i) => {
                const callIndex = allDates.indexOf(p.date);
                const x = xForIndex(callIndex, allDates.length);
                const y = yForScore(p.score);
                return `${x},${y}`;
              })
              .join(" ");
            return (
              <g key={s.parameterId}>
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {s.points.map((p, i) => {
                  const callIndex = allDates.indexOf(p.date);
                  return (
                    <circle
                      key={i}
                      cx={xForIndex(callIndex, allDates.length)}
                      cy={yForScore(p.score)}
                      r="3"
                      fill={s.color}
                    >
                      <title>
                        {s.name} {s.suffix} — Call {callIndex + 1}: {(p.score * 100).toFixed(0)}%
                      </title>
                    </circle>
                  );
                })}
              </g>
            );
          })}

          {/* X-axis call labels */}
          {allDates.map((d, i) => (
            <text
              key={d}
              x={xForIndex(i, allDates.length)}
              y={H - padB + 16}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-muted)"
            >
              #{i + 1}
            </text>
          ))}
        </svg>

        {/* Legend */}
        <div className="skill-trend-legend">
          {series.map((s) => (
            <span key={s.parameterId} className="skill-trend-legend-item">
              <span
                className="skill-trend-legend-swatch"
                style={{ background: s.color }}
                aria-hidden
              />
              <span>
                {s.name} {s.suffix && <span className="skill-band-tile-suffix">{s.suffix}</span>}
              </span>
            </span>
          ))}
          {cohortTarget !== null && (
            <span className="skill-trend-legend-item">
              <span className="skill-trend-legend-swatch skill-trend-legend-swatch--dashed" aria-hidden />
              <span>Target ({(cohortTarget * 100).toFixed(0)}%)</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

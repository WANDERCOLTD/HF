import { BAND_MAX, bandColorVar } from "@/lib/band";

/**
 * A single IELTS-criterion bar. Abstracted from the prototype's inline
 * ScoreBar — now a reusable, token-driven presentational component.
 */
export function ScoreBar({
  label,
  score,
  max = BAND_MAX,
}: {
  label: string;
  score: number;
  max?: number;
}) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color = bandColorVar(score);
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
          fontSize: 13,
          color: "var(--text-secondary)",
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 700, color }}>{score.toFixed(1)}</span>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--border-default)",
          borderRadius: 3,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 3,
            transition: "width 0.8s ease",
          }}
        />
      </div>
    </div>
  );
}

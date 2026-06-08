import { chartPoints } from "@/lib/band";

/**
 * Sparkline of band scores over time. Abstracted from the prototype's inline
 * MiniChart; the points maths now lives in lib/band.ts (unit-tested).
 */
export function MiniChart({
  data,
  height = 60,
  color = "var(--band-high)",
}: {
  data: number[];
  height?: number;
  color?: string;
}) {
  if (!data || data.length < 2) return null;
  const points = chartPoints(data);
  const min = Math.min(...data) - 0.5;
  const max = Math.max(...data) + 0.5;
  const range = max - min || 1;
  const step = 100 / (data.length - 1);
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: "100%", height, display: "block" }}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      {data.map((v, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={100 - ((v - min) / range) * 100}
          r="3"
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

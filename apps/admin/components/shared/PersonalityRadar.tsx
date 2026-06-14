"use client";

// =====================================================
// PersonalityRadar — Custom SVG radar/spider chart
// for displaying personality profiles (Big Five, VARK, etc.)
// Two modes: hero (280px, labels + grid) and compact (56px, shape only)
// =====================================================

import { useIsOperatorOrAbove } from "@/hooks/useIsOperatorOrAbove";

export interface RadarTrait {
  id: string;           // e.g., "B5-O"
  label: string;        // e.g., "Openness"
  value: number;        // 0-1 scale
  color: string;        // hex color
  interpretationHigh?: string;
  interpretationLow?: string;
}

export interface PersonalityRadarProps {
  /** Trait data points to plot */
  traits: RadarTrait[];
  /** Optional second series for overlay (e.g., target values) */
  targetTraits?: RadarTrait[];
  /** Overall size in pixels (default 280) */
  size?: number;
  /** Compact mode for table thumbnails (no labels, no grid detail) */
  compact?: boolean;
  /** Animate on mount (default true) */
  animated?: boolean;
}

// --- Geometry helpers ---

const START_ANGLE = -Math.PI / 2; // 12 o'clock

function traitToPoint(
  index: number,
  value: number,
  total: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const angle = START_ANGLE + (index * 2 * Math.PI) / total;
  return {
    x: cx + Math.cos(angle) * radius * value,
    y: cy + Math.sin(angle) * radius * value,
  };
}

function pointsToString(points: { x: number; y: number }[]): string {
  return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function getLabelAnchor(index: number, total: number): "start" | "middle" | "end" {
  const angle = START_ANGLE + (index * 2 * Math.PI) / total;
  const deg = ((angle * 180) / Math.PI + 360) % 360;
  // Top and bottom → center; left half → end; right half → start
  if (deg > 80 && deg < 100) return "middle";   // bottom
  if (deg > 260 && deg < 280) return "middle";   // top
  if (deg >= 100 && deg <= 260) return "end";     // left half
  return "start";
}

function getLabelDY(index: number, total: number): number {
  const angle = START_ANGLE + (index * 2 * Math.PI) / total;
  const deg = ((angle * 180) / Math.PI + 360) % 360;
  // Top labels → shift up; bottom labels → shift down; sides → center vertically
  if (deg > 250 && deg < 290) return -6;  // top
  if (deg > 70 && deg < 110) return 14;   // bottom
  return 4;
}

// --- Component ---

export function PersonalityRadar({
  traits,
  targetTraits,
  size: sizeProp,
  compact = false,
  animated = true,
}: PersonalityRadarProps) {
  // #1664 Decision 5 — interpretation strings are OPERATOR-only. The
  // radar tooltip suppresses interpretationHigh/Low text for
  // STUDENT-level sessions; numeric value + label still render.
  const operatorOrBetter = useIsOperatorOrAbove();
  const n = traits.length;
  if (n < 3) return null;

  const size = sizeProp ?? (compact ? 56 : 280);
  const labelPadding = compact ? 4 : 44;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - labelPadding;

  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  // Pre-compute data points
  const dataPoints = traits.map((t, i) => traitToPoint(i, t.value, n, cx, cy, radius));
  const axisEndpoints = traits.map((_, i) => traitToPoint(i, 1.0, n, cx, cy, radius));

  // Polygon fill color — use first trait color as base
  const fillColor = traits[0]?.color || "var(--accent-primary)";

  // --- Compact mode: shape silhouette only ---
  if (compact) {
    const outerRing = axisEndpoints;
    return (
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ display: "block" }}
        role="img"
        aria-label="Personality profile"
      >
        {/* Outer ring */}
        <polygon
          points={pointsToString(outerRing)}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={0.5}
        />
        {/* Data polygon */}
        <polygon
          points={pointsToString(dataPoints)}
          fill={fillColor}
          fillOpacity={0.15}
          stroke={fillColor}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {/* Vertex dots */}
        {dataPoints.map((pt, i) => (
          <circle
            key={traits[i].id}
            cx={pt.x}
            cy={pt.y}
            r={2}
            fill={traits[i].color}
          />
        ))}
      </svg>
    );
  }

  // --- Hero mode ---

  // Target series points (optional)
  const targetPoints = targetTraits?.map((t, i) =>
    traitToPoint(i, t.value, n, cx, cy, radius)
  );

  // Label positions — outside the 100% ring
  const labelOffset = 16;
  const labelPoints = traits.map((_, i) => {
    const angle = START_ANGLE + (i * 2 * Math.PI) / n;
    return {
      x: cx + Math.cos(angle) * (radius + labelOffset),
      y: cy + Math.sin(angle) * (radius + labelOffset),
    };
  });

  // Value label positions — just outside each data point
  const valueOffset = 14;
  const valuePoints = traits.map((t, i) => {
    const angle = START_ANGLE + (i * 2 * Math.PI) / n;
    const r = Math.max(radius * t.value + valueOffset, valueOffset + 4);
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: size, display: "block" }}
      role="img"
      aria-label={`Personality radar chart: ${traits.map(t => `${t.label} ${(t.value * 100).toFixed(0)}%`).join(", ")}`}
    >
      {/* Layer 1: Grid rings */}
      {ringLevels.map(level => {
        const ringPts = traits.map((_, i) =>
          traitToPoint(i, level, n, cx, cy, radius)
        );
        const is50 = level === 0.5;
        return (
          <polygon
            key={`ring-${level}`}
            points={pointsToString(ringPts)}
            fill="none"
            stroke={is50 ? "var(--border-default)" : "var(--border-subtle)"}
            strokeWidth={is50 ? 1 : 0.5}
            opacity={is50 ? 0.6 : 0.4}
          />
        );
      })}

      {/* Layer 2: Axis lines */}
      {axisEndpoints.map((pt, i) => (
        <line
          key={`axis-${i}`}
          x1={cx}
          y1={cy}
          x2={pt.x}
          y2={pt.y}
          stroke="var(--border-subtle)"
          strokeWidth={0.5}
          opacity={0.4}
        />
      ))}

      {/* Layer 3: Target polygon (optional) */}
      {targetPoints && (
        <polygon
          points={pointsToString(targetPoints)}
          fill="none"
          stroke="var(--text-placeholder)"
          strokeWidth={1.5}
          strokeDasharray="4,4"
          strokeLinejoin="round"
          opacity={0.6}
        />
      )}

      {/* Layer 4-5: Data polygon + vertex dots (animated group) */}
      <g
        className={animated ? "hf-radar-enter" : undefined}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        {/* Fill polygon */}
        <polygon
          points={pointsToString(dataPoints)}
          fill={fillColor}
          fillOpacity={0.12}
          stroke="none"
        />

        {/* Per-edge colored strokes */}
        {dataPoints.map((pt, i) => {
          const next = dataPoints[(i + 1) % n];
          return (
            <line
              key={`edge-${i}`}
              x1={pt.x}
              y1={pt.y}
              x2={next.x}
              y2={next.y}
              stroke={traits[i].color}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.85}
            />
          );
        })}

        {/* Vertex dots */}
        {dataPoints.map((pt, i) => (
          <circle
            key={`dot-${traits[i].id}`}
            cx={pt.x}
            cy={pt.y}
            r={4}
            fill={traits[i].color}
            stroke="var(--surface-primary)"
            strokeWidth={2}
          >
            <title>
              {traits[i].label}: {(traits[i].value * 100).toFixed(0)}%
              {operatorOrBetter &&
              traits[i].interpretationHigh &&
              traits[i].value >= 0.6
                ? `\n${traits[i].interpretationHigh}`
                : ""}
              {operatorOrBetter &&
              traits[i].interpretationLow &&
              traits[i].value < 0.4
                ? `\n${traits[i].interpretationLow}`
                : ""}
            </title>
          </circle>
        ))}
      </g>

      {/* Layer 6: Value labels */}
      {traits.map((t, i) => (
        <text
          key={`val-${t.id}`}
          x={valuePoints[i].x}
          y={valuePoints[i].y}
          textAnchor={getLabelAnchor(i, n)}
          dy={getLabelDY(i, n)}
          fontSize={11}
          fontWeight={600}
          fontFamily="monospace"
          fill="var(--text-secondary)"
        >
          {(t.value * 100).toFixed(0)}
        </text>
      ))}

      {/* Layer 7: Axis labels */}
      {traits.map((t, i) => (
        <text
          key={`label-${t.id}`}
          x={labelPoints[i].x}
          y={labelPoints[i].y}
          textAnchor={getLabelAnchor(i, n)}
          dy={getLabelDY(i, n)}
          fontSize={12}
          fontWeight={500}
          fill="var(--text-muted)"
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
}

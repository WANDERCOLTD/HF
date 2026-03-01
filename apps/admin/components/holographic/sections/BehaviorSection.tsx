"use client";

/**
 * Behavior Section — Agent communication style, teaching approach, matrix positions.
 * Shows how the agent is tuned to communicate and teach.
 */

import { useHolo } from "@/hooks/useHolographicState";
import { Sliders, ArrowUpRight, MessageCircle, GraduationCap } from "lucide-react";
import Link from "next/link";
import {
  AGENT_TUNING_DEFAULTS,
  type MatrixDef,
  type MatrixPreset,
} from "@/lib/domain/agent-tuning";

interface MatrixPos {
  x: number;
  y: number;
}

/** Find the nearest preset to a given position (Euclidean distance). */
function nearestPreset(
  matrix: MatrixDef,
  pos: MatrixPos,
): MatrixPreset | null {
  let best: MatrixPreset | null = null;
  let bestDist = Infinity;
  for (const preset of matrix.presets) {
    const dx = preset.x - pos.x;
    const dy = preset.y - pos.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return best;
}

const MATRIX_ICONS: Record<string, React.ReactNode> = {
  "communication-style": <MessageCircle size={15} />,
  "teaching-approach": <GraduationCap size={15} />,
};

export function BehaviorSection() {
  const { state } = useHolo();
  const domain = state.domainDetail as Record<string, any> | null;

  if (!domain) {
    return <div className="hp-section-empty">No domain data loaded.</div>;
  }

  const targets = domain.onboardingDefaultTargets as Record<string, any> | null;
  const matrixPositions = targets?._matrixPositions as
    | Record<string, MatrixPos>
    | undefined;
  const teachingMode = (domain.playbooks?.[0]?.config as any)?.teachingMode as
    | string
    | undefined;

  const hasPositions = matrixPositions && Object.keys(matrixPositions).length > 0;

  if (!hasPositions && !teachingMode) {
    return (
      <div className="hp-section-empty">
        <Sliders size={24} className="hp-section-empty-icon" />
        <div>No behavior tuning configured.</div>
        <div className="hp-section-empty-hint">
          Set up agent communication and teaching style on the Domains page or
          via Quick Launch.
        </div>
      </div>
    );
  }

  return (
    <div className="hp-section-behavior">
      {/* Matrix blocks */}
      {AGENT_TUNING_DEFAULTS.matrices.map((matrix) => {
        const pos = matrixPositions?.[matrix.id];
        if (!pos) return null;

        const preset = nearestPreset(matrix, pos);

        return (
          <div key={matrix.id} className="hp-behavior-matrix">
            <div className="hp-behavior-matrix-header">
              {MATRIX_ICONS[matrix.id] || <Sliders size={15} />}
              <span>{matrix.name}</span>
            </div>

            <div className="hp-behavior-axes">
              {/* X axis */}
              <div className="hp-behavior-bar">
                <span className="hp-behavior-bar-label">
                  {matrix.xAxis.label}
                </span>
                <div className="hp-behavior-bar-track">
                  <div
                    className="hp-behavior-bar-fill"
                    style={{ width: `${Math.round(pos.x * 100)}%` }}
                  />
                </div>
                <span className="hp-behavior-bar-value">
                  {pos.x.toFixed(1)}
                </span>
              </div>

              {/* Y axis */}
              <div className="hp-behavior-bar">
                <span className="hp-behavior-bar-label">
                  {matrix.yAxis.label}
                </span>
                <div className="hp-behavior-bar-track">
                  <div
                    className="hp-behavior-bar-fill"
                    style={{ width: `${Math.round(pos.y * 100)}%` }}
                  />
                </div>
                <span className="hp-behavior-bar-value">
                  {pos.y.toFixed(1)}
                </span>
              </div>
            </div>

            {preset && (
              <div className="hp-behavior-preset">
                Nearest: {preset.name}
                {preset.traits.length > 0 && (
                  <span className="hp-behavior-traits">
                    {preset.traits.join(" · ")}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Teaching mode */}
      {teachingMode && (
        <div className="hp-behavior-mode">
          <span className="hp-behavior-mode-label">Teaching Mode</span>
          <span className="hp-behavior-mode-value">{teachingMode}</span>
        </div>
      )}

      {/* Edit link */}
      <Link
        href={`/x/domains?id=${state.id}&tab=onboarding`}
        className="hp-section-link"
      >
        Configure
        <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Award, AlertTriangle, Info } from "lucide-react";

import {
  ABOVE_TARGET,
  AWAITING_EVIDENCE,
  TierCell,
} from "@/components/shared/TierCell";
import { tierLabel } from "@/lib/banding/tier-colors";

import "./course-skills-tab.css";

/**
 * Course Detail → Skills Framework tab (`?tab=skills&v=3`).
 *
 * Sprint 2 SP2-B — Framework Map lens as the default landing.
 *
 * The educator sees the structural rubric they authored:
 *   - Each row = one skill (SKILL-01 … SKILL-NN)
 *   - Each cell = one tier in that skill's `tierScheme`
 *   - Target tier carries the ★ marker
 *   - Click a skill row → inline expand tier descriptors
 *
 * Subsequent lenses (Cohort Heatmap, Rubric Calibration, Source Lineage,
 * Mastery vs Skill explainer, Single Learner Drill) sit alongside as a
 * lens registry — registered locally for now, migrating to S4's
 * PREVIEW_RENDERERS registry when that ships.
 */

interface SkillsFrameworkSkill {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  description: string | null;
  targetValue: number;
  tierScheme: string[];
  tiers: Record<string, string>;
  bandThresholds: Record<string, string> | null;
}

interface SkillsFrameworkResponse {
  courseId: string;
  playbookStatus: string;
  skills: SkillsFrameworkSkill[];
  empty: boolean;
}

interface Props {
  courseId: string;
}

export function CourseSkillsTab({ courseId }: Props) {
  const [data, setData] = useState<SkillsFrameworkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkillRef, setExpandedSkillRef] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/skills-framework`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((payload: SkillsFrameworkResponse) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading) {
    return (
      <div className="hf-skills-loading" role="status" aria-live="polite">
        Loading Skills Framework…
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-skills-error hf-banner-error" role="alert">
        <AlertTriangle size={16} />
        <div>
          <strong>Could not load the Skills Framework.</strong>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="hf-skills-tab">
      <header className="hf-skills-tab-header">
        <h2 className="hf-section-title">
          <Award size={18} aria-hidden /> Skills Framework
        </h2>
        <p className="hf-section-desc">
          The structural rubric this course measures learners against.
          Each row is a Skill; each cell is a Tier in that skill's scheme.
          The educator's target tier carries a ★ marker.
        </p>
        {data.playbookStatus === "DRAFT" ? (
          <div className="hf-skills-draft-watermark" aria-label="Course is in draft mode">
            DRAFT
          </div>
        ) : null}
      </header>

      {data.empty ? (
        <EmptyState />
      ) : (
        <FrameworkMapLens
          skills={data.skills}
          expandedSkillRef={expandedSkillRef}
          onToggleSkill={(skillRef) =>
            setExpandedSkillRef((prev) => (prev === skillRef ? null : skillRef))
          }
        />
      )}

      <Legend />
    </div>
  );
}

// ── Framework Map lens ──────────────────────────────────────────────────────

function FrameworkMapLens({
  skills,
  expandedSkillRef,
  onToggleSkill,
}: {
  skills: SkillsFrameworkSkill[];
  expandedSkillRef: string | null;
  onToggleSkill: (skillRef: string) => void;
}) {
  return (
    <div className="hf-skills-map">
      {skills.map((skill) => {
        const targetTier =
          tierForTargetValue(skill.tierScheme, skill.targetValue) ??
          skill.tierScheme[skill.tierScheme.length - 1];
        const expanded = expandedSkillRef === skill.skillRef;

        return (
          <div key={skill.skillRef} className="hf-skill-row">
            <button
              type="button"
              className="hf-skill-row-header"
              onClick={() => onToggleSkill(skill.skillRef)}
              aria-expanded={expanded}
              aria-controls={`hf-skill-${skill.skillRef}-detail`}
            >
              <span className="hf-skill-row-ref">{skill.skillRef}</span>
              <span className="hf-skill-row-name">{skill.parameterName}</span>
              <span className="hf-skill-row-target">
                Target: {tierLabel(targetTier)}
                {" · "}
                {(skill.targetValue * 10).toFixed(1)}
              </span>
              <span className="hf-skill-row-chevron" aria-hidden>
                {expanded ? "▾" : "▸"}
              </span>
            </button>

            <div className="hf-skill-row-tiers">
              {skill.tierScheme.map((tier) => (
                <TierCell
                  key={tier}
                  tier={tier}
                  target={tier === targetTier}
                  caption={tierLabel(tier)}
                  size="default"
                />
              ))}
              <TierCell
                tier={AWAITING_EVIDENCE}
                caption="No data"
                size="compact"
              />
              <TierCell
                tier={ABOVE_TARGET}
                caption="Exceeds"
                size="compact"
              />
            </div>

            {expanded ? (
              <div
                id={`hf-skill-${skill.skillRef}-detail`}
                className="hf-skill-detail"
              >
                {skill.description ? (
                  <p className="hf-skill-description">{skill.description}</p>
                ) : null}
                {skill.tierScheme.map((tier) => (
                  <div
                    key={`${skill.skillRef}-${tier}-detail`}
                    className={`hf-skill-detail-row ${
                      tier === targetTier ? "hf-skill-detail-row--target" : ""
                    }`}
                  >
                    <TierCell tier={tier} target={tier === targetTier} size="compact" />
                    <strong className="hf-skill-detail-tier">{tierLabel(tier)}</strong>
                    <span className="hf-skill-detail-text">
                      {skill.tiers[tier] ?? (
                        <em className="hf-skill-detail-empty">
                          (no descriptors yet — add to course-ref)
                        </em>
                      )}
                    </span>
                  </div>
                ))}
                {skill.bandThresholds &&
                Object.keys(skill.bandThresholds).length > 0 ? (
                  <div className="hf-skill-detail-bands">
                    <div className="hf-skill-detail-bands-title">Per-band descriptors</div>
                    {Object.entries(skill.bandThresholds)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .map(([band, text]) => (
                        <div key={band} className="hf-skill-detail-band">
                          <strong>Band {band}</strong> {text}
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tierForTargetValue(
  scheme: string[],
  targetValue: number,
): string | null {
  // targetValue is normalized 0-1. Map proportionally onto the scheme so the
  // educator's "Band 7" → "Practitioner" in a 4-tier rubric works without
  // hardcoded band tables. Last tier wins for targetValue >= 1.0.
  if (scheme.length === 0) return null;
  const idx = Math.min(
    Math.floor(targetValue * scheme.length),
    scheme.length - 1,
  );
  return scheme[idx];
}

function EmptyState() {
  return (
    <div className="hf-skills-empty">
      <Info size={20} aria-hidden />
      <div>
        <strong>No skills declared for this course yet.</strong>
        <p>
          Upload a course-ref doc with a <code>## Skills Framework</code>{" "}
          section to mint the rubric. The wizard&apos;s{" "}
          <strong>PROJECTION_NO_SKILLS_FRAMEWORK</strong> launch blocker
          prevents publishing until at least one skill is declared.
        </p>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <footer className="hf-skills-legend" aria-label="Tier colour key">
      <span className="hf-skills-legend-title">Key</span>
      <TierCell tier={AWAITING_EVIDENCE} caption="Awaiting" size="compact" />
      <TierCell tier="emerging" caption="Emerging" size="compact" />
      <TierCell tier="developing" caption="Developing" size="compact" />
      <TierCell tier="secure" caption="Secure" size="compact" />
      <TierCell tier={ABOVE_TARGET} caption="Above target" size="compact" />
      <span className="hf-skills-legend-note">
        ★ = the tier the educator targets · cold → hot, left to right
      </span>
    </footer>
  );
}

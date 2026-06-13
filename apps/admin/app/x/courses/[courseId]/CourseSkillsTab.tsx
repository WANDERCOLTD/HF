"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  AlertTriangle,
  Info,
  Grid3X3,
  Users,
  Sliders,
} from "lucide-react";

import {
  ABOVE_TARGET,
  AWAITING_EVIDENCE,
  TierCell,
} from "@/components/shared/TierCell";
import { tierLabel } from "@/lib/banding/tier-colors";
import { CascadeValue } from "@/components/shared/CascadeValue";
import { CascadeInspectorTray } from "@/components/cascade/CascadeInspectorTray";
import { BandingPicker } from "@/components/shared/BandingPicker";
import { VariantPresetPill } from "@/components/shared/VariantPresetPill";
import type { Effective } from "@/lib/cascade/layer-types";

import "./course-skills-tab.css";

type LensId = "framework-map" | "cohort-heatmap" | "rubric-calibration";

interface LensSpec {
  id: LensId;
  label: string;
  icon: React.ReactNode;
  blurb: string;
}

const LENSES: LensSpec[] = [
  {
    id: "framework-map",
    label: "Framework Map",
    icon: <Grid3X3 size={14} />,
    blurb: "The structural rubric — Skills × Tiers grid.",
  },
  {
    id: "cohort-heatmap",
    label: "Cohort Heatmap",
    icon: <Users size={14} />,
    blurb: "Where the cohort sits — per-skill × per-tier learner count.",
  },
  {
    id: "rubric-calibration",
    label: "Rubric Calibration",
    icon: <Sliders size={14} />,
    blurb: "What the AI tutor reads — per-skill MEASURE prompt + tuning knobs.",
  },
];

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
  const [activeLens, setActiveLens] = useState<LensId>("framework-map");

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
          Each row is a Skill; each cell is a Tier in that skill&apos;s scheme.
          The educator&apos;s target tier carries a ★ marker.
        </p>
        {data.playbookStatus === "DRAFT" ? (
          <div className="hf-skills-draft-watermark" aria-label="Course is in draft mode">
            DRAFT
          </div>
        ) : null}
      </header>

      <LensSwitcher active={activeLens} onChange={setActiveLens} />

      {data.empty ? (
        <EmptyState />
      ) : activeLens === "framework-map" ? (
        <FrameworkMapLens
          skills={data.skills}
          expandedSkillRef={expandedSkillRef}
          onToggleSkill={(skillRef) =>
            setExpandedSkillRef((prev) => (prev === skillRef ? null : skillRef))
          }
        />
      ) : activeLens === "cohort-heatmap" ? (
        <CohortHeatmapLens courseId={courseId} />
      ) : (
        <RubricCalibrationLens courseId={courseId} />
      )}

      <Legend />
    </div>
  );
}

// ── Lens switcher ───────────────────────────────────────────────────────────

function LensSwitcher({
  active,
  onChange,
}: {
  active: LensId;
  onChange: (id: LensId) => void;
}) {
  const activeSpec = LENSES.find((l) => l.id === active);
  return (
    <div className="hf-skills-lens-switcher" role="tablist" aria-label="Skills Framework lens">
      {LENSES.map((lens) => (
        <button
          key={lens.id}
          type="button"
          role="tab"
          aria-selected={active === lens.id}
          className={`hf-skills-lens-tab ${
            active === lens.id ? "hf-skills-lens-tab--active" : ""
          }`}
          onClick={() => onChange(lens.id)}
        >
          {lens.icon}
          <span>{lens.label}</span>
        </button>
      ))}
      {activeSpec ? (
        <span className="hf-skills-lens-blurb">{activeSpec.blurb}</span>
      ) : null}
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

// ── Cohort Heatmap lens (SP2-D) ─────────────────────────────────────────────

interface CohortHeatmapRow {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  tierScheme: string[];
  targetTier: string | null;
  targetValue: number;
  buckets: Record<string, number>;
}

interface CohortHeatmapResponse {
  courseId: string;
  totalLearners: number;
  rows: CohortHeatmapRow[];
  empty: boolean;
}

function CohortHeatmapLens({ courseId }: { courseId: string }) {
  const [data, setData] = useState<CohortHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/skills-cohort-heatmap`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((payload: CohortHeatmapResponse) => {
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
        Loading cohort heatmap…
      </div>
    );
  }
  if (error) {
    return (
      <div className="hf-skills-error hf-banner-error" role="alert">
        <AlertTriangle size={16} />
        <div>
          <strong>Could not load the Cohort Heatmap.</strong>
          <div>{error}</div>
        </div>
      </div>
    );
  }
  if (!data) return null;

  if (data.empty) {
    return <EmptyState />;
  }

  if (data.totalLearners === 0) {
    return (
      <div className="hf-skills-empty">
        <Info size={20} aria-hidden />
        <div>
          <strong>No learners enrolled on this course yet.</strong>
          <p>
            Once learners enrol, this lens shows their distribution across
            each skill&apos;s tiers — cold→hot, same colours as the
            Framework Map and the per-learner Attainment view.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-skills-cohort">
      <div className="hf-skills-cohort-meta">
        Cohort: <strong>{data.totalLearners}</strong> learners enrolled
      </div>
      {data.rows.map((row) => (
        <CohortHeatmapRowView
          key={row.skillRef}
          row={row}
          totalLearners={data.totalLearners}
        />
      ))}
    </div>
  );
}

function CohortHeatmapRowView({
  row,
  totalLearners,
}: {
  row: CohortHeatmapRow;
  totalLearners: number;
}) {
  // Ordered render: AWAITING, scheme[0..n], ABOVE_TARGET
  const orderedTiers = useMemo(() => {
    const out: string[] = [AWAITING_EVIDENCE, ...row.tierScheme, ABOVE_TARGET];
    return out;
  }, [row.tierScheme]);

  return (
    <div className="hf-cohort-row">
      <div className="hf-cohort-row-meta">
        <span className="hf-skill-row-ref">{row.skillRef}</span>
        <span className="hf-skill-row-name">{row.parameterName}</span>
        <span className="hf-skill-row-target">
          Target:{" "}
          {row.targetTier ? tierLabel(row.targetTier) : "—"} · {(row.targetValue * 10).toFixed(1)}
        </span>
      </div>
      <div className="hf-cohort-row-cells">
        {orderedTiers.map((tier) => {
          const count = row.buckets[tier] ?? 0;
          const pct = totalLearners > 0 ? Math.round((count / totalLearners) * 100) : 0;
          return (
            <TierCell
              key={`${row.skillRef}-${tier}`}
              tier={tier}
              target={tier === row.targetTier}
              caption={`${count} · ${pct}%`}
              size="default"
            >
              {count}
            </TierCell>
          );
        })}
      </div>
    </div>
  );
}

// ── Rubric Calibration lens (SP3-A) ─────────────────────────────────────────

interface RubricCalibrationAction {
  description: string;
  parameterId: string;
  weight: number;
}

interface RubricCalibrationMeasure {
  triggerName: string;
  given: string;
  when: string;
  then: string;
  actions: RubricCalibrationAction[];
}

interface RubricCalibrationSkill {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  description: string | null;
  targetValue: number;
  tierScheme: string[];
  tiers: Record<string, string>;
  bandThresholds: Record<string, string> | null;
  measure: RubricCalibrationMeasure | null;
}

interface RubricCalibrationMasteryPolicyChip {
  knobKey: "skillTierMapping" | "skillScoringEmaHalfLifeDays";
  envelope: Effective<unknown>;
}

interface RubricCalibrationVariantPreset {
  useFreshMastery: boolean | null;
  maxMasteryTier: string | null;
  scoringMode: string | null;
}

interface RubricCalibrationResponse {
  courseId: string;
  playbookStatus: string;
  measureSpecSlug: string | null;
  skills: RubricCalibrationSkill[];
  masteryPolicyChips: RubricCalibrationMasteryPolicyChip[];
  variantPreset: RubricCalibrationVariantPreset;
  empty: boolean;
}

const MASTERY_CHIP_LABELS: Record<
  RubricCalibrationMasteryPolicyChip["knobKey"],
  string
> = {
  skillTierMapping: "Tier mapping",
  skillScoringEmaHalfLifeDays: "EMA half-life",
};

function fmtMasteryChipValue(
  knobKey: RubricCalibrationMasteryPolicyChip["knobKey"],
  value: unknown,
): string {
  if (value === null || value === undefined) return "— default";
  if (knobKey === "skillScoringEmaHalfLifeDays") {
    if (typeof value === "number") return `${value} day${value === 1 ? "" : "s"}`;
    return String(value);
  }
  // skillTierMapping is a complex object — surface a structural summary.
  if (typeof value === "object" && value !== null && "thresholds" in value) {
    return "custom mapping";
  }
  return "custom";
}

function RubricCalibrationLens({ courseId }: { courseId: string }) {
  const [data, setData] = useState<RubricCalibrationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkillRef, setExpandedSkillRef] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<{
    knobKey: string;
    knobLabel: string;
  } | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/skills-rubric-calibration`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((payload: RubricCalibrationResponse) => setData(payload))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/skills-rubric-calibration`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((payload: RubricCalibrationResponse) => {
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
        Loading Rubric Calibration…
      </div>
    );
  }
  if (error) {
    return (
      <div className="hf-skills-error hf-banner-error" role="alert">
        <AlertTriangle size={16} />
        <div>
          <strong>Could not load Rubric Calibration.</strong>
          <div>{error}</div>
        </div>
      </div>
    );
  }
  if (!data) return null;
  if (data.empty) {
    return <EmptyState />;
  }

  return (
    <div className="hf-rubric-calibration">
      <section className="hf-rubric-policy">
        <header className="hf-rubric-section-header">
          <h3>Mastery policy</h3>
          <p>
            How scores convert to tiers and how quickly EMA mastery responds to
            new evidence. Two of these inherit from Domain when set there;
            three are variant-intrinsic and don&apos;t cascade.
          </p>
        </header>
        <div className="hf-rubric-policy-row">
          {data.masteryPolicyChips.map((chip) => (
            <CascadeValue
              key={chip.knobKey}
              envelope={chip.envelope}
              knobKey={chip.knobKey}
              ariaLabel={`Inspect ${MASTERY_CHIP_LABELS[chip.knobKey]} cascade`}
              hideSubtitle={false}
              onInspect={() =>
                setInspecting({
                  knobKey: chip.knobKey,
                  knobLabel: MASTERY_CHIP_LABELS[chip.knobKey],
                })
              }
            >
              <span className="hf-rubric-chip-value">
                <strong>{MASTERY_CHIP_LABELS[chip.knobKey]}:</strong>{" "}
                {fmtMasteryChipValue(chip.knobKey, chip.envelope.value)}
              </span>
            </CascadeValue>
          ))}
        </div>
        <div className="hf-rubric-policy-row">
          <VariantPresetPill
            knob="useFreshMastery"
            value={data.variantPreset.useFreshMastery}
          />
          <VariantPresetPill
            knob="maxMasteryTier"
            value={data.variantPreset.maxMasteryTier}
          />
          <VariantPresetPill
            knob="scoringMode"
            value={data.variantPreset.scoringMode}
          />
        </div>
      </section>

      <section className="hf-rubric-banding">
        <header className="hf-rubric-section-header">
          <h3>Preset banding</h3>
          <p>
            Swap the whole tier-mapping scheme in one click. Persists to
            this course&apos;s config — Domain-level defaults still apply
            when this is cleared.
          </p>
        </header>
        <BandingPicker courseId={courseId} onSaved={refresh} />
      </section>

      <section className="hf-rubric-skills">
        <header className="hf-rubric-section-header">
          <h3>Per-skill rubric</h3>
          <p>
            Click a skill to see the literal prompt the AI tutor reads when it
            scores a transcript.
            {data.measureSpecSlug ? (
              <>
                {" "}
                MEASURE spec: <code>{data.measureSpecSlug}</code>.
              </>
            ) : (
              <>
                {" "}
                No MEASURE spec exists yet — re-project this course-ref to
                mint one.
              </>
            )}
          </p>
        </header>
        {data.skills.map((skill) => {
          const expanded = expandedSkillRef === skill.skillRef;
          return (
            <div
              key={skill.skillRef}
              className="hf-rubric-skill"
              data-skill-ref={skill.skillRef}
            >
              <button
                type="button"
                className="hf-rubric-skill-header"
                onClick={() =>
                  setExpandedSkillRef((prev) =>
                    prev === skill.skillRef ? null : skill.skillRef,
                  )
                }
                aria-expanded={expanded}
                aria-controls={`hf-rubric-${skill.skillRef}-body`}
              >
                <span className="hf-skill-row-ref">{skill.skillRef}</span>
                <span className="hf-skill-row-name">{skill.parameterName}</span>
                <span className="hf-skill-row-target">
                  Target: {tierLabelForTarget(skill)}
                </span>
                <span className="hf-skill-row-chevron" aria-hidden>
                  {expanded ? "▾" : "▸"}
                </span>
              </button>

              {expanded ? (
                <div
                  id={`hf-rubric-${skill.skillRef}-body`}
                  className="hf-rubric-skill-body"
                >
                  {skill.description ? (
                    <p className="hf-skill-description">{skill.description}</p>
                  ) : null}

                  <div className="hf-rubric-skill-tiers">
                    <div className="hf-rubric-subheading">Tier descriptors</div>
                    {skill.tierScheme.map((tier) => (
                      <div key={tier} className="hf-rubric-tier-row">
                        <TierCell tier={tier} size="compact" />
                        <strong className="hf-rubric-tier-name">
                          {tierLabel(tier)}
                        </strong>
                        <span className="hf-rubric-tier-text">
                          {skill.tiers[tier] ?? (
                            <em className="hf-skill-detail-empty">
                              (no descriptor yet)
                            </em>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {skill.bandThresholds &&
                  Object.keys(skill.bandThresholds).length > 0 ? (
                    <div className="hf-rubric-skill-bands">
                      <div className="hf-rubric-subheading">
                        Per-band descriptors
                      </div>
                      {Object.entries(skill.bandThresholds)
                        .sort(([a], [b]) => Number(b) - Number(a))
                        .map(([band, text]) => (
                          <div key={band} className="hf-rubric-band-row">
                            <strong>Band {band}</strong>
                            <span>{text}</span>
                          </div>
                        ))}
                    </div>
                  ) : null}

                  {skill.measure ? (
                    <div className="hf-rubric-skill-measure">
                      <div className="hf-rubric-subheading">
                        What the AI tutor reads (MEASURE prompt)
                      </div>
                      <dl className="hf-rubric-measure-block">
                        <dt>Given</dt>
                        <dd>{skill.measure.given}</dd>
                        <dt>When</dt>
                        <dd>{skill.measure.when}</dd>
                        <dt>Then</dt>
                        <dd>{skill.measure.then}</dd>
                      </dl>
                      {skill.measure.actions.length > 0 ? (
                        <div className="hf-rubric-measure-actions">
                          <strong>Actions:</strong>
                          <ul>
                            {skill.measure.actions.map((act, i) => (
                              <li key={`${act.parameterId}-${i}`}>
                                {act.description}{" "}
                                <span className="hf-rubric-measure-weight">
                                  (weight {act.weight})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="hf-rubric-skill-measure hf-rubric-skill-measure--empty">
                      <em>
                        No MEASURE trigger matched this skill. Re-project the
                        course-ref to mint one.
                      </em>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {inspecting ? (
        <CascadeInspectorTray
          knobKey={inspecting.knobKey}
          knobLabel={inspecting.knobLabel}
          scopeChain={{ playbookId: courseId }}
          onClose={() => setInspecting(null)}
        />
      ) : null}
    </div>
  );
}

function tierLabelForTarget(skill: RubricCalibrationSkill): string {
  const targetTier =
    tierForTargetValue(skill.tierScheme, skill.targetValue) ??
    skill.tierScheme[skill.tierScheme.length - 1];
  if (!targetTier) return "—";
  return `${tierLabel(targetTier)} · ${(skill.targetValue * 10).toFixed(1)}`;
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

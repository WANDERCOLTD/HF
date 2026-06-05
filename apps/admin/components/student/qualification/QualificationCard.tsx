"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Donut } from "@/components/shared/display-primitives";
import type { MasteryTier } from "@/lib/curriculum/mastery-tiers";
import { TIER_RANK } from "@/lib/curriculum/mastery-tiers";
import type {
  QualificationProgressData,
  QualificationProgressUnit,
} from "@/hooks/useQualificationProgress";
import "./qualification-card.css";

/**
 * QualificationCard — the composed qualification dashboard block (#1098 Slice B).
 *
 * Used in two places:
 *   - `/x/student/progress` (learner-facing dashboard) — CTA visible
 *   - Caller Detail Progress V2 `qualification` lens (educator-facing) —
 *     CTA hidden via `hideNextBestStep`
 *
 * All data comes from a single fetch of `/api/student/qualification-progress`.
 * Empty / cold-start state ("Not yet assessed") is rendered when
 * `data.qualification.tier === null` — i.e. the AGGREGATE rollup hasn't fired
 * yet for this learner.
 *
 * Reuses display primitives: `Donut` for the headline % readiness. No EQMixer
 * (too parameter-heavy) and no Radar (deferred to a future iteration).
 */

interface QualificationCardProps {
  data: QualificationProgressData;
  /** Hide the Next Best Step CTA — true for the educator lens. */
  hideNextBestStep?: boolean;
  /** Click handler for the Next Best Step CTA. Defaults to a sim deep-link. */
  onStartCall?: (next: NonNullable<QualificationProgressData["nextBestStep"]>) => void;
}

const TIER_LABELS: Record<MasteryTier, string> = {
  FOUNDATION: "Foundation",
  DEVELOPING: "Developing",
  PRACTITIONER: "Practitioner",
  DISTINCTION: "Distinction",
};

export function QualificationCard({
  data,
  hideNextBestStep = false,
  onStartCall,
}: QualificationCardProps): React.ReactElement | null {
  const { qualification, units, skills, nextBestStep } = data;
  if (!qualification) return null;

  const initialExpanded = qualification.weakestUnitSlug ?? units[0]?.moduleSlug ?? null;
  const [expandedUnit, setExpandedUnit] = useState<string | null>(initialExpanded);

  const fraction = useMemo(() => {
    if (qualification.losTotal === 0) return null;
    return qualification.losAtTierOrAbove / qualification.losTotal;
  }, [qualification.losAtTierOrAbove, qualification.losTotal]);

  const sortedSkills = useMemo(() => sortByTierDesc(skills), [skills]);
  const isColdStart = qualification.tier == null;

  return (
    <section className="hf-qualification-card" aria-label="Qualification progress">
      <QualificationHeader
        qualification={qualification}
        fraction={fraction}
        isColdStart={isColdStart}
      />

      {!hideNextBestStep && nextBestStep && (
        <NextBestStepCTA
          next={nextBestStep}
          units={units}
          onStartCall={onStartCall}
        />
      )}

      {isColdStart && (
        <p className="hf-qualification-coldstart">
          Take your first call to start tracking progress against this Standard.
        </p>
      )}

      <UnitTilesGrid
        units={units}
        expandedSlug={expandedUnit}
        onToggle={(slug) => setExpandedUnit((prev) => (prev === slug ? null : slug))}
      />

      {expandedUnit && (
        <ExpandedUnitLos
          unit={units.find((u) => u.moduleSlug === expandedUnit) ?? null}
        />
      )}

      {sortedSkills.length > 0 && (
        <SkillsList skills={sortedSkills} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function QualificationHeader({
  qualification,
  fraction,
  isColdStart,
}: {
  qualification: NonNullable<QualificationProgressData["qualification"]>;
  fraction: number | null;
  isColdStart: boolean;
}): React.ReactElement {
  const tierLabel = qualification.tier ? TIER_LABELS[qualification.tier] : null;
  const subtitleParts = [
    qualification.qualificationBody,
    qualification.qualificationNumber,
  ].filter(Boolean);

  return (
    <header className="hf-qualification-header">
      <div className="hf-qualification-header-text">
        <h2 className="hf-qualification-title">{qualification.displayName}</h2>
        {subtitleParts.length > 0 && (
          <p className="hf-qualification-subtitle">
            {subtitleParts.join(" · ")}
          </p>
        )}
        <p className="hf-qualification-readiness">
          {isColdStart ? (
            <span className="hf-qualification-readiness--cold">Ready to start</span>
          ) : (
            <>
              <span className="hf-qualification-tier-pill">{tierLabel}</span>
              <span>
                {" "}on {qualification.losAtTierOrAbove} of {qualification.losTotal} Learning Outcomes
              </span>
            </>
          )}
        </p>
      </div>
      <div className="hf-qualification-header-donut">
        <Donut value={fraction ?? null} size={88}>
          <span className="hf-qualification-donut-label">
            {fraction != null ? `${Math.round(fraction * 100)}%` : "—"}
          </span>
        </Donut>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Next Best Step CTA
// ---------------------------------------------------------------------------

function NextBestStepCTA({
  next,
  units,
  onStartCall,
}: {
  next: NonNullable<QualificationProgressData["nextBestStep"]>;
  units: readonly QualificationProgressUnit[];
  onStartCall?: (next: NonNullable<QualificationProgressData["nextBestStep"]>) => void;
}): React.ReactElement {
  const href = `/x/sim?requestedModuleId=${encodeURIComponent(next.moduleSlug)}`;
  // Resolve the unit's display name + the focus LO's plain-language name from
  // the catalog so the CTA never surfaces a raw slug or ref to the learner.
  const unit = units.find((u) => u.moduleSlug === next.moduleSlug) ?? null;
  const unitDisplay = unit?.displayName ?? next.moduleSlug;
  const focusLo = next.loRef
    ? unit?.learningObjectives.find((lo) => lo.ref === next.loRef) ?? null
    : null;
  const focusLoDisplay = focusLo?.displayName ?? next.loRef;
  return (
    <div className="hf-qualification-cta" role="region" aria-label="Next best step">
      <div className="hf-qualification-cta-body">
        <p className="hf-qualification-cta-headline">
          ▶ {next.courseType} on {unitDisplay}
        </p>
        <p className="hf-qualification-cta-reason">{next.reason}</p>
        {focusLoDisplay && (
          <p className="hf-qualification-cta-focus">
            Focus: <span className="hf-qualification-cta-focus-name">{focusLoDisplay}</span>
          </p>
        )}
      </div>
      {onStartCall ? (
        <button
          type="button"
          className="hf-qualification-cta-button"
          onClick={() => onStartCall(next)}
        >
          Practise this unit →
        </button>
      ) : (
        <Link href={href} className="hf-qualification-cta-button">
          Practise this unit →
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unit tiles grid
// ---------------------------------------------------------------------------

function UnitTilesGrid({
  units,
  expandedSlug,
  onToggle,
}: {
  units: readonly QualificationProgressUnit[];
  expandedSlug: string | null;
  onToggle: (slug: string) => void;
}): React.ReactElement {
  return (
    <div
      className="hf-qualification-unit-grid"
      role="group"
      aria-label="Units in this qualification"
    >
      {units.map((unit) => (
        <UnitTile
          key={unit.moduleSlug}
          unit={unit}
          isExpanded={unit.moduleSlug === expandedSlug}
          onToggle={() => onToggle(unit.moduleSlug)}
        />
      ))}
    </div>
  );
}

function UnitTile({
  unit,
  isExpanded,
  onToggle,
}: {
  unit: QualificationProgressUnit;
  isExpanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const tierLabel = unit.tier ? TIER_LABELS[unit.tier] : "Not assessed";
  const tierClass = unit.tier
    ? `hf-qualification-tile--tier-${unit.tier.toLowerCase()}`
    : "hf-qualification-tile--tier-none";

  return (
    <button
      type="button"
      className={`hf-qualification-tile ${tierClass} ${isExpanded ? "hf-qualification-tile--expanded" : ""}`}
      onClick={onToggle}
      aria-pressed={isExpanded}
      aria-label={`${unit.displayName} — ${tierLabel}, ${unit.losCovered} of ${unit.losTotal} learning outcomes covered`}
    >
      <span className="hf-qualification-tile-title">{unit.displayName}</span>
      <ProgressBar value={unit.losTotal === 0 ? null : unit.losCovered / unit.losTotal} />
      <span className="hf-qualification-tile-tier">{tierLabel}</span>
      <span className="hf-qualification-tile-fraction">
        {unit.losCovered}/{unit.losTotal}
      </span>
    </button>
  );
}

function ProgressBar({ value }: { value: number | null }): React.ReactElement {
  const filled = value != null ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div
      className="hf-qualification-progress-bar"
      role="progressbar"
      aria-valuenow={value != null ? Math.round(filled * 100) : 0}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="hf-qualification-progress-bar-fill"
        data-width={Math.round(filled * 100)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded unit — LO list
// ---------------------------------------------------------------------------

function ExpandedUnitLos({
  unit,
}: {
  unit: QualificationProgressUnit | null;
}): React.ReactElement | null {
  if (!unit) return null;

  return (
    <div className="hf-qualification-lo-list">
      <h3 className="hf-qualification-lo-list-title">{unit.displayName}</h3>
      <ul className="hf-qualification-lo-rows">
        {unit.learningObjectives.map((lo) => {
          const indicator = lo.tier
            ? lo.tier === "DISTINCTION" || lo.tier === "PRACTITIONER"
              ? "✓"
              : "◐"
            : "◯";
          const tierLabel = lo.tier ? TIER_LABELS[lo.tier] : "Not assessed";
          const tierClass = lo.tier
            ? `hf-qualification-lo--tier-${lo.tier.toLowerCase()}`
            : "hf-qualification-lo--tier-none";
          const isWeakest = unit.weakestLoRef === lo.ref;
          return (
            <li
              key={lo.ref}
              className={`hf-qualification-lo-row ${tierClass} ${isWeakest ? "hf-qualification-lo-row--weakest" : ""}`}
            >
              <span className="hf-qualification-lo-indicator" aria-hidden="true">
                {indicator}
              </span>
              <span className="hf-qualification-lo-ref">{lo.ref}</span>
              <span className="hf-qualification-lo-name">{lo.displayName}</span>
              <span className="hf-qualification-lo-tier">{tierLabel}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cross-cutting skills
// ---------------------------------------------------------------------------

function SkillsList({
  skills,
}: {
  skills: readonly QualificationProgressData["skills"][number][];
}): React.ReactElement {
  return (
    <div className="hf-qualification-skills">
      <h3 className="hf-qualification-skills-title">Cross-cutting Skills</h3>
      <ul className="hf-qualification-skills-list">
        {skills.map((skill) => {
          const tierLabel = skill.tier ? TIER_LABELS[skill.tier] : "Not assessed";
          const tierClass = skill.tier
            ? `hf-qualification-skill--tier-${skill.tier.toLowerCase()}`
            : "hf-qualification-skill--tier-none";
          return (
            <li
              key={skill.ref}
              className={`hf-qualification-skill ${tierClass}`}
            >
              <span className="hf-qualification-skill-name">{skill.name}</span>
              <span className="hf-qualification-skill-tier">{tierLabel}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortByTierDesc<T extends { tier: MasteryTier | null; name: string }>(
  list: readonly T[],
): T[] {
  return [...list].sort((a, b) => {
    const ra = a.tier ? TIER_RANK[a.tier] : -1;
    const rb = b.tier ? TIER_RANK[b.tier] : -1;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });
}

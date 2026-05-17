"use client";

/**
 * BandChip — tier+band pill rendered alongside ACHIEVE goal progress
 * for SKILL-NN goals when a real per-skill currentScore is available.
 *
 * Resolves tier + band number via `scoreToTier()` from track-progress,
 * passing the optional `mapping` so per-playbook overrides (CEFR,
 * 5-Level, custom) are honoured. Falls back to IELTS defaults if no
 * mapping is supplied.
 *
 * Visually: pill with a tier-coloured background, a hover-tooltip
 * explaining the tier (via `<Acronym>`), and the band number alongside.
 *
 * Design-system compliant: hf-band-chip classes only, no inline hex,
 * tier colour via modifier class.
 */
import { scoreToTier, type SkillTierMapping } from "@/lib/goals/track-progress";
import { Acronym } from "./Acronym";

interface BandChipProps {
  /** 0-1 running skill score. */
  score: number;
  /** Optional per-playbook tier override. */
  mapping?: SkillTierMapping;
  /** Compact vs default density. */
  size?: "compact" | "default";
}

export function BandChip({ score, mapping, size }: BandChipProps) {
  const { tier, band } = scoreToTier(score, mapping);
  const slug =
    tier === "Secure"
      ? "secure"
      : tier === "Developing"
        ? "developing"
        : tier === "Emerging"
          ? "emerging"
          : "approaching";
  const className = `hf-band-chip hf-band-chip--${slug}${size === "compact" ? " hf-text-xs" : ""}`;
  return (
    <span className={className} aria-label={`${tier}, band ~${band}`}>
      <Acronym>{tier}</Acronym>
      <span>·</span>
      <span>band ~{band}</span>
    </span>
  );
}

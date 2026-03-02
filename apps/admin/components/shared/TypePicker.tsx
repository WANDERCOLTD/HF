"use client";

/**
 * TypePicker — compact chip selector for institution type (sector).
 *
 * Shared between CreateInstitutionModal (Teach wizard) and CreateDomainModal (Domains page).
 * Compact `hf-chip` buttons with icon + name. Hover-aware preview panel below
 * shows the full description and AI personality tooltip.
 *
 * Fetches types from /api/admin/institution-types on mount.
 * Falls back to static SECTOR_CONFIG if API fails (graceful degradation for non-admin roles).
 */

import { useState, useEffect } from "react";
import {
  GraduationCap,
  Building2,
  Users,
  Target,
  Heart,
  Dumbbell,
  HelpCircle,
} from "lucide-react";
import { SECTOR_CONFIG, SECTOR_SLUGS, type SectorSlug } from "@/lib/institution-types/sector-config";

const ICON_COMPONENTS: Record<string, React.ComponentType<{ size: number }>> = {
  GraduationCap,
  Building2,
  Users,
  Target,
  Heart,
  Dumbbell,
};

export interface TypePickerOption {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  defaultDomainKind?: string | null;
}

interface TypePickerProps {
  /** Currently selected type slug */
  value: string | null;
  /** Called when user selects a type */
  onChange: (slug: string, typeId?: string, defaultDomainKind?: string) => void;
  /** Label above the picker */
  label?: string;
  /** Auto-suggested type slug (shown with badge, not yet confirmed) */
  suggestedValue?: string | null;
}

export function TypePicker({ value, onChange, label = "What kind of organisation is this?", suggestedValue }: TypePickerProps) {
  const [apiTypes, setApiTypes] = useState<TypePickerOption[] | null>(null);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);

  // Try to load types from API (includes id for linking), fall back to static config
  useEffect(() => {
    fetch("/api/admin/institution-types")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.types?.length) {
          setApiTypes(data.types.map((t: any) => ({
            id: t.id,
            slug: t.slug,
            name: t.name,
            description: t.description,
            defaultDomainKind: t.defaultDomainKind || null,
          })));
        }
      })
      .catch(() => {}); // Silently fall back to static config
  }, []);

  // Merge: use API data if available (has id), otherwise static config
  const types: Array<{ slug: string; id?: string; name: string; description: string; defaultDomainKind?: string | null }> =
    apiTypes
      ? apiTypes.map((t) => ({
          slug: t.slug,
          id: t.id,
          name: t.name,
          description: t.description || SECTOR_CONFIG[t.slug as SectorSlug]?.description || "",
          defaultDomainKind: t.defaultDomainKind,
        }))
      : SECTOR_SLUGS.map((slug) => ({
          slug,
          name: SECTOR_CONFIG[slug].label,
          description: SECTOR_CONFIG[slug].description,
        }));

  const previewSlug = hoveredSlug || value;
  const previewType = previewSlug ? types.find((t) => t.slug === previewSlug) : null;
  const previewSector = previewSlug ? SECTOR_CONFIG[previewSlug as SectorSlug] : null;

  return (
    <div>
      <label className="hf-label hf-mb-xs">
        {label}
      </label>
      <div className="hf-chip-grid">
        {types.map((t) => {
          const sectorDef = SECTOR_CONFIG[t.slug as SectorSlug];
          const IconComp = sectorDef ? ICON_COMPONENTS[sectorDef.icon] : HelpCircle;
          const isSelected = value === t.slug;

          const isSuggested = !value && suggestedValue === t.slug;
          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => onChange(t.slug, t.id, t.defaultDomainKind || undefined)}
              onMouseEnter={() => setHoveredSlug(t.slug)}
              onMouseLeave={() => setHoveredSlug(null)}
              className={`hf-chip${isSelected || isSuggested ? " hf-chip-selected" : ""}`}
            >
              {IconComp && <IconComp size={14} />}
              <span>{t.name}</span>
              {isSuggested && <span className="hf-chip-badge">Suggested</span>}
            </button>
          );
        })}
      </div>
      {previewType ? (
        <div className="hf-chip-preview">
          <span className="hf-chip-preview-label">{previewType.name}:</span>
          <span className="hf-chip-preview-desc">{previewType.description}</span>
          {previewSector?.tooltip && (
            <span className="hf-chip-preview-examples">{previewSector.tooltip}</span>
          )}
        </div>
      ) : (
        <div className="hf-chip-preview">
          <span className="hf-chip-preview-empty">Hover over an option to learn more</span>
        </div>
      )}
    </div>
  );
}

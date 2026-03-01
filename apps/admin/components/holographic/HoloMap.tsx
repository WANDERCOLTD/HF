"use client";

import { useHolo } from "@/hooks/useHolographicState";
import { visibleSections } from "@/lib/holographic/permissions";
import { getSectionMeta } from "@/lib/holographic/section-labels";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import { HoloHeader } from "./HoloHeader";
import { HoloMapCard } from "./HoloMapCard";
import { SaveIndicator } from "./SaveIndicator";

interface HoloDomain {
  id: string;
  name: string;
  slug: string;
  institution?: { name: string } | null;
}

interface HoloMapProps {
  mobileOpen?: boolean;
  /** All available domains for the selector */
  domains?: HoloDomain[];
  /** Currently active domain ID */
  activeDomainId?: string;
  /** Called when user picks a different domain */
  onDomainChange?: (domainId: string) => void;
}

export function HoloMap({
  mobileOpen,
  domains,
  activeDomainId,
  onDomainChange,
}: HoloMapProps) {
  const { state, setActiveSection, setMapCollapsed } = useHolo();
  const { role, activeSection, readinessMap, summaries, mapCollapsed, saveStatus } = state;

  const sections = visibleSections(role);

  const mapClasses = [
    "hp-map",
    mapCollapsed && "hp-map-collapsed",
    mobileOpen && "hp-map-mobile-open",
  ]
    .filter(Boolean)
    .join(" ");

  // Build domain options for FancySelect
  const domainOptions: FancySelectOption[] = (domains || []).map((d) => ({
    value: d.id,
    label: d.name,
    subtitle: d.institution?.name || d.slug,
  }));

  const showDomainSelector = domains && domains.length > 1 && onDomainChange;

  return (
    <aside className={mapClasses}>
      {/* Domain selector — above header when multiple domains */}
      {showDomainSelector && !mapCollapsed && (
        <div className="hp-domain-selector">
          <FancySelect
            value={activeDomainId || ""}
            onChange={(val) => onDomainChange!(val)}
            options={domainOptions}
            placeholder="Switch domain…"
            searchable
          />
        </div>
      )}

      <HoloHeader
        collapsed={mapCollapsed}
        onToggleCollapse={() => setMapCollapsed(!mapCollapsed)}
      />

      <div className="hp-map-cards">
        {sections.map((section) => {
          const meta = getSectionMeta(section, role);
          return (
            <HoloMapCard
              key={section}
              section={section}
              label={meta.label}
              summary={summaries[section] || meta.tagline}
              status={readinessMap[section]}
              active={section === activeSection}
              onClick={() => setActiveSection(section)}
            />
          );
        })}
      </div>

      <SaveIndicator status={saveStatus} />
    </aside>
  );
}

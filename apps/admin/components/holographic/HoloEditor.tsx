"use client";

import { useHolo } from "@/hooks/useHolographicState";
import { getSectionMeta } from "@/lib/holographic/section-labels";
import { canEdit } from "@/lib/holographic/permissions";
import type { SectionId } from "@/lib/holographic/permissions";

// Section components (all 8 live)
import { ReadinessSection } from "./sections/ReadinessSection";
import { StructureSection } from "./sections/StructureSection";
import { IdentitySection } from "./sections/IdentitySection";
import { CurriculumSection } from "./sections/CurriculumSection";
import { OnboardingSection } from "./sections/OnboardingSection";
import { PromptPreviewSection } from "./sections/PromptPreviewSection";
import { BehaviorSection } from "./sections/BehaviorSection";
import { ChannelsSection } from "./sections/ChannelsSection";

// Section dispatch map — maps SectionId to its component
const SECTION_COMPONENTS: Record<SectionId, React.ComponentType> = {
  identity: IdentitySection,
  curriculum: CurriculumSection,
  behavior: BehaviorSection,
  onboarding: OnboardingSection,
  channels: ChannelsSection,
  readiness: ReadinessSection,
  structure: StructureSection,
  "prompt-preview": PromptPreviewSection,
};

export function HoloEditor() {
  const { state } = useHolo();
  const { activeSection, role, sectionLoading } = state;

  const meta = getSectionMeta(activeSection, role);
  const editable = canEdit(activeSection, role);
  const loading = sectionLoading.includes(activeSection);

  const SectionComponent = SECTION_COMPONENTS[activeSection];

  return (
    <main className="hp-editor">
      <div className="hp-editor-content">
        <h1 className="hp-editor-title">{meta.label}</h1>
        <p className="hp-editor-tagline">
          {meta.tagline}
          {editable && (
            <span className="hp-editor-editable"> · Editable</span>
          )}
        </p>

        {loading ? (
          <div className="hp-section-placeholder">
            <div className="hf-spinner" />
          </div>
        ) : (
          <SectionComponent />
        )}
      </div>
    </main>
  );
}

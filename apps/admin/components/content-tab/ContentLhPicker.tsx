"use client";

/**
 * ContentLhPicker — LH intent-group picker for the Content tab.
 *
 * Renders one row per ContentKind (MCQ Bank / Cue Cards / Topic Prompts /
 * Scenario Probes / Reflection Prompts) with a per-group item count.
 * Click → setSelectedKind. Mirrors the ModulesLhPicker styling so the
 * two tabs share a visual rhythm.
 */

import {
  CONTENT_KINDS,
  countItemsForKind,
  type ContentKind,
  type TypedContentGroups,
} from "./types";

interface ContentLhPickerProps {
  groups: TypedContentGroups;
  selectedKind: ContentKind;
  onSelect: (kind: ContentKind) => void;
}

export function ContentLhPicker({
  groups,
  selectedKind,
  onSelect,
}: ContentLhPickerProps) {
  return (
    <div className="hf-journey-lh" data-testid="hf-content-lh-picker">
      <div className="hf-journey-lh-groups">
        {CONTENT_KINDS.map((meta) => {
          const count = countItemsForKind(groups, meta.kind);
          const isSelected = selectedKind === meta.kind;
          return (
            <button
              key={meta.kind}
              type="button"
              className={`hf-content-lh-row ${isSelected ? "hf-selected" : ""}`}
              onClick={() => onSelect(meta.kind)}
              data-testid={`hf-content-lh-row-${meta.kind}`}
              aria-pressed={isSelected}
            >
              <span className="hf-journey-bucket-label">{meta.label}</span>
              <span className="hf-journey-bucket-count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

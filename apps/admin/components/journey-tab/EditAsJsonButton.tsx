"use client";

/**
 * EditAsJsonButton — Phase 5 of epic #1675.
 *
 * Power-user fallback: open the existing `JsonEditorModal` for the
 * selected contract. Apply path goes through the same journey-setting
 * PATCH route as the inline JourneyField primitive.
 *
 * Mounted next to the JourneyField in the Inspector pane.
 */

import { useState } from "react";
import { Braces } from "lucide-react";

import { JsonEditorModal } from "@/components/settings/JsonEditorModal";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

interface EditAsJsonButtonProps {
  contract: JourneySettingContract;
  value: unknown;
}

export function EditAsJsonButton({ contract, value }: EditAsJsonButtonProps) {
  const ctx = useJourneySetting();
  const [open, setOpen] = useState(false);

  if (ctx.readonly || !ctx.courseId) return null;

  const initialText = formatJson(value);

  return (
    <>
      <button
        type="button"
        className="hf-btn hf-btn-secondary"
        onClick={() => setOpen(true)}
        aria-label="Edit as JSON"
        title="Edit as JSON (power-user)"
        data-testid={`hf-jf-json-btn-${contract.id}`}
      >
        <Braces size={14} aria-hidden />
        <span>JSON</span>
      </button>
      <JsonEditorModal
        isOpen={open}
        onClose={() => setOpen(false)}
        label={contract.educatorLabel}
        settingKey={contract.id}
        initialText={initialText}
        onSave={async (_key, parsed) => {
          await ctx.saveSetting(contract.id, parsed);
        }}
      />
    </>
  );
}

function formatJson(v: unknown): string {
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

"use client";

/**
 * InspectorRowMenu — Lane 2 RHS Inspector usability pass.
 *
 * Replaces the per-row `{} JSON` button (which dominated every row's
 * visual weight in Slice C) with a single overflow `⋯` button. The
 * power-user JSON path lives behind the menu, not as a foreground
 * affordance.
 *
 * Operator feedback (4 screenshots, 2026-06-16): "I cannot believe you
 * have a JSON button on every row." The fix: the JSON editor is still
 * one click away — it's just no longer the dominant visual.
 *
 * Menu contains:
 *   - Edit as JSON (advanced) — opens JsonEditorModal (the old behaviour)
 *   - Copy current value — copies the JSON-stringified value to clipboard
 *   - Copy storage path — copies the contract's storagePath for debug
 *
 * Replaces: EditAsJsonButton (kept around as the JSON-edit modal handler
 * the menu invokes).
 */

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Braces, Copy, Hash } from "lucide-react";

import { JsonEditorModal } from "@/components/settings/JsonEditorModal";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

interface InspectorRowMenuProps {
  contract: JourneySettingContract;
  value: unknown;
}

function getStoragePathString(c: JourneySettingContract): string {
  if (typeof c.storagePath === "string") return c.storagePath;
  return c.storagePath.path;
}

function formatJson(v: unknown): string {
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

export function InspectorRowMenu({ contract, value }: InspectorRowMenuProps) {
  const ctx = useJourneySetting();
  const [menuOpen, setMenuOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (ctx.readonly || !ctx.courseId) return null;

  const valueJson = formatJson(value);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore — copy is best-effort
    }
    setMenuOpen(false);
  };

  return (
    <div
      ref={wrapRef}
      className="hf-inspector-row-menu-wrap"
      data-testid={`hf-inspector-row-menu-${contract.id}`}
    >
      <button
        type="button"
        className="hf-inspector-row-menu-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Row actions"
        title="More actions"
        onClick={() => setMenuOpen((v) => !v)}
        data-testid={`hf-inspector-row-menu-trigger-${contract.id}`}
      >
        <MoreHorizontal size={14} aria-hidden focusable="false" />
      </button>
      {menuOpen ? (
        <div
          className="hf-inspector-row-menu"
          role="menu"
          aria-label={`${contract.educatorLabel} actions`}
        >
          <button
            type="button"
            role="menuitem"
            className="hf-inspector-row-menu-item"
            onClick={() => {
              setMenuOpen(false);
              setJsonOpen(true);
            }}
            data-testid={`hf-inspector-row-menu-edit-json-${contract.id}`}
          >
            <Braces size={12} aria-hidden focusable="false" />
            <span>Edit as JSON</span>
            <span className="hf-inspector-row-menu-hint">advanced</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="hf-inspector-row-menu-item"
            onClick={() => void copyToClipboard(valueJson)}
            disabled={!valueJson}
            data-testid={`hf-inspector-row-menu-copy-value-${contract.id}`}
          >
            <Copy size={12} aria-hidden focusable="false" />
            <span>Copy current value</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="hf-inspector-row-menu-item"
            onClick={() => void copyToClipboard(getStoragePathString(contract))}
            data-testid={`hf-inspector-row-menu-copy-path-${contract.id}`}
          >
            <Hash size={12} aria-hidden focusable="false" />
            <span>Copy storage path</span>
          </button>
        </div>
      ) : null}
      <JsonEditorModal
        isOpen={jsonOpen}
        onClose={() => setJsonOpen(false)}
        label={contract.educatorLabel}
        settingKey={contract.id}
        initialText={valueJson}
        onSave={async (_key, parsed) => {
          await ctx.saveSetting(contract.id, parsed);
        }}
      />
    </div>
  );
}

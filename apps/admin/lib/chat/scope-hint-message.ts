/**
 * Synthetic scope-hint message builder (Epic #1442 Layer 3 Slice 5).
 *
 * When the route layer has resolved a scope (either from a parsed token or
 * from URL inference), it prepends a synthetic user-role message into the
 * DEMO `messages` array describing the resolution. This is the mechanism
 * by which the LLM is told "for the next tool call, use these scope ids".
 *
 * The synthetic message is encoded as a `[scope] …` user-prefixed note so
 * the existing tray-reflection convention ("user-prefixed `[tray] ...`
 * notes" — see `tray-reflection.ts`) carries over naturally. The DEMO
 * system prompt instructs the model to acknowledge the scope before
 * emitting a tool call.
 *
 * No SDK changes. No `handleDataModeWithTools` signature changes.
 */

import type { Layer } from "@/lib/cascade/layer-types";

export interface ScopeHint {
  layer: Layer;
  /** Resolved cascade scope identifiers — only the slot for `layer` is set. */
  scopeIds: {
    playbookId?: string;
    domainId?: string;
    callerId?: string;
  };
  /** Operator-facing label (e.g. "Bertie Tallstaff", "OCEAN", "Education"). */
  label: string;
  /** Optional — the tool to suggest using ("update_behavior_target" etc). */
  suggestedTool?: string;
}

export function buildScopeHintMessage(hint: ScopeHint): string {
  const { layer, scopeIds, label, suggestedTool } = hint;

  let scopeWord = "";
  let idSentence = "";
  let warning = "";

  switch (layer) {
    case "CALLER":
      scopeWord = "CALLER";
      idSentence = `caller_id=${scopeIds.callerId}`;
      break;
    case "PLAYBOOK":
      scopeWord = "PLAYBOOK";
      idSentence = `playbook_id=${scopeIds.playbookId}`;
      break;
    case "DOMAIN":
      scopeWord = "DOMAIN";
      idSentence = `domain_id=${scopeIds.domainId}`;
      warning =
        " ⚠ This affects every course in the domain — confirm before applying.";
      break;
    case "SEGMENT":
    case "CALL":
    case "SYSTEM":
      // These layers don't reach this helper today — `setKnobAtLayer` throws.
      // We still produce a hint so the LLM sees the operator's intent.
      scopeWord = layer;
      idSentence = "(scope id not provided)";
      break;
  }

  const toolSentence = suggestedTool
    ? ` Use ${suggestedTool} for the next tool call.`
    : "";

  return `[scope] Operator targeted ${scopeWord} scope (${label}). For the next tool call, pass ${idSentence}.${toolSentence}${warning}`;
}

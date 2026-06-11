/**
 * Welcome-message cascade UX helpers (#1471).
 *
 * Pure functions extracted from `SessionFlowEditor::WelcomeMessageDrawer`
 * so unit tests can pin the caption + aria-label rules without mounting
 * the whole timeline editor. The drawer wires these into `<LayerBadge>`
 * + `<CascadeInspectorTray>` from the cascade primitive (#1462/#1464/#1469).
 */

import type { Effective } from "@/lib/cascade/layer-types";

/**
 * Inline caption shown beneath the Message label. `null` means "render
 * nothing" — the `[PB]` case is self-explanatory via the badge.
 */
export function inheritedCaptionFor(
  envelope: Effective<string | null> | null,
): string | null {
  if (!envelope) return null;
  if (envelope.source === "DOMAIN") {
    const dom = envelope.layers.find((h) => h.layer === "DOMAIN");
    return dom ? `Inherited from Domain: ${dom.scopeLabel}` : "Inherited from Domain";
  }
  if (envelope.source === "SYSTEM" && envelope.layers.length === 0) {
    return "No override set — AI uses its default greeting";
  }
  return null;
}

/**
 * Aria-label suffix used by the badge — keeps the chip's accessible name
 * informative ("Welcome message source: inherited from Domain") instead
 * of the generic default ("Cascade layer: DOM").
 */
export function badgeAriaLabel(source: Effective<unknown>["source"]): string {
  switch (source) {
    case "PLAYBOOK":
      return "set on this Course";
    case "DOMAIN":
      return "inherited from Domain";
    case "SYSTEM":
      return "using System default";
    case "CALLER":
      return "caller-scope override";
    case "SEGMENT":
    case "CALL":
      return "set at a deeper scope";
  }
}

/**
 * The textarea placeholder. When the live effective value is a Domain
 * inheritance, surface it as ghost text so the operator sees what the
 * AI would say if they don't override. SYSTEM/PLAYBOOK fall back to the
 * generic placeholder.
 */
export function placeholderFor(
  envelope: Effective<string | null> | null,
): string {
  if (envelope?.source === "DOMAIN" && envelope.value) return envelope.value;
  return "Welcome to the course! Let's get started…";
}

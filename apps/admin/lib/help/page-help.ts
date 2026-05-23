/**
 * Page-scoped help registry. Each route declares its title, about copy,
 * tab explanations, and chord bindings here. The Help Overlay (#686),
 * chord engine (#688), and tab hover-tooltips (#689) all read from this
 * single source.
 *
 * This file ships in #686 with the type definitions and an empty
 * registry. #687 populates it for Wizard / Courses / Learners pages.
 *
 * Letter mapping rule for chord `keys`:
 *   - First letter of the tab label is preferred
 *   - On collision, pick the next memorable letter (not next-alphabet)
 *   - Settings is always `T` (mnemonic: tuning)
 *   - Avoid prefixes `H` and `G` for second-letter assignments
 */

export interface PageHelp {
  /** Route pattern. Use a literal pathname or a RegExp for parameterised routes. */
  match: string | RegExp;
  /** Shown in the overlay header. */
  title: string;
  /** 1–2 sentences. What this page is for. */
  about: string;
  /** Optional tour id from lib/tours/tour-definitions.ts. */
  tourId?: string;
  /** Per-tab explanations. Omit for pages with no tabs. */
  tabs?: TabHelp[];
  /** Page-scoped chords. The chord engine prepends H or G. */
  chords?: ChordBinding[];
}

export interface TabHelp {
  /** Stable id; matches the tab system on the page (URL ?tab=, useState, pathname). */
  id: string;
  /** Human-readable label as it appears in the tab strip. */
  label: string;
  /** What's in this tab. */
  about: string;
  /** Optional secondary line. */
  whenToUse?: string;
}

export interface ChordBinding {
  /** Single letter A–Z. Capital. */
  keys: string;
  action: "navigate" | "callback";
  /** Required when action === "navigate". */
  href?: string;
  /** Required when action === "callback". The page wires it up. */
  callbackId?: string;
  /** Shown in the overlay's "Shortcuts — on this page" section. */
  label: string;
}

/**
 * Registry. Populated by #687.
 */
export const PAGE_HELP: readonly PageHelp[] = [];

/**
 * Match a pathname against the registry.
 */
export function findPageHelp(pathname: string): PageHelp | undefined {
  for (const entry of PAGE_HELP) {
    if (typeof entry.match === "string") {
      if (entry.match === pathname) return entry;
    } else if (entry.match.test(pathname)) {
      return entry;
    }
  }
  return undefined;
}

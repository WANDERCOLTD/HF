/**
 * Global keyboard shortcuts shown in the Help Overlay's "Shortcuts — global"
 * section. NON-CHORD shortcuts only — chord nav bindings live in
 * lib/help/page-help.ts::GLOBAL_CHORDS and are derived dynamically for
 * display (so the listed chord can never claim a binding that doesn't
 * actually exist).
 */
export interface GlobalShortcut {
  keys: string;
  description: string;
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  // Trigger-style — single-key with no modifier
  { keys: "?", description: "Open this help" },
  { keys: "Esc", description: "Close panel or dialog" },

  // Cmd-modified (wired in app/layout.tsx::handleGlobalKeyDown)
  { keys: "⌘K", description: "Open AI assistant" },
  { keys: "⌘G", description: "Build Course (wizard)" },
  { keys: "⌘D", description: "Educator dashboard" },
  { keys: "⌘S", description: "Sim / Learn surface" },
  { keys: "⌘L", description: "Learners" },

  // Chord prefix
  { keys: "H + key  ·  G + key", description: "Two-key navigation chord (see list below)" },
];

/**
 * Global keyboard shortcuts shown in the Help Overlay's "Shortcuts — global"
 * section. Page-scoped shortcuts live in lib/help/page-help.ts.
 */
export interface GlobalShortcut {
  keys: string;
  description: string;
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { keys: "?", description: "Open this help" },
  { keys: "⌘K", description: "Open AI assistant / search" },
  { keys: "Esc", description: "Close panel or dialog" },
  { keys: "H + key  ·  G + key", description: "Jump to a tab on this page (chord)" },
  { keys: "H H  ·  G H", description: "Go home" },
  { keys: "H C  ·  G C", description: "Courses" },
  { keys: "H L  ·  G L", description: "Learners" },
  { keys: "H D  ·  G D", description: "Data dictionary" },
  { keys: "H S  ·  G S", description: "Specs" },
];

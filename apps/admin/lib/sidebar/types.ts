// Sidebar navigation types

export type NavItem = {
  /** Stable identifier for cross-referencing (e.g. tours, analytics) */
  id?: string;
  href: string;
  label: string;
  icon?: string;
  highlighted?: boolean;
  /** Role-specific overrides for label, href, and icon */
  roleVariants?: Record<string, { label?: string; href?: string; icon?: string }>;
  /** If set, only these roles see this item. Omit to show to all roles that can see the section. */
  visibleFor?: string[];
  /** Hidden when user is in simple view mode (view-mode gate) */
  advancedOnly?: boolean;
  /** If set, label is replaced with the resolved terminology term at runtime (e.g. "cohort_plural") */
  terminologyLabel?: string;
  /** Small static tag shown after the label (e.g. "NEW", "WS3") */
  tag?: string;
  /** If true, shows a sparkles indicator — item leads into a wizard/guided flow */
  wizard?: boolean;
  /** Keyboard shortcut hint shown on hover (e.g. "⌘G") */
  shortcutHint?: string;
};

export type NavSection = {
  id: string;
  title?: string;
  href?: string;
  items: NavItem[];
  dividerAfter?: boolean;
  collapsedByDefault?: boolean;
  /** Minimum role required to see this section (hard gate — can't override) */
  requiredRole?: string;
  /** Roles for which this section is hidden by default (soft — user can unhide) */
  defaultHiddenFor?: string[];
  /** Hidden when user is in simple view mode (view-mode gate) */
  advancedOnly?: boolean;
  /** If set, section title is replaced with "My {term}" at runtime (e.g. "institution") */
  terminologySectionTitle?: string;
};

// Persisted layout configuration
export type SidebarLayout = {
  sectionOrder: string[];
  itemPlacements: Record<string, string>; // itemHref → sectionId
  itemOrder: Record<string, string[]>; // sectionId → [itemHrefs in order]
  sectionTitles?: Record<string, string>; // sectionId → custom title
  hiddenSections?: string[]; // sectionIds to hide (appear in restore menu)
  deletedSections?: string[]; // sectionIds fully removed (only recoverable via Reset)
};

// Drag state for UI binding
export type SidebarDragState = {
  draggedSection: string | null;
  draggedItem: string | null;
  dragOverSection: string | null;
  dragOverItem: string | null;
  dragOverSectionForItem: string | null;
};

// Actions for the reducer
export type SidebarAction =
  | { type: "SET_LAYOUT"; layout: Partial<SidebarLayout> }
  | { type: "RESET_LAYOUT" }
  | { type: "MOVE_SECTION"; fromId: string; toId: string }
  | { type: "MOVE_ITEM"; itemHref: string; toSectionId: string; atIndex?: number }
  | { type: "RENAME_SECTION"; sectionId: string; title: string }
  | { type: "HIDE_SECTION"; sectionId: string }
  | { type: "SHOW_SECTION"; sectionId: string }
  | { type: "DELETE_SECTION"; sectionId: string }
  | { type: "UNDO_DELETE_SECTION"; sectionId: string }
  | { type: "SET_DRAG_STATE"; dragState: Partial<SidebarDragState> }
  | { type: "CLEAR_DRAG_STATE" };

// Combined state for reducer
export type SidebarState = {
  layout: SidebarLayout;
  dragState: SidebarDragState;
  hasCustomLayout: boolean;
  isLoaded: boolean;
};

// Initial/empty layout
export const EMPTY_LAYOUT: SidebarLayout = {
  sectionOrder: [],
  itemPlacements: {},
  itemOrder: {},
  sectionTitles: {},
  hiddenSections: [],
  deletedSections: [],
};

export const EMPTY_DRAG_STATE: SidebarDragState = {
  draggedSection: null,
  draggedItem: null,
  dragOverSection: null,
  dragOverItem: null,
  dragOverSectionForItem: null,
};

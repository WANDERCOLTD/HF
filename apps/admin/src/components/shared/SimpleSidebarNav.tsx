"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useGlobalAssistant } from "@/contexts/AssistantContext";
import { useGuidance } from "@/contexts/GuidanceContext";
import { useMasquerade } from "@/contexts/MasqueradeContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useViewMode } from "@/contexts/ViewModeContext";
import { useSidebarLayout } from "@/hooks/useSidebarLayout";
import { ICON_MAP } from "@/lib/sidebar/icons";
import type { NavSection } from "@/lib/sidebar/types";
import { pluralize, type TermMap } from "@/lib/terminology/types";
import { ROLE_LEVEL } from "@/lib/roles";
import sidebarManifest from "@/lib/sidebar/sidebar-manifest.json";
import {
  MoreVertical,
  ChevronDown,
  PanelLeft,
  EyeOff,
  Trash2,
  PenLine,
  Bot,
  Home,
  Sparkles,
} from "lucide-react";

// ============================================================================
// Icon Helper
// ============================================================================

function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon className={className} />;
}

// ============================================================================
// Terminology resolution for sidebar labels
// ============================================================================

/** Resolve a terminologyLabel key (e.g. "cohort_plural", "supervisor") into a display string */
function resolveTermLabel(key: string, t: TermMap): string | null {
  if (key.endsWith("_plural")) {
    const baseKey = key.replace("_plural", "") as keyof TermMap;
    return baseKey in t ? pluralize(t[baseKey]) : null;
  }
  return (t as Record<string, string>)[key] ?? null;
}

// ============================================================================
// Kebab Menu (appears on section header hover)
// ============================================================================

function SectionKebabMenu({
  sectionId,
  sectionTitle,
  visible,
  onRename,
  onHide,
  onDelete,
}: {
  sectionId: string;
  sectionTitle: string;
  visible: boolean;
  onRename: (id: string, title: string) => void;
  onHide: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const showButton = visible || open;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="p-2 rounded hover:bg-[var(--hover-bg)] transition-opacity"
        style={{ opacity: showButton ? 1 : 0 }}
        aria-label={`Options for ${sectionTitle}`}
      >
        <MoreVertical className="w-4 h-4 text-[var(--text-muted)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-lg py-1">
          <button
            type="button"
            onClick={() => {
              onRename(sectionId, sectionTitle);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            <PenLine className="w-3.5 h-3.5" /> Rename
          </button>
          <button
            type="button"
            onClick={() => {
              onHide(sectionId);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5" /> Hide
          </button>
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          <button
            type="button"
            onClick={() => {
              onDelete(sectionId);
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Base Section Definitions (manifest is structural fallback; DB rules override visibility)
// ============================================================================

const MANIFEST_SECTIONS: NavSection[] = sidebarManifest as NavSection[];

// ============================================================================
// Component
// ============================================================================

export default function SimpleSidebarNav({
  collapsed: externalCollapsed,
  onToggle: externalOnToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const realRole = session?.user?.role as string | undefined;
  const realIsAdmin = realRole === "ADMIN" || realRole === "SUPERADMIN";

  // Branding: institution name + logo
  const { branding } = useBranding();

  // Terminology: institution-specific labels for sidebar items
  const { terms } = useTerminology();

  // Masquerade: override sidebar role filtering to match masqueraded user
  const { isMasquerading, effectiveRole } = useMasquerade();
  const userRole = isMasquerading ? effectiveRole : realRole;
  const isAdmin = realIsAdmin; // Keep admin features (layout save, masquerade trigger) based on real role
  const effectiveIsAdmin = (ROLE_LEVEL[effectiveRole] ?? 0) >= 4; // For API calls that go through requireAuth
  const { isAdvanced } = useViewMode();

  // ── DB-backed visibility rules (overrides manifest requiredRole/defaultHiddenFor) ──
  const [visibilityRules, setVisibilityRules] = useState<Record<
    string,
    { requiredRole: string | null; defaultHiddenFor: string[] }
  > | null>(null);

  useEffect(() => {
    // Only admins have access to this endpoint; for others, manifest defaults are fine
    if (!effectiveIsAdmin) return;
    fetch("/api/admin/access-control/sidebar-visibility")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.rules?.sections) {
          setVisibilityRules(data.rules.sections);
        }
      })
      .catch((e) => console.warn("[Sidebar] Failed to load visibility rules, using manifest defaults:", e));
  }, [effectiveIsAdmin]);

  const BASE_SECTIONS = useMemo(() => {
    if (!visibilityRules) return MANIFEST_SECTIONS;
    return MANIFEST_SECTIONS.map((section) => {
      const dbRule = visibilityRules[section.id];
      if (!dbRule) return section;
      return {
        ...section,
        requiredRole: dbRule.requiredRole ?? section.requiredRole,
        defaultHiddenFor: dbRule.defaultHiddenFor ?? section.defaultHiddenFor,
      };
    });
  }, [visibilityRules]);
  const assistant = useGlobalAssistant();
  const guidance = useGuidance();

  // Active task count badge
  const [taskActiveCount, setTaskActiveCount] = useState(0);

  useEffect(() => {
    if (!userId) return;

    const fetchTaskCount = async () => {
      try {
        const res = await fetch("/api/tasks/counts");
        const data = await res.json();
        if (data.ok) {
          setTaskActiveCount(data.counts?.processing ?? 0);
        }
      } catch {
        // Silent fail
      }
    };

    fetchTaskCount();
    const interval = setInterval(fetchTaskCount, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  // Student artifact notification badge
  const [studentUnreadCount, setStudentUnreadCount] = useState(0);

  useEffect(() => {
    if (!userId || userRole !== "STUDENT") return;

    const fetchStudentUnread = async () => {
      try {
        const res = await fetch("/api/student/notifications");
        const data = await res.json();
        if (data.ok) {
          setStudentUnreadCount(data.unreadCount || 0);
        }
      } catch {
        // Silent fail
      }
    };

    fetchStudentUnread();
    const interval = setInterval(fetchStudentUnread, 30000);
    return () => clearInterval(interval);
  }, [userId, userRole]);

  // Content review queue count badge (OPERATOR+ only)
  const [reviewCount, setReviewCount] = useState(0);
  const isOperatorPlus = ["OPERATOR", "ADMIN", "SUPERADMIN"].includes(userRole || "");

  useEffect(() => {
    if (!userId || !isOperatorPlus) return;

    const fetchReviewCount = async () => {
      try {
        const res = await fetch("/api/content-review/counts");
        const data = await res.json();
        if (data.ok) {
          const c = data.counts;
          setReviewCount((c?.unreviewed ?? 0) + (c?.dirty ?? 0) + (c?.errors ?? 0));
        }
      } catch {
        // Silent fail
      }
    };

    fetchReviewCount();
    const interval = setInterval(fetchReviewCount, 30000);
    return () => clearInterval(interval);
  }, [userId, isOperatorPlus]);

  // Collapse state
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = externalCollapsed ?? internalCollapsed;
  const onToggle = externalOnToggle ?? (() => setInternalCollapsed((prev) => !prev));

  // Layout hook
  const {
    visibleSections,
    hiddenSectionIds,
    hasCustomLayout,
    hasPersonalDefault,
    isLoaded,
    dragState,
    renameSection,
    hideSection,
    showSection,
    deleteSection,
    undoDeleteSection,
    resetLayout,
    setAsDefault,
    setAsPersonalDefault,
    sectionDragHandlers,
    itemDragHandlers,
  } = useSidebarLayout({ userId, userRole, baseSections: BASE_SECTIONS, isAdmin, isAdvanced });

  // UI state
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteToast, setDeleteToast] = useState<{
    sectionId: string;
    sectionTitle: string;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);

  // Collapsed sections state (persisted to localStorage)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedSectionsLoaded, setCollapsedSectionsLoaded] = useState(false);

  // Hydrate from localStorage after mount (avoids hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hf-sidebar-collapsed-sections");
      if (saved) {
        setCollapsedSections(new Set(JSON.parse(saved)));
      } else {
        // Initialize from collapsedByDefault
        const defaults = BASE_SECTIONS
          .filter((s) => s.collapsedByDefault)
          .map((s) => s.id);
        if (defaults.length > 0) {
          setCollapsedSections(new Set(defaults));
        }
      }
    } catch {
      // ignore
    }
    setCollapsedSectionsLoaded(true);
  }, []);

  // Persist collapsed sections (only after initial load to avoid overwriting)
  useEffect(() => {
    if (collapsedSectionsLoaded) {
      localStorage.setItem("hf-sidebar-collapsed-sections", JSON.stringify([...collapsedSections]));
    }
  }, [collapsedSections, collapsedSectionsLoaded]);

  const toggleSectionCollapse = useCallback((sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const navRef = useRef<HTMLElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus edit input when editing
  useEffect(() => {
    if (editingSectionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSectionId]);

  // Flatten items for keyboard navigation (with role variants + terminology resolved)
  const flatNavItems = useMemo(() => {
    const items: { href: string; label: string }[] = [];
    for (const section of visibleSections) {
      for (const item of section.items) {
        const variant = item.roleVariants?.[userRole || ""] ?? {};
        const termLabel = item.terminologyLabel
          ? resolveTermLabel(item.terminologyLabel, terms)
          : null;
        items.push({
          href: variant.href ?? item.href,
          label: variant.label ?? termLabel ?? item.label,
        });
      }
    }
    return items;
  }, [visibleSections, userRole]);

  // Active state
  const isActive = useCallback(
    (href: string) => {
      if (!isLoaded || !pathname) return false;
      return pathname === href || pathname.startsWith(href + "/");
    },
    [isLoaded, pathname]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flatNavItems.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % flatNavItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + flatNavItems.length) % flatNavItems.length);
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const item = flatNavItems[focusedIndex];
        if (item) router.push(item.href);
      }
    },
    [flatNavItems, focusedIndex, router]
  );

  // Focus link on index change
  useEffect(() => {
    if (focusedIndex >= 0 && navRef.current) {
      const links = navRef.current.querySelectorAll("a[data-nav-item]");
      const link = links[focusedIndex] as HTMLElement;
      if (link) link.focus();
    }
  }, [focusedIndex]);

  // Handle nav click (refresh if same page)
  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      const [targetPath] = href.split("?");
      if (targetPath === pathname) {
        e.preventDefault();
        router.replace(href);
      }
      // Call onNavigate for mobile overlay close
      onNavigate?.();
    },
    [pathname, router, onNavigate]
  );

  // Handle rename
  const handleStartRename = useCallback((sectionId: string, currentTitle: string) => {
    setEditingSectionId(sectionId);
    setEditingTitle(currentTitle || "");
  }, []);

  const handleFinishRename = useCallback(() => {
    if (editingSectionId) {
      renameSection(editingSectionId, editingTitle.trim());
      setEditingSectionId(null);
      setEditingTitle("");
    }
  }, [editingSectionId, editingTitle, renameSection]);

  // Handle delete with undo toast
  const handleDeleteSection = useCallback((sectionId: string) => {
    const section = visibleSections.find((s) => s.id === sectionId);
    const title = section?.title || sectionId;

    deleteSection(sectionId);

    // Clear any existing toast timeout
    if (deleteToast?.timeoutId) clearTimeout(deleteToast.timeoutId);

    const timeoutId = setTimeout(() => {
      setDeleteToast(null);
    }, 5000);

    setDeleteToast({ sectionId, sectionTitle: title, timeoutId });
  }, [visibleSections, deleteSection, deleteToast]);

  const handleUndoDelete = useCallback(() => {
    if (!deleteToast) return;
    clearTimeout(deleteToast.timeoutId);
    undoDeleteSection(deleteToast.sectionId);
    setDeleteToast(null);
  }, [deleteToast, undoDeleteSection]);


  return (
    <div className="relative flex h-full flex-col" style={{ color: "var(--text-primary)", zIndex: 50 }}>
      {/* Navigation panel */}
      <div className={collapsed ? "flex h-full flex-col px-1.5 py-2" : "flex h-full flex-col p-2"}>
      {/* Header */}
      {collapsed ? (
        <div className="mb-3 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="sidebar-icon-btn"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <Link
            href="/x"
            className="sidebar-icon-btn"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={assistant.toggle}
            title={assistant.isOpen ? "Hide AI Assistant" : "Show AI Assistant"}
            className={
              "sidebar-icon-btn " +
              (assistant.isOpen
                ? "bg-[var(--surface-selected)] text-[var(--accent-primary)]"
                : "")
            }
          >
            <Bot className="w-4 h-4" />
          </button>
          <div className="w-6 my-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2">
          {branding.logoUrl ? (
            <Link href="/x" className="flex items-center">
              <img src={branding.logoUrl} alt={branding.name} style={{ height: 22 }} />
            </Link>
          ) : (
            <Link
              href="/x"
              className="text-[13px] font-bold tracking-tight hover:text-[var(--accent-primary)] transition-colors"
            >
              {branding.name}
            </Link>
          )}

          <div className="flex items-center gap-0.5">
            {/* AI assistant toggle */}
            <button
              type="button"
              onClick={assistant.toggle}
              title={assistant.isOpen ? "Hide AI Assistant" : "Show AI Assistant"}
              className={
                "w-9 h-9 flex items-center justify-center rounded-md transition-colors " +
                (assistant.isOpen
                  ? "bg-[var(--surface-selected)] text-[var(--accent-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]")
              }
            >
              <Bot className="w-4.5 h-4.5" />
            </button>

            {/* Collapse toggle */}
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg)] transition-colors"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Scrollable nav area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sidebar-scroll">
        <nav ref={navRef} className={collapsed ? "flex flex-col gap-1" : "flex flex-col gap-4"} onKeyDown={handleKeyDown} role="navigation" aria-label="Main navigation">
          {visibleSections.map((section) => {
            // Resolve terminology for section title (e.g. "institution" → "My Organization")
            const termSectionKey = (section as NavSection & { terminologySectionTitle?: string }).terminologySectionTitle;
            const sectionDisplayTitle = termSectionKey
              ? `My ${(terms as Record<string, string>)[termSectionKey] ?? section.title}`
              : section.title;

            const isDraggingSection = dragState.draggedSection === section.id;
            const isDragOverForSection = dragState.dragOverSection === section.id;
            const isDragOverForItem = dragState.dragOverSectionForItem === section.id && dragState.draggedItem !== null;

            return (
              <div
                key={section.id}
                draggable={!collapsed && !dragState.draggedItem}
                onDragStart={(e) => !dragState.draggedItem && sectionDragHandlers.onDragStart(e, section.id)}
                onDragOver={(e) =>
                  dragState.draggedItem
                    ? itemDragHandlers.onDragOverSection(e, section.id)
                    : sectionDragHandlers.onDragOver(e, section.id)
                }
                onDragLeave={sectionDragHandlers.onDragLeave}
                onDrop={(e) =>
                  dragState.draggedItem
                    ? itemDragHandlers.onDropOnSection(e, section.id)
                    : sectionDragHandlers.onDrop(e, section.id)
                }
                onDragEnd={sectionDragHandlers.onDragEnd}
                className={
                  "flex flex-col transition-all rounded-md " +
                  (isDraggingSection ? "opacity-50 " : "") +
                  (isDragOverForSection ? "border-t-2 border-[var(--accent-primary)] " : "") +
                  (isDragOverForItem ? "bg-[var(--surface-selected)] ring-2 ring-[var(--accent-primary)] ring-inset " : "")
                }
                style={{ cursor: collapsed ? "default" : dragState.draggedItem ? "default" : "grab" }}
              >
                {/* Section divider */}
                {section.title && (
                  <div className={collapsed ? "mx-2 my-0.5 border-t" : "mx-2 mt-1 border-t"} style={{ borderColor: "var(--border-subtle)" }} />
                )}

                {/* Section title with kebab menu */}
                {section.title && !collapsed && (
                  <div
                    className="flex items-center justify-between px-2 pb-0.5 pt-2"
                    onMouseEnter={() => setHoveredSectionId(section.id)}
                    onMouseLeave={() => setHoveredSectionId(null)}
                  >
                    {editingSectionId === section.id ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={handleFinishRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishRename();
                          if (e.key === "Escape") {
                            setEditingSectionId(null);
                            setEditingTitle("");
                          }
                        }}
                        className="w-full text-[10px] font-semibold tracking-widest uppercase bg-transparent border-b border-[var(--accent-primary)] outline-none"
                        style={{ color: "var(--text-secondary)" }}
                      />
                    ) : (
                      <div className="flex-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSectionCollapse(section.id)}
                          className="flex-shrink-0 p-0 transition-colors"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <ChevronDown
                            className="w-3 h-3 transition-transform"
                            style={{
                              transform: collapsedSections.has(section.id) ? "rotate(-90deg)" : "rotate(0deg)",
                            }}
                          />
                        </button>
                        {section.href ? (
                          <Link
                            href={section.href}
                            className="group flex items-center text-[10px] font-semibold tracking-widest uppercase transition-colors"
                            style={{
                              color: isActive(section.href) ? "var(--accent-primary)" : "var(--text-muted)",
                              textDecoration: "none",
                            }}
                          >
                            <span>{sectionDisplayTitle}</span>
                            <span className="opacity-0 group-hover:opacity-60 transition-opacity text-[9px] ml-1">{"\u203A"}</span>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleSectionCollapse(section.id)}
                            className="text-[10px] font-semibold tracking-widest uppercase transition-colors"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {sectionDisplayTitle}
                          </button>
                        )}
                      </div>
                    )}

                    {editingSectionId !== section.id && (
                      <SectionKebabMenu
                        sectionId={section.id}
                        sectionTitle={sectionDisplayTitle || section.id}
                        visible={hoveredSectionId === section.id}
                        onRename={handleStartRename}
                        onHide={hideSection}
                        onDelete={handleDeleteSection}
                      />
                    )}
                  </div>
                )}

                {/* Section items (collapsible) */}
                <div
                  className={
                    (collapsed ? "flex flex-col items-center gap-0.5" : "flex flex-col gap-1") +
                    " overflow-hidden transition-all duration-200"
                  }
                  style={{
                    maxHeight: !collapsed && section.title && collapsedSections.has(section.id) ? "0px" : "500px",
                    opacity: !collapsed && section.title && collapsedSections.has(section.id) ? 0 : 1,
                  }}
                >
                  {section.items.map((rawItem) => {
                    // Resolve role-specific overrides
                    const variant = rawItem.roleVariants?.[userRole || ""] ?? {};
                    // Resolve terminology label (takes priority over manifest default, but not explicit role variant)
                    const termLabel = rawItem.terminologyLabel
                      ? resolveTermLabel(rawItem.terminologyLabel, terms)
                      : null;
                    const item = {
                      ...rawItem,
                      label: variant.label ?? termLabel ?? rawItem.label,
                      href: variant.href ?? rawItem.href,
                      icon: variant.icon ?? rawItem.icon,
                    };
                    const active = isActive(item.href);
                    const itemIndex = flatNavItems.findIndex((fi) => fi.href === item.href);
                    const isFocused = itemIndex === focusedIndex;
                    const isDraggingItem = dragState.draggedItem === item.href;
                    const isDragOverThisItem = dragState.dragOverItem === item.href;

                    // Highlighted items (e.g. Pipeline)
                    const baseClass = item.highlighted && !active
                      ? "bg-[var(--surface-selected)] "
                      : "";

                    // Dynamic highlight from GuidanceContext
                    const highlight = guidance?.getHighlight(item.href);
                    const highlightClass = highlight && !active
                      ? `sidebar-highlight-${highlight.type} `
                      : "";

                    const shortcutHint = (rawItem as any).shortcutHint as string | undefined;

                    return collapsed ? (
                      <Link
                        key={item.id}
                        href={item.href}
                        title={shortcutHint ? `${item.label} (${shortcutHint})` : item.label}
                        data-nav-item
                        tabIndex={0}
                        onClick={(e) => handleNavClick(e, item.href)}
                        onFocus={() => setFocusedIndex(itemIndex)}
                        className={
                          "sidebar-icon-btn " +
                          (active
                            ? "sidebar-icon-btn-active"
                            : "hover:bg-[var(--hover-bg)]")
                        }
                      >
                        {item.icon && (
                          <NavIcon
                            name={item.icon}
                            className={
                              "w-[18px] h-[18px] " +
                              (active ? "text-[var(--accent-primary)]" : "text-[var(--text-muted)]")
                            }
                          />
                        )}
                        {/* Badge dot for jobs/notifications in collapsed mode */}
                        {item.href === "/x/jobs" && taskActiveCount > 0 && (
                          <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "var(--accent-primary)" }} />
                        )}
                        {item.href === "/x/student/stuff" && studentUnreadCount > 0 && (
                          <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "var(--accent-primary)" }} />
                        )}
                        {item.href === "/x/content-review" && reviewCount > 0 && (
                          <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "var(--status-warning-text)" }} />
                        )}
                      </Link>
                    ) : (
                      <Link
                        key={item.id}
                        href={item.href}
                        title={shortcutHint ? `${item.label} (${shortcutHint})` : undefined}
                        data-nav-item
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => itemDragHandlers.onDragStart(e, item.href)}
                        onDragOver={(e) => itemDragHandlers.onDragOverItem(e, item.href, section.id)}
                        onDrop={(e) => itemDragHandlers.onDropOnItem(e, item.href, section.id)}
                        onDragEnd={itemDragHandlers.onDragEnd}
                        onClick={(e) => handleNavClick(e, item.href)}
                        onFocus={() => setFocusedIndex(itemIndex)}
                        className={
                          baseClass +
                          highlightClass +
                          "sidebar-nav-item " +
                          (isDraggingItem ? "opacity-50 " : "") +
                          (isDragOverThisItem ? "border-t-2 border-[var(--accent-primary)] " : "") +
                          (active
                            ? "font-semibold"
                            : isFocused
                              ? "bg-[var(--hover-bg)] font-medium"
                              : "font-medium hover:bg-[var(--hover-bg)]")
                        }
                        style={{
                          cursor: "grab",
                          color: active ? "var(--accent-primary)" : "var(--text-primary)",
                          background: active ? "color-mix(in srgb, var(--accent-primary) 8%, transparent)" : undefined,
                        }}
                      >
                        {item.icon && (
                          <span className="flex items-center justify-center w-5 h-5 flex-shrink-0 rounded-md transition-colors">
                            <NavIcon
                              name={item.icon}
                              className={
                                "w-[16px] h-[16px] " +
                                (active ? "text-[var(--accent-primary)]" : "text-[var(--text-muted)]")
                              }
                            />
                          </span>
                        )}
                        <span className="truncate">{item.label}</span>
                        {(rawItem as any).wizard && (
                          <Sparkles
                            className="w-[11px] h-[11px] flex-shrink-0 ml-0.5"
                            style={{ color: "var(--status-warning-text)", opacity: 0.75 }}
                            title="Guided flow"
                          />
                        )}
                        {(rawItem as any).tag && (
                          <span
                            className="ml-auto inline-flex items-center justify-center rounded text-[9px] font-bold tracking-wide px-1.5 py-0.5 flex-shrink-0"
                            style={{
                              background: "color-mix(in srgb, var(--status-success-text) 15%, transparent)",
                              color: "var(--status-success-text)",
                              border: "1px solid color-mix(in srgb, var(--status-success-text) 25%, transparent)",
                            }}
                          >
                            {(rawItem as any).tag}
                          </span>
                        )}
                        {item.href === "/x/jobs" && taskActiveCount > 0 && (
                          <span
                            className="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-white min-w-[18px] px-1.5 py-0.5"
                            style={{
                              background: "var(--accent-primary)",
                              opacity: active ? 0.8 : 1,
                            }}
                          >
                            {taskActiveCount}
                          </span>
                        )}
                        {item.href === "/x/student/stuff" && studentUnreadCount > 0 && (
                          <span
                            className="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-white min-w-[18px] px-1.5 py-0.5"
                            style={{
                              background: "var(--accent-primary)",
                              opacity: active ? 0.8 : 1,
                            }}
                          >
                            {studentUnreadCount}
                          </span>
                        )}
                        {item.href === "/x/content-review" && reviewCount > 0 && (
                          <span
                            className="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-white min-w-[18px] px-1.5 py-0.5"
                            style={{
                              background: "var(--status-warning-text)",
                              opacity: active ? 0.8 : 1,
                            }}
                          >
                            {reviewCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        </div>
      </div>
      {/* End: Navigation panel */}

      {/* Undo delete toast */}
      {deleteToast && (
        <div
          className="absolute bottom-3 left-2 right-2 z-50 flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 shadow-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          <span className="text-xs">
            Deleted <strong>{deleteToast.sectionTitle}</strong>
          </span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="text-xs font-semibold transition-colors"
            style={{ color: "var(--accent-primary)" }}
          >
            Undo
          </button>
        </div>
      )}

      <style>{`
        .sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text-muted) 30%, transparent); border-radius: 4px; }
        .sidebar-scroll:hover::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text-muted) 50%, transparent); }
      `}</style>
    </div>
  );
}

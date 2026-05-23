'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * SectionHeader — title + icon for a logical block on a course page.
 *
 * When `collapsible` is set, the header turns into a button: clicking
 * toggles the content (passed as children) and the open/closed state is
 * persisted to localStorage so it sticks across sessions. `persistKey`
 * is appended to a stable namespace; pass something unique per course
 * + section so different courses can have different defaults.
 */
export function SectionHeader({
  title, icon: Icon, subtitle, actions,
  collapsible = false,
  defaultCollapsed = false,
  persistKey,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  subtitle?: string;
  actions?: React.ReactNode;
  /** When true, the header toggles a content panel and persists state. */
  collapsible?: boolean;
  /** Initial state when no persisted value exists. */
  defaultCollapsed?: boolean;
  /** Storage key suffix — combined with a stable prefix. */
  persistKey?: string;
  /** Content to show / hide when collapsible. Ignored when not collapsible. */
  children?: React.ReactNode;
}) {
  const storageKey = persistKey ? `hf.course.section.${persistKey}` : null;

  // Initialise from localStorage when collapsible; otherwise no state needed.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!collapsible) return false;
    if (typeof window === 'undefined' || !storageKey) return defaultCollapsed;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'open') return false;
      if (stored === 'collapsed') return true;
      return defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });

  // Persist when the user toggles.
  useEffect(() => {
    if (!collapsible || !storageKey || typeof window === 'undefined') return;
    try {
      localStorage.setItem(storageKey, collapsed ? 'collapsed' : 'open');
    } catch {
      // ignore
    }
  }, [collapsed, collapsible, storageKey]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  // Non-collapsible — original rendering preserved.
  if (!collapsible) {
    return (
      <div className={subtitle ? 'hf-flex-col hf-mb-md hf-section-divider' : 'hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider'}>
        <div className="hf-flex hf-gap-sm hf-items-center hf-flex-1">
          <Icon size={18} className="hf-text-muted" />
          <h2 className="hf-section-title hf-mb-0">{title}</h2>
        </div>
        {actions}
        {subtitle && (
          <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">{subtitle}</p>
        )}
      </div>
    );
  }

  // Collapsible — header is a button, optional content panel below.
  return (
    <>
      <div className={subtitle ? 'hf-flex-col hf-mb-md hf-section-divider' : 'hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider'}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="hf-flex hf-gap-sm hf-items-center hf-flex-1"
          style={{
            background: 'transparent', border: 'none', padding: 0, margin: 0,
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          {collapsed
            ? <ChevronRight size={16} className="hf-text-muted" />
            : <ChevronDown size={16} className="hf-text-muted" />}
          <Icon size={18} className="hf-text-muted" />
          <h2 className="hf-section-title hf-mb-0">{title}</h2>
        </button>
        {actions}
        {subtitle && (
          <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">{subtitle}</p>
        )}
      </div>
      {!collapsed && children}
    </>
  );
}

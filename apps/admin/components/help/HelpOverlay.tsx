"use client";

import React, { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useHelpContext } from "@/contexts/HelpContext";
import { useSession } from "next-auth/react";
import { useChatContext, MODE_CONFIG, type ChatMode } from "@/contexts/ChatContext";
import { getPageHelp, canSeeOperatorOnly, GLOBAL_CHORDS, type PageHelp } from "@/lib/help/page-help";
import { GLOBAL_SHORTCUTS } from "@/lib/help/global-shortcuts";
import { useHelpKeyboard } from "@/hooks/useHelpKeyboard";
import "./help-overlay.css";

// Chat commands surfaced in the overlay's "Chat commands" section. Sourced
// from lib/chat/commands.ts — kept as a static mirror here because that file
// is server-side (imports prisma). Update both if you add or remove commands.
const CHAT_COMMAND_HELP: Record<ChatMode, Array<{ name: string; description: string }>> = {
  DATA: [
    { name: "/help", description: "Show available commands" },
    { name: "/clear", description: "Clear chat history for this mode" },
    { name: "/context", description: "Show current entity context" },
    { name: "/memories", description: "Show memories for current caller" },
    { name: "/buildprompt", description: "Show the composed prompt for current caller" },
    { name: "/caller", description: "Show information about the current caller" },
  ],
  TUNING: [
    { name: "/help", description: "Show available commands" },
    { name: "/clear", description: "Clear chat history for this mode" },
    { name: "/context", description: "Show current entity context" },
    { name: "/scope", description: "Show current tuning scope (LEARNER or PLAYBOOK)" },
    { name: "/params", description: "List tunable parameters for current context" },
  ],
};

export function HelpOverlay() {
  useHelpKeyboard();
  const { isOpen, close } = useHelpContext();
  const { isOpen: chatOpen, mode: chatMode } = useChatContext();
  const { data: session } = useSession();
  const pathname = usePathname() || "/";
  const rawPageHelp = getPageHelp(pathname);
  const isOperator = canSeeOperatorOnly(session?.user?.role as string | undefined);
  // Filter operator-only tabs and chords so VIEWER/STUDENT/TESTER don't see
  // affordances they can't actually use.
  const pageHelp: PageHelp | undefined = rawPageHelp
    ? {
        ...rawPageHelp,
        tabs: rawPageHelp.tabs?.filter((t) => !t.requiresOperator || isOperator),
        chords: rawPageHelp.chords?.filter((c) => !c.requiresOperator || isOperator),
      }
    : undefined;
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) closeBtnRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-overlay-title"
      data-help-overlay-root
      className="help-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={panelRef} className="help-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <header className="help-overlay-header">
          <h2 id="help-overlay-title" className="help-overlay-title">
            Help — {pageHelp?.title ?? "This page"}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={close}
            className="help-overlay-close"
            aria-label="Close help"
          >
            <X size={18} />
          </button>
        </header>

        <div className="help-overlay-body">
          <Section title="About this page">
            {pageHelp ? (
              <p className="help-overlay-about">{pageHelp.about}</p>
            ) : (
              <p className="help-overlay-empty">No page guide yet for this route.</p>
            )}
          </Section>

          <Section title="Tabs">
            {pageHelp?.tabs?.length ? (
              <dl className="help-overlay-tabs">
                {pageHelp.tabs.map((t) => (
                  <React.Fragment key={t.id}>
                    <dt className="help-overlay-tab-label">{t.label}</dt>
                    <dd className="help-overlay-tab-about">
                      {t.about}
                      {t.whenToUse ? <span className="help-overlay-tab-when"> {t.whenToUse}</span> : null}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : (
              <p className="help-overlay-empty">No tabs on this page.</p>
            )}
          </Section>

          <Section title="Shortcuts — on this page">
            <p className="help-overlay-chord-hint">
              Press <kbd>H</kbd> or <kbd>G</kbd> followed by the chord letter — either prefix works.
              Or cycle tabs with <kbd>⌥</kbd>+<kbd>⇧</kbd>+<kbd>←</kbd> / <kbd>⌥</kbd>+<kbd>⇧</kbd>+<kbd>→</kbd>.
            </p>
            {pageHelp?.chords?.length ? (
              <ShortcutList
                items={[
                  ...pageHelp.chords.map((c) => ({
                    keys: `H/G + ${c.keys}`,
                    description: c.label,
                  })),
                  ...(pageHelp.tabs && pageHelp.tabs.length > 1
                    ? [
                        {
                          keys: "⌥⇧←  /  ⌥⇧→",
                          description: "Previous / next tab (cycles)",
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className="help-overlay-empty">No page-specific shortcuts.</p>
            )}
          </Section>

          <Section title="Shortcuts — global">
            <ShortcutList
              items={[
                ...GLOBAL_SHORTCUTS,
                // Derive the chord nav display strings from the actual bindings
                // so the overlay can't claim a chord that doesn't exist. Filter
                // out keys that the active page has overridden (page chord wins
                // on collision, so listing the global form here would mislead).
                ...GLOBAL_CHORDS.filter((g) => {
                  const pageKeys = new Set((pageHelp?.chords ?? []).map((c) => c.keys.toUpperCase()));
                  return !pageKeys.has(g.keys.toUpperCase());
                }).map((c) => ({
                  keys: `H/G + ${c.keys}`,
                  description: c.label,
                })),
              ]}
            />
          </Section>

          {chatOpen && (
            <Section title={`Chat commands  ·  ${MODE_CONFIG[chatMode]?.label ?? chatMode} mode`}>
              <dl className="help-overlay-tabs">
                {(CHAT_COMMAND_HELP[chatMode] ?? []).map((c) => (
                  <React.Fragment key={c.name}>
                    <dt className="help-overlay-tab-label">
                      <code>{c.name}</code>
                    </dt>
                    <dd className="help-overlay-tab-about">{c.description}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="help-overlay-section">
      <h3 className="help-overlay-section-title">{title}</h3>
      {children}
    </section>
  );
}

function ShortcutList({ items }: { items: Array<{ keys: string; description: string }> }) {
  return (
    <dl className="help-overlay-shortcuts">
      {items.map((s, i) => (
        <React.Fragment key={`${s.keys}-${i}`}>
          <dt className="help-overlay-shortcut-keys">
            <kbd>{s.keys}</kbd>
          </dt>
          <dd className="help-overlay-shortcut-desc">{s.description}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// Re-export the type so other modules can import it from here if convenient.
export type { PageHelp };

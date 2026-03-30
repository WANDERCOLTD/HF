"use client";

/**
 * MessageActions — hover menu on assistant chat bubbles.
 *
 * Extracted from ConversationalWizard to reduce file size.
 * Actions: correct, tell me more, move on, copy, quote & reply.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { AlertCircle, HelpCircle, ChevronsRight, Copy, Quote, MoreHorizontal, Check } from "lucide-react";

// ── Types ─────────────────────────────────────────────────

export interface MessageActionsMessage {
  content: string;
}

interface MessageActionsProps {
  message: MessageActionsMessage;
  onSend: (text: string) => void;
  onPrefill: (text: string) => void;
  onFocusInput: () => void;
}

// ── Helpers ───────────────────────────────────────────────

function firstTwoLines(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  return lines.slice(0, 2).map((l) => l.length > 100 ? l.slice(0, 100) + "…" : l).join("\n");
}

const COPY_FEEDBACK_MS = 1800;

// ── Component ─────────────────────────────────────────────

export function MessageActions({ message, onSend, onPrefill, onFocusInput }: MessageActionsProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const actions = [
    { id: "correct", label: "That's not right", icon: AlertCircle },
    { id: "more", label: "Tell me more", icon: HelpCircle },
    { id: "skip", label: "Move on", icon: ChevronsRight },
    { id: "divider" },
    { id: "copy", label: "Copy", icon: Copy },
    { id: "quote", label: "Quote & reply", icon: Quote },
  ] as const;

  const actionItems = actions.filter((a) => a.id !== "divider") as Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }> }>;

  const handleOpen = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 200;
    const menuHeight = 220;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceAbove >= menuHeight + 4
      ? rect.top - menuHeight - 4
      : spaceBelow >= menuHeight + 4
        ? rect.bottom + 4
        : Math.max(8, window.innerHeight - menuHeight - 8);
    const left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
    setPos({ top, left: Math.max(8, left) });
    setOpen(true);
    setFocusedIndex(-1);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setPos(null);
    setFocusedIndex(-1);
  }, []);

  const handleAction = useCallback((id: string) => {
    handleClose();
    switch (id) {
      case "correct":
        onPrefill(`That's not right:\n\n> ${firstTwoLines(message.content)}\n\n`);
        onFocusInput();
        break;
      case "more":
        onSend("Tell me more about that");
        break;
      case "skip":
        onSend("Move on");
        break;
      case "copy":
        navigator.clipboard.writeText(message.content).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
        }).catch(() => {
          // Fallback for browsers without clipboard API
          const ta = document.createElement("textarea");
          ta.value = message.content;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          setCopied(true);
          setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
        });
        break;
      case "quote":
        onPrefill(`> ${firstTwoLines(message.content)}\n\n`);
        onFocusInput();
        break;
    }
  }, [handleClose, message.content, onSend, onPrefill, onFocusInput]);

  // Click outside + Escape
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [open, handleClose]);

  // Focus first item when menu opens
  useEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLButtonElement>("[role=menuitem]");
      first?.focus();
      setFocusedIndex(0);
    }
  }, [open]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => {
        const next = Math.min(i + 1, actionItems.length - 1);
        menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[next]?.focus();
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => {
        const prev = Math.max(i - 1, 0);
        menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[prev]?.focus();
        return prev;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < actionItems.length) {
        handleAction(actionItems[focusedIndex].id);
      }
    }
  }, [focusedIndex, actionItems, handleAction]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cv4-msg-actions-trigger"
        onClick={handleOpen}
        aria-label={copied ? "Copied" : "Message actions"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions for this message"
      >
        {copied ? <Check size={16} /> : <MoreHorizontal size={16} />}
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          className="cv4-msg-actions-menu"
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          onKeyDown={handleMenuKeyDown}
        >
          {actions.map((action, i) =>
            action.id === "divider" ? (
              <div key={i} className="cv4-msg-actions-divider" role="separator" />
            ) : (
              <button
                key={action.id}
                type="button"
                className="cv4-msg-actions-item"
                role="menuitem"
                tabIndex={-1}
                onClick={() => handleAction(action.id)}
              >
                {action.icon && <action.icon size={15} />}
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}

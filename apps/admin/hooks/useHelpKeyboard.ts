"use client";

import { useEffect } from "react";
import { isFocusBlocked } from "@/lib/help/isFocusBlocked";
import { useHelpContext } from "@/contexts/HelpContext";

/**
 * Global `?` keypress → toggle Help Overlay.
 *
 * Guards:
 *   - Skipped when focus is inside INPUT / TEXTAREA / contenteditable
 *     (isFocusBlocked) — typing `?` into a chat message must not trigger
 *   - Skipped when any other dialog/modal is already open (prevents
 *     stacking on top of an existing modal)
 *
 * Closes via Escape, second `?` press, or the X button in the overlay.
 */
export function useHelpKeyboard() {
  const { isOpen, toggle, close } = useHelpContext();

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "?") return;
      if (isFocusBlocked(e)) return;
      if (!isOpen) {
        const otherDialog = document.querySelector('[role="dialog"][data-help-overlay-root]');
        const anyDialog = document.querySelector('[role="dialog"]');
        if (anyDialog && !otherDialog) return;
      }
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [isOpen, toggle, close]);
}

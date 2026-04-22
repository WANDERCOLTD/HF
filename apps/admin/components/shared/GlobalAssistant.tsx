"use client";

import { useEffect } from "react";
import { useChatContext } from "@/contexts/ChatContext";
import { useGlobalAssistant } from "@/contexts/AssistantContext";
import { ChatPanel } from "@/components/chat/ChatPanel";

/**
 * Global AI Assistant — renders ChatPanel as the Cmd+K surface.
 *
 * ChatPanel uses `/api/chat` DATA mode with streaming, tool calling,
 * entity context, and localStorage persistence.
 *
 * Open state is driven by AssistantContext (shared with FloatingAssistant,
 * DockedAssistant, etc.) and synced into ChatContext so ChatPanel responds.
 *
 * TODO(#200): FloatingAssistant / DockedAssistant / MinimizedAssistant
 * still render the old UnifiedAssistantPanel. Swap them in a follow-up story.
 */
export function GlobalAssistant() {
  const assistant = useGlobalAssistant();
  const chat = useChatContext();

  // Sync AssistantContext.isOpen → ChatContext open/close
  // AssistantContext is the single source of truth for the global toggle.
  useEffect(() => {
    if (assistant.isOpen && !chat.isOpen) {
      chat.openPanel();
    } else if (!assistant.isOpen && chat.isOpen) {
      chat.closePanel();
    }
    // Only react to assistant.isOpen changes — avoid feedback loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.isOpen]);

  // Sync ChatContext.isOpen → AssistantContext (reverse direction)
  // This handles the case where ChatPanel's own close button is clicked.
  useEffect(() => {
    if (!chat.isOpen && assistant.isOpen) {
      assistant.close();
    } else if (chat.isOpen && !assistant.isOpen) {
      assistant.open();
    }
    // Only react to chat.isOpen changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isOpen]);

  // Global Cmd+K keyboard shortcut — drives AssistantContext.toggle
  // ChatPanel also registers Cmd+K via useChatKeyboardShortcut on ChatContext.
  // To avoid double-toggle, we only register here (ChatPanel's hook is removed below).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        assistant.toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [assistant]);

  // Render ChatPanel — it reads isOpen from ChatContext (synced above)
  return <ChatPanel />;
}

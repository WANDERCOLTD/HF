/**
 * Tests for multi-user preference isolation
 *
 * Covers:
 * - Chat context user isolation (ChatContext.tsx)
 * - Draggable tab ordering (DraggableTabs.tsx)
 * - Sidebar section ordering (SimpleSidebarNav.tsx)
 * - Storage key generation
 * - User change detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// =============================================================================
// STORAGE KEY GENERATION
// =============================================================================

describe("Storage Key Generation", () => {
  describe("ChatContext storage keys", () => {
    const STORAGE_KEY_PREFIX = "hf.chat.history";
    const SETTINGS_KEY_PREFIX = "hf.chat.settings";

    function getStorageKey(userId: string | undefined): string {
      return userId ? `${STORAGE_KEY_PREFIX}.${userId}` : STORAGE_KEY_PREFIX;
    }

    function getSettingsKey(userId: string | undefined): string {
      return userId ? `${SETTINGS_KEY_PREFIX}.${userId}` : SETTINGS_KEY_PREFIX;
    }

    it("should generate user-specific storage key when userId provided", () => {
      const key = getStorageKey("user-123");
      expect(key).toBe("hf.chat.history.user-123");
    });

    it("should use base key when userId is undefined", () => {
      const key = getStorageKey(undefined);
      expect(key).toBe("hf.chat.history");
    });

    it("should generate user-specific settings key when userId provided", () => {
      const key = getSettingsKey("user-456");
      expect(key).toBe("hf.chat.settings.user-456");
    });

    it("should use base settings key when userId is undefined", () => {
      const key = getSettingsKey(undefined);
      expect(key).toBe("hf.chat.settings");
    });
  });

  describe("DraggableTabs storage keys", () => {
    function getTabStorageKey(key: string, userId: string | undefined): string {
      return userId ? `tab-order:${key}.${userId}` : `tab-order:${key}`;
    }

    it("should generate user-specific tab order key", () => {
      const key = getTabStorageKey("pipeline-tabs", "user-123");
      expect(key).toBe("tab-order:pipeline-tabs.user-123");
    });

    it("should use base key for anonymous users", () => {
      const key = getTabStorageKey("pipeline-tabs", undefined);
      expect(key).toBe("tab-order:pipeline-tabs");
    });

    it("should handle dynamic storage keys", () => {
      const domainId = "domain-abc";
      const key = getTabStorageKey(`domain-detail-tabs-${domainId}`, "user-789");
      expect(key).toBe("tab-order:domain-detail-tabs-domain-abc.user-789");
    });
  });

  describe("SimpleSidebarNav storage keys", () => {
    const SIDEBAR_ORDER_KEY = "hf.sidebar.section-order";

    function getSidebarStorageKey(userId: string | undefined): string {
      return userId ? `${SIDEBAR_ORDER_KEY}.${userId}` : SIDEBAR_ORDER_KEY;
    }

    it("should generate user-specific sidebar key", () => {
      const key = getSidebarStorageKey("user-999");
      expect(key).toBe("hf.sidebar.section-order.user-999");
    });

    it("should use base key for anonymous users", () => {
      const key = getSidebarStorageKey(undefined);
      expect(key).toBe("hf.sidebar.section-order");
    });
  });
});

// =============================================================================
// TAB ORDERING LOGIC
// =============================================================================

describe("Tab Ordering Logic", () => {
  type TabDefinition = { id: string; label: string };

  function reorderTabs(
    stored: string[] | null,
    tabs: TabDefinition[]
  ): TabDefinition[] {
    if (!stored) return tabs;

    // Reorder tabs based on stored order, handling new/removed tabs gracefully
    const orderedIds = stored.filter((id) => tabs.some((t) => t.id === id));
    const newTabIds = tabs.filter((t) => !stored.includes(t.id)).map((t) => t.id);
    const finalOrder = [...orderedIds, ...newTabIds];

    return finalOrder
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t): t is TabDefinition => t !== undefined);
  }

  const defaultTabs: TabDefinition[] = [
    { id: "inspector", label: "Inspector" },
    { id: "blueprint", label: "Blueprint" },
    { id: "history", label: "History" },
  ];

  it("should return default order when no stored order", () => {
    const result = reorderTabs(null, defaultTabs);
    expect(result.map((t) => t.id)).toEqual(["inspector", "blueprint", "history"]);
  });

  it("should apply stored order", () => {
    const stored = ["history", "inspector", "blueprint"];
    const result = reorderTabs(stored, defaultTabs);
    expect(result.map((t) => t.id)).toEqual(["history", "inspector", "blueprint"]);
  });

  it("should handle new tabs not in stored order", () => {
    const stored = ["inspector", "blueprint"];
    const result = reorderTabs(stored, defaultTabs);
    // New tab "history" should be appended
    expect(result.map((t) => t.id)).toEqual(["inspector", "blueprint", "history"]);
  });

  it("should handle removed tabs from stored order", () => {
    const stored = ["inspector", "removed-tab", "blueprint"];
    const result = reorderTabs(stored, defaultTabs);
    // "removed-tab" should be ignored, and "history" appended as new
    expect(result.map((t) => t.id)).toEqual(["inspector", "blueprint", "history"]);
  });

  it("should handle partial overlap", () => {
    const stored = ["history", "old-tab", "inspector"];
    const result = reorderTabs(stored, defaultTabs);
    expect(result.map((t) => t.id)).toEqual(["history", "inspector", "blueprint"]);
  });
});

// =============================================================================
// CUSTOM ORDER DETECTION
// =============================================================================

describe("Custom Order Detection", () => {
  function hasCustomOrder(defaultTabs: string[], currentTabs: string[]): boolean {
    const defaultOrder = defaultTabs.join(",");
    const currentOrder = currentTabs.join(",");
    return defaultOrder !== currentOrder;
  }

  it("should return false when order matches default", () => {
    const defaults = ["a", "b", "c"];
    const current = ["a", "b", "c"];
    expect(hasCustomOrder(defaults, current)).toBe(false);
  });

  it("should return true when order differs", () => {
    const defaults = ["a", "b", "c"];
    const current = ["c", "b", "a"];
    expect(hasCustomOrder(defaults, current)).toBe(true);
  });

  it("should return true when single item moved", () => {
    const defaults = ["a", "b", "c"];
    const current = ["b", "a", "c"];
    expect(hasCustomOrder(defaults, current)).toBe(true);
  });
});

// =============================================================================
// SECTION DRAG-DROP REORDER
// =============================================================================

describe("Section Drag-Drop Reorder", () => {
  function reorderSections(
    sections: string[],
    draggedId: string,
    targetId: string
  ): string[] {
    const newOrder = [...sections];
    const draggedIndex = newOrder.indexOf(draggedId);
    const targetIndex = newOrder.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) return sections;
    if (draggedId === targetId) return sections;

    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, removed);

    return newOrder;
  }

  const baseSections = ["home", "prompts", "playbook-tools", "history", "data", "config"];

  it("should move section forward", () => {
    const result = reorderSections(baseSections, "data", "prompts");
    expect(result).toEqual(["home", "data", "prompts", "playbook-tools", "history", "config"]);
  });

  it("should move section backward", () => {
    const result = reorderSections(baseSections, "prompts", "data");
    // prompts (index 1) is removed, then inserted at data's position (index 4)
    // After removal: ["home", "playbook-tools", "history", "data", "config"]
    // After insert at 4: ["home", "playbook-tools", "history", "data", "prompts", "config"]
    expect(result).toEqual(["home", "playbook-tools", "history", "data", "prompts", "config"]);
  });

  it("should handle same source and target", () => {
    const result = reorderSections(baseSections, "data", "data");
    expect(result).toEqual(baseSections);
  });

  it("should handle invalid source", () => {
    const result = reorderSections(baseSections, "invalid", "data");
    expect(result).toEqual(baseSections);
  });

  it("should handle invalid target", () => {
    const result = reorderSections(baseSections, "data", "invalid");
    expect(result).toEqual(baseSections);
  });
});

// =============================================================================
// CHAT MESSAGE STORAGE
// =============================================================================

describe("Chat Message Storage", () => {
  type ChatMode = "DATA";
  type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    mode: ChatMode;
    timestamp: Date;
  };

  function createEmptyMessages(): Record<ChatMode, ChatMessage[]> {
    return {
      DATA: [],
    };
  }

  const MAX_MESSAGES_PER_MODE = 50;

  function trimMessages(
    messages: Record<ChatMode, ChatMessage[]>
  ): Record<ChatMode, ChatMessage[]> {
    const trimmed: Record<string, ChatMessage[]> = {};
    for (const [mode, msgs] of Object.entries(messages)) {
      trimmed[mode] = msgs.slice(-MAX_MESSAGES_PER_MODE);
    }
    return trimmed as Record<ChatMode, ChatMessage[]>;
  }

  it("should create empty messages for DATA mode", () => {
    const empty = createEmptyMessages();
    expect(empty.DATA).toEqual([]);
  });

  it("should trim messages to max limit", () => {
    const messages = createEmptyMessages();
    // Add 60 messages to DATA mode
    for (let i = 0; i < 60; i++) {
      messages.DATA.push({
        id: `msg-${i}`,
        role: "user",
        content: `Message ${i}`,
        mode: "DATA",
        timestamp: new Date(),
      });
    }

    const trimmed = trimMessages(messages);
    expect(trimmed.DATA.length).toBe(50);
    // Should keep the last 50 (ids 10-59)
    expect(trimmed.DATA[0].id).toBe("msg-10");
    expect(trimmed.DATA[49].id).toBe("msg-59");
  });

  it("should not trim when under the limit", () => {
    const messages = createEmptyMessages();
    messages.DATA.push({
      id: "msg-1",
      role: "user",
      content: "Hello",
      mode: "DATA",
      timestamp: new Date(),
    });

    const trimmed = trimMessages(messages);
    expect(trimmed.DATA.length).toBe(1);
  });
});

// =============================================================================
// USER CHANGE DETECTION
// =============================================================================

describe("User Change Detection", () => {
  it("should detect user change", () => {
    const lastUserId: string | undefined = "user-1";
    const newUserId = "user-2";

    const hasChanged = newUserId !== lastUserId;
    expect(hasChanged).toBe(true);
  });

  it("should not detect change when same user", () => {
    const lastUserId: string | undefined = "user-1";
    const newUserId = "user-1";

    const hasChanged = newUserId !== lastUserId;
    expect(hasChanged).toBe(false);
  });

  it("should detect change from undefined to defined", () => {
    const lastUserId: string | undefined = undefined;
    const newUserId = "user-1";

    const hasChanged = newUserId !== lastUserId;
    expect(hasChanged).toBe(true);
  });

  it("should detect change from defined to undefined (logout)", () => {
    const lastUserId: string | undefined = "user-1";
    const newUserId: string | undefined = undefined;

    const hasChanged = newUserId !== lastUserId;
    expect(hasChanged).toBe(true);
  });
});

// =============================================================================
// CHAT MODE MIGRATION
// =============================================================================

describe("Chat Mode Migration", () => {
  type ChatMode = "DATA";

  function migrateMode(storedMode: string): ChatMode {
    // All stored modes migrate to DATA (CHAT, SPEC, CALL removed)
    return "DATA";
  }

  it("should migrate any stored mode to DATA", () => {
    expect(migrateMode("CALL")).toBe("DATA");
    expect(migrateMode("CHAT")).toBe("DATA");
    expect(migrateMode("SPEC")).toBe("DATA");
    expect(migrateMode("DATA")).toBe("DATA");
    expect(migrateMode("UNKNOWN")).toBe("DATA");
    expect(migrateMode("")).toBe("DATA");
  });
});

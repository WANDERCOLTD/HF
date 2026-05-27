/**
 * #911 — ChatContext tuningScope reset on entity-type transition.
 *
 * Closes the "stale PLAYBOOK toggle on a caller page" hole flagged in #911:
 * when the active entity's *type* changes (caller ↔ playbook ↔ neither),
 * the tuningScope toggle must reset to `null` so the AI re-asks. Same-type
 * id changes (caller A → caller B) must NOT reset — those are routine
 * drill-downs that shouldn't drop the educator's prior choice.
 *
 * Mocks `next-auth/react` and `next/navigation` so we don't need a real
 * session/router. Wraps `useChatContext` in both `EntityProvider` and
 * `ChatProvider` and drives entity transitions via the entity-context
 * actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// Mock next-auth: provide a stable session so ChatProvider hydrates past
// the "session === undefined" guard.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "u-test", email: "t@x", name: "T", role: "OPERATOR", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    status: "authenticated",
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/x/test",
}));

import { ChatProvider, useChatContext } from "@/contexts/ChatContext";
import { EntityProvider, useEntityContext } from "@/contexts/EntityContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <EntityProvider>
      <ChatProvider>{children}</ChatProvider>
    </EntityProvider>
  );
}

function useChatAndEntity() {
  const chat = useChatContext();
  const entity = useEntityContext();
  return { chat, entity };
}

describe("ChatContext — tuningScope reset on entity-type transition (#911)", () => {
  beforeEach(() => {
    // Wipe persisted settings so each test starts from default PLAYBOOK.
    if (typeof window !== "undefined") {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // ignore
      }
    }
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets tuningScope to null when active entity transitions caller → playbook", async () => {
    const { result } = renderHook(() => useChatAndEntity(), { wrapper });

    // Push a caller first; user picks LEARNER scope.
    await act(async () => {
      result.current.entity.pushEntity({ type: "caller", id: "c1", label: "Caller 1" });
    });
    await act(async () => {
      result.current.chat.setTuningScope("LEARNER");
    });
    expect(result.current.chat.tuningScope).toBe("LEARNER");

    // Transition to a playbook entity.
    await act(async () => {
      result.current.entity.pushEntity({ type: "playbook", id: "pb1", label: "Course A" });
    });

    expect(result.current.chat.tuningScope).toBeNull();
  });

  it("resets tuningScope to null when active entity transitions playbook → caller", async () => {
    const { result } = renderHook(() => useChatAndEntity(), { wrapper });

    await act(async () => {
      result.current.entity.pushEntity({ type: "playbook", id: "pb1", label: "Course A" });
    });
    await act(async () => {
      result.current.chat.setTuningScope("PLAYBOOK");
    });
    expect(result.current.chat.tuningScope).toBe("PLAYBOOK");

    await act(async () => {
      result.current.entity.pushEntity({ type: "caller", id: "c1", label: "Caller 1" });
    });

    expect(result.current.chat.tuningScope).toBeNull();
  });

  it("resets tuningScope to null when active entity becomes null (homepage)", async () => {
    const { result } = renderHook(() => useChatAndEntity(), { wrapper });

    await act(async () => {
      result.current.entity.pushEntity({ type: "playbook", id: "pb1", label: "Course A" });
    });
    await act(async () => {
      result.current.chat.setTuningScope("PLAYBOOK");
    });
    expect(result.current.chat.tuningScope).toBe("PLAYBOOK");

    await act(async () => {
      result.current.entity.reset();
    });

    expect(result.current.chat.tuningScope).toBeNull();
  });

  it("does NOT reset tuningScope when same-type entity changes (caller A → caller B)", async () => {
    const { result } = renderHook(() => useChatAndEntity(), { wrapper });

    await act(async () => {
      result.current.entity.pushEntity({ type: "caller", id: "cA", label: "Caller A" });
    });
    await act(async () => {
      result.current.chat.setTuningScope("LEARNER");
    });
    expect(result.current.chat.tuningScope).toBe("LEARNER");

    await act(async () => {
      result.current.entity.pushEntity({ type: "caller", id: "cB", label: "Caller B" });
    });

    // Same type — toggle should persist.
    expect(result.current.chat.tuningScope).toBe("LEARNER");
  });
});

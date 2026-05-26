/**
 * PendingChangesTray (epic #854 / Story #856).
 *
 * Asserts:
 *   - Returns null when no entries
 *   - Renders entries with diff + AI badge
 *   - Toggle 1 hidden without caller-in-context, visible + ON-default with one
 *   - Toggle 2 OFF-default for non-fanout-class keys
 *   - Toggle 2 pre-checked ON for fanout-class keys (A6 — mastery threshold)
 *   - Toggle 2 disabled + forced OFF when any entry has aiSuggested (A5)
 *   - Discard all clears entries
 *   - Remove button removes a single entry
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";

// #873 — PendingChangesTray reads chat-open / chatLayout from
// ChatContext to position itself away from the chat panel. The
// component test doesn't render a real ChatProvider; mock the hook to
// return "chat closed" defaults so the tray sits at its base position.
vi.mock("@/contexts/ChatContext", () => ({
  useChatContext: () => ({ isOpen: false, chatLayout: "vertical" }),
}));

import {
  PendingChangesTrayProvider,
  usePendingChangesTray,
  type TrayEntry,
} from "@/hooks/use-pending-changes-tray";
import { PendingChangesTray } from "@/components/shared/PendingChangesTray";

// Mock sessionStorage to keep tests isolated
const store: Record<string, string> = {};
Object.defineProperty(window, "sessionStorage", {
  value: {
    getItem: vi.fn((k: string) => store[k] || null),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k];
    }),
  },
  configurable: true,
});

// Stub fetch (preview endpoint). Default: low-count preview.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        count: 5,
        sampleNames: ["Mary", "Bob"],
        etaSeconds: 10,
        cacheHit: false,
        source: "live",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

// Test harness: a sibling component that uses the hook to push entries
// before the tray renders. Avoids us re-implementing the hook surface.
function TestHarness({
  setupEntries = () => {},
  setupCaller,
}: {
  setupEntries?: (push: (e: Omit<TrayEntry, "id">) => void) => void;
  setupCaller?: { id: string; name: string };
}) {
  return (
    <PendingChangesTrayProvider>
      <Harness setupEntries={setupEntries} setupCaller={setupCaller} />
      <PendingChangesTray />
    </PendingChangesTrayProvider>
  );
}

function Harness({
  setupEntries,
  setupCaller,
}: {
  setupEntries: (push: (e: Omit<TrayEntry, "id">) => void) => void;
  setupCaller?: { id: string; name: string };
}) {
  const { push, setCallerInContext } = usePendingChangesTray();
  React.useEffect(() => {
    if (setupCaller) setCallerInContext(setupCaller);
    setupEntries(push);
    // intentionally one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function nonFanoutEntry(overrides: Partial<TrayEntry> = {}): Omit<TrayEntry, "id"> {
  return {
    key: "onboardingWelcome",
    label: "Onboarding welcome",
    scopeLabel: "Domain Acme",
    beforeValue: "old",
    afterValue: "new",
    scope: "domain",
    scopeId: "d-1",
    aiSuggested: false,
    fanoutScope: "none",
    ...overrides,
  };
}

function fanoutClassEntry(overrides: Partial<TrayEntry> = {}): Omit<TrayEntry, "id"> {
  return {
    key: "tolerances.masteryThreshold",
    label: "Mastery threshold",
    scopeLabel: "Course IELTS Prep",
    beforeValue: "0.7",
    afterValue: "0.6",
    scope: "playbook",
    scopeId: "pb-1",
    aiSuggested: false,
    fanoutScope: "none",
    ...overrides,
  };
}

describe("PendingChangesTray", () => {
  it("renders nothing when no entries", () => {
    const { queryByTestId } = render(<TestHarness />);
    expect(queryByTestId("pending-changes-tray")).toBeNull();
  });

  it("renders entries with scope, label, and diff", async () => {
    const { findByTestId, getByText } = render(
      <TestHarness
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    await findByTestId("pending-changes-tray");
    expect(getByText("Domain Acme")).toBeInTheDocument();
    expect(getByText("Onboarding welcome")).toBeInTheDocument();
    expect(getByText("old → new")).toBeInTheDocument();
  });

  it("shows AI badge for ai-suggested entries", async () => {
    const { findByText } = render(
      <TestHarness
        setupEntries={(push) =>
          push(nonFanoutEntry({ aiSuggested: true }))
        }
      />,
    );
    expect(await findByText("AI")).toBeInTheDocument();
  });

  it("Toggle 1 is hidden when no caller-in-context", async () => {
    const { findByTestId, queryByText } = render(
      <TestHarness
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    await findByTestId("pending-changes-tray");
    expect(queryByText(/Also recompose/i)).toBeNull();
  });

  it("Toggle 1 visible + checked when caller-in-context set", async () => {
    const { findByLabelText } = render(
      <TestHarness
        setupCaller={{ id: "c-1", name: "Mary Smith" }}
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    const cb = (await findByLabelText(
      /Also recompose Mary Smith/i,
    )) as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("Toggle 2 is OFF by default for non-fanout-class entry", async () => {
    const { findByLabelText } = render(
      <TestHarness
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    // Wait for preview to render (count > 0 → toggle 2 visible)
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 600));
    });
    const cb = (await findByLabelText(
      /Recompose all/i,
    )) as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("Toggle 2 is pre-checked ON for fanout-class entry (A6)", async () => {
    const { findByLabelText } = render(
      <TestHarness
        setupEntries={(push) => push(fanoutClassEntry())}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    const cb = (await findByLabelText(
      /Recompose all/i,
    )) as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("Toggle 2 is disabled + OFF when any entry is aiSuggested (A5)", async () => {
    const { findByLabelText, findByText } = render(
      <TestHarness
        setupEntries={(push) => {
          push(fanoutClassEntry()); // would normally pre-check Toggle 2
          push(nonFanoutEntry({ aiSuggested: true })); // forces lock
        }}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    const cb = (await findByLabelText(
      /Recompose all/i,
    )) as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    expect(cb.checked).toBe(false);
    // Warning copy surfaces
    expect(
      await findByText(/AI-suggested change present/i),
    ).toBeInTheDocument();
  });

  it("Discard all clears every entry", async () => {
    const { findByText, queryByTestId } = render(
      <TestHarness
        setupEntries={(push) => {
          push(nonFanoutEntry({ key: "k-1" }));
          push(nonFanoutEntry({ key: "k-2" }));
        }}
      />,
    );
    const discardBtn = await findByText("Discard all");
    fireEvent.click(discardBtn);
    expect(queryByTestId("pending-changes-tray")).toBeNull();
  });

  it("remove button on an entry removes only that entry", async () => {
    const { findAllByLabelText, getByText } = render(
      <TestHarness
        setupEntries={(push) => {
          push(nonFanoutEntry({ key: "k-1", label: "Label 1" }));
          push(nonFanoutEntry({ key: "k-2", label: "Label 2" }));
        }}
      />,
    );
    const removeButtons = await findAllByLabelText(/Remove /i);
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    // After removing one, the other label still shows
    expect(getByText("Label 2")).toBeInTheDocument();
  });
});

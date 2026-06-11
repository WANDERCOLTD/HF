/**
 * PendingChangesTray (epic #854 / Story #856; renamed in #912).
 *
 * Asserts:
 *   - Returns null when no entries
 *   - Renders entries with diff + AI badge
 *   - No tray button contains "Save" or "Discard" (#912 — Model A honesty)
 *   - "Recompose this learner" + "Recompose entire cohort" CTAs render
 *   - Learner button disabled without caller-in-context
 *   - Cohort button disabled (with AI tooltip) when any entry aiSuggested
 *   - Cohort button enabled when all entries non-AI + cohort > 0
 *   - Per-row dismiss button tooltip reads "Dismiss"
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

async function waitForPreview(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 600));
  });
}

describe("PendingChangesTray", () => {
  it("renders nothing when no entries", () => {
    const { queryByTestId } = render(<TestHarness />);
    expect(queryByTestId("pending-changes-tray")).toBeNull();
  });

  it("renders entries with scope, label, and diff", async () => {
    const { findByTestId, getByText } = render(
      <TestHarness setupEntries={(push) => push(nonFanoutEntry())} />,
    );
    await findByTestId("pending-changes-tray");
    expect(getByText("Domain Acme")).toBeInTheDocument();
    expect(getByText("Onboarding welcome")).toBeInTheDocument();
    expect(getByText("old → new")).toBeInTheDocument();
  });

  it("shows AI badge for ai-suggested entries", async () => {
    const { findByText } = render(
      <TestHarness
        setupEntries={(push) => push(nonFanoutEntry({ aiSuggested: true }))}
      />,
    );
    expect(await findByText("AI")).toBeInTheDocument();
  });

  it("never renders a button labelled 'Save' or 'Discard' (#912 Model A)", async () => {
    const { findByTestId, queryAllByRole } = render(
      <TestHarness
        setupCaller={{ id: "c-1", name: "Mary Smith" }}
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    await findByTestId("pending-changes-tray");
    await waitForPreview();
    const buttons = queryAllByRole("button");
    for (const btn of buttons) {
      const text = (btn.textContent || "").toLowerCase();
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      expect(text).not.toMatch(/\bsave\b/);
      expect(label).not.toMatch(/\bsave\b/);
      expect(text).not.toMatch(/\bdiscard\b/);
      expect(label).not.toMatch(/\bdiscard\b/);
    }
  });

  it("renders 'Recompose this learner' and 'Recompose entire cohort' CTAs", async () => {
    const { findByRole, findByTestId } = render(
      <TestHarness
        setupCaller={{ id: "c-1", name: "Mary Smith" }}
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    await findByTestId("pending-changes-tray");
    await waitForPreview();
    expect(
      await findByRole("button", { name: /Recompose this learner/i }),
    ).toBeInTheDocument();
    expect(
      await findByRole("button", { name: /Recompose entire cohort/i }),
    ).toBeInTheDocument();
  });

  it("'Recompose this learner' is disabled without caller-in-context", async () => {
    const { findByRole, findByTestId } = render(
      <TestHarness setupEntries={(push) => push(nonFanoutEntry())} />,
    );
    await findByTestId("pending-changes-tray");
    await waitForPreview();
    const btn = (await findByRole("button", {
      name: /Recompose this learner/i,
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("'Recompose entire cohort' is disabled (AI tooltip) when any entry is aiSuggested", async () => {
    const { findByRole, findByText } = render(
      <TestHarness
        setupCaller={{ id: "c-1", name: "Mary Smith" }}
        setupEntries={(push) => {
          push(fanoutClassEntry());
          push(nonFanoutEntry({ aiSuggested: true }));
        }}
      />,
    );
    await waitForPreview();
    const btn = (await findByRole("button", {
      name: /Recompose entire cohort/i,
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(
      /AI-suggested changes can't fan out/i,
    );
    expect(
      await findByText(/AI-suggested change present/i),
    ).toBeInTheDocument();
  });

  it("shows config-saved reassurance when both recompose buttons are disabled (#1442 L4)", async () => {
    const { findByTestId, findByRole, queryByTestId } = render(
      <TestHarness
        setupEntries={(push) => push(nonFanoutEntry({ aiSuggested: true }))}
      />,
    );
    await waitForPreview();
    // Reassurance block should render — caller is null AND aiSuggested.
    const block = await findByTestId("hf-pending-tray-config-saved");
    expect(block).toBeInTheDocument();
    expect(block.textContent).toMatch(/Course config is already saved/i);
    expect(block.textContent).toMatch(/next call/i);
    // CTA pointing to /x/sim/<callerId> rendered when no caller in context.
    expect(block.textContent).toMatch(/\/x\/sim\/<callerId>/);
    // Dismiss button is rendered and enabled.
    const dismiss = await findByRole("button", { name: /Got it/i });
    expect(dismiss).toBeInTheDocument();
    expect((dismiss as HTMLButtonElement).disabled).toBe(false);
    // Reassurance should NOT render when there is a caller in context
    // (the learner button isn't disabled) — sanity proof of the gate.
    void queryByTestId; // suppress "unused" if upgraded later
  });

  it("does NOT show config-saved reassurance when caller-in-context (learner button enabled)", async () => {
    const { queryByTestId } = render(
      <TestHarness
        setupCaller={{ id: "c-1", name: "Mary Smith" }}
        setupEntries={(push) => push(nonFanoutEntry({ aiSuggested: true }))}
      />,
    );
    await waitForPreview();
    expect(queryByTestId("hf-pending-tray-config-saved")).toBeNull();
  });

  it("'Recompose entire cohort' is enabled when all entries are non-AI and cohort > 0", async () => {
    const { findByRole } = render(
      <TestHarness
        setupCaller={{ id: "c-1", name: "Mary Smith" }}
        setupEntries={(push) => push(nonFanoutEntry())}
      />,
    );
    await waitForPreview();
    const btn = (await findByRole("button", {
      name: /Recompose entire cohort/i,
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("per-row dismiss button has aria-label 'Dismiss <label>' and title 'Dismiss'", async () => {
    const { findAllByRole } = render(
      <TestHarness
        setupEntries={(push) => {
          push(nonFanoutEntry({ key: "k-1", label: "Label 1" }));
          push(nonFanoutEntry({ key: "k-2", label: "Label 2" }));
        }}
      />,
    );
    const dismissButtons = await findAllByRole("button", { name: /^Dismiss / });
    expect(dismissButtons).toHaveLength(2);
    for (const btn of dismissButtons) {
      expect(btn.getAttribute("title")).toBe("Dismiss");
    }
  });

  it("dismiss button removes only that entry", async () => {
    const { findAllByRole, getByText } = render(
      <TestHarness
        setupEntries={(push) => {
          push(nonFanoutEntry({ key: "k-1", label: "Label 1" }));
          push(nonFanoutEntry({ key: "k-2", label: "Label 2" }));
        }}
      />,
    );
    const dismissButtons = await findAllByRole("button", { name: /^Dismiss / });
    fireEvent.click(dismissButtons[0]);
    expect(getByText("Label 2")).toBeInTheDocument();
  });
});

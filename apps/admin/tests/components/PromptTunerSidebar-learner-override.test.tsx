/**
 * #911 — PromptTunerSidebar learner-override smoke test.
 *
 * Verifies that when scope=learner and a CALLER-scope override exists for
 * a parameter, the slider's rendered value reflects the override (e.g.
 * BEH-ABSTRACT-OK = 0.34) rather than the playbook-cascade fallback (0.30).
 *
 * Mocks both backend endpoints:
 *   - `/api/playbooks/[id]/targets` (existing — SYSTEM+PLAYBOOK cascade)
 *   - `/api/callers/[id]/effective-behavior-targets?playbookId=...` (new — full cascade)
 *
 * After scope toggle, the second pass overlays the cascade onto each
 * parameter so the slider at line 940
 * (`draftTargets[p.parameterId] ?? p.effectiveValue`) renders correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import React from "react";

// usePendingChangesTray is server-state-ish — stub it so the sidebar
// renders without a real provider. The push handler is a no-op spy.
vi.mock("@/hooks/use-pending-changes-tray", () => ({
  usePendingChangesTray: () => ({
    entries: [],
    push: vi.fn(),
    setCallerInContext: vi.fn(),
  }),
}));

// #1664 — PromptTunerSidebar now consults useIsOperatorOrAbove (via
// useSession) to gate the interpretation tooltip text. Default to an
// OPERATOR session so existing slider assertions keep their current
// shape; this test isn't checking interpretation strings.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "OPERATOR" } } }),
}));

import { PromptTunerSidebar } from "@/components/callers/caller-detail/PromptTunerSidebar";

// Sample SYSTEM+PLAYBOOK response from /api/playbooks/[id]/targets.
const playbookCascade = {
  ok: true,
  playbookId: "pb-001",
  playbookName: "Test Course",
  playbookStatus: "PUBLISHED",
  parameters: [
    {
      parameterId: "BEH-ABSTRACT-OK",
      name: "Abstract OK",
      definition: "Whether abstract reasoning is acceptable",
      domainGroup: "comprehension",
      interpretationHigh: "Comfortable with abstraction",
      interpretationLow: "Prefers concrete examples",
      systemValue: 0.5,
      playbookValue: 0.3,
      effectiveValue: 0.3,
      effectiveScope: "PLAYBOOK",
    },
  ],
  counts: { total: 1, withPlaybookOverride: 1, withSystemDefault: 1 },
};

// CALLER-overlay response from the new endpoint.
const cascadeWithCallerOverride = {
  ok: true,
  callerId: "caller-001",
  playbookId: "pb-001",
  parameters: [
    {
      parameterId: "BEH-ABSTRACT-OK",
      effectiveValue: 0.34,
      sourceScope: "CALLER" as const,
      systemValue: 0.5,
      playbookValue: 0.3,
      callerValue: 0.34,
    },
  ],
};

// Other endpoints the sidebar pings — answer with empty/ok.
function mockFetch(implementation: (url: string) => unknown) {
  const f = vi.fn(async (url: string) => {
    const body = implementation(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = f as unknown as typeof fetch;
  return f;
}

describe("PromptTunerSidebar — learner-override cascade overlay (#911)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders BEH-ABSTRACT-OK = 0.34 on the slider when scope=learner and a CALLER override exists", async () => {
    mockFetch((url) => {
      if (url.includes("/effective-behavior-targets")) return cascadeWithCallerOverride;
      if (url.includes("/targets")) return playbookCascade;
      if (url.endsWith("/behavior-targets")) return { ok: true, overrides: [] };
      if (url.match(/\/api\/playbooks\/pb-001$/)) return { ok: true, playbook: { config: {} } };
      if (url.includes("/enrollments")) return { ok: true, count: 1, enrollments: [] };
      return { ok: true };
    });

    render(
      <PromptTunerSidebar
        open
        inline
        llmPrompt={null}
        callerId="caller-001"
        callerName="Freddy"
        playbookId="pb-001"
        playbookName="Test Course"
        onApplied={() => {}}
      />,
    );

    // Pick the "This learner" scope so the cascade overlay fires.
    await waitFor(() => {
      expect(screen.getByText(/This learner|Freddy/)).toBeTruthy();
    });
    const learnerScopeBtn = screen
      .getAllByRole("button")
      .find((b) => /Freddy|This learner/.test(b.textContent || ""));
    expect(learnerScopeBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(learnerScopeBtn!);
    });

    // After the cascade overlay re-fetch, the slider's aria-valuetext for
    // BEH-ABSTRACT-OK should be 0.34 (not 0.30).
    await waitFor(() => {
      const slider = screen.getByLabelText("Abstract OK") as HTMLInputElement;
      expect(slider.getAttribute("aria-valuetext")).toBe("0.34");
    }, { timeout: 3000 });
  });
});

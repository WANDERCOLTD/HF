/**
 * Tests for CascadeLensPanel (#1348 Cascade Lens v1 — UI).
 *
 * Verifies:
 *   - renders 4 layer pills per field (system / provider / domain / course)
 *   - the winning layer pill is highlighted (.hf-cascade-pill--active)
 *   - deep-link href is correct for each winning-layer scope
 *   - lock icon shown on locked: true rows, absent otherwise
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "u1",
        email: "u@example.com",
        name: "U",
        image: null,
        role: "OPERATOR",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    status: "authenticated",
  }),
}));

import { CascadeLensPanel } from "@/components/callers/CascadeLensPanel";

const explanationFixture = {
  cascade: "voice",
  callerId: "c-1",
  playbookId: "pb-7",
  courseId: "pb-7",
  providerId: "vp-1",
  resolvedAt: "2026-06-08T00:00:00Z",
  fields: [
    // System winner
    {
      key: "autoPipeline",
      resolvedValue: true,
      winningSource: "system",
      locked: false,
      chain: [
        { layer: "system", value: true, present: true },
        { layer: "provider", value: null, present: false },
        { layer: "domain", value: null, present: false },
        { layer: "course", value: null, present: false },
      ],
    },
    // Provider winner
    {
      key: "voiceId",
      resolvedValue: "asteria",
      winningSource: "provider",
      locked: false,
      chain: [
        { layer: "system", value: null, present: false },
        { layer: "provider", value: "asteria", present: true },
        { layer: "domain", value: null, present: false },
        { layer: "course", value: null, present: false },
      ],
    },
    // Course winner
    {
      key: "silenceTimeoutSeconds",
      resolvedValue: 12,
      winningSource: "course",
      locked: false,
      chain: [
        { layer: "system", value: 30, present: true },
        { layer: "provider", value: null, present: false },
        { layer: "domain", value: null, present: false },
        { layer: "course", value: 12, present: true },
      ],
    },
    // Locked
    {
      key: "model",
      resolvedValue: "claude-opus-4-7",
      winningSource: "system",
      locked: true,
      chain: [
        { layer: "system", value: "claude-opus-4-7", present: true },
        { layer: "provider", value: null, present: false },
        { layer: "domain", value: null, present: false },
        { layer: "course", value: null, present: false },
      ],
    },
  ],
};

function mockFetchOnce(body: unknown, status = 200) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("CascadeLensPanel (#1348)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 4 layer pills for every field", async () => {
    mockFetchOnce({ data: explanationFixture });
    let container: HTMLElement;
    await act(async () => {
      const r = render(<CascadeLensPanel callerId="c-1" />);
      container = r.container;
    });

    // Expand the panel
    const toggle = container!.querySelector(
      ".hf-cascade-lens-toggle",
    ) as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });

    await waitFor(() => {
      const rows = container!.querySelectorAll(".hf-cascade-row");
      expect(rows.length).toBe(4);
    });

    const rows = container!.querySelectorAll(".hf-cascade-row");
    for (const row of Array.from(rows)) {
      const pills = row.querySelectorAll(".hf-cascade-pill");
      expect(pills.length).toBe(4);
    }
  });

  it("highlights the winning layer pill (.hf-cascade-pill--active)", async () => {
    mockFetchOnce({ data: explanationFixture });
    let container: HTMLElement;
    await act(async () => {
      const r = render(<CascadeLensPanel callerId="c-1" />);
      container = r.container;
    });

    const toggle = container!.querySelector(
      ".hf-cascade-lens-toggle",
    ) as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });

    await waitFor(() =>
      expect(container!.querySelectorAll(".hf-cascade-row").length).toBe(4),
    );

    const rows = Array.from(container!.querySelectorAll(".hf-cascade-row"));
    // autoPipeline → system wins
    // Post-#1470 the panel renders full sidebar-aligned labels
    // ("System default" / "Voice provider" / "Domain" / "Course") instead
    // of the prior 3-char tokens (sys/prov/dom/crs).
    const autoRow = rows[0];
    const autoActive = autoRow.querySelectorAll(".hf-cascade-pill--active");
    expect(autoActive.length).toBe(1);
    expect(autoActive[0].textContent?.trim().toLowerCase()).toBe("system default");

    // voiceId → provider wins
    const voiceRow = rows[1];
    const voiceActive = voiceRow.querySelectorAll(".hf-cascade-pill--active");
    expect(voiceActive.length).toBe(1);
    expect(voiceActive[0].textContent?.trim().toLowerCase()).toBe("voice provider");

    // silenceTimeoutSeconds → course wins
    const silenceRow = rows[2];
    const silenceActive = silenceRow.querySelectorAll(
      ".hf-cascade-pill--active",
    );
    expect(silenceActive.length).toBe(1);
    expect(silenceActive[0].textContent?.trim().toLowerCase()).toBe("course");
  });

  it("deep-link href is correct for each winning-layer scope", async () => {
    mockFetchOnce({ data: explanationFixture });
    let container: HTMLElement;
    await act(async () => {
      const r = render(<CascadeLensPanel callerId="c-1" />);
      container = r.container;
    });
    const toggle = container!.querySelector(
      ".hf-cascade-lens-toggle",
    ) as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    await waitFor(() =>
      expect(container!.querySelectorAll(".hf-cascade-row").length).toBe(4),
    );

    const rows = Array.from(container!.querySelectorAll(".hf-cascade-row"));

    // System winner deep-links to /x/settings/voice-providers
    const sysLink = rows[0].querySelector(
      "a.hf-cascade-pill--active",
    ) as HTMLAnchorElement | null;
    expect(sysLink?.getAttribute("href")).toBe("/x/settings/voice-providers");

    // Provider winner deep-links to /x/settings/voice-providers/[providerId]
    const provLink = rows[1].querySelector(
      "a.hf-cascade-pill--active",
    ) as HTMLAnchorElement | null;
    expect(provLink?.getAttribute("href")).toBe(
      "/x/settings/voice-providers/vp-1",
    );

    // Course winner deep-links to /x/courses/[courseId]?tab=design
    const courseLink = rows[2].querySelector(
      "a.hf-cascade-pill--active",
    ) as HTMLAnchorElement | null;
    expect(courseLink?.getAttribute("href")).toBe(
      "/x/courses/pb-7?tab=design",
    );
  });

  it("lock icon shown on locked rows, absent on others", async () => {
    mockFetchOnce({ data: explanationFixture });
    let container: HTMLElement;
    await act(async () => {
      const r = render(<CascadeLensPanel callerId="c-1" />);
      container = r.container;
    });
    const toggle = container!.querySelector(
      ".hf-cascade-lens-toggle",
    ) as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    await waitFor(() =>
      expect(container!.querySelectorAll(".hf-cascade-row").length).toBe(4),
    );

    const rows = Array.from(container!.querySelectorAll(".hf-cascade-row"));

    // Locked row (model)
    const lockedRow = rows[3];
    expect(lockedRow.getAttribute("data-locked")).toBe("true");
    const lockSpan = lockedRow.querySelector(".hf-cascade-lock");
    expect(lockSpan?.textContent).toBe("🔒");

    // Non-locked row (autoPipeline) — data-locked attr absent
    const unlocked = rows[0];
    expect(unlocked.getAttribute("data-locked")).toBeNull();
    const unlockedLockSpan = unlocked.querySelector(".hf-cascade-lock");
    expect(unlockedLockSpan?.textContent).toBe("");
  });
});

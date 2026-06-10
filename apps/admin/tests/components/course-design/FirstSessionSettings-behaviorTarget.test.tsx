/**
 * Tests for FirstSessionSettings rendering BehaviorTarget(scope=PLAYBOOK)
 * rows surfaced via the new GET /api/courses/[courseId]/design (#1417).
 *
 * Covers:
 *   - read-only behaviorTarget row appears with "Managed via AgentTuner"
 *     badge
 *   - "No overrides set" empty state appears ONLY when both sources empty
 *   - editable firstSessionTargets path unchanged when behaviorTarget rows
 *     are present (no regression on the existing editor)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { FirstSessionSettings } from "@/components/course-design/FirstSessionSettings";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  // FirstSessionSettings issues TWO mount fetches: the existing
  // `call1-override-preview` (#798) AND the new `/design` GET (#1417).
  // Tests below override the `/design` response per-case; this fallback
  // catches the preview call and any other request.
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/call1-override-preview")) {
      return Promise.resolve(jsonRes({ ok: true, count: 0, samples: [], rangeFormCount: 0 }));
    }
    return Promise.resolve(jsonRes({ ok: true, rows: [] }));
  });
});

function mockDesignResponse(body: unknown) {
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/call1-override-preview")) {
      return Promise.resolve(jsonRes({ ok: true, count: 0, samples: [], rangeFormCount: 0 }));
    }
    if (typeof url === "string" && url.includes("/design")) {
      return Promise.resolve(jsonRes(body));
    }
    return Promise.resolve(jsonRes({ ok: true }));
  });
}

describe("FirstSessionSettings — #1417 BehaviorTarget row visibility", () => {
  it("renders read-only behaviorTarget row with Managed badge", async () => {
    mockDesignResponse({
      ok: true,
      rows: [
        {
          parameterId: "BEH-RESPONSE-LEN",
          value: 0.2,
          origin: "behaviorTarget",
          source: "MANUAL",
          updatedAt: "2026-06-09T00:00:00.000Z",
        },
      ],
      firstCallMode: null,
    });

    render(<FirstSessionSettings courseId="c1" />);

    await waitFor(() => {
      expect(screen.getByText("Managed via AgentTuner")).toBeTruthy();
    });
    expect(screen.getByText(/BEH-RESPONSE-LEN/)).toBeTruthy();
    expect(
      screen.queryByText("No overrides set — domain defaults apply."),
    ).toBeNull();
  });

  it("shows 'No overrides set' only when BOTH sources are empty", async () => {
    mockDesignResponse({ ok: true, rows: [], firstCallMode: null });

    render(<FirstSessionSettings courseId="c1" />);

    await waitFor(() => {
      expect(
        screen.getByText("No overrides set — domain defaults apply."),
      ).toBeTruthy();
    });
  });

  it("flags conflict when same parameterId exists in both sources", async () => {
    mockDesignResponse({
      ok: true,
      rows: [
        {
          parameterId: "BEH-WARMTH",
          value: 0.4,
          origin: "behaviorTarget",
          source: "MANUAL",
          updatedAt: "2026-05-22T00:00:00.000Z",
        },
      ],
      firstCallMode: null,
    });

    render(
      <FirstSessionSettings
        courseId="c1"
        playbookConfig={{
          firstSessionTargets: { "BEH-WARMTH": { value: 0.7 } },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Managed via AgentTuner")).toBeTruthy();
    });
    expect(screen.getByText("Conflict with editable row")).toBeTruthy();
  });

  it("editable firstSessionTargets rows remain editable when behaviorTarget rows are also present", async () => {
    mockDesignResponse({
      ok: true,
      rows: [
        {
          parameterId: "BEH-RESPONSE-LEN",
          value: 0.2,
          origin: "behaviorTarget",
          source: "MANUAL",
          updatedAt: "2026-06-09T00:00:00.000Z",
        },
      ],
      firstCallMode: null,
    });

    render(
      <FirstSessionSettings
        courseId="c1"
        playbookConfig={{
          firstSessionTargets: { "BEH-WARMTH": { value: 0.7 } },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Managed via AgentTuner")).toBeTruthy();
    });
    // The editable repeater renders a `<input type="range">` per row.
    const sliders = document.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(1); // firstSessionTargets row only; behaviorTarget is read-only
  });
});

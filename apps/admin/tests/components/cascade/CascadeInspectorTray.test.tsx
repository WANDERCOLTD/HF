/**
 * CascadeInspectorTray — Slice 3 of #1454.
 *
 * Covers AC:
 *   - fetches GET /api/cascade/resolve on open
 *   - shows loading state, then chain
 *   - CTA label flips: "Override for X" vs "Replace override on X"
 *   - "Reset to inherited" only renders when isInherited === false
 *   - close button fires onClose
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen, fireEvent } from "@testing-library/react";
import { CascadeInspectorTray } from "@/components/cascade/CascadeInspectorTray";

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
});

describe("CascadeInspectorTray — load + render", () => {
  it("fetches the cascade envelope and renders the chain", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        value: 0.6,
        source: "DOMAIN",
        layers: [
          {
            layer: "SYSTEM",
            scopeId: null,
            scopeLabel: "System default",
            value: 0.5,
            setAt: null,
            setBy: null,
          },
          {
            layer: "DOMAIN",
            scopeId: "dom1",
            scopeLabel: "Education",
            value: 0.6,
            setAt: "2026-05-22T00:00:00.000Z",
            setBy: null,
          },
        ],
        isInherited: true,
        recommendedLayerForEdit: "PLAYBOOK",
      }),
    );

    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading cascade…")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Effective")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/cascade\/resolve\?knobKey=BEH-WARMTH/),
    );
    // Winner row marker
    expect(screen.getAllByText("✓", { exact: false }).length).toBeGreaterThan(0);
  });

  it("CTA reads 'Override for OCEAN' when no hit at PLAYBOOK", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        value: 0.5,
        source: "SYSTEM",
        layers: [
          {
            layer: "SYSTEM",
            scopeId: null,
            scopeLabel: "System default",
            value: 0.5,
            setAt: null,
            setBy: null,
          },
        ],
        isInherited: true,
        recommendedLayerForEdit: "PLAYBOOK",
      }),
    );

    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        currentEditScope="PLAYBOOK"
        onClose={vi.fn()}
        onOverrideAtCurrentScope={vi.fn()}
      />,
    );

    await waitFor(() => {
      // Match the primary CTA — fallback label is "Course" (operator-facing)
      // when there's no PLAYBOOK hit to surface a scopeLabel.
      expect(screen.getByText(/^Override for Course$/)).toBeTruthy();
    });
  });

  it("CTA reads 'Replace override on OCEAN' when PLAYBOOK hit exists", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        value: 0.6,
        source: "PLAYBOOK",
        layers: [
          {
            layer: "PLAYBOOK",
            scopeId: "pb1",
            scopeLabel: "OCEAN",
            value: 0.6,
            setAt: null,
            setBy: null,
          },
        ],
        isInherited: false,
        recommendedLayerForEdit: "PLAYBOOK",
      }),
    );

    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        currentEditScope="PLAYBOOK"
        onClose={vi.fn()}
        onOverrideAtCurrentScope={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Replace override on OCEAN")).toBeTruthy();
    });
  });

  it("hides 'Reset to inherited' when isInherited is true", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        value: 0.5,
        source: "SYSTEM",
        layers: [],
        isInherited: true,
        recommendedLayerForEdit: "PLAYBOOK",
      }),
    );

    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        onClose={vi.fn()}
        onResetToInherited={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Effective")).toBeTruthy();
    });
    expect(screen.queryByText("Reset to inherited")).toBeNull();
  });

  it("shows 'Reset to inherited' when isInherited is false", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        value: 0.6,
        source: "PLAYBOOK",
        layers: [
          {
            layer: "PLAYBOOK",
            scopeId: "pb1",
            scopeLabel: "OCEAN",
            value: 0.6,
            setAt: null,
            setBy: null,
          },
        ],
        isInherited: false,
        recommendedLayerForEdit: "PLAYBOOK",
      }),
    );

    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        onClose={vi.fn()}
        onResetToInherited={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Reset to inherited")).toBeTruthy();
    });
  });

  it("renders error state on fetch failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ error: "Playbook not found: pb1" }, 404),
    );

    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Playbook not found/);
    });
  });

  it("close button fires onClose", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        value: null,
        source: "SYSTEM",
        layers: [],
        isInherited: false,
        recommendedLayerForEdit: "PLAYBOOK",
      }),
    );
    const onClose = vi.fn();
    render(
      <CascadeInspectorTray
        knobKey="BEH-WARMTH"
        knobLabel="Warmth"
        scopeChain={{ playbookId: "pb1" }}
        onClose={onClose}
      />,
    );
    await waitFor(() => screen.getByText("Effective"));
    fireEvent.click(screen.getByLabelText("Close inspector"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

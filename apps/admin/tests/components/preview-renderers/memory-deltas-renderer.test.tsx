/**
 * MemoryDeltasRenderer — #1645 (Epic #1606 Group A.5).
 *
 * Pinned acceptance:
 *   1. Registry contract for the `memoryDeltas` key.
 *   2. Loading state — placeholder rendered.
 *   3. No-learner state — when previewCallerName is null.
 *   4. Call 1 state — when priorCallId is null.
 *   5. Identical-memory-sets state — hasDeltas=false with priorCallId set.
 *   6. Populated state — added entries with category + key + value.
 *   7. Populated state — updated entries with prior→new diff arrow.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  MemoryDeltasRenderer,
  type MemoryDeltasRendererData,
} from "@/components/shared/preview-renderers";
import {
  getPreviewRenderer,
  registerPreviewRenderer,
} from "@/components/shared/designer-shell";
import { __resetPreviewRenderersForTesting } from "@/components/shared/designer-shell/section-registry";

afterEach(() => {
  cleanup();
  __resetPreviewRenderersForTesting();
});

beforeEach(() => {
  registerPreviewRenderer<"memoryDeltas", MemoryDeltasRendererData>(
    "memoryDeltas",
    MemoryDeltasRenderer,
  );
});

describe("MemoryDeltasRenderer — registry contract", () => {
  it("registers under 'memoryDeltas'", () => {
    expect(getPreviewRenderer("memoryDeltas")).toBe(MemoryDeltasRenderer);
  });
});

describe("MemoryDeltasRenderer — empty states", () => {
  it("renders the loading placeholder", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          loading: true,
          hasDeltas: false,
          priorCallId: null,
          priorPriorCallId: null,
          added: [],
          updated: [],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getByText(/loading recent memory changes/i)).toBeTruthy();
  });

  it("renders 'No learners enrolled yet' when previewCallerName is null", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          previewCallerName: null,
          hasDeltas: false,
          priorCallId: null,
          priorPriorCallId: null,
          added: [],
          updated: [],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getByText(/no learners enrolled/i)).toBeTruthy();
  });

  it("renders the Call 1 state when priorCallId is null", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          previewCallerName: "Bertie",
          hasDeltas: false,
          priorCallId: null,
          priorPriorCallId: null,
          added: [],
          updated: [],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getByText(/no prior call yet/i)).toBeTruthy();
  });

  it("renders the 'no memory changes' state when prior call exists but no deltas", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          previewCallerName: "Bertie",
          hasDeltas: false,
          priorCallId: "call-prior",
          priorPriorCallId: "call-prior-prior",
          added: [],
          updated: [],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getByText(/no memory changes since last call/i)).toBeTruthy();
  });
});

describe("MemoryDeltasRenderer — populated states", () => {
  it("renders added entries with category, key, value", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          previewCallerName: "Bertie",
          hasDeltas: true,
          priorCallId: "call-prior",
          priorPriorCallId: null,
          added: [
            { category: "PREFERENCE", key: "tutor_tone", value: "warm", confidence: 0.9 },
          ],
          updated: [],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getAllByText(/added/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/PREFERENCE/)).toBeTruthy();
    expect(screen.getByText(/tutor_tone/)).toBeTruthy();
    expect(screen.getByText(/warm/)).toBeTruthy();
  });

  it("renders updated entries with the prior → new diff arrow", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          previewCallerName: "Bertie",
          hasDeltas: true,
          priorCallId: "call-prior",
          priorPriorCallId: "call-prior-prior",
          added: [],
          updated: [
            {
              category: "FACT",
              key: "location",
              value: "Manchester",
              priorValue: "London",
              confidence: 0.85,
            },
          ],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getAllByText(/updated/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/location/)).toBeTruthy();
    expect(screen.getByText(/Manchester/)).toBeTruthy();
    expect(screen.getByText(/London/)).toBeTruthy();
  });

  it("renders both added + updated counts in the header", () => {
    render(
      <MemoryDeltasRenderer
        data={{
          previewCallerName: "Bertie",
          hasDeltas: true,
          priorCallId: "call-prior",
          priorPriorCallId: "call-prior-prior",
          added: [
            { category: "FACT", key: "k1", value: "v1", confidence: 0.8 },
            { category: "FACT", key: "k2", value: "v2", confidence: 0.8 },
          ],
          updated: [
            {
              category: "FACT",
              key: "k3",
              value: "new",
              priorValue: "old",
              confidence: 0.8,
            },
          ],
        }}
        selection={{ selectedKey: "memoryDeltas" }}
      />,
    );
    expect(screen.getByText(/2 added.*1 updated/)).toBeTruthy();
  });
});

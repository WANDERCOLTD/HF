/**
 * ConversationArtifactsRenderer — #1643 (Epic #1606 Group A.5).
 *
 * Pinned acceptance:
 *   1. Registry contract for the `conversationArtifacts` key.
 *   2. Loading state — renders "Loading recent artifacts…" placeholder.
 *   3. No-learners-enrolled state — when previewCallerName is null.
 *   4. Call 1 empty state — no prior call yet.
 *   5. Last-call-empty state — prior call shared zero DELIVERED artifacts.
 *   6. Populated state — renders per-artifact type + title + snippet.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ConversationArtifactsRenderer,
  type ConversationArtifactsRendererData,
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
  registerPreviewRenderer<
    "conversationArtifacts",
    ConversationArtifactsRendererData
  >("conversationArtifacts", ConversationArtifactsRenderer);
});

describe("ConversationArtifactsRenderer — registry contract", () => {
  it("registers under 'conversationArtifacts'", () => {
    expect(getPreviewRenderer("conversationArtifacts")).toBe(
      ConversationArtifactsRenderer,
    );
  });
});

describe("ConversationArtifactsRenderer — empty states", () => {
  it("renders the loading placeholder when loading is true", () => {
    render(
      <ConversationArtifactsRenderer
        data={{
          loading: true,
          hasArtifacts: false,
          lastCallId: null,
          lastCallAt: null,
          artifacts: [],
        }}
        selection={{ selectedKey: "conversationArtifacts" }}
      />,
    );
    expect(screen.getByText(/loading recent artifacts/i)).toBeTruthy();
  });

  it("renders 'No learners enrolled yet' when previewCallerName is null", () => {
    render(
      <ConversationArtifactsRenderer
        data={{
          previewCallerName: null,
          hasArtifacts: false,
          lastCallId: null,
          lastCallAt: null,
          artifacts: [],
        }}
        selection={{ selectedKey: "conversationArtifacts" }}
      />,
    );
    expect(screen.getByText(/no learners enrolled/i)).toBeTruthy();
  });

  it("renders the Call 1 empty path when learner has no prior call", () => {
    render(
      <ConversationArtifactsRenderer
        data={{
          previewCallerName: "Bertie",
          hasArtifacts: false,
          lastCallId: null,
          lastCallAt: null,
          artifacts: [],
        }}
        selection={{ selectedKey: "conversationArtifacts" }}
      />,
    );
    expect(screen.getByText(/no prior call yet/i)).toBeTruthy();
    expect(screen.getByText(/Bertie/)).toBeTruthy();
  });

  it("renders the 'last call shared no artifacts' state when prior call exists but has zero DELIVERED", () => {
    render(
      <ConversationArtifactsRenderer
        data={{
          previewCallerName: "Bertie",
          hasArtifacts: false,
          lastCallId: "call-prior",
          lastCallAt: new Date(Date.now() - 86400000).toISOString(),
          artifacts: [],
        }}
        selection={{ selectedKey: "conversationArtifacts" }}
      />,
    );
    expect(screen.getByText(/shared no artifacts/i)).toBeTruthy();
  });
});

describe("ConversationArtifactsRenderer — populated state", () => {
  it("renders the artifact list with type, title, and snippet", () => {
    render(
      <ConversationArtifactsRenderer
        data={{
          previewCallerName: "Bertie",
          hasArtifacts: true,
          lastCallId: "call-prior",
          lastCallAt: new Date(Date.now() - 86400000).toISOString(),
          totalCount: 2,
          artifacts: [
            {
              id: "art-1",
              type: "KEY_FACT",
              title: "Pythagorean identity",
              snippet: "a² + b² = c²",
              confidence: 0.92,
              deliveredAt: new Date().toISOString(),
            },
            {
              id: "art-2",
              type: "STUDY_NOTE",
              title: "Right triangle",
              snippet: "Use the identity to find hypotenuse",
              confidence: 0.8,
              deliveredAt: null,
            },
          ],
        }}
        selection={{ selectedKey: "conversationArtifacts" }}
      />,
    );
    expect(screen.getByText(/Pythagorean identity/)).toBeTruthy();
    expect(screen.getByText(/KEY_FACT/)).toBeTruthy();
    expect(screen.getByText(/Right triangle/)).toBeTruthy();
    expect(screen.getByText(/STUDY_NOTE/)).toBeTruthy();
    expect(screen.getByText(/a² \+ b² = c²/)).toBeTruthy();
  });

  it("includes the caller name in the header when populated", () => {
    render(
      <ConversationArtifactsRenderer
        data={{
          previewCallerName: "Bertie",
          hasArtifacts: true,
          lastCallId: "call-prior",
          lastCallAt: new Date().toISOString(),
          totalCount: 1,
          artifacts: [
            {
              id: "art-1",
              type: "SUMMARY",
              title: "Call recap",
              snippet: "We covered limits",
              confidence: 0.85,
              deliveredAt: null,
            },
          ],
        }}
        selection={{ selectedKey: "conversationArtifacts" }}
      />,
    );
    expect(screen.getByText(/Bertie/)).toBeTruthy();
  });
});

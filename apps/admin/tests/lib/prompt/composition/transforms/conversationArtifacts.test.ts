/**
 * Tests for the renderConversationArtifacts transform (#1642 — Epic #1606 Group A.5).
 *
 * Pins:
 *   - Empty + no-prior-call paths both return null so the section is omitted
 *   - Output carries totalCount + byType breakdown + summary string
 *   - Summary line includes the by-type counts sorted alphabetically (deterministic)
 */

import { describe, it, expect } from "vitest";
import "@/lib/prompt/composition/transforms/conversationArtifacts";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { ConversationArtifactsData } from "@/lib/prompt/composition/loaders/conversationArtifacts";

const transform = getTransform("renderConversationArtifacts");

const dummyContext = {} as any;
const dummySection = {} as any;

describe("renderConversationArtifacts transform", () => {
  it("registers under the name 'renderConversationArtifacts'", () => {
    expect(transform).toBeDefined();
  });

  it("returns null for the empty shape (Call 1 path)", () => {
    const empty: ConversationArtifactsData = {
      hasArtifacts: false,
      lastCallId: null,
      lastCallAt: null,
      artifacts: [],
    };
    expect(transform!(empty, dummyContext, dummySection)).toBeNull();
  });

  it("returns null when hasArtifacts=false even if lastCallId is populated", () => {
    const noDelivered: ConversationArtifactsData = {
      hasArtifacts: false,
      lastCallId: "call-prior",
      lastCallAt: "2026-06-13T10:00:00.000Z",
      artifacts: [],
    };
    expect(transform!(noDelivered, dummyContext, dummySection)).toBeNull();
  });

  it("emits the section payload with totalCount, byType, and a deterministic summary", () => {
    const data: ConversationArtifactsData = {
      hasArtifacts: true,
      lastCallId: "call-prior",
      lastCallAt: "2026-06-13T10:00:00.000Z",
      artifacts: [
        {
          id: "art-1",
          type: "STUDY_NOTE",
          title: "Right triangle",
          snippet: "Use Pythagoras",
          confidence: 0.8,
          deliveredAt: null,
        },
        {
          id: "art-2",
          type: "KEY_FACT",
          title: "Pythagoras",
          snippet: "a² + b² = c²",
          confidence: 0.92,
          deliveredAt: "2026-06-13T10:15:00.000Z",
        },
        {
          id: "art-3",
          type: "STUDY_NOTE",
          title: "Trig basics",
          snippet: "SOHCAHTOA",
          confidence: 0.7,
          deliveredAt: null,
        },
      ],
    };

    const out = transform!(data, dummyContext, dummySection);
    expect(out).not.toBeNull();
    expect(out.totalCount).toBe(3);
    expect(out.byType).toEqual({ KEY_FACT: 1, STUDY_NOTE: 2 });
    expect(out.lastCallId).toBe("call-prior");
    expect(out.summary).toBe(
      "From your last call: 3 items shared (1 KEY_FACT, 2 STUDY_NOTE).",
    );
    expect(out.artifacts).toHaveLength(3);
  });

  it("uses singular form in the summary when a single artifact was shared", () => {
    const data: ConversationArtifactsData = {
      hasArtifacts: true,
      lastCallId: "call-prior",
      lastCallAt: "2026-06-13T10:00:00.000Z",
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
    };

    const out = transform!(data, dummyContext, dummySection);
    expect(out.summary).toBe("From your last call: 1 item shared (1 SUMMARY).");
  });
});

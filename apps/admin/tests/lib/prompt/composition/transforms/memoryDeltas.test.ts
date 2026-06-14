/**
 * Tests for the renderMemoryDeltas transform (#1644 — Epic #1606 Group A.5).
 */

import { describe, it, expect } from "vitest";
import "@/lib/prompt/composition/transforms/memoryDeltas";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { MemoryDeltasData } from "@/lib/prompt/composition/loaders/memoryDeltas";

const transform = getTransform("renderMemoryDeltas");
const ctx = {} as any;
const def = {} as any;

const EMPTY: MemoryDeltasData = {
  hasDeltas: false,
  priorCallId: null,
  priorPriorCallId: null,
  added: [],
  updated: [],
};

describe("renderMemoryDeltas transform", () => {
  it("registers under the name 'renderMemoryDeltas'", () => {
    expect(transform).toBeDefined();
  });

  it("returns null for the empty shape", () => {
    expect(transform!(EMPTY, ctx, def)).toBeNull();
  });

  it("returns null when hasDeltas is true but both arrays are empty (defensive)", () => {
    const oddShape: MemoryDeltasData = {
      hasDeltas: true,
      priorCallId: "call-prior",
      priorPriorCallId: null,
      added: [],
      updated: [],
    };
    expect(transform!(oddShape, ctx, def)).toBeNull();
  });

  it("emits the section payload with counts + deterministic added-only summary", () => {
    const data: MemoryDeltasData = {
      hasDeltas: true,
      priorCallId: "call-prior",
      priorPriorCallId: null,
      added: [
        { id: "m1", category: "FACT", key: "name", value: "Alex", confidence: 0.9 },
        { id: "m2", category: "PREFERENCE", key: "tone", value: "warm", confidence: 0.8 },
      ],
      updated: [],
    };
    const out = transform!(data, ctx, def);
    expect(out).not.toBeNull();
    expect(out.addedCount).toBe(2);
    expect(out.updatedCount).toBe(0);
    expect(out.summary).toBe("Since your last call: 2 new facts.");
  });

  it("emits the updated-only summary correctly", () => {
    const data: MemoryDeltasData = {
      hasDeltas: true,
      priorCallId: "call-prior",
      priorPriorCallId: "call-prior-prior",
      added: [],
      updated: [
        {
          id: "m1",
          category: "FACT",
          key: "location",
          value: "Manchester",
          confidence: 0.85,
          supersededId: "m-old",
          priorValue: "London",
        },
      ],
    };
    const out = transform!(data, ctx, def);
    expect(out.summary).toBe("Since your last call: 1 updated.");
    expect(out.updated[0]).toMatchObject({
      key: "location",
      value: "Manchester",
      priorValue: "London",
    });
  });

  it("combines added + updated in the summary with the correct pluralisation", () => {
    const data: MemoryDeltasData = {
      hasDeltas: true,
      priorCallId: "call-prior",
      priorPriorCallId: "call-prior-prior",
      added: [
        { id: "m1", category: "FACT", key: "k1", value: "v1", confidence: 0.8 },
      ],
      updated: [
        {
          id: "m2",
          category: "FACT",
          key: "k2",
          value: "v2-new",
          confidence: 0.8,
          supersededId: "m2-old",
          priorValue: "v2-old",
        },
        {
          id: "m3",
          category: "FACT",
          key: "k3",
          value: "v3-new",
          confidence: 0.8,
          supersededId: "m3-old",
          priorValue: "v3-old",
        },
      ],
    };
    const out = transform!(data, ctx, def);
    expect(out.summary).toBe("Since your last call: 1 new fact, 2 updated.");
  });
});

/**
 * Tests for session-flow resolver.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * AC focus: every distinct source string from resolveSessionFlow.source
 * maps to the correct Layer via the explicit table (no fallthrough).
 */

import { describe, it, expect } from "vitest";

import { mapSessionFlowSource } from "@/lib/cascade/resolvers/session-flow";

describe("mapSessionFlowSource", () => {
  it("maps 'domain' to DOMAIN", () => {
    expect(mapSessionFlowSource("domain")).toBe("DOMAIN");
  });

  it("maps PLAYBOOK-tier source strings to PLAYBOOK", () => {
    expect(mapSessionFlowSource("new-shape")).toBe("PLAYBOOK");
    expect(mapSessionFlowSource("playbook-legacy")).toBe("PLAYBOOK");
    expect(mapSessionFlowSource("legacy-welcome")).toBe("PLAYBOOK");
    expect(mapSessionFlowSource("synthesized-from-legacy")).toBe("PLAYBOOK");
  });

  it("maps SYSTEM-tier source strings to SYSTEM", () => {
    expect(mapSessionFlowSource("init001")).toBe("SYSTEM");
    expect(mapSessionFlowSource("defaults")).toBe("SYSTEM");
  });
});

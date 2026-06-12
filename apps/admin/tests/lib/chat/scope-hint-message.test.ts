import { describe, it, expect } from "vitest";
import { buildScopeHintMessage } from "@/lib/chat/scope-hint-message";

describe("buildScopeHintMessage", () => {
  it("CALLER scope → message names caller_id and suggests tool", () => {
    const s = buildScopeHintMessage({
      layer: "CALLER",
      scopeIds: { callerId: "c1" },
      label: "Bertie Tallstaff",
      suggestedTool: "update_behavior_target",
    });
    expect(s).toContain("[scope]");
    expect(s).toContain("CALLER");
    expect(s).toContain("Bertie Tallstaff");
    expect(s).toContain("caller_id=c1");
    expect(s).toContain("update_behavior_target");
  });

  it("PLAYBOOK scope → message names playbook_id", () => {
    const s = buildScopeHintMessage({
      layer: "PLAYBOOK",
      scopeIds: { playbookId: "pb1" },
      label: "OCEAN",
    });
    expect(s).toContain("PLAYBOOK");
    expect(s).toContain("OCEAN");
    expect(s).toContain("playbook_id=pb1");
    expect(s).not.toContain("update_behavior_target");
  });

  it("DOMAIN scope → message includes fanout warning", () => {
    const s = buildScopeHintMessage({
      layer: "DOMAIN",
      scopeIds: { domainId: "dom1" },
      label: "Education",
    });
    expect(s).toContain("DOMAIN");
    expect(s).toContain("domain_id=dom1");
    expect(s).toMatch(/affects every course/i);
  });

  it("SYSTEM scope (defensive) → no id sentence required", () => {
    const s = buildScopeHintMessage({
      layer: "SYSTEM",
      scopeIds: {},
      label: "system",
    });
    expect(s).toContain("SYSTEM");
    expect(s).toContain("[scope]");
  });
});

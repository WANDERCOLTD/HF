import { describe, it, expect } from "vitest";

import { resolveValueAtPath } from "@/components/journey-tab/resolve-value-at-path";

describe("resolveValueAtPath — Phase 4 (#1697)", () => {
  it("reads config.* roots from the playbookConfig root", () => {
    const config = { firstCallMode: "teach_immediately" };
    expect(resolveValueAtPath(config, "config.firstCallMode")).toBe(
      "teach_immediately",
    );
  });

  it("reads sessionFlow.* under sessionFlow", () => {
    const config = { sessionFlow: { welcomeMessage: "hi" } };
    expect(resolveValueAtPath(config, "sessionFlow.welcomeMessage")).toBe("hi");
  });

  it("reads tolerances.* under tolerances", () => {
    const config = { tolerances: { accuracy: 0.8 } };
    expect(resolveValueAtPath(config, "tolerances.accuracy")).toBe(0.8);
  });

  it("reads voiceConfig.* via playbook.voiceConfig.*", () => {
    const config = { voiceConfig: { voiceId: "v-1" } };
    expect(resolveValueAtPath(config, "playbook.voiceConfig.voiceId")).toBe("v-1");
  });

  it("returns undefined for missing paths", () => {
    expect(resolveValueAtPath({}, "config.firstCallMode")).toBeUndefined();
    expect(resolveValueAtPath({}, "sessionFlow.welcomeMessage")).toBeUndefined();
  });

  it("returns undefined for domain.* / behaviorTargets / unknown roots (not in playbookConfig)", () => {
    expect(
      resolveValueAtPath({}, "domain.onboardingIdentitySpecId"),
    ).toBeUndefined();
    expect(
      resolveValueAtPath({}, "behaviorTargets[firstCall]"),
    ).toBeUndefined();
  });

  it("returns the matching array element for structured path + arrayKey/selectorValue", () => {
    const config = {
      sessionFlow: {
        stops: [
          { kind: "pre_test", enabled: true },
          { kind: "post_test", enabled: false },
        ],
      },
    };
    const v = resolveValueAtPath(config, {
      path: "sessionFlow.stops[]",
      arrayKey: "kind",
      selectorValue: "pre_test",
    });
    expect(v).toEqual({ kind: "pre_test", enabled: true });
  });

  it("returns undefined for a null config", () => {
    expect(resolveValueAtPath(null, "config.firstCallMode")).toBeUndefined();
  });
});

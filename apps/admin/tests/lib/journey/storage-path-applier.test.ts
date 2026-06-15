import { describe, it, expect } from "vitest";

import {
  applyAtPath,
  resolveStoragePath,
} from "@/lib/journey/storage-path-applier";
import type { PlaybookConfig } from "@/lib/types/json-fields";

describe("resolveStoragePath", () => {
  it("classifies bare config.* paths", () => {
    const r = resolveStoragePath("config.firstCallMode");
    expect(r.root).toBe("config");
    expect(r.segments).toEqual(["firstCallMode"]);
    expect(r.arraySelector).toBeNull();
    expect(r.writeMode).toBe("replace");
  });

  it("classifies sessionFlow.* paths", () => {
    const r = resolveStoragePath("sessionFlow.welcomeMessage");
    expect(r.root).toBe("sessionFlow");
    expect(r.segments).toEqual(["welcomeMessage"]);
  });

  it("classifies tolerances.* paths", () => {
    const r = resolveStoragePath("tolerances.accuracy");
    expect(r.root).toBe("tolerances");
    expect(r.segments).toEqual(["accuracy"]);
  });

  it("classifies playbook.voiceConfig.* paths", () => {
    const r = resolveStoragePath("playbook.voiceConfig.voiceId");
    expect(r.root).toBe("playbook.voiceConfig");
    expect(r.segments).toEqual(["voiceId"]);
  });

  it("classifies domain.* paths", () => {
    const r = resolveStoragePath("domain.onboardingIdentitySpecId");
    expect(r.root).toBe("domain");
  });

  it("classifies behaviorTargets paths", () => {
    const r = resolveStoragePath("behaviorTargets[firstCall]");
    expect(r.root).toBe("behaviorTargets");
  });

  it("handles structured paths with arrayKey + selectorValue", () => {
    const r = resolveStoragePath({
      path: "playbook.config.sessionFlow.stops[].enabled",
      arrayKey: "kind",
      selectorValue: "pre_test",
      writeMode: "merge",
    });
    expect(r.arraySelector).toEqual({ key: "kind", value: "pre_test" });
    expect(r.writeMode).toBe("merge");
  });

  it("returns root: 'unknown' for paths it doesn't recognise", () => {
    const r = resolveStoragePath("madeUp.path");
    expect(r.root).toBe("unknown");
  });
});

describe("applyAtPath", () => {
  it("writes a config.* path at the playbook config root", () => {
    const config: PlaybookConfig = {} as PlaybookConfig;
    applyAtPath(config, resolveStoragePath("config.firstCallMode"), "teach_immediately");
    expect((config as Record<string, unknown>).firstCallMode).toBe("teach_immediately");
  });

  it("writes a sessionFlow.* path under sessionFlow", () => {
    const config: PlaybookConfig = {} as PlaybookConfig;
    applyAtPath(config, resolveStoragePath("sessionFlow.welcomeMessage"), "hi");
    const sf = (config as Record<string, unknown>).sessionFlow as Record<string, unknown>;
    expect(sf.welcomeMessage).toBe("hi");
  });

  it("writes voice fields under voiceConfig", () => {
    const config: PlaybookConfig = {} as PlaybookConfig;
    applyAtPath(config, resolveStoragePath("playbook.voiceConfig.voiceId"), "v123");
    const vc = (config as Record<string, unknown>).voiceConfig as Record<string, unknown>;
    expect(vc.voiceId).toBe("v123");
  });

  it("merges into a nested object when writeMode=merge", () => {
    const config = { progressSignals: { lowWater: 0.2 } } as unknown as PlaybookConfig;
    const resolved = resolveStoragePath({
      path: "config.progressSignals",
      writeMode: "merge",
    });
    applyAtPath(config, resolved, { highWater: 0.8 });
    const ps = (config as Record<string, unknown>).progressSignals as Record<string, unknown>;
    expect(ps.lowWater).toBe(0.2);
    expect(ps.highWater).toBe(0.8);
  });

  it("noops on unknown root (returns config unchanged)", () => {
    const config = { firstCallMode: "onboarding" } as unknown as PlaybookConfig;
    applyAtPath(config, resolveStoragePath("madeUp.path"), "x");
    expect((config as Record<string, unknown>).firstCallMode).toBe("onboarding");
  });

  it("inserts a new array element when selectorValue doesn't yet exist", () => {
    const config = {} as unknown as PlaybookConfig;
    const resolved = resolveStoragePath({
      path: "sessionFlow.stops[]",
      arrayKey: "kind",
      selectorValue: "pre_test",
      writeMode: "merge",
    });
    applyAtPath(config, resolved, { enabled: true });
    const sf = (config as Record<string, unknown>).sessionFlow as Record<string, unknown>;
    const stops = sf.stops as Array<Record<string, unknown>>;
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ kind: "pre_test", enabled: true });
  });

  it("merges into an existing array element when selectorValue matches", () => {
    const config = {
      sessionFlow: { stops: [{ kind: "pre_test", enabled: false, trigger: { type: "first" } }] },
    } as unknown as PlaybookConfig;
    const resolved = resolveStoragePath({
      path: "sessionFlow.stops[]",
      arrayKey: "kind",
      selectorValue: "pre_test",
      writeMode: "merge",
    });
    applyAtPath(config, resolved, { enabled: true });
    const stops = (
      (config as Record<string, unknown>).sessionFlow as Record<string, unknown>
    ).stops as Array<Record<string, unknown>>;
    expect(stops).toHaveLength(1);
    expect(stops[0].enabled).toBe(true);
    expect(stops[0].trigger).toEqual({ type: "first" });
  });
});

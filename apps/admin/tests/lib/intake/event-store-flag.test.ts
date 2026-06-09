// event-store-flag — epic #1338 Slice 2 (#1343).

import { describe, it, expect, vi } from "vitest";
import { resolveIntakeEventStoreMode } from "@/lib/intake/event-store-flag";

// `process.env` is typed `NodeJS.ProcessEnv` which is a string-record
// with method augmentation. Cast the test fixtures so the call sites
// stay terse.
const env = (overrides: Record<string, string>): NodeJS.ProcessEnv =>
  overrides as unknown as NodeJS.ProcessEnv;

describe("resolveIntakeEventStoreMode", () => {
  it("defaults to 'memory' when the env var is absent", () => {
    expect(resolveIntakeEventStoreMode(env({}))).toBe("memory");
  });

  it("defaults to 'memory' when the env var is an empty string", () => {
    expect(resolveIntakeEventStoreMode(env({ HF_FLAG_INTAKE_EVENT_STORE: "" }))).toBe("memory");
  });

  it("returns 'prisma' when explicitly set", () => {
    expect(resolveIntakeEventStoreMode(env({ HF_FLAG_INTAKE_EVENT_STORE: "prisma" }))).toBe(
      "prisma",
    );
  });

  it("returns 'memory' when explicitly set", () => {
    expect(resolveIntakeEventStoreMode(env({ HF_FLAG_INTAKE_EVENT_STORE: "memory" }))).toBe(
      "memory",
    );
  });

  it("normalises case + whitespace", () => {
    expect(
      resolveIntakeEventStoreMode(env({ HF_FLAG_INTAKE_EVENT_STORE: "  PRISMA  " })),
    ).toBe("prisma");
    expect(resolveIntakeEventStoreMode(env({ HF_FLAG_INTAKE_EVENT_STORE: "Memory" }))).toBe(
      "memory",
    );
  });

  it("falls back to default and warns on an unrecognised value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveIntakeEventStoreMode(env({ HF_FLAG_INTAKE_EVENT_STORE: "redis" }))).toBe(
      "memory",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

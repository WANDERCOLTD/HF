/**
 * #1342 — feature-flag accessor tests. Exercises both flag states so the
 * cut-over routes can guarantee the false-path is untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ENV_VAR = "HF_FLAG_SESSION_MODEL_V2";

describe("isSessionModelV2Enabled", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
  });

  it("returns false when unset", async () => {
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    expect(isSessionModelV2Enabled()).toBe(false);
  });

  it("returns false when set to empty string", async () => {
    process.env[ENV_VAR] = "";
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    expect(isSessionModelV2Enabled()).toBe(false);
  });

  it("returns true ONLY for literal 'true'", async () => {
    process.env[ENV_VAR] = "true";
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    expect(isSessionModelV2Enabled()).toBe(true);
  });

  it("returns false for '1', 'TRUE', 'on', 'yes' (strict literal)", async () => {
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    for (const v of ["1", "TRUE", "on", "yes", "false", "0"]) {
      process.env[ENV_VAR] = v;
      expect(isSessionModelV2Enabled()).toBe(false);
    }
  });
});

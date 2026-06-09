/**
 * #1342 / #1344 — feature-flag accessor tests.
 *
 * #1344 Slice 4 flipped the default: the flag is ON unless explicitly
 * set to "false". Slice 5 removes the flag entirely.
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

  it("returns TRUE when unset (default on per #1344 Slice 4)", async () => {
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    expect(isSessionModelV2Enabled()).toBe(true);
  });

  it("returns TRUE when set to empty string", async () => {
    process.env[ENV_VAR] = "";
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    expect(isSessionModelV2Enabled()).toBe(true);
  });

  it("returns FALSE ONLY for literal 'false'", async () => {
    process.env[ENV_VAR] = "false";
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    expect(isSessionModelV2Enabled()).toBe(false);
  });

  it("returns TRUE for 'true', '1', 'TRUE', 'on', 'yes', '0' (anything that isn't literal 'false')", async () => {
    const { isSessionModelV2Enabled } = await import("@/lib/voice/session-flag");
    for (const v of ["true", "1", "TRUE", "on", "yes", "0"]) {
      process.env[ENV_VAR] = v;
      expect(isSessionModelV2Enabled()).toBe(true);
    }
  });
});

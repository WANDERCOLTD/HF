// @vitest-environment node
//
// Sprint C — DisclosureContentPort tests.
//
// Two-layer story (merged from #1244 + #1243 batch 1):
//   1. #1244 promoted all six disclosure files DRAFT → RC.1, so the
//      live files no longer trigger the safety belt. The rendered
//      body has no DRAFT placeholders / lorem ipsum / "DO NOT SHIP"
//      markers.
//   2. #1243 retargeted the guard from `NODE_ENV=production` to
//      `NEXT_PUBLIC_APP_ENV=PROD` so STAGING/PILOT/DEV (which all run
//      NODE_ENV=production on Cloud Run) no longer over-block intake.
//
// The guard MECHANISM (DRAFT × env → refuse) is still in place; it
// just doesn't fire against the post-promotion file set. Future
// status:DRAFT files will re-exercise it. The audit-bundle test
// exercises the mechanism today via mocked DRAFT meta.
//
// HF's tests/setup.ts globally mocks node:fs/promises (for transcript
// tests). We unmock for THIS file so the real fs sees lib/intake/copy/.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.unmock("node:fs/promises");
vi.doMock("node:fs/promises", async () =>
  vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
import {
  loadDisclosureCopy,
} from "@/lib/intake/hf-adapter/disclosure-content";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_APP_ENV = process.env.NEXT_PUBLIC_APP_ENV;

// process.env.NODE_ENV is typed readonly under recent TS; mutate via
// the parent object cast so we can flip envs in tests.
const ENV = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete ENV.NODE_ENV;
  } else {
    ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  if (ORIGINAL_APP_ENV === undefined) {
    delete ENV.NEXT_PUBLIC_APP_ENV;
  } else {
    ENV.NEXT_PUBLIC_APP_ENV = ORIGINAL_APP_ENV;
  }
});

describe("DisclosureContentPort — production safety belt", () => {
  beforeEach(() => {
    ENV.NODE_ENV = "test";
    delete ENV.NEXT_PUBLIC_APP_ENV;
  });

  it("loads the GDPR Art 13 notice in dev/test", async () => {
    const entry = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(entry.meta.requirementId).toBe("gdpr.art13.privacy-notice");
    expect(entry.meta.status).toBe("RC");
    expect(entry.meta.version).toBe("0.1.0-rc.1");
    expect(entry.content.format).toBe("markdown");
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/); // hex sha256
    expect(entry.body.length).toBeGreaterThan(50);
    // #1244 — visible DRAFT markers must not appear in rendered copy.
    expect(entry.body).not.toMatch(/lorem ipsum/i);
    expect(entry.body).not.toMatch(/DO NOT SHIP/i);
    expect(entry.body).not.toMatch(/\[DRAFT/);
  });

  it("loads the EU AI Act Art 50 notice", async () => {
    const entry = await loadDisclosureCopy(
      "eu-ai-act.art50.ai-interaction-disclosure",
    );
    expect(entry.meta.requirementId).toBe(
      "eu-ai-act.art50.ai-interaction-disclosure",
    );
    expect(entry.meta.status).toBe("RC");
    expect(entry.body).not.toMatch(/lorem ipsum/i);
    expect(entry.body).not.toMatch(/DO NOT SHIP/i);
  });

  // RC copy is delivered under every env value — the safety belt only
  // fires on status:DRAFT. After #1244 promoted the live files there
  // are no DRAFT files on disk to refuse; the mechanism itself remains
  // exercised in audit-bundle.test.ts via mocked DRAFT meta.
  it("RC copy is delivered (not refused) when NEXT_PUBLIC_APP_ENV=PROD", async () => {
    ENV.NEXT_PUBLIC_APP_ENV = "PROD";
    const entry = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(entry.meta.status).toBe("RC");
  });

  // Regression: STAGING / PILOT / DEV all run NODE_ENV=production on
  // Cloud Run. Pre-#1243 the guard keyed off NODE_ENV which would have
  // blocked staging bootstrap if any DRAFT files existed; now keyed
  // off NEXT_PUBLIC_APP_ENV. The matrix here proves no env value
  // refuses delivery of an RC file — the env axis is independent of
  // the file's status when status is RC.
  for (const appEnv of ["DEV", "STAGING", "PILOT", "TEST"] as const) {
    it(`delivers RC copy when NODE_ENV=production AND NEXT_PUBLIC_APP_ENV=${appEnv}`, async () => {
      ENV.NODE_ENV = "production";
      ENV.NEXT_PUBLIC_APP_ENV = appEnv;
      const entry = await loadDisclosureCopy("gdpr.art13.privacy-notice");
      expect(entry.meta.status).toBe("RC");
      expect(entry.meta.requirementId).toBe("gdpr.art13.privacy-notice");
    });
  }

  it("delivers RC copy when NEXT_PUBLIC_APP_ENV is unset (dev/test default)", async () => {
    ENV.NODE_ENV = "production";
    delete ENV.NEXT_PUBLIC_APP_ENV;
    const entry = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(entry.meta.status).toBe("RC");
  });

  it("contentHash is stable across reads of the same file", async () => {
    const a = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    const b = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(a.contentHash).toBe(b.contentHash);
  });
});

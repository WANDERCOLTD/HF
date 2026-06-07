// @vitest-environment node
//
// Sprint C — DisclosureContentPort tests.
//
// Post-#1244 — all six disclosure files were promoted from DRAFT to RC.1
// (counsel sign-off for staging — files renamed to *.v0.1.0-rc.1.mdx,
// frontmatter status: RC, visible DRAFT markers + lorem ipsum
// stripped). The runtime safety belt at disclosure-content.ts still
// blocks status:DRAFT delivery; these tests cover (a) RC files load
// cleanly, (b) the rendered body has no DRAFT placeholders, (c) RC
// files are not refused regardless of env. The safety-belt mechanism
// itself is now exercised only via mocked DRAFT meta in audit-bundle
// tests.
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
  DraftCopyInProductionError,
} from "@/lib/intake/hf-adapter/disclosure-content";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

// process.env.NODE_ENV is typed readonly under recent TS; mutate via
// the parent object cast so we can flip envs in tests.
const ENV = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete ENV.NODE_ENV;
  } else {
    ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

describe("DisclosureContentPort — production safety belt", () => {
  beforeEach(() => {
    ENV.NODE_ENV = "test";
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

  it("RC copy is delivered (not refused) under any env — DRAFT refusal only fires for status:DRAFT", async () => {
    // Promotion DRAFT → RC means the safety belt does NOT fire for these
    // files regardless of NODE_ENV / NEXT_PUBLIC_APP_ENV. The refusal
    // path is reserved for status:DRAFT only.
    ENV.NODE_ENV = "production";
    const entry = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(entry.meta.status).toBe("RC");
  });

  it("contentHash is stable across reads of the same file", async () => {
    const a = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    const b = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(a.contentHash).toBe(b.contentHash);
  });
});

// @vitest-environment node
//
// Sprint C — DisclosureContentPort tests.
//
// Verifies the runtime safety belt that refuses to deliver DRAFT
// copy in NODE_ENV=production. Tests against the real on-disk
// lib/intake/copy/*.v0.1.0-DRAFT.mdx files since the production-refusal
// behaviour is the critical Sprint C ratchet.
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

  it("loads the GDPR Art 13 placeholder in dev/test", async () => {
    const entry = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(entry.meta.requirementId).toBe("gdpr.art13.privacy-notice");
    expect(entry.meta.status).toBe("DRAFT");
    expect(entry.meta.version).toBe("0.1.0");
    expect(entry.content.format).toBe("markdown");
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/); // hex sha256
    expect(entry.body.length).toBeGreaterThan(50);
  });

  it("loads the EU AI Act Art 50 placeholder", async () => {
    const entry = await loadDisclosureCopy(
      "eu-ai-act.art50.ai-interaction-disclosure",
    );
    expect(entry.meta.requirementId).toBe(
      "eu-ai-act.art50.ai-interaction-disclosure",
    );
    expect(entry.meta.status).toBe("DRAFT");
  });

  it("REFUSES to deliver DRAFT copy when NODE_ENV=production", async () => {
    ENV.NODE_ENV = "production";
    await expect(
      loadDisclosureCopy("gdpr.art13.privacy-notice"),
    ).rejects.toBeInstanceOf(DraftCopyInProductionError);
  });

  it("contentHash is stable across reads of the same file", async () => {
    const a = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    const b = await loadDisclosureCopy("gdpr.art13.privacy-notice");
    expect(a.contentHash).toBe(b.contentHash);
  });
});

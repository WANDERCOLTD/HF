// Sprint C — End-to-end audit bundle composition test.
//
// Drives a complete intake session through the in-memory store,
// composes the AuditBundle, and verifies the structural properties
// the spike must demonstrate per issue #993 AC #10:
//
//   - Byte-stable canonicalisation (serialise twice → identical bytes)
//   - All locked event kinds present (DisclosureDelivered × 2,
//     CapturedTurn × N, ProjectionCommit)
//   - AUDIT_BUNDLE_VERSION matches the library constant
//   - Bundle is non-empty JSON parsable

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the disclosure-content port at the file-IO boundary so tests
// don't depend on lib/intake/copy/*.mdx being present on disk in the
// test environment. (vitest runs from apps/admin with cwd=that, so
// the real port would actually work — but this isolates the test.)
vi.mock("@/lib/intake/hf-adapter/disclosure-content", () => ({
  loadDisclosureCopy: vi.fn(async (requirementId: string) => ({
    meta: {
      requirementId,
      regulation: "gdpr",
      article: "13",
      version: "0.1.0",
      status: "DRAFT",
      effective: "2026-06-02",
      controller: "HumanFirst Foundation",
      controllerContact: "dpo@humanfirstfoundation.com",
      locale: "en",
    },
    body: "stub body",
    content: { text: "stub body", format: "markdown", locale: "en" },
    contentHash: `fake-hash-${requirementId}`,
  })),
}));

import {
  openSession,
  appendEvent,
  appendMessage,
  setValue,
  PURPOSE,
  __resetSessionStore,
} from "@/lib/intake/session-store";
import { composeBundleFromSession } from "@/lib/intake/audit-bundle";
import { canonicalJSON, AUDIT_BUNDLE_VERSION } from "@/lib/intake/tallyseal";
import type {
  IntentKey,
  ProjectionName,
  Region,
  TenantId,
  ActorId,
  SubjectId,
} from "@/lib/intake/tallyseal";

const TENANT = {
  id: "hf-test" as TenantId,
  region: "europe-west2" as Region,
};
const ACTOR = {
  id: "test-actor" as ActorId,
  kind: "human" as const,
};
const SUBJECT = "subject-1" as SubjectId;

const FIXED_TIME = new Date("2026-06-02T20:00:00Z");

beforeEach(() => {
  __resetSessionStore();
});

describe("End-to-end audit bundle composition", () => {
  it("composes a byte-stable bundle from a complete happy-path session", () => {
    const session = openSession({
      tenant: TENANT,
      actor: ACTOR,
      key: "EnrollmentIntake" as IntentKey,
      projection: "IntakeApplication" as ProjectionName,
    });

    appendEvent(session, {
      kind: "DisclosureDelivered",
      payload: { requirementId: "gdpr.art13.privacy-notice" },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [SUBJECT],
    });
    appendEvent(session, {
      kind: "DisclosureDelivered",
      payload: { requirementId: "eu-ai-act.art50.ai-interaction-disclosure" },
      lawfulBasis: "contract",
      purpose: PURPOSE.aiTutorMediation,
      dataSubjectIds: [SUBJECT],
    });

    appendEvent(session, {
      kind: "CapturedTurn",
      payload: { role: "user", content: "Sarah" },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [SUBJECT],
    });
    setValue(session, "firstName", "Sarah");
    appendMessage(session, "user", "Sarah");

    appendEvent(session, {
      kind: "CapturedTurn",
      payload: { role: "user", content: "Wright" },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [SUBJECT],
    });
    setValue(session, "lastName", "Wright");
    appendMessage(session, "user", "Wright");

    appendEvent(session, {
      kind: "CapturedTurn",
      payload: { role: "user", content: "sarah@example.com" },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [SUBJECT],
    });
    setValue(session, "email", "sarah@example.com");
    appendMessage(session, "user", "sarah@example.com");

    appendEvent(session, {
      kind: "ProjectionCommit",
      payload: {
        projection: "IntakeApplication",
        snapshot: { firstName: "Sarah", lastName: "Wright", email: "sarah@example.com" },
      },
      lawfulBasis: "contract",
      purpose: PURPOSE.courseDelivery,
      dataSubjectIds: [SUBJECT],
    });
    session.state = "committed";

    const bundle = composeBundleFromSession(session, { generatedAt: FIXED_TIME });

    expect(bundle.bundleVersion).toBe(AUDIT_BUNDLE_VERSION);
    expect(bundle.events.length).toBe(6);

    const kinds = bundle.events.map((e: { kind: string }) => e.kind);
    expect(kinds.filter((k) => k === "DisclosureDelivered").length).toBe(2);
    expect(kinds.filter((k) => k === "CapturedTurn").length).toBe(3);
    expect(kinds.filter((k) => k === "ProjectionCommit").length).toBe(1);

    // Byte-stable canonicalisation: serialise twice → identical bytes.
    const a = canonicalJSON(bundle);
    const b = canonicalJSON(bundle);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
    // And the bundle is valid JSON.
    expect(() => JSON.parse(a)).not.toThrow();
  });

  it("hash chain is monotonic — each event's prevHash matches the prior event's contentHash", () => {
    const session = openSession({
      tenant: TENANT,
      actor: ACTOR,
      key: "EnrollmentIntake" as IntentKey,
      projection: "IntakeApplication" as ProjectionName,
    });

    for (let i = 0; i < 5; i++) {
      appendEvent(session, {
        kind: "CapturedTurn",
        payload: { role: "user", content: `message ${i}` },
        lawfulBasis: "contract",
        purpose: PURPOSE.courseDelivery,
        dataSubjectIds: [SUBJECT],
      });
    }

    for (let i = 1; i < session.events.length; i++) {
      const prev = session.events[i - 1];
      const curr = session.events[i];
      expect(curr.prevHash).toBe(prev.contentHash);
    }

    // First event's prevHash is the genesis sentinel — `null` per the
    // Tallyseal spec (`GENESIS_PREV_HASH` from @tallyseal/core).
    // Pre-#1343 this was a 64-char zero string; switched in Slice 2
    // so both the in-memory store and PrismaEventStore converge with
    // Tallyseal's `computeContentHash` pipeline.
    expect(session.events[0].prevHash).toBeNull();
  });
});

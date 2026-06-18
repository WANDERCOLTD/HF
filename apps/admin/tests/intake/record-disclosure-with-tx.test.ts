/**
 * #1919 — pin the forward-compat shape of `recordDisclosure` /
 * `markDisclosureAcknowledged` so the Tallyseal Drop 1 swap is a
 * one-line change rather than a refactor.
 *
 * What we pin today:
 *   - The wrapper functions exist + are exported
 *   - They accept the documented arg shape (compile-time type test)
 *   - They accept an optional `tx?` argument (forward-compat)
 *   - Best-effort semantics preserved — internal failures don't throw
 *
 * What we DO NOT pin today:
 *   - Whether `tx` is actually plumbed through to Tallyseal — that
 *     requires Drop 1 to ship `opts?: { tx?: PrismaTxLike }` on the
 *     SDK side. Pre-Drop-1 the wrapper accepts + ignores `tx`. A
 *     post-Drop-1 follow-on PR will land the active plumbing + a
 *     vitest that asserts the tx is honoured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recordMock = vi.fn().mockResolvedValue(undefined);
const markAcknowledgedMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/intake/hf-adapter/disclosure-store", () => ({
  getDisclosureStore: vi.fn().mockResolvedValue({
    record: recordMock,
    markAcknowledged: markAcknowledgedMock,
  }),
  deriveDisclosureId: (intentId: string, requirementId: string) =>
    `disc_${intentId}_${requirementId}`,
}));

import {
  recordDisclosure,
  markDisclosureAcknowledged,
  type PrismaTxLike,
} from "@/lib/intake/hf-adapter/record-disclosure-with-tx";

describe("recordDisclosure (forward-compat wrapper, #1919)", () => {
  beforeEach(() => {
    recordMock.mockClear();
    markAcknowledgedMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the underlying store.record with the documented shape", async () => {
    const deliveredAt = new Date("2026-06-18T12:00:00Z");
    await recordDisclosure({
      id: "disc_int_gdpr.art13.privacy-notice",
      tenantId: "tenant_x",
      subject: "intake-subject-abc",
      requirementId: "gdpr.art13.privacy-notice",
      content: { body: "redacted" },
      contentHash: "deadbeef",
      deliveredAt,
      deliveryMethod: "in-app",
    });
    expect(recordMock).toHaveBeenCalledTimes(1);
    const arg = recordMock.mock.calls[0][0];
    expect(arg.id).toBe("disc_int_gdpr.art13.privacy-notice");
    expect(arg.tenantId).toBe("tenant_x");
    expect(arg.requirementId).toBe("gdpr.art13.privacy-notice");
    expect(arg.deliveryMethod).toBe("in-app");
    expect(arg.acknowledgedAt).toBeNull();
    expect(arg.retractedAt).toBeNull();
    expect(arg.deliveredAt).toBe(deliveredAt);
  });

  it("swallows store.record failures (best-effort)", async () => {
    recordMock.mockRejectedValueOnce(new Error("postgres unreachable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordDisclosure({
        id: "disc_x_y",
        tenantId: "t",
        subject: "s",
        requirementId: "r",
        content: {},
        contentHash: "h",
        deliveredAt: new Date(),
        deliveryMethod: "in-app",
      }),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[intake] recordDisclosure"),
      expect.any(String),
    );
  });

  it("accepts but does not propagate `tx` (pre-Drop-1 behaviour)", async () => {
    const fakeTx = {} as PrismaTxLike;
    await recordDisclosure({
      id: "id",
      tenantId: "t",
      subject: "s",
      requirementId: "r",
      content: {},
      contentHash: "h",
      deliveredAt: new Date(),
      deliveryMethod: "in-app",
      tx: fakeTx,
    });
    expect(recordMock).toHaveBeenCalledTimes(1);
    // Pre-Drop-1: store.record is called with exactly ONE argument
    // (the payload). When Drop 1 lands, the wrapper passes a second
    // `{ tx }` argument and this assertion flips.
    expect(recordMock.mock.calls[0].length).toBe(1);
  });
});

describe("markDisclosureAcknowledged (forward-compat wrapper, #1919)", () => {
  beforeEach(() => {
    recordMock.mockClear();
    markAcknowledgedMock.mockClear();
  });

  it("calls the underlying store.markAcknowledged", async () => {
    const acknowledgedAt = new Date("2026-06-18T13:00:00Z");
    await markDisclosureAcknowledged({
      tenantId: "tenant_x",
      disclosureId: "disc_int_gdpr.art13.privacy-notice",
      acknowledgedAt,
    });
    expect(markAcknowledgedMock).toHaveBeenCalledTimes(1);
    expect(markAcknowledgedMock).toHaveBeenCalledWith(
      "tenant_x",
      "disc_int_gdpr.art13.privacy-notice",
      acknowledgedAt,
    );
  });

  it("swallows markAcknowledged failures (best-effort)", async () => {
    markAcknowledgedMock.mockRejectedValueOnce(new Error("db error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      markDisclosureAcknowledged({
        tenantId: "t",
        disclosureId: "d",
        acknowledgedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[intake] markDisclosureAcknowledged"),
      expect.any(String),
    );
  });

  it("accepts but does not propagate `tx` (pre-Drop-1 behaviour)", async () => {
    const fakeTx = {} as PrismaTxLike;
    await markDisclosureAcknowledged({
      tenantId: "t",
      disclosureId: "d",
      acknowledgedAt: new Date(),
      tx: fakeTx,
    });
    expect(markAcknowledgedMock).toHaveBeenCalledTimes(1);
    // Pre-Drop-1: 3 positional args (tenantId, disclosureId, acknowledgedAt).
    // Post-Drop-1: 4th `{ tx }` argument added.
    expect(markAcknowledgedMock.mock.calls[0].length).toBe(3);
  });
});

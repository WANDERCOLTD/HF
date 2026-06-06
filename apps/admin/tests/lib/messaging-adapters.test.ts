/**
 * Tests for lib/messaging/adapters/* + registry (#1141).
 *
 * Properties under test:
 *   - email-resend adapter rejects non-email channel
 *   - email-resend adapter throws when secretRef points at an unset env var
 *   - noop-sms adapter throws NotImplementedError (TL R6 — throw, not silent ok)
 *   - noop-sms adapter rejects non-sms channel
 *   - registry returns the right adapter for each key
 *   - registry throws a friendly error on unknown key
 *   - listRegisteredMessagingAdapterKeys reflects the registry shape
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// nodemailer is stubbed so we never actually try to connect to Resend.
const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
}));

describe("messaging adapters + registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("email-resend adapter", () => {
    it("rejects channel != 'email'", async () => {
      const { emailResendAdapter } = await import(
        "@/lib/messaging/adapters/email-resend"
      );
      await expect(
        emailResendAdapter.send({
          to: "x@y.z",
          channel: "sms", // wrong channel
          secretRef: "RESEND_API_KEY",
          fromAddress: "HF <noreply@test>",
          body: "hi",
        }),
      ).rejects.toThrow(/email only/);
    });

    it("throws when secretRef env var is unset", async () => {
      vi.stubEnv("UNSET_TEST_KEY", "");
      const { emailResendAdapter } = await import(
        "@/lib/messaging/adapters/email-resend"
      );
      await expect(
        emailResendAdapter.send({
          to: "x@y.z",
          channel: "email",
          secretRef: "UNSET_TEST_KEY",
          fromAddress: "HF <noreply@test>",
          subject: "test",
          body: "<p>hi</p>",
        }),
      ).rejects.toThrow(/secretRef 'UNSET_TEST_KEY' is not set/);
    });

    it("calls nodemailer with the resolved env credential and returns messageId", async () => {
      vi.stubEnv("RESEND_API_KEY_TEST", "re_xyz");
      sendMailMock.mockResolvedValue({ messageId: "<smtp-id-123>" });
      const { emailResendAdapter } = await import(
        "@/lib/messaging/adapters/email-resend"
      );
      const result = await emailResendAdapter.send({
        to: "x@y.z",
        channel: "email",
        secretRef: "RESEND_API_KEY_TEST",
        fromAddress: "HF <noreply@test>",
        subject: "PIN test",
        body: "<p>123456</p>",
        plainTextBody: "123456",
      });
      expect(result.messageId).toBe("<smtp-id-123>");
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "HF <noreply@test>",
          to: "x@y.z",
          subject: "PIN test",
          html: "<p>123456</p>",
          text: "123456",
        }),
      );
    });
  });

  describe("noop-sms adapter", () => {
    it("throws NotImplementedError on send (TL R6 — fail loud)", async () => {
      const { noopSmsAdapter } = await import(
        "@/lib/messaging/adapters/noop-sms"
      );
      const { NotImplementedError } = await import("@/lib/messaging/types");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          noopSmsAdapter.send({
            to: "+447700900123",
            channel: "sms",
            secretRef: "TWILIO_AUTH_TOKEN",
            fromAddress: "+15005550006",
            body: "Your code is 482931",
            plainTextBody: "Your code is 482931",
          }),
        ).rejects.toBeInstanceOf(NotImplementedError);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("[noop-sms]"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("rejects channel != 'sms'", async () => {
      const { noopSmsAdapter } = await import(
        "@/lib/messaging/adapters/noop-sms"
      );
      await expect(
        noopSmsAdapter.send({
          to: "x@y.z",
          channel: "email",
          secretRef: "TWILIO_AUTH_TOKEN",
          fromAddress: "+15005550006",
          body: "x",
        }),
      ).rejects.toThrow(/sms only/);
    });
  });

  describe("registry", () => {
    it("returns the right adapter for each known key", async () => {
      const {
        getMessagingAdapter,
        listRegisteredMessagingAdapterKeys,
      } = await import("@/lib/messaging/registry");
      const keys = listRegisteredMessagingAdapterKeys();
      expect(keys).toEqual(expect.arrayContaining(["email-resend", "noop-sms"]));
      const email = getMessagingAdapter("email-resend");
      const sms = getMessagingAdapter("noop-sms");
      expect(email.key).toBe("email-resend");
      expect(sms.key).toBe("noop-sms");
    });

    it("throws a friendly error on unknown key", async () => {
      const { getMessagingAdapter } = await import("@/lib/messaging/registry");
      expect(() => getMessagingAdapter("nope")).toThrow(
        /no adapter registered for key 'nope'/,
      );
    });
  });
});

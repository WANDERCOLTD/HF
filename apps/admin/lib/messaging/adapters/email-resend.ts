import nodemailer from "nodemailer";
import type {
  MessagingAdapter,
  MessagingSendParams,
  MessagingSendResult,
} from "../types";

/**
 * Email-resend adapter (#1141).
 *
 * Wraps a nodemailer transport against the Resend SMTP relay. Mirrors
 * the existing `lib/email.ts::transporter` configuration but dereferences
 * `secretRef` from process.env per-call so that admins can swap secrets
 * via /x/settings/messaging-providers without a dev-server restart.
 *
 * The PIN-email body composition still lives in
 * `lib/email.ts::sendIdentityPinEmail` — this adapter is for raw
 * transport. The TL review (#1141 R5) chose option (a): leave
 * `sendIdentityPinEmail` untouched and have it call through this adapter
 * via the resolver. That keeps #1101's deployed-and-working PIN flow
 * low-risk during the rewire.
 */
class EmailResendAdapter implements MessagingAdapter {
  readonly key = "email-resend";
  readonly channels = ["email"] as const;

  async send(params: MessagingSendParams): Promise<MessagingSendResult> {
    if (params.channel !== "email") {
      throw new Error(
        `[email-resend] cannot deliver to channel '${params.channel}' — email only`,
      );
    }

    const apiKey = process.env[params.secretRef];
    if (!apiKey) {
      throw new Error(
        `[email-resend] secretRef '${params.secretRef}' is not set in env`,
      );
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.resend.com",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      auth: {
        user: process.env.SMTP_USER || "resend",
        pass: apiKey,
      },
    });

    const info = await transporter.sendMail({
      from: params.fromAddress,
      to: params.to,
      subject: params.subject ?? "",
      text: params.plainTextBody ?? "",
      html: params.body,
    });

    return {
      messageId:
        typeof info?.messageId === "string"
          ? info.messageId
          : `unknown-${Date.now()}`,
    };
  }
}

export const emailResendAdapter = new EmailResendAdapter();

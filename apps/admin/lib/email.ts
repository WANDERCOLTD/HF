// @ts-expect-error — no @types/nodemailer installed
import nodemailer from "nodemailer";
import {
  getEmailTemplateSettings,
  EMAIL_TEMPLATE_DEFAULTS,
  type EmailTemplateSettings,
} from "@/lib/system-settings";
import { renderEmailHtml } from "@/lib/email-render";
export { renderEmailHtml, type RenderEmailOptions } from "@/lib/email-render";

/** Centralized email "from" address — all email functions use this */
export const EMAIL_FROM_DEFAULT = "HF Admin <noreply@example.com>";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.resend.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  auth: {
    user: process.env.SMTP_USER || "resend",
    pass: process.env.SMTP_PASSWORD || process.env.RESEND_API_KEY || "",
  },
});

// ── Template variable replacement ───────────────────────

function replaceVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ── Magic link email ────────────────────────────────────

interface SendMagicLinkEmailParams {
  to: string;
  url: string;
}

export async function sendMagicLinkEmail({ to, url }: SendMagicLinkEmailParams) {
  let settings: EmailTemplateSettings;
  try {
    settings = await getEmailTemplateSettings();
  } catch {
    settings = EMAIL_TEMPLATE_DEFAULTS;
  }

  const fromAddress = process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT;

  const html = renderEmailHtml({
    heading: settings.magicLinkHeading,
    bodyHtml: `<p style="margin: 0 0 16px;">${settings.magicLinkBody}</p>`,
    buttonText: settings.magicLinkButtonText,
    buttonUrl: url,
    footer: settings.magicLinkFooter,
    brandColorStart: settings.sharedBrandColorStart,
    brandColorEnd: settings.sharedBrandColorEnd,
  });

  const text = `${settings.magicLinkBody}\n\nSign in: ${url}\n\n${settings.magicLinkFooter}`;

  await transporter.sendMail({
    from: fromAddress,
    to,
    subject: settings.magicLinkSubject,
    text,
    html,
  });
}

// ── Invite email ────────────────────────────────────────

interface SendInviteEmailParams {
  to: string;
  firstName?: string;
  inviteUrl: string;
  domainName?: string;
}

export async function sendInviteEmail({
  to,
  firstName,
  inviteUrl,
  domainName,
}: SendInviteEmailParams) {
  let settings: EmailTemplateSettings;
  try {
    settings = await getEmailTemplateSettings();
  } catch {
    settings = EMAIL_TEMPLATE_DEFAULTS;
  }

  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const context = domainName
    ? `You've been invited to test the <strong>${domainName}</strong> experience.`
    : "You've been invited to test our conversational AI system.";

  const vars: Record<string, string> = {
    greeting,
    context,
    firstName: firstName || "",
    domainName: domainName || "",
  };

  const subject = replaceVars(settings.inviteSubject, vars);
  const bodyTemplate = replaceVars(settings.inviteBody, vars);
  const footerText = replaceVars(settings.inviteFooter, vars);

  const fromAddress = process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT;

  const bodyHtml = bodyTemplate
    .split("\n")
    .map((line) => `<p style="font-size: 16px; margin: 0 0 16px;">${line}</p>`)
    .join("\n");

  const html = renderEmailHtml({
    heading: replaceVars(settings.inviteHeading, vars),
    bodyHtml,
    buttonText: replaceVars(settings.inviteButtonText, vars),
    buttonUrl: inviteUrl,
    footer: footerText,
    brandColorStart: settings.sharedBrandColorStart,
    brandColorEnd: settings.sharedBrandColorEnd,
  });

  const textContext = domainName
    ? `You've been invited to test the ${domainName} experience.`
    : "You've been invited to test our conversational AI system.";
  const text = `${greeting}\n\n${textContext}\n\nAccept your invitation: ${inviteUrl}\n\n${footerText}`;

  await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html,
  });
}

// ── Identity PIN email (#1101 — first-call continuity attestation) ──────

interface SendIdentityPinEmailParams {
  to: string;
  firstName?: string;
  pin: string;
  callerSimUrl: string;
  isResend?: boolean;
}

/**
 * Email the learner their first-call PIN. Reuses the shared transporter and
 * renderEmailHtml. PIN is rendered as a prominent code block in the body and
 * also surfaced in the subject-line-adjacent space; the button takes the
 * learner to /x/sim/[callerId] where they enter it.
 *
 * Subject differs on resend so a learner's inbox makes the new code obvious
 * when there are multiple in a thread.
 */
export async function sendIdentityPinEmail({
  to,
  firstName,
  pin,
  callerSimUrl,
  isResend = false,
}: SendIdentityPinEmailParams) {
  const fromAddress = process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const heading = isResend ? "Your new sign-in code" : "Your sign-in code";
  const subject = isResend
    ? `Your new sign-in code: ${pin}`
    : `Your sign-in code: ${pin}`;

  const pinDisplay = `<div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; letter-spacing: 8px; font-weight: 700; text-align: center; padding: 24px; margin: 16px 0; background: #f4f4f5; border-radius: 8px; color: #18181b;">${pin}</div>`;

  const bodyHtml = [
    `<p style="font-size: 16px; margin: 0 0 16px;">${greeting}</p>`,
    `<p style="font-size: 16px; margin: 0 0 16px;">Enter this code on the page below to start your first call. It expires in 24 hours.</p>`,
    pinDisplay,
    `<p style="font-size: 14px; color: #71717a; margin: 16px 0 0;">If you didn't request this code, you can safely ignore this email.</p>`,
  ].join("\n");

  const html = renderEmailHtml({
    heading,
    bodyHtml,
    buttonText: "Enter your code",
    buttonUrl: callerSimUrl,
    footer: "This code lets us confirm it's really you on your first call.",
  });

  const text = `${greeting}\n\nYour sign-in code is: ${pin}\n\nIt expires in 24 hours. Enter it here: ${callerSimUrl}\n\nIf you didn't request this code, you can safely ignore this email.`;

  await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html,
  });
}

// ── Password reset email ────────────────────────────────────

interface SendPasswordResetEmailParams {
  to: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: SendPasswordResetEmailParams) {
  let settings: EmailTemplateSettings;
  try {
    settings = await getEmailTemplateSettings();
  } catch {
    settings = EMAIL_TEMPLATE_DEFAULTS;
  }

  const fromAddress = process.env.EMAIL_FROM || EMAIL_FROM_DEFAULT;

  const html = renderEmailHtml({
    heading: settings.passwordResetHeading,
    bodyHtml: `<p style="margin: 0 0 16px;">${settings.passwordResetBody}</p>`,
    buttonText: settings.passwordResetButtonText,
    buttonUrl: resetUrl,
    footer: settings.passwordResetFooter,
    brandColorStart: settings.sharedBrandColorStart,
    brandColorEnd: settings.sharedBrandColorEnd,
  });

  const text = `${settings.passwordResetBody}\n\nReset password: ${resetUrl}\n\n${settings.passwordResetFooter}`;

  await transporter.sendMail({
    from: fromAddress,
    to,
    subject: settings.passwordResetSubject,
    text,
    html,
  });
}

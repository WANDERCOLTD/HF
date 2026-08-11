/**
 * POST /api/interest — pilot invite request capture.
 *
 * Accepts the native form submission from /ielts and /cio-cto.
 * - Validates via Zod (email required; everything else optional).
 * - Emails NOTIFY_EMAIL via Resend REST API (no npm dep).
 * - Sends a confirmation email to the submitter.
 * - Always logs the submission to console + appends to a JSONL backup
 *   so nothing is lost if Resend is unset or unreachable.
 * - Responds with 303 redirect to /thanks so the browser lands on
 *   the thank-you page after a plain HTML form submit.
 *
 * Environment variables:
 *   RESEND_API_KEY   — activate email delivery (get one at resend.com)
 *   NOTIFY_EMAIL     — where the pilot notification lands (default:
 *                      hfpw@thewanders.com)
 *   FROM_EMAIL       — verified Resend sender (default:
 *                      resned@thewanders.com — must be verified in
 *                      Resend before production emails deliver)
 *
 * The route never blocks the redirect on email failure — the
 * submission is still captured in logs.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

const RequestSchema = z.object({
  course: z.enum(["ielts", "cio-cto"]),
  email: z.string().email().max(200),
  name: z.string().max(200).optional().or(z.literal("")),
  message: z.string().max(2000).optional().or(z.literal("")),
  // IELTS-specific
  targetBand: z.string().max(20).optional().or(z.literal("")),
  testDate: z.string().max(50).optional().or(z.literal("")),
  // CIO/CTO-specific
  role: z.string().max(200).optional().or(z.literal("")),
  units: z.string().max(500).optional().or(z.literal("")),
});

type Submission = z.infer<typeof RequestSchema> & { submittedAt: string; ip?: string };

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "hfpw@thewanders.com";
const FROM_EMAIL = process.env.FROM_EMAIL ?? "resned@thewanders.com";
const LOG_PATH = process.env.INTEREST_LOG_PATH ?? "/tmp/hf-interest.jsonl";

export async function POST(req: Request) {
  const raw = await parseBody(req);
  const parsed = RequestSchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_submission", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const submission: Submission = {
    ...parsed.data,
    submittedAt: new Date().toISOString(),
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  };

  // Always capture: console + JSONL. Never lost even if email fails.
  console.log("[interest]", JSON.stringify(submission));
  appendJsonl(submission).catch((err) =>
    console.error("[interest] jsonl append failed", err),
  );

  // Fire-and-forget email delivery; never blocks the redirect.
  sendNotificationEmails(submission).catch((err) =>
    console.error("[interest] email send failed", err),
  );

  const redirectUrl = new URL("/thanks", req.url);
  return NextResponse.redirect(redirectUrl, 303);
}

// ----- helpers -----

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await req.json()) as Record<string, unknown>;
  }
  // form-urlencoded or multipart from a plain HTML form.
  const form = await req.formData();
  const obj: Record<string, unknown> = {};
  form.forEach((value, key) => {
    obj[key] = typeof value === "string" ? value : value.name;
  });
  return obj;
}

async function appendJsonl(submission: Submission): Promise<void> {
  const line = JSON.stringify(submission) + "\n";
  const dir = path.dirname(LOG_PATH);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await fs.appendFile(LOG_PATH, line, "utf8");
}

async function sendNotificationEmails(s: Submission): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[interest] RESEND_API_KEY unset — skipping email");
    return;
  }

  const courseLabel = s.course === "ielts" ? "IELTS Speaking Practice" : "CIO / CTO Standard";

  // (a) Notification to Paul.
  const notifyBody = formatNotification(s, courseLabel);
  await resendSend(apiKey, {
    from: `HumanFirst <${FROM_EMAIL}>`,
    to: [NOTIFY_EMAIL],
    reply_to: s.email,
    subject: `[${courseLabel}] Pilot request — ${s.name || s.email}`,
    text: notifyBody,
  });

  // (b) Confirmation to submitter.
  const confirmBody = formatConfirmation(s, courseLabel);
  await resendSend(apiKey, {
    from: `HumanFirst <${FROM_EMAIL}>`,
    to: [s.email],
    reply_to: NOTIFY_EMAIL,
    subject: `You're in the queue — HumanFirst ${courseLabel} pilot`,
    text: confirmBody,
  });
}

async function resendSend(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
}

function formatNotification(s: Submission, courseLabel: string): string {
  const lines: string[] = [
    `New pilot request — ${courseLabel}`,
    ``,
    `Email:  ${s.email}`,
  ];
  if (s.name) lines.push(`Name:   ${s.name}`);
  if (s.targetBand) lines.push(`Target band: ${s.targetBand}`);
  if (s.testDate) lines.push(`Test date:   ${s.testDate}`);
  if (s.role) lines.push(`Role:        ${s.role}`);
  if (s.units) lines.push(`Units:       ${s.units}`);
  if (s.message) lines.push(``, `Message:`, s.message);
  lines.push(``, `Submitted: ${s.submittedAt}`);
  if (s.ip) lines.push(`IP:        ${s.ip}`);
  lines.push(``, `Reply to this email to reach them directly.`);
  return lines.join("\n");
}

function formatConfirmation(s: Submission, courseLabel: string): string {
  return [
    `Hi${s.name ? " " + s.name : ""},`,
    ``,
    `Thanks for asking about the ${courseLabel} pilot.`,
    ``,
    `We'll email you within 24 hours — either with a personal invite`,
    `link for this cohort, or a note about when the next cohort opens.`,
    ``,
    `If you don't hear back in 24 hours, reply to this email and we'll`,
    `find your submission.`,
    ``,
    `— HumanFirst Foundation`,
    `https://humanfirstfoundation.com`,
  ].join("\n");
}

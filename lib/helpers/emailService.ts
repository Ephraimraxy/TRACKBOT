import { readFileSync } from "node:fs";
import path from "node:path";

import { BRAND } from "@/lib/config/brand";
import { prisma } from "@/lib/utils/prisma";
import {
  generateTOTPCode,
  generateTOTPSecret,
  TOTP_EXPIRATION_DURATION,
} from "@/lib/utils/totp";

export async function triggerEmailVerification(
  userId: string,
  email: string,
  update: boolean
) {
  // Generate secret for this user
  const secret = generateTOTPSecret();
  const code = generateTOTPCode(secret);

  // Store secret in db
  await prisma.tOTPSecret.upsert({
    where: { userId },
    update: {
      secret,
      expiresLe: new Date(Date.now() + TOTP_EXPIRATION_DURATION * 1000),
    },
    create: {
      userId: userId,
      secret,
      expiresLe: new Date(Date.now() + TOTP_EXPIRATION_DURATION * 1000),
    },
  });

  // Send the code via email
  if (update) {
    await sendEmailUpdateVerification(email, code);
  } else {
    await sendVerificationEmail(email, code);
  }
}

// ---------------------------------------------------------------------------
// Sending (Resend, https://resend.com). Needs RESEND_API_KEY and RESEND_FROM_EMAIL.
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;

export interface EmailAttachment {
  filename: string;
  /** Base64 content. */
  content: string;
  /** Lets the HTML show it inline with <img src="cid:...">. */
  content_id?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

/** Send one email through the Resend HTTP API. Errors never include the API key or the response body. */
export async function sendEmail(
  message: EmailMessage,
  deps: { fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {}
): Promise<void> {
  const env = deps.env ?? process.env;
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Email is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL).");

  const res = await (deps.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Email provider answered HTTP ${res.status}`);
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The brand logo as an inline email attachment (null if the file is not available). */
let cachedLogo: EmailAttachment | null | undefined;
export function logoAttachment(): EmailAttachment | null {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const file = readFileSync(path.join(process.cwd(), "public", "manifest", "web-app-manifest-192x192.png"));
    cachedLogo = { filename: "logo.png", content: file.toString("base64"), content_id: "logo" };
  } catch {
    cachedLogo = null; // the email still works, with the name instead of the picture
  }
  return cachedLogo;
}

export interface CodeEmailOptions {
  title: string;
  intro: string;
  code: string;
  ignoreNote: string;
  /** Where the logo comes from. "cid:logo" is the inline attachment; previews may pass a data URI; null = no logo. */
  logoSrc?: string | null;
}

/**
 * HTML for the verification / reset / email-change code emails.
 * Built with tables and inline styles only (the only thing every mail client renders reliably).
 */
export function codeEmailHtml(opts: CodeEmailOptions): string {
  const logoSrc = opts.logoSrc === undefined ? "cid:logo" : opts.logoSrc;
  const brand = escapeHtml(BRAND.name);
  const code = escapeHtml(opts.code);
  const logo = logoSrc
    ? `<img src="${logoSrc}" width="44" height="44" alt="${brand}" style="display:block;border:0;border-radius:10px;">`
    : "";
  const preheader = `Your ${BRAND.name} code is ${opts.code}. It expires in 5 minutes.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f6;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f2;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="padding-right:12px;">${logo}</td>
            <td style="font-size:22px;font-weight:700;color:#111111;letter-spacing:-0.3px;">${brand}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:30px 28px 8px 28px;">
          <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:#111111;">${escapeHtml(opts.title)}</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(opts.intro)}</p>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td align="center" style="background:#f9fafb;border:1px dashed #cbd5e1;border-radius:12px;padding:22px 12px;">
              <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Your code</div>
              <div style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:10px;color:#000000;">${code}</div>
            </td></tr>
          </table>
          <p style="margin:14px 0 0 0;font-size:14px;line-height:1.5;color:#374151;text-align:center;">This code is valid for <strong>5 minutes</strong>. ${escapeHtml(opts.ignoreNote)}</p>
        </td></tr>
        <tr><td style="padding:0 28px 24px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.5;color:#92400e;">
              <strong>Keep this code private.</strong> ${brand} will never ask you for it by phone, chat or email.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #eef0f2;font-size:12px;line-height:1.6;color:#6b7280;">
          Sent by ${brand}. This is an automated message, please do not reply.<br>
          ${escapeHtml(BRAND.degree)} project, ${escapeHtml(BRAND.institution)}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Plain-text version of the same message (better deliverability, and for clients that block HTML). */
export function codeEmailText(opts: Omit<CodeEmailOptions, "logoSrc">): string {
  return [
    opts.title,
    "",
    opts.intro,
    "",
    `Your code: ${opts.code}`,
    "",
    `This code is valid for 5 minutes. ${opts.ignoreNote}`,
    "Keep this code private: we will never ask you for it.",
    "",
    `- ${BRAND.name}`,
  ].join("\n");
}

async function deliverCode(
  to: string,
  subject: string,
  opts: Omit<CodeEmailOptions, "logoSrc">,
  label: string
): Promise<void> {
  const logo = logoAttachment();
  try {
    await sendEmail({
      to,
      subject,
      html: codeEmailHtml({ ...opts, logoSrc: logo ? "cid:logo" : null }),
      text: codeEmailText(opts),
      ...(logo ? { attachments: [logo] } : {}),
    });
    console.log(`${label} email sent`);
  } catch (error) {
    console.error(`Error sending ${label} email:`, (error as Error).message);
    throw new Error(`Failed to send ${label} email.`);
  }
}

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  await deliverCode(
    email,
    `Verify your ${BRAND.name} account`,
    {
      title: `Welcome to ${BRAND.name}!`,
      intro: "Thanks for signing up. To verify your email address, use the code below:",
      code,
      ignoreNote: "If you did not request this, you can ignore this email.",
    },
    "verification"
  );
}

export async function sendEmailUpdateVerification(email: string, code: string): Promise<void> {
  await deliverCode(
    email,
    "Confirm your new email address",
    {
      title: "Confirm your new email address",
      intro: "You asked to change the email address on your account. To confirm the new address, use the code below:",
      code,
      ignoreNote: "If you did not request this change, you can ignore this email.",
    },
    "email-update"
  );
}

export async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  await deliverCode(
    email,
    `Your ${BRAND.name} password reset code`,
    {
      title: "Reset your password",
      intro: "We received a request to reset the password for your account. Enter the code below to choose a new password:",
      code,
      ignoreNote: "If you did not request a reset, you can safely ignore this email and your password will stay the same.",
    },
    "password-reset"
  );
}

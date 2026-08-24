import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import {
  buildResendPayload,
  formatFrom,
  isRetryableStatus,
  parseResendError,
} from "./resend-payload";

// ─── Transactional email — two transports, one contract ───────────────────────
// All outgoing report mail leaves from ONE HRestroSewa sender. Restaurants never
// configure a transport; they only choose recipients. Credentials live ONLY in
// server env vars and never reach the client — this module is `server-only`.
//
// TWO TRANSPORTS, because where the app runs decides what can work:
//
//   RESEND (HTTPS, port 443)  — used whenever RESEND_API_KEY is set.
//   GMAIL  (SMTP,  port 465)  — the original, used when it is not.
//
// WHY: DigitalOcean silently DROPS outbound packets on every SMTP port to every
// provider — 25, 465 and 587, to Gmail, SendGrid and Brevo alike. Proven by
// socket test from the droplet; `ufw` is not the cause (default outgoing is
// allow). So from 2026-08-21, when sending moved off Vercel, every report failed
// with "Connection timeout" and no owner received one. Port 443 is open, so mail
// has to leave over HTTPS.
//
// Gmail SMTP is KEPT rather than replaced: it still works from a local machine
// and from any host that does not block SMTP, so leaving it in place means dev
// and any future host keep working with no env change. The key decides.
//
// It NEVER throws: the caller (report orchestrator) logs the outcome per restaurant,
// and one bad send must not abort a batch. Retries a few times with linear backoff
// before giving up, and reports how many attempts it took.

export type EmailAttachment = {
  filename: string;
  content: Uint8Array | Buffer;
  contentType?: string;
};

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
};

export type SendResult =
  | { ok: true; id?: string; attempts: number }
  | { ok: false; error: string; attempts: number };

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cached across warm invocations of a serverless function.
let cached: Transporter | null = null;

function getTransport(): Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // implicit TLS
      auth: { user, pass },
    });
  }
  return cached;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send over Resend's HTTPS API. Uses `fetch` rather than the `resend` npm
 * package: the request is one JSON POST, and a dependency that only wraps that
 * is a dependency to keep updated for no benefit.
 */
async function sendViaResend(input: SendEmailInput, to: string[]): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY!;
  const address = (process.env.MAIL_FROM || "").trim();
  if (!address) {
    // Resend will only send from a domain you have verified, so GMAIL_USER is
    // not a usable fallback here — a gmail.com sender is rejected outright.
    // Failing loudly beats three retries against a guaranteed 403.
    return {
      ok: false,
      error: "RESEND_API_KEY is set but MAIL_FROM is missing (must be an address on a Resend-verified domain).",
      attempts: 0,
    };
  }

  const from = formatFrom(address, process.env.SUMMARY_FROM_NAME || "HRestroSewa Reports");
  const payload = buildResendPayload(input, from);

  let lastError = "send failed";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, id: data.id, attempts: attempt };
      }
      lastError = parseResendError(res.status, await res.text().catch(() => ""));
      // A rejected request stays rejected — do not spend the other two attempts.
      if (!isRetryableStatus(res.status)) return { ok: false, error: lastError, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "send failed";
    }
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1500); // 1.5s, 3s
  }
  return { ok: false, error: lastError, attempts: MAX_ATTEMPTS };
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const to = input.to.map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "No recipients.", attempts: 0 };

  // The key decides the transport. Checked before the SMTP config so a host with
  // both set uses the one that can actually reach the internet.
  // TEMP DIAGNOSTIC (2026-08-24): a DO redeploy was observed still hanging on
  // Gmail SMTP for ~2 minutes (nodemailer's default connectionTimeout) despite
  // RESEND_API_KEY being confirmed present in the container's env. This line
  // exists only to prove, from the container logs, which branch actually runs —
  // remove once that's confirmed.
  console.log(
    `[mailer] transport=${process.env.RESEND_API_KEY ? "resend" : "gmail"} ` +
      `keyPresent=${Boolean(process.env.RESEND_API_KEY)} from=${process.env.MAIL_FROM ?? "(unset)"}`
  );
  if (process.env.RESEND_API_KEY) return sendViaResend(input, to);

  const transport = getTransport();
  const user = process.env.GMAIL_USER;
  if (!transport || !user) {
    return {
      ok: false,
      error: "Email is not configured (set RESEND_API_KEY + MAIL_FROM, or GMAIL_USER + GMAIL_APP_PASSWORD).",
      attempts: 0,
    };
  }

  const fromName = process.env.SUMMARY_FROM_NAME || "HRestroSewa Reports";
  const message = {
    from: `"${fromName}" <${user}>`,
    to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: (input.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
      contentType: a.contentType ?? "application/pdf",
    })),
  };

  let lastError = "send failed";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await transport.sendMail(message);
      return { ok: true, id: info.messageId, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "send failed";
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1500); // 1.5s, 3s
    }
  }
  return { ok: false, error: lastError, attempts: MAX_ATTEMPTS };
}

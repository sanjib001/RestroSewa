// ─── Resend request shaping — deliberately dependency-free ────────────────────
// Split out of mailer.ts so it can be unit-tested: `node --test` cannot resolve
// the `@/` alias and will not load a module that imports `server-only` or
// `nodemailer`, so anything worth testing has to have ZERO runtime imports.
// `Buffer` is a Node global, not an import, so it does not break that rule.
//
// WHY RESEND AT ALL: DigitalOcean drops outbound packets on every SMTP port
// (25/465/587) to every provider, so nodemailer cannot deliver from the droplet
// — proven by socket test, and it is why every 2026-08-21 report failed with
// "Connection timeout". Port 443 is open, so mail has to leave over HTTPS.

export type ResendAttachment = {
  filename: string;
  /** base64, which is the only encoding the JSON API accepts. */
  content: string;
  content_type?: string;
};

export type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: ResendAttachment[];
};

/** `"Reports" <reports@example.com>` — the display name is optional. */
export function formatFrom(address: string, name?: string | null): string {
  const addr = address.trim();
  const label = (name ?? "").trim();
  if (!label) return addr;
  // A quote inside the display name would terminate it early and corrupt the
  // header, so drop them rather than trying to escape.
  return `"${label.replace(/"/g, "")}" <${addr}>`;
}

export function toBase64(content: Uint8Array | ArrayBuffer | string): string {
  if (typeof content === "string") return Buffer.from(content, "utf8").toString("base64");
  if (content instanceof ArrayBuffer) return Buffer.from(new Uint8Array(content)).toString("base64");
  // Buffer is itself a Uint8Array, so this covers both without a second branch.
  return Buffer.from(content).toString("base64");
}

export function buildResendPayload(
  input: {
    to: string[];
    subject: string;
    html: string;
    text: string;
    attachments?: { filename: string; content: Uint8Array | ArrayBuffer | string; contentType?: string }[];
  },
  from: string
): ResendPayload {
  const to = input.to.map((e) => e.trim()).filter(Boolean);
  const payload: ResendPayload = {
    from,
    to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  // Omit the key entirely when there is nothing to attach — Resend rejects an
  // empty array rather than treating it as "no attachments".
  const files = input.attachments ?? [];
  if (files.length) {
    payload.attachments = files.map((a) => ({
      filename: a.filename,
      content: toBase64(a.content),
      content_type: a.contentType ?? "application/pdf",
    }));
  }
  return payload;
}

/**
 * Resend reports failures as JSON (`{name, message, statusCode}`), but a proxy
 * or gateway in front of it can return HTML or nothing at all. Both have to end
 * up as one readable line in `report_deliveries.error`, because that column is
 * the only place an admin ever sees why a report did not arrive.
 */
export function parseResendError(status: number, body: string): string {
  const raw = (body ?? "").trim();
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw) as { message?: string; name?: string; error?: string };
      const msg = j.message || j.error || j.name;
      if (msg) return `Resend ${status}: ${msg}`;
    } catch {
      // fall through to the raw-text form
    }
  }
  const snippet = raw.replace(/\s+/g, " ").slice(0, 200);
  return snippet ? `Resend ${status}: ${snippet}` : `Resend ${status}`;
}

/**
 * A 4xx other than 429 means the request itself is wrong — a bad key, an
 * unverified sender, a malformed address. Retrying it just burns the schedule
 * and writes the same error three times, so those fail immediately. 429 and 5xx
 * are transient and worth another go.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500;
}

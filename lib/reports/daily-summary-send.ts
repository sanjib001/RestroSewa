import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildDailySummary,
  normalizeDailySummaryConfig,
  renderDailySummaryEmail,
} from "./daily-summary";
import { renderDailySummaryPdf } from "./daily-summary-pdf";
import { sendEmail } from "@/lib/email/mailer";
import { addBusinessDays, businessToday } from "@/lib/business-day";
import type { ReportLogo } from "./pdf/report-document";

// ─── Orchestrator: build → PDF → email → log ───────────────────────────────────
// The ONE code path that produces and sends a daily report, shared by the
// scheduled cron and the admin "Retry" button. It builds the model, renders the PDF, sends it
// from the HRestroSewa Gmail with the PDF attached, and records the outcome in
// report_deliveries (generated_at, sent_at, recipients, attempts, status/error).
// Exactly-once: unless `force`, a day already marked 'sent' is skipped.

/** Minimum gap between two UNATTENDED sends for the same failed (restaurant, day). */
const RETRY_BACKOFF_MS = 30 * 60 * 1000;

/**
 * How far back the scheduler will still send a report on its own. A report
 * normally leaves the moment its business day closes, so its age is 0 or 1 —
 * this only ever bites a backlog that built up during an outage. Past that,
 * sending is a decision, not a retry: use the admin Retry button.
 */
const MAX_UNATTENDED_AGE_DAYS = 2;

export type SendOutcome =
  | { status: "sent"; recipients: string[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; recipients: string[] };

/** Fetch the restaurant logo and detect PNG/JPG (the only formats pdf-lib embeds).
 *  Best-effort — a missing or unsupported logo just omits it, never fails the send. */
async function fetchLogo(url: string | null): Promise<ReportLogo | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPng = ct.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50);
    const isJpg =
      ct.includes("jpeg") || ct.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8);
    if (isPng) return { bytes, type: "png" };
    if (isJpg) return { bytes, type: "jpg" };
    return null; // svg/webp/etc — skip
  } catch {
    return null;
  }
}

function pdfFilename(restaurantName: string, businessDate: string): string {
  const slug =
    restaurantName
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .toLowerCase() || "restaurant";
  return `daily-finance-${slug}-${businessDate}.pdf`;
}

export async function sendDailySummary(
  restaurantId: string,
  businessDate: string,
  closingHour: number,
  opts?: { force?: boolean }
): Promise<SendOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;

  const { data: rest } = await service
    .from("restaurants")
    .select("name, logo_url, settings")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!rest) return { status: "skipped", reason: "restaurant not found" };

  const config = normalizeDailySummaryConfig(rest.settings?.daily_summary);
  if (!config.enabled || config.emails.length === 0) {
    return { status: "skipped", reason: "disabled or no recipients" };
  }

  // One read serves the dedup check, the retry backoff and the attempts accumulator.
  const { data: existing } = await service
    .from("report_deliveries")
    .select("status, attempts, sent_at")
    .eq("restaurant_id", restaurantId)
    .eq("period_type", "daily")
    .eq("period_key", businessDate)
    .maybeSingle();
  // Two TERMINAL states: 'sent' because the report arrived, 'abandoned' because
  // someone decided this day's report will never go out. Only the admin "Retry"
  // button (force) reopens either — the scheduler never does.
  if (!opts?.force && (existing?.status === "sent" || existing?.status === "abandoned")) {
    return {
      status: "skipped",
      reason: existing.status === "sent" ? "already sent" : "abandoned",
    };
  }

  // ── Stale-report guard ──────────────────────────────────────────────────────
  // An outage that stops mail for several days would, the moment it is fixed,
  // deliver every missed day at once — an owner opening their inbox to four
  // "yesterday's summary" mails, the oldest of which is no longer news. Worse,
  // the scheduler ticks every 15 minutes, so they all arrive within one tick of
  // each other.
  //
  // Real case: DigitalOcean blocks outbound SMTP, so every report from
  // 2026-08-21 failed. Restoring mail without this guard would have dumped the
  // whole backlog on every owner.
  //
  // Normal operation is unaffected: a report leaves as soon as its business day
  // closes, so its age is 0 or 1. Anything older has been failing for days and
  // is a judgement call, which is what the Retry button is for.
  //
  // REPORT_SEND_FROM is the manual half of the same idea: a hard floor for
  // one-off use after an outage, when the backlog is younger than the age guard
  // but should still never go out. Set it and forget it — it only ever hides
  // days that are already in the past. ISO dates compare correctly as strings.
  if (!opts?.force) {
    const floor = (process.env.REPORT_SEND_FROM || "").trim();
    if (floor && businessDate < floor) {
      return { status: "skipped", reason: `before REPORT_SEND_FROM (${floor})` };
    }
    const oldestAutoSendable = addBusinessDays(businessToday(closingHour), -MAX_UNATTENDED_AGE_DAYS);
    if (businessDate < oldestAutoSendable) {
      return { status: "skipped", reason: `too old to auto-send (before ${oldestAutoSendable})` };
    }
  }
  // Auto-retry backoff. The scheduler ticks every 15 minutes so that a report
  // leaves the moment the day closes — but that also means a restaurant whose
  // send keeps failing would be re-attempted 96×/day, each one opening three SMTP
  // connections. That is how you get the shared Gmail account rate-limited for
  // everyone. Space unattended retries out instead; the failure still self-heals,
  // just at ~2 tries an hour. The admin "Retry" button passes force and is never
  // held back.
  if (!opts?.force && existing?.status === "failed" && existing.sent_at) {
    const since = Date.now() - new Date(existing.sent_at).getTime();
    if (since < RETRY_BACKOFF_MS) return { status: "skipped", reason: "retry backoff" };
  }
  const priorAttempts = Number(existing?.attempts ?? 0);

  const generatedAt = new Date().toISOString();
  const restaurantName = rest.name ?? "Restaurant";
  const model = await buildDailySummary(restaurantId, businessDate, closingHour);
  const logo = await fetchLogo(rest.logo_url ?? null);
  const pdf = await renderDailySummaryPdf(model, { restaurantName, logo });
  const email = renderDailySummaryEmail(model, restaurantName);

  const result = await sendEmail({
    to: config.emails,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [
      { filename: pdfFilename(restaurantName, businessDate), content: pdf, contentType: "application/pdf" },
    ],
  });

  // Upsert so a later successful retry overwrites an earlier 'failed' row — one row
  // per (restaurant, day), never a duplicate. attempts accumulates across runs.
  await service.from("report_deliveries").upsert(
    {
      restaurant_id: restaurantId,
      period_type: "daily",
      period_key: businessDate,
      status: result.ok ? "sent" : "failed",
      recipient_count: result.ok ? config.emails.length : 0,
      recipients: config.emails,
      error: result.ok ? null : result.error,
      generated_at: generatedAt,
      sent_at: new Date().toISOString(),
      attempts: priorAttempts + result.attempts,
    },
    { onConflict: "restaurant_id,period_type,period_key" }
  );

  if (result.ok) return { status: "sent", recipients: config.emails };
  return { status: "failed", error: result.error, recipients: config.emails };
}

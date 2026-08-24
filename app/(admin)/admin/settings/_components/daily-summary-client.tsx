"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateDailySummarySettings,
  retryReportDelivery,
  type ActionResult,
  type ReportDeliveryRow,
} from "@/app/actions/settings";
import type { DailySummaryConfig } from "@/lib/reports/daily-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, CheckCircle2, History, RefreshCw, AlertTriangle } from "lucide-react";

const SLOTS = 3;

const CARD =
  "rounded-xl border px-5 py-5 max-w-2xl";
const cardStyle = { background: "var(--color-canvas)", borderColor: "var(--color-hairline)" };

function prettyDay(businessDate: string): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function prettyTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

// ── Recipients editor ─────────────────────────────────────────────────────────

function RecipientsForm({ config }: { config: DailySummaryConfig }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    updateDailySummarySettings,
    null
  );

  const [enabled, setEnabled] = useState(config.enabled);
  const [emails, setEmails] = useState<string[]>(() => {
    const e = [...config.emails];
    while (e.length < SLOTS) e.push("");
    return e.slice(0, SLOTS);
  });

  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;
  const setEmail = (i: number, v: string) =>
    setEmails((prev) => prev.map((e, idx) => (idx === i ? v : e)));

  return (
    <form action={action} className={CARD} style={cardStyle}>
      <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

      <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
        <Mail size={15} /> Daily Finance Report Recipients
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        After your business day closes, we email a PDF financial report — sales, purchases,
        balances, profit and stock — to up to three addresses. Leave it off to send nothing.
      </p>

      <label className="flex items-center gap-2.5 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
          style={{ accentColor: "var(--color-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--color-ink)" }}>Send a daily report</span>
      </label>

      <div className="flex flex-col gap-2" style={{ opacity: enabled ? 1 : 0.55 }}>
        {emails.map((e, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Recipient {i + 1}{i === 0 ? "" : " (optional)"}
            </span>
            <Input
              name={`email_${i}`}
              type="email"
              autoComplete="off"
              placeholder="owner@example.com"
              value={e}
              disabled={!enabled}
              onChange={(ev) => setEmail(i, ev.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
        {errored && (
          <span className="text-sm" style={{ color: "var(--color-ruby)" }}>
            {(state as { error: string }).error}
          </span>
        )}
      </div>
    </form>
  );
}

// ── Delivery history + retry ──────────────────────────────────────────────────

function HistoryCard({ history }: { history: ReportDeliveryRow[] }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startRetry] = useTransition();

  const retry = (day: string) => {
    setError(null);
    setRetrying(day);
    startRetry(async () => {
      try {
        const res = await retryReportDelivery(day);
        if (res && "error" in res && res.error) setError(`${prettyDay(day)}: ${res.error}`);
        else router.refresh();
      } catch {
        // A thrown (not returned) error here is almost always a stale Server
        // Action reference from a deploy that happened while this tab was open —
        // the browser's bundle references an action id the new server doesn't
        // know. Without this catch, `retrying` never clears and the button is
        // stuck on "Sending…" forever with no way to tell what happened.
        setError(`${prettyDay(day)}: This page is out of date — refresh and try again.`);
      } finally {
        setRetrying(null);
      }
    });
  };

  return (
    <div className={CARD} style={cardStyle}>
      <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
        <History size={15} /> Report history
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        The last daily reports we generated and sent. Failed ones can be retried — the PDF is
        rebuilt from live data and re-sent.
      </p>

      {error && (
        <p className="text-sm rounded-md px-3 py-2 mb-3" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {error}
        </p>
      )}

      {history.length === 0 ? (
        <div
          className="rounded-lg border px-4 py-6 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No reports yet. The first one sends after your next business day closes.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--color-hairline)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-canvas-soft)" }}>
                {["Business date", "Generated", "Sent", "Recipients", "Status", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide whitespace-nowrap"
                    style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const failed = r.status === "failed";
                return (
                  <tr key={r.businessDate} className="border-t align-top" style={{ borderColor: "var(--color-hairline)" }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--color-ink)" }}>
                      {prettyDay(r.businessDate)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--color-ink-mute)" }}>
                      {prettyTime(r.generatedAt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "var(--color-ink-mute)" }}>
                      {prettyTime(r.sentAt)}
                    </td>
                    <td className="px-3 py-2.5" style={{ color: "var(--color-ink-mute)", maxWidth: 200 }}>
                      <span className="block truncate" title={r.recipients.join(", ")}>
                        {r.recipients.length ? r.recipients.join(", ") : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                        style={{
                          color: failed ? "var(--color-ruby)" : "var(--color-success)",
                          borderColor: failed
                            ? "color-mix(in srgb, var(--color-ruby) 30%, transparent)"
                            : "color-mix(in srgb, var(--color-success) 30%, transparent)",
                          background: failed
                            ? "color-mix(in srgb, var(--color-ruby) 8%, transparent)"
                            : "color-mix(in srgb, var(--color-success) 8%, transparent)",
                        }}
                      >
                        {failed ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                        {failed ? "Failed" : "Delivered"}
                      </span>
                      {failed && r.error && (
                        <span className="block text-[11px] mt-1 max-w-[220px] truncate" title={r.error} style={{ color: "var(--color-ink-mute)" }}>
                          {r.error}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {failed && (
                        <button
                          type="button"
                          onClick={() => retry(r.businessDate)}
                          disabled={retrying === r.businessDate}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border disabled:opacity-50"
                          style={{ borderColor: "var(--color-hairline)", color: "var(--color-primary)" }}
                        >
                          <RefreshCw size={12} className={retrying === r.businessDate ? "animate-spin" : ""} />
                          {retrying === r.businessDate ? "Sending…" : "Retry"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Daily Finance Report — recipients editor + delivery history with retry.
 * Owner-only surface (Settings); the send itself runs server-side after close.
 */
export function DailySummaryClient({
  config,
  history,
}: {
  config: DailySummaryConfig;
  history: ReportDeliveryRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <RecipientsForm config={config} />
      <HistoryCard history={history} />
    </div>
  );
}

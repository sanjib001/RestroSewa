"use client";

import { useActionState, useState } from "react";
import { updateBusinessDaySettings, type ActionResult } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle2, TriangleAlert } from "lucide-react";

// Whole hours only — every real closing time is on the hour, and a dropdown of
// them is far harder to mis-set on a phone than a free time field. Stopping at
// 6 AM is deliberate: past that it stops being "last night's trade" and starts
// being a data-entry mistake.
const HOURS = [0, 1, 2, 3, 4, 5, 6];

function label(h: number): string {
  if (h === 0) return "12:00 AM (midnight)";
  return `${h}:00 AM`;
}

/**
 * The business-day boundary.
 *
 * Its own card and its own action, like the discount PIN: this is not a print
 * detail, it changes what every number on every report MEANS, and it must never
 * ride along with an unrelated "Save".
 */
export function BusinessDayClient({ closingHour }: { closingHour: number }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    updateBusinessDaySettings,
    null
  );
  const [hour, setHour] = useState(closingHour);

  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;
  const changed = hour !== closingHour;

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 max-w-lg"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p
        className="text-sm font-medium mb-1 flex items-center gap-2"
        style={{ color: "var(--color-ink)" }}
      >
        <Clock size={15} /> Business closing time
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        When your trading day ends. If you serve past midnight, set this to your real closing
        time and those late sales stay on the <strong>same</strong> business day instead of
        starting a new one.
      </p>

      <label className="flex flex-col gap-1.5 mb-1">
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Day ends at
        </span>
        <select
          name="closing_hour"
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="h-9 w-56 rounded-lg border px-3 text-sm"
          style={{
            borderColor: "var(--color-hairline-input)",
            color: "var(--color-ink)",
            background: "var(--color-canvas)",
          }}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {label(h)}
            </option>
          ))}
        </select>
      </label>

      {/* A worked example beats a definition — this is the question everyone
          actually has, and the 2:50 case is the one that surprises people. */}
      <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
        {hour === 0 ? (
          <>
            A bill at <strong>11:30 PM</strong> counts as today; anything from{" "}
            <strong>12:00 AM</strong> counts as the next day.
          </>
        ) : (
          <>
            A bill at <strong>11:30 PM</strong>, <strong>12:45 AM</strong> or{" "}
            <strong>{hour === 1 ? "12:50 AM" : `${hour - 1}:50 AM`}</strong> all count as the
            same business day. The next day starts at <strong>{label(hour)}</strong>.
          </>
        )}
      </p>

      {changed && (
        <div
          className="rounded-lg border px-3 py-2.5 mt-4 flex items-start gap-2"
          style={{
            background: "var(--color-warning-bg)",
            borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)",
          }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            This applies to <strong>past days too</strong>. Sales, finance and stock figures for
            earlier days will shift once as late-night orders move to the previous business day.
            Your totals don&apos;t change — only which day they land on.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 mt-5 flex-wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save closing time"}
        </Button>
        {saved && (
          <span
            className="text-sm flex items-center gap-1.5"
            style={{ color: "var(--color-success)" }}
          >
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

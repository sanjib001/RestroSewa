"use client";

import Link from "next/link";
import { memo, useCallback, useState, useTransition } from "react";
import { getMyTables, openTableSession, markTableClean } from "@/app/actions/pos";
import type { TableStatus } from "@/app/actions/pos";
import { STATUS_STYLE, cleaningFor } from "@/lib/status-colors";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { CountPill } from "@/components/ui/count-pill";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Sparkles, LayoutGrid } from "lucide-react";

const CARD =
  "flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all";

// The table number is the card's whole point, so it's the one thing that should be readable
// from arm's length across a busy floor — bumped a step, and to weight 400 so it doesn't look
// faint against the tinted panel. (Inter 400/500/600 are real cuts now, not faux-bold.)
const NUMBER = "font-normal leading-tight break-words line-clamp-2 w-full";
const NUMBER_STYLE = { letterSpacing: "-0.3px", fontSize: "clamp(1.05rem, 3.6vw, 1.6rem)" } as const;

/**
 * `memo` so refetching the list re-renders only the cards whose data actually
 * moved — one table opening shouldn't repaint all 55.
 *
 * A FREE table submits a server action; it does not navigate.
 *
 * It used to link to /employee/open-table/[id], a page whose only job was to
 * create a session and redirect. That made opening a table a GET request that
 * mutates — and Next cannot follow a redirect inside an RSC fetch, so every tap
 * logged "Failed to fetch RSC payload", threw away the client-side navigation and
 * did a full page load instead. It worked, slowly, and shouted about it. The
 * route still exists for QR and deep links; the dashboard no longer goes through
 * it, and `openTableSession` redirects cleanly from an action.
 */
const TableCard = memo(function TableCard({
  table,
  onError,
}: {
  table: TableStatus;
  onError: (msg: string) => void;
}) {
  const [opening, startOpen] = useTransition();
  const [cleaning, startClean] = useTransition();

  // In use — the one card that's solid-filled. A busy table is the thing a cashier looks for,
  // so it's the loudest state; free tables stay quiet even when there are 55 of them.
  if (table.state === "active" && table.session_id) {
    const s = STATUS_STYLE.active;
    return (
      <Link
        href={`/employee/session/${table.session_id}`}
        title={`Table ${table.number} — active`}
        className={`${CARD} hover:brightness-110`}
        // Constant blue FILL, not s.color: the status token flips to a light blue in dark that
        // the white number can't sit on. This keeps the in-use card a solid readable blue in both.
        style={{ minHeight: 88, background: "var(--fill-blue)", borderColor: "var(--fill-blue)" }}
      >
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "#fff" }}>
          {table.number}
        </span>
        <span className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.9)" }}>
          Active
        </span>
      </Link>
    );
  }

  // Just vacated: the bill is settled but the table isn't ready for the next party. It is
  // NOT a link — tapping it must not seat anyone (the server refuses that anyway); the only
  // thing to do here is say it's been wiped.
  if (table.state === "cleaning") {
    const s = STATUS_STYLE.cleaning;
    const waited = cleaningFor(table.cleaning_since);
    return (
      <div
        title={`Table ${table.number} — needs cleaning`}
        className={CARD}
        style={{ minHeight: 88, background: s.soft, borderColor: s.color, opacity: cleaning ? 0.5 : 1 }}
      >
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: s.color }}>
          {table.number}
        </span>
        <button
          type="button"
          disabled={cleaning}
          onClick={() =>
            startClean(async () => {
              const r = await markTableClean(table.id);
              if (r && "error" in r) onError(r.error);
            })
          }
          // nowrap + 11px: at text-xs the label wrapped to two lines inside a 92px card and
          // squashed the number above it. It has to stay one line at the narrowest column.
          className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded-md border transition-colors"
          style={{ borderColor: s.color, color: s.color, background: "transparent" }}
        >
          <Sparkles size={10} className="shrink-0" />
          {cleaning ? "…" : "Mark clean"}
        </button>
        {waited && (
          <span className="text-[11px] mt-0.5" style={{ color: s.color, opacity: 0.85 }}>
            {waited}
          </span>
        )}
      </div>
    );
  }

  // Free. Green, but only as a tinted panel and a dot — a floor is mostly free, so filling 55
  // cards with saturated green would drown the handful that actually need attention. The
  // number stays ink so it's the most legible thing on the card.
  const s = STATUS_STYLE.available;
  return (
    <button
      type="button"
      disabled={opening}
      title={`Table ${table.number} — free`}
      onClick={() =>
        startOpen(async () => {
          // On success this redirects and never returns. Only a FAILURE comes
          // back — and the old open-table page dropped it on the floor, so a
          // table that wouldn't open just sat there doing nothing.
          const r = await openTableSession(table.id);
          if (r && "error" in r) onError(r.error);
        })
      }
      className={`${CARD} hover:brightness-95`}
      style={{
        minHeight: 88,
        background: s.soft,
        borderColor: s.color,
        opacity: opening ? 0.5 : 1,
      }}
    >
      <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "var(--color-ink)" }}>
        {table.number}
      </span>
      <span className="text-xs mt-1 inline-flex items-center gap-1" style={{ color: s.color }}>
        <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
        Free
      </span>
    </button>
  );
});

/**
 * Still the fix for "waiter activates C1, cashier still sees it free" — but it now
 * refetches ONLY the tables.
 *
 * It used to be `<RealtimeRefresh>`, i.e. `router.refresh()`, which re-runs the
 * entire dashboard route: the sales report, the credit ledger, the whole menu.
 * Those are client components that keep their own state, so every one of those
 * queries was executed and then discarded. One order event cost a full dashboard
 * re-render; two sections were listening, so it cost two.
 */
export function TablesGrid({
  initial,
  hasAnyTables,
}: {
  initial: TableStatus[];
  hasAnyTables: boolean;
}) {
  const [tables, setTables] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const resync = useCallback(() => {
    startTransition(async () => {
      setTables(await getMyTables());
    });
  }, []);

  useRealtime(["tables", "orders"], resync);

  // Stable identity, so memoised cards aren't invalidated on every render.
  const onError = useCallback((msg: string) => setError(msg), []);

  const active = tables.filter((t) => t.state === "active").length;
  const dirty = tables.filter((t) => t.state === "cleaning").length;
  const free = tables.filter((t) => t.state === "available").length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <p className="text-base font-medium" style={{ color: SECTION_ACCENT.tables.color }}>Tables</p>
        {/* Counts as status-coloured pills: the same green/blue/orange the cards use, so the
            summary and the grid teach each other. Zero-count states are dropped rather than
            shown as "0", which is noise on a small screen. */}
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {free > 0 && <CountPill n={free} label="free" tone={STATUS_STYLE.available} />}
          {active > 0 && <CountPill n={active} label="active" tone={STATUS_STYLE.active} />}
          {dirty > 0 && <CountPill n={dirty} label="cleaning" tone={STATUS_STYLE.cleaning} />}
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>{tables.length} total</span>
        </span>
      </div>

      {tables.length === 0 ? (
        <div
          className="rounded-xl border px-8 py-10 text-center flex flex-col items-center gap-3"
          style={{
            borderStyle: "dashed",
            borderColor: SECTION_ACCENT.tables.soft,
            background: "var(--color-canvas)",
          }}
        >
          <span
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: SECTION_ACCENT.tables.soft, color: SECTION_ACCENT.tables.color }}
          >
            <LayoutGrid size={18} strokeWidth={1.6} />
          </span>
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {hasAnyTables
              ? "No tables assigned to you yet. Ask your admin to add you to a table group."
              : "No tables set up yet. Ask your admin to add tables."}
          </p>
        </div>
      ) : (
        <>
          {error && (
            <p className="text-xs mb-2" style={{ color: "var(--color-ruby)" }}>
              {error}
            </p>
          )}
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}
          >
            {tables.map((t) => (
              <TableCard key={t.id} table={t} onError={onError} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

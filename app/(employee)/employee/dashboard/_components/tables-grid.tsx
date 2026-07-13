"use client";

import Link from "next/link";
import { memo, useCallback, useState, useTransition } from "react";
import { getMyTables, openTableSession, openWalkInSession } from "@/app/actions/pos";
import type { TableStatus } from "@/app/actions/pos";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";

const CARD =
  "flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all";

const NUMBER = "font-light leading-tight break-words line-clamp-2 w-full";
const NUMBER_STYLE = { letterSpacing: "-0.3px", fontSize: "clamp(0.9rem, 3.2vw, 1.4rem)" } as const;

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

  if (table.session_id) {
    return (
      <Link
        href={`/employee/session/${table.session_id}`}
        title={`Table ${table.number}`}
        className={CARD}
        style={{
          minHeight: 88,
          background: "var(--color-primary)",
          borderColor: "var(--color-primary)",
        }}
      >
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "#fff" }}>
          {table.number}
        </span>
        <span className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
          Active
        </span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={opening}
      title={`Table ${table.number}`}
      onClick={() =>
        startOpen(async () => {
          // On success this redirects and never returns. Only a FAILURE comes
          // back — and the old open-table page dropped it on the floor, so a
          // table that wouldn't open just sat there doing nothing.
          const r = await openTableSession(table.id);
          if (r && "error" in r) onError(r.error);
        })
      }
      className={CARD}
      style={{
        minHeight: 88,
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        opacity: opening ? 0.5 : 1,
      }}
    >
      <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "var(--color-ink)" }}>
        {table.number}
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

  const active = tables.filter((t) => t.session_id).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Tables</p>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {active} active · {tables.length} total
          </span>
          <form action={openWalkInSession}>
            <Button type="submit" variant="secondary">+ Walk-in</Button>
          </form>
        </div>
      </div>

      {tables.length === 0 ? (
        <div
          className="rounded-xl border px-8 py-10 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
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

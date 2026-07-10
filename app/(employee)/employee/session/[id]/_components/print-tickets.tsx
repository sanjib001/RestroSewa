"use client";

import { useMemo, useState } from "react";
import type { SessionDetail } from "@/app/actions/pos";
import { ChefHat, Receipt } from "lucide-react";
import {
  PrintModal,
  BillTicket,
  Divider,
  Line,
  ticketNumber,
  shortId,
} from "@/app/(employee)/employee/_components/bill-ticket";
import type { RestaurantInfo, BillItem } from "@/app/(employee)/employee/_components/bill-ticket";

// Re-export so existing imports (`./print-tickets`) keep working.
export type { RestaurantInfo } from "@/app/(employee)/employee/_components/bill-ticket";

// ── helpers ───────────────────────────────────────────────────────────────────

function locationLabel(session: SessionDetail): string {
  if (session.table_number) return `Table ${session.table_number}`;
  if (session.room_number) return `Room ${session.room_number}`;
  if (session.type === "walk_in") return "Walk-in";
  return "—";
}

function orderIds(session: SessionDetail): string[] {
  return [...new Set(session.items.map((i) => i.order_id))];
}

// ── KOT (Kitchen Order Ticket) — no pricing ────────────────────────────────────

function KotTicket({
  session,
  restaurant,
  staffName,
  at,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName: string;
  at: Date;
}) {
  // Group by workstation (Kitchen / Bar / Bakery …) so each station gets its slice.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; quantity: number; notes: string | null }[]>();
    for (const it of session.items) {
      const ws = it.workstation_name || "Kitchen";
      if (!m.has(ws)) m.set(ws, []);
      m.get(ws)!.push({ name: it.item_name, quantity: it.quantity, notes: it.notes });
    }
    return [...m.entries()];
  }, [session.items]);

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{restaurant.name}</div>
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 2 }}>KITCHEN ORDER TICKET</div>
      </div>
      <Divider />
      <Line label="KOT No" value={ticketNumber("KOT", session.id, at)} />
      <Line label={orderIds(session).length > 1 ? "Orders" : "Order"} value={orderIds(session).map(shortId).join(", ") || "—"} />
      <Line label="Table" value={locationLabel(session)} />
      <Line label="Date" value={at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      {staffName && <Line label="Staff" value={staffName} />}
      <Divider />

      {groups.length === 0 ? (
        <div style={{ textAlign: "center" }}>No items.</div>
      ) : (
        groups.map(([ws, items]) => (
          <div key={ws} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>» {ws}</div>
            {items.map((it, i) => (
              <div key={i} style={{ marginTop: 2 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 700, minWidth: 26 }}>{it.quantity}×</span>
                  <span style={{ flex: 1 }}>{it.name}</span>
                </div>
                {it.notes && <div style={{ paddingLeft: 34, fontStyle: "italic" }}>↳ {it.notes}</div>}
              </div>
            ))}
          </div>
        ))
      )}

      <Divider />
      <div style={{ textAlign: "center", fontSize: 11 }}>
        Total items: {session.items.reduce((s, i) => s + i.quantity, 0)}
      </div>
    </>
  );
}

// ── public: buttons that open the previews ─────────────────────────────────────

export function SessionPrintButtons({
  session,
  restaurant,
  staffName,
  canPrintKot,
  canPrintBill,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName: string;
  canPrintKot: boolean;
  canPrintBill: boolean;
}) {
  const [kotOpen, setKotOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  // Freeze the ticket's date/number for the life of a preview.
  const [kotAt, setKotAt] = useState<Date>(() => new Date());
  const [billAt, setBillAt] = useState<Date>(() => new Date());

  if (!canPrintKot && !canPrintBill) return null;

  const billItems: BillItem[] = session.items.map((it) => ({
    id: it.id,
    item_name: it.item_name,
    item_price: Number(it.item_price),
    quantity: it.quantity,
  }));

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {canPrintKot && (
          <button
            type="button"
            onClick={() => { setKotAt(new Date()); setKotOpen(true); }}
            className="w-full rounded-xl border py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          >
            <ChefHat size={15} /> Print KOT
          </button>
        )}
        {canPrintBill && (
          <button
            type="button"
            onClick={() => { setBillAt(new Date()); setBillOpen(true); }}
            className="w-full rounded-xl border py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          >
            <Receipt size={15} /> Print Bill
          </button>
        )}
      </div>

      <PrintModal open={kotOpen} onClose={() => setKotOpen(false)} title="Kitchen Order Ticket — preview">
        <KotTicket session={session} restaurant={restaurant} staffName={staffName} at={kotAt} />
      </PrintModal>

      <PrintModal open={billOpen} onClose={() => setBillOpen(false)} title="Bill — preview">
        <BillTicket
          restaurant={restaurant}
          billNo={ticketNumber("BILL", session.id, billAt)}
          orders={orderIds(session)}
          location={locationLabel(session)}
          at={billAt}
          items={billItems}
        />
      </PrintModal>
    </>
  );
}

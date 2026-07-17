"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { addRoomCharge, checkOutRoom, removeRoomCharge } from "@/app/actions/rooms";
import type { RoomFolioView } from "@/app/actions/rooms";
import { searchCreditCustomers } from "@/app/actions/credits";
import type { CreditCustomer } from "@/app/actions/credits";
import type { SessionDetail } from "@/app/actions/pos";
import { CHARGE_TYPES } from "@/lib/room-billing";
import { formatDateTime } from "@/lib/format-time";
import { Button } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OrderItem } from "@/app/(employee)/employee/_components/order-item";
import { SessionPrintButtons } from "@/app/(employee)/employee/session/[id]/_components/print-tickets";
import type { RestaurantInfo, PrintStation } from "@/app/(employee)/employee/session/[id]/_components/print-tickets";
import { PrintModal, Divider, Line as TicketLine, PoweredBy } from "@/app/(employee)/employee/_components/bill-ticket";
import {
  ArrowLeft, BedDouble, Plus, Printer, Trash2, User, UtensilsCrossed, X,
} from "lucide-react";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pinned to the restaurant's zone — a check-in stamp on a bill has to say the
// wall-clock time at the hotel, not the time in whatever region the server is in.
const when = (iso: string) => formatDateTime(iso);

// ─── One line of the bill ────────────────────────────────────────────────────

function Line({
  label, detail, amount, onRemove, muted,
}: {
  label: string;
  detail?: string;
  amount: number;
  onRemove?: () => void;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: muted ? "var(--color-ink-mute)" : "var(--color-ink)" }}>
          {label}
        </p>
        {detail && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{detail}</p>
        )}
      </div>
      <span className="text-sm tabular shrink-0" style={{ color: "var(--color-ink)" }}>
        {rupee(amount)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="p-1 rounded shrink-0"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function GroupHeader({ icon, title, total }: { icon: React.ReactNode; title: string; total: string }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-b"
      style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
    >
      <span style={{ color: "var(--color-ink-mute)" }}>{icon}</span>
      <p className="text-xs uppercase tracking-wide flex-1 font-medium"
         style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
        {title}
      </p>
      <span className="text-xs tabular" style={{ color: "var(--color-ink-mute)" }}>{total}</span>
    </div>
  );
}

// ─── Add an extra (§5 — the future-ready charge types, usable today) ──────────

function AddChargeForm({ stayId, onDone }: { stayId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addRoomCharge, null);
  const [type, setType] = useState("laundry");

  useEffect(() => {
    if (state === null && !pending) return;
  }, [state, pending]);

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="px-4 py-3 border-t flex flex-col gap-2.5"
      style={{ borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="stay_id" value={stayId} />
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-10 rounded-sm border px-2 text-sm sm:w-40"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        >
          {CHARGE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <input
          name="description"
          placeholder="Note (optional)"
          className="h-10 rounded-sm border px-3 text-sm flex-1"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        />
        <input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          placeholder="Amount"
          required
          className="h-10 rounded-sm border px-3 text-sm tabular sm:w-32"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        />
        <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

// ─── Check out ───────────────────────────────────────────────────────────────

function CheckOutForm({
  view, canDiscount, canUseCredit,
}: {
  view: RoomFolioView;
  canDiscount: boolean;
  canUseCredit: boolean;
}) {
  const [state, action, pending] = useActionState(checkOutRoom, null);
  const [method, setMethod] = useState<"cash" | "online" | "card" | "mixed" | "credit">("cash");
  const [discount, setDiscount] = useState("");
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [downTender, setDownTender] = useState<"cash" | "online" | "card">("cash");

  // Credit account picker — the same live search the table bill uses, so a
  // returning guest never collects a second credit id.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreditCustomer[]>([]);
  const [picked, setPicked] = useState<CreditCustomer | null>(null);
  const [, startSearch] = useTransition();

  useEffect(() => {
    if (method !== "credit" || picked || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      startSearch(async () => setResults(await searchCreditCustomers(query)));
    }, 200);
    return () => clearTimeout(t);
  }, [query, method, picked]);

  const f = view.folio;

  // The subtotal is fixed; the discount is the only thing the cashier moves, so
  // the payable total is recomputed live from it. The SERVER rebuilds this from
  // the database regardless — this is only so the number under the cursor is right.
  const disc = Math.min(Math.max(parseFloat(discount) || 0, 0), f.subtotal);
  const taxable = f.subtotal - disc;
  const total =
    Math.round((taxable * (1 + f.taxPercent / 100 + f.servicePercent / 100)) * 100) / 100;

  const cashNum = parseFloat(cash) || 0;
  const onlineNum = parseFloat(online) || 0;
  const paidNum = parseFloat(paidNow) || 0;

  const mixedOk = method !== "mixed" || Math.abs(cashNum + onlineNum - total) < 0.01;
  const creditOk =
    method !== "credit" || (paidNum >= 0 && paidNum < total && (!!picked || query.trim().length > 0));
  const owed = Math.max(0, total - paidNum);

  const amounts = {
    cash: method === "cash" ? total : method === "mixed" ? cashNum : method === "credit" && downTender === "cash" ? paidNum : 0,
    online: method === "online" ? total : method === "mixed" ? onlineNum : method === "credit" && downTender === "online" ? paidNum : 0,
    card: method === "card" ? total : method === "credit" && downTender === "card" ? paidNum : 0,
  };

  type Method = "cash" | "online" | "card" | "mixed" | "credit";
  const METHODS: { key: Method; label: string }[] = [
    { key: "cash", label: "Cash" },
    { key: "online", label: "Online" },
    { key: "card", label: "Card" },
    { key: "mixed", label: "Cash + Online" },
    ...(canUseCredit ? [{ key: "credit" as const, label: "Credit" }] : []),
  ];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="stay_id" value={view.stay_id} />
      <input type="hidden" name="payment_method" value={method} />
      <input type="hidden" name="discount" value={disc.toFixed(2)} />
      <input type="hidden" name="cash_amount" value={amounts.cash.toFixed(2)} />
      <input type="hidden" name="online_amount" value={amounts.online.toFixed(2)} />
      <input type="hidden" name="card_amount" value={amounts.card.toFixed(2)} />
      {method === "credit" && (
        <>
          <input type="hidden" name="credit_customer_id" value={picked?.id ?? ""} />
          <input type="hidden" name="credit_customer_name" value={picked ? picked.name : query || view.guest_name} />
          <input type="hidden" name="credit_customer_phone" value={picked?.phone ?? view.guest_phone ?? ""} />
        </>
      )}

      {canDiscount && (
        <div>
          <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
            Discount
          </label>
          <input
            type="number"
            min="0"
            max={f.subtotal}
            step="0.01"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0.00"
            className="w-full h-10 rounded-sm border px-3 text-sm tabular"
            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          />
        </div>
      )}

      {/* Payable */}
      <div
        className="flex items-baseline justify-between rounded-lg border px-4 py-3"
        style={{ borderColor: "var(--color-primary)", background: "rgba(99,102,241,0.06)" }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Payable now</span>
        <span className="text-xl tabular" style={{ color: "var(--color-primary)", fontWeight: 300 }}>
          {rupee(total)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {METHODS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMethod(m.key)}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: method === m.key ? "var(--color-primary)" : "var(--color-hairline)",
              background: method === m.key ? "var(--color-primary)" : "var(--color-canvas)",
              color: method === m.key ? "#fff" : "var(--color-ink)",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === "mixed" && (
        <div className="grid grid-cols-2 gap-3">
          {([["Cash", cash, setCash], ["Online", online, setOnline]] as const).map(([label, val, set]) => (
            <div key={label}>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>{label}</label>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={val}
                onChange={(e) => set(e.target.value)}
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>
          ))}
          {!mixedOk && (
            <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
              Cash and Online must add up to {rupee(total)}.
            </p>
          )}
        </div>
      )}

      {method === "credit" && (
        <div className="flex flex-col gap-3">
          {picked ? (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {picked.name} · {picked.customer_code}
                </p>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Already owes {rupee(picked.balance)}
                </p>
              </div>
              <button type="button" onClick={() => { setPicked(null); setQuery(""); }} style={{ color: "var(--color-ink-mute)" }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Credit account — search an existing customer, or type a name to open a new one
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={view.guest_name}
                className="w-full h-10 rounded-sm border px-3 text-sm"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
              {results.length > 0 && (
                <div className="mt-1 rounded-lg border divide-y" style={{ borderColor: "var(--color-hairline)" }}>
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setPicked(r)}
                      className="w-full text-left px-3 py-2"
                      style={{ borderColor: "var(--color-hairline)" }}
                    >
                      <span className="text-sm block" style={{ color: "var(--color-ink)" }}>{r.name}</span>
                      <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                        {r.customer_code} · owes {rupee(r.balance)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>Paid now</label>
              <input
                type="number" min="0" max={total} step="0.01" inputMode="decimal"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>Tendered as</label>
              <select
                value={downTender}
                onChange={(e) => setDownTender(e.target.value as typeof downTender)}
                className="w-full h-10 rounded-sm border px-2 text-sm"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              >
                <option value="cash">Cash</option>
                <option value="online">Online</option>
                <option value="card">Card</option>
              </select>
            </div>
          </div>

          <div
            className="flex items-baseline justify-between rounded-lg border px-3 py-2"
            style={{ borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)", background: "var(--color-warning-bg)" }}
          >
            <span className="text-sm" style={{ color: "var(--color-warning)" }}>Left on credit</span>
            <span className="text-sm tabular font-medium" style={{ color: "var(--color-warning)" }}>{rupee(owed)}</span>
          </div>
        </div>
      )}

      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}

      <Button
        type="submit"
        variant="primary"
        disabled={pending || !mixedOk || !creditOk}
        className="w-full"
      >
        {pending ? "Checking out…" : `Check out · ${rupee(total)}`}
      </Button>
    </form>
  );
}

// ─── The folio ───────────────────────────────────────────────────────────────

export function FolioClient({
  view, session, restaurant, staffName, workstations = [],
  canAddCharges, canCreateOrders, canManageOrders, canCancelOrders,
  canCheckOut, canDiscount, canUseCredit, canPrintTickets = false, canPrintBill = false,
}: {
  view: RoomFolioView;
  /** The stay's session, in the same shape a table's screen uses. */
  session: SessionDetail | null;
  restaurant: RestaurantInfo;
  staffName: string;
  workstations?: PrintStation[];
  canAddCharges: boolean;
  canCreateOrders: boolean;
  canManageOrders: boolean;
  canCancelOrders: boolean;
  canCheckOut: boolean;
  canDiscount: boolean;
  canUseCredit: boolean;
  /** KOT/BOT printing — billing/order-management staff only (not waiters). */
  canPrintTickets?: boolean;
  /** Room folio bill printing — billing staff only. */
  canPrintBill?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [removing, startRemove] = useTransition();
  const f = view.folio;
  const open = view.status === "active";

  // The food ordered against this stay — from the room QR, or added by hand. It
  // is ONE list either way; the two were never separate pipelines, they just had
  // separate screens.
  const items = session?.items ?? [];
  const pendingItems = items.filter((i) => i.item_status !== "served");
  const servedItems = items.filter((i) => i.item_status === "served");

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-5 py-4 pb-16 flex flex-col gap-4">
      {/* A room-service order placed from the guest's phone changes this bill, so
          the folio re-reads itself when orders move — no refresh, no stale total. */}
      <RealtimeRefresh topics={["orders", "tables"]} />

      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ArrowLeft size={14} /> Dashboard
      </Link>

      {/* Guest */}
      <div
        className="rounded-2xl border px-5 py-4"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <div className="flex items-start gap-3">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-primary)" }}
          >
            <BedDouble size={19} strokeWidth={1.6} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
              Room {view.room_number}
              <span className="text-sm ml-2" style={{ color: "var(--color-ink-mute)" }}>{view.type_name}</span>
            </p>
            <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
              <User size={12} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
              {view.guest_name}
              {view.guest_count > 1 && (
                <span style={{ color: "var(--color-ink-mute)" }}> · {view.guest_count} guests</span>
              )}
              {view.guest_phone && (
                <span style={{ color: "var(--color-ink-mute)" }}> · {view.guest_phone}</span>
              )}
            </p>
          </div>
          {!open && (
            <span
              className="text-xs px-2 py-0.5 rounded-full shrink-0"
              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
            >
              Checked out
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            ["Check-in", when(f.checkIn)],
            [open ? "Now" : "Check-out", when(f.checkOut)],
            ["Stay", f.duration],
            ["Nights charged", String(f.nights)],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
              <p className="text-sm" style={{ color: "var(--color-ink)" }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Orders ───────────────────────────────────────────────────────────
          THE fix. A QR order from the room lands here the moment it is placed,
          and the KOT prints from right here — the same OrderItem rows and the
          same SessionPrintButtons a table uses. Staff no longer go through "Add a
          room-service order" to reach a ticket for food the guest already ordered.
          That page is now only what its name says: for orders taken by phone or
          in person. */}
      {session && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <GroupHeader
            icon={<UtensilsCrossed size={13} />}
            title={
              pendingItems.length > 0
                ? `Orders · ${pendingItems.length} pending`
                : "Orders"
            }
            total={rupee(f.foodTotal)}
          />

          {items.length === 0 ? (
            <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
              No food ordered yet. The guest can order from the room QR, or you can add one.
            </p>
          ) : (
            <>
              {pendingItems.map((i) => (
                <OrderItem key={i.id} item={i} canCancel={canCancelOrders && open} />
              ))}
              {servedItems.length > 0 && pendingItems.length > 0 && (
                <div
                  className="px-4 py-1.5 border-t"
                  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
                >
                  <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Served</p>
                </div>
              )}
              {servedItems.map((i) => (
                <OrderItem key={i.id} item={i} />
              ))}
            </>
          )}

          {open && (
            <div
              className="flex flex-col sm:flex-row gap-2 px-4 py-3 border-t"
              style={{ borderColor: "var(--color-hairline)" }}
            >
              {items.length > 0 && (
                <div className="flex-1">
                  <SessionPrintButtons
                    session={session}
                    restaurant={restaurant}
                    staffName={staffName}
                    workstations={workstations}
                    // KOT/BOT is billing/order-management only now — a waiter (who has
                    // create/manage orders) must NOT be able to print kitchen tickets.
                    canPrintTickets={canPrintTickets}
                    // The bill for a room is the FOLIO — room nights, extras and
                    // food together — not the session's food-only total. It prints
                    // from the folio below, so the session's bill ticket is off.
                    canPrintBill={false}
                  />
                </div>
              )}
              {canCreateOrders && (
                <Link href={`/employee/session/${session.id}/add`} className="shrink-0">
                  <Button variant="secondary" className="w-full flex items-center justify-center gap-1.5">
                    <Plus size={13} /> Add order
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* The bill */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <GroupHeader icon={<BedDouble size={13} />} title="Room" total={rupee(f.roomTotal)} />
        <Line label={f.room.label} detail={f.room.detail} amount={f.room.amount} />

        <GroupHeader
          icon={<Plus size={13} />}
          title="Extras & services"
          total={rupee(f.extrasTotal)}
        />
        {f.extras.length === 0 ? (
          <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Nothing added.
          </p>
        ) : (
          f.extras.map((l) => (
            <Line
              key={l.key}
              label={l.label}
              detail={l.detail}
              amount={l.amount}
              onRemove={
                canAddCharges && open
                  ? () => startRemove(async () => { await removeRoomCharge(l.key); })
                  : undefined
              }
            />
          ))
        )}
        {canAddCharges && open && (
          adding ? (
            <AddChargeForm stayId={view.stay_id} onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={removing}
              className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs border-t"
              style={{ color: "var(--color-primary)", borderColor: "var(--color-hairline)" }}
            >
              <Plus size={13} /> Add a charge
            </button>
          )
        )}

        {/* Food, as a bill LINE — the working list, with its serve and cancel
            controls, lives in the Orders card above. It used to be listed here
            instead, read-only, with the only way through to the real thing being
            a link that said "Add a room-service order". */}
        <GroupHeader
          icon={<UtensilsCrossed size={13} />}
          title="Food & beverage"
          total={rupee(f.foodTotal)}
        />
        {f.food.length === 0 ? (
          <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
            No orders on this room.
          </p>
        ) : (
          f.food.map((l) => <Line key={l.key} label={l.label} detail={l.detail} amount={l.amount} />)
        )}

        {/* Totals */}
        <div className="border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
          <Line label="Subtotal" amount={f.subtotal} muted />
          {f.discount > 0 && <Line label="Discount" amount={-f.discount} muted />}
          {f.tax > 0 && <Line label={`Tax (${f.taxPercent}%)`} amount={f.tax} muted />}
          {f.service > 0 && <Line label={`Service charge (${f.servicePercent}%)`} amount={f.service} muted />}
          <div
            className="flex items-baseline justify-between px-4 py-3 border-t"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Grand total</span>
            <span className="text-lg tabular" style={{ color: "var(--color-ink)", fontWeight: 400 }}>
              {rupee(f.grandTotal)}
            </span>
          </div>
        </div>
      </div>

      {open && f.open && (
        <p className="text-xs text-center" style={{ color: "var(--color-ink-mute)" }}>
          The room charge is billed to right now, and grows by one night every 24 hours.
        </p>
      )}

      {/* Check out */}
      {open && canCheckOut && (
        <div
          className="rounded-2xl border px-5 py-4"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink)" }}>
            Check out &amp; settle
          </p>
          <CheckOutForm view={view} canDiscount={canDiscount} canUseCredit={canUseCredit} />
        </div>
      )}

      {/* Room folio bill — billing staff only, and printed through the SAME shared
          PrintModal as every other ticket. It used to be a raw window.print() over a
          `hidden print:block` block with no chrome-hiding, so it printed the whole
          screen; and its button was ungated, so anyone could print it. Now it previews
          then prints only the bill. */}
      {canPrintBill && (
        <button
          type="button"
          onClick={() => setBillOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-pill border"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        >
          <Printer size={14} /> Print bill
        </button>
      )}

      <PrintModal open={billOpen} onClose={() => setBillOpen(false)} title="Room bill — preview" paperWidthMm={restaurant.paper_width_mm ?? 80}>
        <div style={{ textAlign: "center" }}>
          {restaurant.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={restaurant.logo_url} alt="" style={{ maxHeight: 48, maxWidth: "100%", margin: "0 auto 4px", display: "block", objectFit: "contain" }} />
          )}
          <div style={{ fontWeight: 700, fontSize: 15 }}>{restaurant.name}</div>
          {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
          {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
          {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN/VAT: {restaurant.pan_vat_number}</div>}
          <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>ROOM BILL</div>
        </div>
        <Divider />
        <TicketLine label="Room" value={`${view.room_number} · ${view.type_name}`} />
        <TicketLine label="Guest" value={view.guest_name} />
        <TicketLine label="In" value={when(f.checkIn)} />
        <TicketLine label="Out" value={when(f.checkOut)} />
        <TicketLine label="Stay" value={`${f.duration} · ${f.nights} night(s)`} />
        <Divider />
        <TicketLine label={`${f.room.label} (${f.room.detail})`} value={rupee(f.roomTotal)} />
        {f.extras.map((l) => <TicketLine key={l.key} label={l.label} value={rupee(l.amount)} />)}
        {f.food.map((l) => <TicketLine key={l.key} label={`${l.detail} ${l.label}`.trim()} value={rupee(l.amount)} />)}
        <Divider />
        <TicketLine label="Subtotal" value={rupee(f.subtotal)} />
        {f.discount > 0 && <TicketLine label="Discount" value={`-${rupee(f.discount)}`} />}
        {f.tax > 0 && <TicketLine label={`Tax (${f.taxPercent}%)`} value={rupee(f.tax)} />}
        {f.service > 0 && <TicketLine label={`Service (${f.servicePercent}%)`} value={rupee(f.service)} />}
        <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
        <TicketLine label="TOTAL" value={rupee(f.grandTotal)} bold />
        <Divider />
        <div style={{ textAlign: "center", fontSize: 11 }}>Served by {staffName}</div>
        <PoweredBy />
      </PrintModal>
    </div>
  );
}

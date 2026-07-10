"use client";

import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";

// Shared, reusable receipt/ticket rendering used by both the live session screen
// (KOT + pre-payment bill) and the Sales dashboard (reprint of a PAID bill).

export type RestaurantInfo = {
  name: string;
  address: string | null;
  contact_phone: string | null;
  pan_vat_number: string | null;
  // Optional charges, applied to the bill only when > 0 (read from settings).
  tax_percent?: number;
  service_charge_percent?: number;
};

export type BillItem = { id: string; item_name: string; item_price: number; quantity: number };

// Present only for a bill that has been paid — drives the "PAID" block.
export type BillPayment = {
  method: string; // display label, e.g. "Cash", "Cash + Online"
  cashier?: string | null;
  cash?: number; // split, for a mixed payment
  online?: number;
};

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export function ticketNumber(prefix: string, seedId: string, at: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${shortId(seedId)}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

const rupee = (n: number) => `₹${n.toFixed(2)}`;

// ── print stylesheet (hides the app chrome, prints only the ticket) ────────────

function PrintStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@media print {
  body { background:#fff !important; }
  body * { visibility: hidden !important; }
  .rs-ticket-print, .rs-ticket-print * { visibility: visible !important; }
  .rs-ticket-print { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 8px; }
  .rs-no-print { display: none !important; }
  @page { margin: 8mm; }
}
`,
      }}
    />
  );
}

// ── generic preview + print modal ──────────────────────────────────────────────

export function PrintModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center overflow-y-auto rs-no-print"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
    >
      <PrintStyles />
      <div
        className="w-full max-w-sm my-6 rounded-2xl overflow-hidden"
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{title}</p>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}>
            <X size={16} />
          </button>
        </div>

        {/* The ticket — the only thing that ends up on paper. */}
        <div className="px-4 py-4 max-h-[70vh] overflow-y-auto" style={{ background: "var(--color-canvas-soft)" }}>
          <div
            className="rs-ticket-print mx-auto bg-white"
            style={{ width: 300, padding: "18px 16px", color: "#000", fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 12, lineHeight: 1.5 }}
          >
            {children}
          </div>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t rs-no-print" style={{ borderColor: "var(--color-hairline)" }}>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
          <Button variant="primary" className="flex-1 flex items-center justify-center gap-2" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── ticket primitives ──────────────────────────────────────────────────────────

export function Divider() {
  return <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />;
}

export function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ── Bill (customer bill) — works both before payment (UNPAID) and as a reprint
//    of a completed transaction (PAID + method + cashier) ─────────────────────────

export function BillTicket({
  restaurant,
  billNo,
  orders,
  location,
  at,
  items,
  payment,
}: {
  restaurant: RestaurantInfo;
  billNo: string;
  orders: string[];
  location: string;
  at: Date;
  items: BillItem[];
  payment?: BillPayment;
}) {
  const subtotal = items.reduce((s, i) => s + Number(i.item_price) * i.quantity, 0);
  const taxPct = restaurant.tax_percent ?? 0;
  const svcPct = restaurant.service_charge_percent ?? 0;
  const tax = subtotal * (taxPct / 100);
  const service = subtotal * (svcPct / 100);
  const grandTotal = subtotal + tax + service;
  const mixedSplit =
    payment && (payment.cash ?? 0) > 0 && (payment.online ?? 0) > 0
      ? `Cash ${rupee(payment.cash!)} · Online ${rupee(payment.online!)}`
      : null;

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{restaurant.name}</div>
        {restaurant.address && <div style={{ fontSize: 11 }}>{restaurant.address}</div>}
        {restaurant.contact_phone && <div style={{ fontSize: 11 }}>Ph: {restaurant.contact_phone}</div>}
        {restaurant.pan_vat_number && <div style={{ fontSize: 11 }}>PAN/VAT: {restaurant.pan_vat_number}</div>}
        <div style={{ fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>{payment ? "TAX INVOICE" : "BILL"}</div>
      </div>
      <Divider />
      <Line label={payment ? "Receipt No" : "Bill No"} value={billNo} />
      <Line label={orders.length > 1 ? "Orders" : "Order"} value={orders.map(shortId).join(", ") || "—"} />
      <Line label="Table" value={location} />
      <Line label="Date" value={at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
      {payment?.cashier && <Line label="Cashier" value={payment.cashier} />}
      <Divider />

      {/* Items */}
      <div style={{ display: "flex", fontWeight: 700, fontSize: 11 }}>
        <span style={{ flex: 1 }}>Item</span>
        <span style={{ width: 28, textAlign: "center" }}>Qty</span>
        <span style={{ width: 54, textAlign: "right" }}>Rate</span>
        <span style={{ width: 62, textAlign: "right" }}>Amount</span>
      </div>
      <div style={{ borderTop: "1px solid #000", margin: "4px 0" }} />
      {items.length === 0 ? (
        <div style={{ textAlign: "center" }}>No items.</div>
      ) : (
        items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "flex-start", marginTop: 2 }}>
            <span style={{ flex: 1 }}>{it.item_name}</span>
            <span style={{ width: 28, textAlign: "center" }}>{it.quantity}</span>
            <span style={{ width: 54, textAlign: "right" }}>{Number(it.item_price).toFixed(2)}</span>
            <span style={{ width: 62, textAlign: "right" }}>{(Number(it.item_price) * it.quantity).toFixed(2)}</span>
          </div>
        ))
      )}
      <Divider />

      <Line label="Subtotal" value={rupee(subtotal)} />
      {tax > 0 && <Line label={`Tax (${taxPct}%)`} value={rupee(tax)} />}
      {service > 0 && <Line label={`Service (${svcPct}%)`} value={rupee(service)} />}
      <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
      <Line label="GRAND TOTAL" value={rupee(grandTotal)} bold />
      <Divider />

      {payment ? (
        <>
          <Line label="Status" value="PAID" bold />
          <Line label="Payment" value={payment.method} />
          {mixedSplit && <div style={{ fontSize: 11, textAlign: "right" }}>{mixedSplit}</div>}
        </>
      ) : (
        <div style={{ textAlign: "center", fontSize: 11 }}>Status: UNPAID</div>
      )}
      <div style={{ textAlign: "center", fontSize: 11, marginTop: 6 }}>Thank you! Please visit again.</div>
    </>
  );
}

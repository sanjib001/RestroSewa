"use client";

import { useState } from "react";
import { getPaidBill } from "@/app/actions/pos";
import type { PaidBill } from "@/app/actions/pos";
import { PrintModal, BillTicket } from "@/app/(employee)/employee/_components/bill-ticket";
import { Printer, Loader2 } from "lucide-react";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

// Reprints a PAID bill for one transaction. Fetches the receipt on demand from
// the existing payment record — never creates or changes a bill.
export function PaidBillButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bill, setBill] = useState<PaidBill | null>(null);

  async function openBill() {
    setLoading(true);
    try {
      const res = await getPaidBill(paymentId);
      if ("error" in res) {
        alert(res.error);
        return;
      }
      setBill(res);
      setOpen(true);
    } catch {
      alert("Could not load the bill. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openBill}
        disabled={loading}
        title="Print bill"
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-50"
        style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
      </button>

      {bill && (
        <PrintModal open={open} onClose={() => setOpen(false)} title="Bill — preview">
          <BillTicket
            restaurant={bill.restaurant}
            billNo={`BILL-${bill.payment_id.slice(0, 8).toUpperCase()}`}
            orders={bill.order_ids}
            location={bill.location}
            at={new Date(bill.created_at)}
            items={bill.items}
            payment={{
              method: METHOD_LABEL[bill.method] ?? bill.method,
              cashier: bill.cashier_name,
              cash: bill.cash_amount,
              online: bill.online_amount,
            }}
          />
        </PrintModal>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { getPaidBill } from "@/app/actions/pos";
import type { PaidBill } from "@/app/actions/pos";
import { PrintModal, BillTicket } from "@/app/(employee)/employee/_components/bill-ticket";
import { formatBillNumber, billNumberLabel } from "@/lib/billing/bill-number";
import { billMethodLabel } from "@/lib/billing/payment-method";
import { Printer, Loader2 } from "lucide-react";

// Reprints a closed bill for one transaction. Fetches the receipt on demand from
// the existing payment record — never creates or changes a bill. A bill that went
// on credit reprints with its CURRENT balance, not as "paid".
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
        <PrintModal open={open} onClose={() => setOpen(false)} title="Bill — preview" paperWidthMm={bill.restaurant.paper_width_mm ?? 80}>
          <BillTicket
            restaurant={bill.restaurant}
            // The restaurant's own sequential number when configured; else the legacy ref.
            billNo={
              bill.bill_number != null
                ? formatBillNumber(bill.bill_number, bill.bill_number_pad)
                : `BILL-${bill.payment_id.slice(0, 8).toUpperCase()}`
            }
            billLabel={bill.bill_number != null ? billNumberLabel(bill.bill_number_label) : undefined}
            location={bill.location}
            customer={bill.customer}
            at={new Date(bill.created_at)}
            items={bill.items}
            // A ROOM bill arrives grouped (room charge / extras / food) and carries the
            // hotel block; both are undefined for a table or walk-in bill, which keeps
            // printing its flat `items` list exactly as before.
            sections={bill.sections}
            stay={bill.stay}
            discount={bill.discount}
            advancePaid={bill.advancePaid}
            advanceCash={bill.advanceCash}
            advanceOnline={bill.advanceOnline}
            payment={{
              method: billMethodLabel(bill.method),
              cashier: bill.cashier_name,
              cash: bill.cash_amount,
              online: bill.online_amount,
              card: bill.card_amount,
            }}
            credit={
              bill.credit
                ? {
                    credit_number: bill.credit.credit_number,
                    customer_name: bill.credit.customer_name,
                    customer_phone: bill.credit.customer_phone,
                    tendered: bill.cash_amount + bill.online_amount + bill.card_amount,
                    balance: bill.credit.balance,
                  }
                : null
            }
          />
        </PrintModal>
      )}
    </>
  );
}

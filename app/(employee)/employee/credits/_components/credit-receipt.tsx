"use client";

import { useState } from "react";
import { getCreditReceipt } from "@/app/actions/credits";
import type { CreditReceipt } from "@/app/actions/credits";
import { PrintModal, CreditReceiptTicket } from "@/app/(employee)/employee/_components/bill-ticket";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  mixed: "Mixed",
  upi: "UPI",
  other: "Other",
};

// Prints the customer's credit ACCOUNT — every bill they've run up, everything
// they've paid, and the balance as of now, all under their one Credit ID.
// Reassembled from existing records; creates nothing.
export function CreditReceiptButton({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<CreditReceipt | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getCreditReceipt(customerId);
      if ("error" in res) {
        alert(res.error);
        return;
      }
      setReceipt(res);
      setOpen(true);
    } catch {
      alert("Could not load the receipt. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={load}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        Print credit receipt
      </Button>

      {receipt && (
        <PrintModal open={open} onClose={() => setOpen(false)} title="Credit receipt — preview">
          <CreditReceiptTicket
            restaurant={receipt.restaurant}
            creditNumber={receipt.customer.customer_code}
            customerName={receipt.customer.name}
            customerPhone={receipt.customer.phone}
            openedAt={new Date(receipt.customer.created_at)}
            location={`${receipt.customer.bill_count} bill${receipt.customer.bill_count !== 1 ? "s" : ""}`}
            billAmount={receipt.customer.total_billed}
            paidAmount={receipt.customer.total_paid}
            balance={receipt.customer.balance}
            notes={null}
            // The down payments taken at billing, then every repayment since —
            // everything this customer has handed over, under one Credit ID.
            history={[
              ...receipt.customer.bills
                .filter((b) => b.down_payment > 0)
                .map((b) => ({
                  id: b.id,
                  amount: b.down_payment,
                  method: b.credit_number,
                  staff_name: null,
                  created_at: b.created_at,
                  at_billing: true,
                })),
              ...receipt.customer.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                method: METHOD_LABEL[p.method] ?? p.method,
                staff_name: p.staff_name,
                created_at: p.created_at,
                at_billing: false,
              })),
            ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())}
          />
        </PrintModal>
      )}
    </>
  );
}

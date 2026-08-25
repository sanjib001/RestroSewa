"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { getPaymentTender, updatePaymentTender } from "@/app/actions/security";
import { Input } from "@/components/ui/input";
import { SecurityPinDialog } from "@/components/security-pin-dialog";

// Admin-only, Security-PIN-gated correction of HOW a completed bill was paid — the
// cash / online / card split. It never changes the bill's amount, only its tender, so the
// three amounts must still add up to the total. Shown on the Sales list next to Reprint.

const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (s: string) => (s.trim() === "" ? 0 : parseFloat(s));

export function TenderEditButton({ paymentId, onEdited }: { paymentId: string; onEdited: () => void }) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(0);
  // What was already settled by a room advance — not editable here, so the split
  // below only ever has to add up to `editable` (total − advance), exactly what
  // the server itself validates against.
  const [advance, setAdvance] = useState(0);
  const [editable, setEditable] = useState(0);
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const [card, setCard] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const openDialog = async () => {
    setLoadError(null);
    const res = await getPaymentTender(paymentId);
    if ("error" in res) { setLoadError(res.error); setOpen(true); return; }
    setTotal(res.total);
    setAdvance(res.advance);
    setEditable(res.editable);
    setCash(res.cash ? String(res.cash) : "");
    setOnline(res.online ? String(res.online) : "");
    setCard(res.card ? String(res.card) : "");
    setOpen(true);
  };

  const sum = num(cash) + num(online) + num(card);
  const matches = Math.abs(sum - editable) < 0.01;
  const anyNegative = num(cash) < 0 || num(online) < 0 || num(card) < 0;
  const valid = !loadError && matches && !anyNegative;

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1 flex-1 min-w-[90px]">
      <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{label}</span>
      <Input
        type="number" min="0" step="0.01" inputMode="decimal" placeholder="0"
        value={value} onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="Edit how this bill was paid"
        title="Edit payment tender"
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border"
        style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)", background: "var(--color-canvas)" }}
      >
        <Pencil size={14} />
      </button>

      <SecurityPinDialog
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => { setOpen(false); onEdited(); }}
        title="Edit payment tender"
        description="Correct how this bill was paid. The amount stays the same — only the split changes."
        confirmLabel="Save split"
        extraValid={valid}
        onConfirm={(pin) => updatePaymentTender(pin, paymentId, { cash: num(cash), online: num(online), card: num(card) })}
      >
        {loadError ? (
          <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
            {loadError}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--color-ink-mute)" }}>Bill total</span>
              <span className="tabular-nums font-medium" style={{ color: "var(--color-ink)" }}>{fmt(total)}</span>
            </div>
            {advance > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--color-ink-mute)" }}>Already settled by advance</span>
                <span className="tabular-nums" style={{ color: "var(--color-ink-mute)" }}>−{fmt(advance)}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {field("Cash", cash, setCash)}
              {field("Online", online, setOnline)}
              {field("Card", card, setCard)}
            </div>
            <p className="text-xs" style={{ color: matches ? "var(--color-ink-mute)" : "var(--color-ruby)" }}>
              {matches
                ? advance > 0
                  ? `Splits add up to the ${fmt(editable)} left after the advance.`
                  : "Splits add up to the total."
                : `Cash + Online + Card must equal ${fmt(editable)}${advance > 0 ? " (the bill total less the advance)" : ""} (now ${fmt(sum)}).`}
            </p>
          </div>
        )}
      </SecurityPinDialog>
    </>
  );
}

"use client";

import { useActionState, useState } from "react";
import { updateBillingSettings, type ActionResult, type BillingSettings } from "@/app/actions/settings";
import { formatBillNumber, billNumberLabel, type BillNumberLabel } from "@/lib/billing/bill-number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Receipt, Hash, CheckCircle2 } from "lucide-react";

export function SettingsClient({ settings }: { settings: BillingSettings }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateBillingSettings, null);

  // Live preview of the printed bill line, so the admin sees exactly what padding + label do.
  const [next, setNext] = useState(settings.billNumberNext === null ? "" : String(settings.billNumberNext));
  const [pad, setPad] = useState(String(settings.billNumberPad || ""));
  const [label, setLabel] = useState<BillNumberLabel>(settings.billNumberLabel);

  const nextNum = next.trim() === "" ? null : Number(next);
  const previewValue =
    nextNum !== null && Number.isInteger(nextNum) && nextNum >= 0
      ? formatBillNumber(nextNum, Number(pad) || 0)
      : null;

  const saved = state !== null && "ok" in state;
  const errored = state !== null && "error" in state;

  return (
    <form action={action} className="flex flex-col gap-6 max-w-lg">
      {/* ── PAN ─────────────────────────────────────────────────────────────── */}
      <section
        className="rounded-xl border px-5 py-5"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
          <Receipt size={15} /> PAN number
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-mute)" }}>
          Printed on every bill (e.g. <span className="font-mono">PAN No.: 123456789</span>). Leave blank to omit it.
        </p>
        <Input
          name="pan_number"
          defaultValue={settings.panNumber}
          placeholder="e.g. 123456789"
          className="max-w-xs"
        />
      </section>

      {/* ── Bill / Order numbering ──────────────────────────────────────────── */}
      <section
        className="rounded-xl border px-5 py-5"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
          <Hash size={15} /> Bill numbering
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
          Give bills a running number. Set the next number to use — bills count up automatically from there.
          Reset it whenever you like (e.g. at the start of a financial year); past bills keep the numbers they
          were printed with. Leave blank to use the default reference instead.
        </p>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Next bill number</span>
            <Input
              name="bill_number_next"
              value={next}
              onChange={(e) => setNext(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="e.g. 1"
              className="w-36"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Min digits (padding)</span>
            <Input
              name="bill_number_pad"
              value={pad}
              onChange={(e) => setPad(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="0"
              className="w-28"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Label</span>
            <select
              name="bill_number_label"
              value={label}
              onChange={(e) => setLabel(e.target.value as BillNumberLabel)}
              className="h-10 rounded-lg border px-3 text-sm w-36"
              style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
            >
              <option value="bill">Bill No</option>
              <option value="order">Order No</option>
            </select>
          </label>
        </div>

        {/* Live preview */}
        <div
          className="mt-4 rounded-lg border px-4 py-3 text-sm font-mono"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
        >
          {previewValue !== null ? (
            <>On the bill: <strong>{billNumberLabel(label)}.: {previewValue}</strong></>
          ) : (
            <span style={{ color: "var(--color-ink-mute)" }}>Numbering off — bills use the default reference.</span>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
        {errored && (
          <span className="text-sm" style={{ color: "var(--color-ruby)" }}>{(state as { error: string }).error}</span>
        )}
      </div>
    </form>
  );
}

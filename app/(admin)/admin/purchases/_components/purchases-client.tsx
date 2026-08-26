"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  getPurchaseDetail,
  getPurchaseLines,
  getPurchases,
  getPurchaseSummary,
  recordPurchase,
} from "@/app/actions/purchases";
import type {
  ActionResult,
  PurchaseDetail,
  PurchaseFilter,
  PurchaseLineRow,
  PurchaseRow,
  PurchaseSummary,
  VendorOption,
} from "@/app/actions/purchases";
import type { WorkstationRow } from "@/app/actions/workstations";
import {
  ALL_STATIONS,
  filterableStations,
  matchesStation,
  stationColor,
} from "@/lib/workstations/stations";
import { StationChips } from "@/components/station-chips";
import { updatePurchase, type PurchaseEditInput } from "@/app/actions/security";
import { qty } from "@/lib/stock";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentMethodPicker, splitIsValid } from "@/components/ui/payment-method-picker";
import { SecurityPinDialog } from "@/components/security-pin-dialog";
import { PeriodFilter } from "@/components/ui/period-filter";
import type { HistoryPeriod } from "@/lib/history-period";
import { Modal } from "../../_components/modal";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";

const PAGE_SIZE = 10;

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) => `₹${n.toFixed(2)}`;

type ProductOption = { id: string; name: string; unit: string };

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Mixed",
  credit: "Credit",
};

const METHOD_COLOR: Record<string, string> = {
  cash: "#1a7a4a",
  online: "#1a7a4a",
  credit: "#f97316",
};

const FILTERS: { key: PurchaseFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cash", label: "Cash" },
  { key: "online", label: "Online" },
  { key: "credit", label: "Credit" },
];

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: tone ?? "var(--color-ink)" }}>{value}</p>
    </div>
  );
}

// ── New purchase ──────────────────────────────────────────────────────────────

type Line = { key: number; product_id: string; quantity: string; unit_cost: string };

export type PurchaseFormInitial = {
  vendorId: string;
  method: "cash" | "online" | "credit" | "mixed";
  notes: string;
  lines: Line[];
  paidNow: string;
  paidTender: "cash" | "online" | "mixed";
  mixCash: string;
  mixOnline: string;
};

// Records a new purchase, or — in `edit` mode — edits a completed one behind the Security
// PIN. Same fields either way; only submission differs: a new purchase POSTs the record
// action, an edit opens the Security-PIN dialog and calls `updatePurchase`.
function PurchaseForm({
  vendors,
  products,
  onDone,
  edit,
}: {
  vendors: VendorOption[];
  products: ProductOption[];
  onDone: () => void;
  edit?: { purchaseId: string; initial: PurchaseFormInitial };
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(recordPurchase, null);
  const [vendorId, setVendorId] = useState(edit?.initial.vendorId ?? "");
  const [method, setMethod] = useState<"cash" | "online" | "credit" | "mixed">(edit?.initial.method ?? "cash");
  const [paidNow, setPaidNow] = useState(edit?.initial.paidNow ?? "");
  const [paidTender, setPaidTender] = useState<"cash" | "online" | "mixed">(edit?.initial.paidTender ?? "cash");
  const [notes, setNotes] = useState(edit?.initial.notes ?? "");
  const [mixCash, setMixCash] = useState(edit?.initial.mixCash ?? "");
  const [mixOnline, setMixOnline] = useState(edit?.initial.mixOnline ?? "");
  const [pinOpen, setPinOpen] = useState(false);
  const nextKey = useRef((edit?.initial.lines.length ?? 1) + 1);
  const [lines, setLines] = useState<Line[]>(
    edit?.initial.lines ?? [{ key: 0, product_id: "", quantity: "", unit_cost: "" }]
  );

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const addLine = () =>
    setLines((l) => [...l, { key: nextKey.current++, product_id: "", quantity: "", unit_cost: "" }]);
  const removeLine = (key: number) => setLines((l) => l.filter((x) => x.key !== key));
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // The total shown here is only a preview — the server recomputes it from the
  // lines, so the bill can never disagree with what's in it.
  const validLines = lines.filter(
    (l) => l.product_id && parseFloat(l.quantity) > 0 && parseFloat(l.unit_cost) >= 0
  );
  const total = validLines.reduce(
    (sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.unit_cost),
    0
  );

  const paidNowNum = parseFloat(paidNow) || 0;
  const onCredit = method === "credit" ? Math.max(0, total - paidNowNum) : 0;
  // A mixed purchase must be settled in full: cash + online = total.
  // A credit purchase with mixed paid-now must also split paidNow into cash + online.
  const mixValid = method !== "mixed" || splitIsValid("mixed", total, mixCash, mixOnline);
  const creditMixValid =
    method !== "credit" || paidNowNum === 0 || paidTender !== "mixed" || splitIsValid("mixed", paidNowNum, mixCash, mixOnline);
  const creditValid = method !== "credit" || (paidNowNum >= 0 && paidNowNum < total && creditMixValid);

  const canSubmit =
    !pending && !!vendorId && validLines.length > 0 && total > 0 && creditValid && mixValid;

  const vendor = vendors.find((s) => s.id === vendorId);

  const isEdit = !!edit;
  // The payload for an edit — assembled the same way the record action maps its FormData,
  // so an edit and a fresh record reconcile identically on the server.
  const editPayload: PurchaseEditInput = {
    vendorId,
    method,
    cash:
      method === "mixed" ? (parseFloat(mixCash) || 0)
      : method === "credit" ? (paidTender === "mixed" ? (parseFloat(mixCash) || 0) : paidTender === "cash" ? paidNowNum : 0)
      : 0,
    online:
      method === "mixed" ? (parseFloat(mixOnline) || 0)
      : method === "credit" ? (paidTender === "mixed" ? (parseFloat(mixOnline) || 0) : paidTender === "online" ? paidNowNum : 0)
      : 0,
    items: validLines.map((l) => ({
      product_id: l.product_id,
      quantity: parseFloat(l.quantity),
      unit_cost: parseFloat(l.unit_cost),
    })),
    notes: notes.trim() || null,
  };

  return (
    <form action={isEdit ? undefined : action} className="flex flex-col gap-4">
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="paid_now" value={method === "credit" ? paidNow : ""} />
      <input type="hidden" name="paid_tender" value={paidTender} />
      <input type="hidden" name="cash_amount" value={method === "mixed" || (method === "credit" && paidTender === "mixed") ? mixCash : ""} />
      <input type="hidden" name="online_amount" value={method === "mixed" || (method === "credit" && paidTender === "mixed") ? mixOnline : ""} />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          validLines.map((l) => ({
            product_id: l.product_id,
            quantity: parseFloat(l.quantity),
            unit_cost: parseFloat(l.unit_cost),
          }))
        )}
      />

      {/* Vendor */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pu_vendor" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Vendor <span style={{ color: "var(--color-ruby)" }}>*</span>
        </label>
        <select
          id="pu_vendor"
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
        >
          <option value="">Choose a vendor…</option>
          {vendors.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {vendor && vendor.credit_balance > 0 && (
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            You already owe {vendor.name} {money2(vendor.credit_balance)}.
          </p>
        )}
        {vendors.length === 0 && (
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>No active vendors — add one first.</p>
        )}
      </div>

      {/* Lines */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Products
        </p>

        {lines.map((l) => {
          const prod = products.find((p) => p.id === l.product_id);
          const lineTotal =
            parseFloat(l.quantity) > 0 && parseFloat(l.unit_cost) >= 0
              ? parseFloat(l.quantity) * parseFloat(l.unit_cost)
              : 0;
          return (
            <div
              key={l.key}
              className="rounded-lg border px-3 py-3 flex flex-col gap-2"
              style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
            >
              <div className="flex items-center gap-2">
                <select
                  value={l.product_id}
                  onChange={(e) => setLine(l.key, { product_id: e.target.value })}
                  className="flex-1 min-w-0 text-sm rounded-lg border px-2.5 py-1.5"
                  style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
                >
                  <option value="">Choose a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                  ))}
                </select>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    aria-label="Remove line"
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "var(--color-canvas)", color: "var(--color-ink-mute)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min="0.001"
                  step="0.001"
                  placeholder={prod ? `Qty (${prod.unit})` : "Quantity"}
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Cost per unit (₹)"
                  value={l.unit_cost}
                  onChange={(e) => setLine(l.key, { unit_cost: e.target.value })}
                />
              </div>

              {lineTotal > 0 && (
                <p className="text-xs text-right tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                  Line total {money2(lineTotal)}
                </p>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addLine}
          className="self-start text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-primary)" }}
        >
          <Plus size={13} /> Add another product
        </button>
      </div>

      {/* Payment */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Payment
        </p>
        <div className="grid grid-cols-4 gap-1">
          {(["cash", "online", "mixed", "credit"] as const).map((m) => {
            const active = method === m;
            const isCredit = m === "credit";
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className="py-2 rounded-lg border text-sm transition-colors"
                style={{
                  borderColor: active
                    ? isCredit ? "#f97316" : "var(--color-primary)"
                    : "var(--color-hairline-input)",
                  background: active
                    ? isCredit ? "rgba(249,115,22,0.08)" : "rgba(99,102,241,0.06)"
                    : "var(--color-canvas-soft)",
                  color: "var(--color-ink)",
                }}
              >
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>

        {method === "mixed" && (
          <PaymentMethodPicker
            methods={["mixed"]}
            value="mixed"
            onChange={() => {}}
            total={total}
            cash={mixCash}
            online={mixOnline}
            onSplitChange={(n) => { setMixCash(n.cash); setMixOnline(n.online); }}
            disabled={pending}
          />
        )}
      </div>

      {method === "credit" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pu_paid" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Paying now (₹) — leave blank for full credit
            </label>
            <Input
              id="pu_paid"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={paidNow}
              onChange={(e) => setPaidNow(e.target.value)}
            />
          </div>

          {paidNowNum > 0 && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-1">
                {(["cash", "online", "mixed"] as const).map((t) => {
                  const active = paidTender === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPaidTender(t)}
                      className="py-1.5 rounded-lg border text-xs sm:text-sm transition-colors"
                      style={{
                        borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                        background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                        color: "var(--color-ink)",
                      }}
                    >
                      Paid by {t === "mixed" ? "Mixed" : METHOD_LABEL[t]}
                    </button>
                  );
                })}
              </div>

              {paidTender === "mixed" && (
                <PaymentMethodPicker
                  methods={["mixed"]}
                  value="mixed"
                  onChange={() => {}}
                  total={paidNowNum}
                  cash={mixCash}
                  online={mixOnline}
                  onSplitChange={(n) => { setMixCash(n.cash); setMixOnline(n.online); }}
                  disabled={pending}
                  mixedLabel="Cash + Online Paid Now"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Totals — the maths, spelled out before committing */}
      <div
        className="rounded-lg border px-4 py-3 flex flex-col gap-1.5"
        style={{
          background: method === "credit" ? "var(--color-warning-bg)" : "var(--color-canvas-soft)",
          borderColor: method === "credit" ? "color-mix(in srgb, var(--color-warning) 27%, transparent)" : "var(--color-hairline)",
        }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--color-ink-mute)" }}>Purchase total</span>
          <span className="tabular-nums font-medium" style={{ color: "var(--color-ink)" }}>{money2(total)}</span>
        </div>
        {method === "credit" && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--color-ink-mute)" }}>Paying now</span>
              <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>− {money2(paidNowNum)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: "color-mix(in srgb, var(--color-warning) 20%, transparent)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Goes on vendor credit</span>
              <span className="text-lg font-medium tabular-nums" style={{ color: "var(--color-warning)" }}>{money2(onCredit)}</span>
            </div>
          </>
        )}
      </div>

      {method === "credit" && paidNow !== "" && !creditValid && total > 0 && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          That settles the whole bill — use Cash or Online instead.
        </p>
      )}

      <Input
        name="notes"
        placeholder="Note (optional) — e.g. invoice #1234"
        autoComplete="off"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {!isEdit && state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {state.error}
        </p>
      )}

      {isEdit ? (
        <>
          <Button type="button" variant="primary" disabled={!canSubmit} onClick={() => setPinOpen(true)}>
            {`Save changes${total > 0 ? " · " + money(total) : ""}`}
          </Button>
          <SecurityPinDialog
            open={pinOpen}
            onClose={() => setPinOpen(false)}
            onSuccess={onDone}
            title="Confirm purchase edit"
            description="Editing a completed purchase updates stock and the vendor's balance. Enter your Security PIN to continue."
            confirmLabel="Save changes"
            extraValid={canSubmit}
            onConfirm={(pin) => updatePurchase(pin, edit!.purchaseId, editPayload)}
          />
        </>
      ) : (
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {pending
            ? "Recording…"
            : method === "credit" && onCredit > 0
            ? `Record & add ${money(onCredit)} to vendor credit`
            : `Record purchase ${total > 0 ? money(total) : ""}`}
        </Button>
      )}
    </form>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

function PurchaseDetailView({
  purchaseId,
  vendors,
  products,
  canEdit,
  securityEnabled,
  onEdited,
}: {
  purchaseId: string;
  vendors: VendorOption[];
  products: ProductOption[];
  canEdit: boolean;
  securityEnabled: boolean;
  onEdited: () => void;
}) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await getPurchaseDetail(purchaseId);
      if ("error" in res) setError(res.error);
      else setDetail(res);
    })();
  }, [purchaseId]);

  if (error) {
    return <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>{error}</p>;
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-8" style={{ color: "var(--color-ink-mute)" }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (editing) {
    // `method` is stored more widely than the read-type admits ('mixed' is a real DB value
    // the PurchaseMethod type omits), so widen it to the form's method set for prefill.
    const m = detail.method as PurchaseFormInitial["method"];
    return (
      <PurchaseForm
        vendors={vendors}
        products={products}
        onDone={onEdited}
        edit={{
          purchaseId,
          initial: {
            vendorId: detail.vendor_id,
            method: m,
            notes: detail.notes ?? "",
            lines: detail.items.map((i, idx) => ({
              key: idx,
              product_id: i.product_id,
              quantity: String(i.quantity),
              unit_cost: String(i.unit_cost),
            })),
            // For a credit purchase the "paid now" is whatever was tendered up front
            // (cash, online, or mixed); mixed carries the full cash/online split.
            paidNow: m === "credit" ? String(detail.cash_amount + detail.online_amount) : "",
            paidTender:
              detail.online_amount > 0 && detail.cash_amount > 0 ? "mixed"
              : detail.online_amount > 0 ? "online"
              : "cash",
            mixCash: m === "mixed" || (m === "credit" && detail.cash_amount > 0 && detail.online_amount > 0) ? String(detail.cash_amount) : "",
            mixOnline: m === "mixed" || (m === "credit" && detail.cash_amount > 0 && detail.online_amount > 0) ? String(detail.online_amount) : "",
          },
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
        {detail.items.map((i, idx) => (
          <div
            key={i.id}
            className="flex items-center gap-3 px-4 py-2.5"
            style={{
              background: "var(--color-canvas)",
              borderTop: idx === 0 ? "none" : "1px solid var(--color-hairline)",
            }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{i.product_name}</p>
              <p className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                {qty(i.quantity)} {i.unit} × {money2(i.unit_cost)}
              </p>
            </div>
            <p className="text-sm tabular-nums shrink-0" style={{ color: "var(--color-ink)" }}>
              {money2(i.line_total)}
            </p>
          </div>
        ))}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ background: "var(--color-canvas-soft)", borderTop: "1px solid var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Total</span>
          <span className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
            {money2(detail.total_amount)}
          </span>
        </div>
      </div>

      {/* How it was settled */}
      <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
        <div className="flex justify-between gap-3">
          <span>Vendor</span>
          <span style={{ color: "var(--color-ink)" }}>{detail.vendor_name}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Payment</span>
          <span style={{ color: METHOD_COLOR[detail.method] }}>{METHOD_LABEL[detail.method]}</span>
        </div>
        {detail.cash_amount > 0 && (
          <div className="flex justify-between gap-3">
            <span>Paid in cash</span>
            <span style={{ color: "var(--color-ink)" }}>{money2(detail.cash_amount)}</span>
          </div>
        )}
        {detail.online_amount > 0 && (
          <div className="flex justify-between gap-3">
            <span>Paid online</span>
            <span style={{ color: "var(--color-ink)" }}>{money2(detail.online_amount)}</span>
          </div>
        )}
        {detail.credit_amount > 0 && (
          <div className="flex justify-between gap-3">
            <span>Added to vendor credit</span>
            <span style={{ color: "var(--color-warning)" }}>{money2(detail.credit_amount)}</span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span>Recorded</span>
          <span style={{ color: "var(--color-ink)" }}>
            {new Date(detail.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            {detail.created_by_name ? ` · ${detail.created_by_name}` : ""}
          </span>
        </div>
        {detail.notes && (
          <div className="flex justify-between gap-3">
            <span>Note</span>
            <span className="text-right" style={{ color: "var(--color-ink)" }}>{detail.notes}</span>
          </div>
        )}
      </div>

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)} disabled={!securityEnabled}>
            <Pencil size={14} /> Edit purchase
          </Button>
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {securityEnabled
              ? "Editing updates stock and the vendor's balance. It needs your Security PIN, and every change is logged."
              : "Set a Security PIN in Settings to enable editing completed purchases."}
          </p>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          This purchase already added its items to stock
          {detail.credit_amount > 0 ? " and raised the vendor's balance" : ""}. Purchases are never
          edited or deleted — record a stock adjustment or a vendor payment instead, so the trail stays intact.
        </p>
      )}
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function PurchasesClient({
  initialPurchases,
  initialLines,
  initialSummary,
  vendors,
  products,
  workstations,
  canManage,
  canEdit,
  securityEnabled,
}: {
  initialPurchases: PurchaseRow[];
  /** The same bills as `initialPurchases`, split into lines — the station view. */
  initialLines: PurchaseLineRow[];
  initialSummary: PurchaseSummary;
  vendors: VendorOption[];
  products: ProductOption[];
  workstations: WorkstationRow[];
  canManage: boolean;
  /** Owner: may edit completed purchases (behind the Security PIN). */
  canEdit: boolean;
  /** Whether a Security PIN is configured — editing is impossible without it. */
  securityEnabled: boolean;
}) {
  const [rows, setRows] = useState(initialPurchases);
  const [lines, setLines] = useState(initialLines);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PurchaseFilter>("all");
  const [period, setPeriod] = useState<HistoryPeriod>("today");
  const [date, setDate] = useState("");
  /** Station filter. `all` keeps the familiar list of BILLS; picking a station
   *  switches to LINES, because only a line belongs to one station. */
  const [station, setStation] = useState<string>(ALL_STATIONS);
  const [page, setPage] = useState(1);
  const [loading, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [detailOf, setDetailOf] = useState<PurchaseRow | null>(null);

  const reload = useCallback((s: string, f: PurchaseFilter, p: HistoryPeriod, d: string) => {
    startTransition(async () => {
      try {
        // Bills and lines are fetched together, always. They are two views of the
        // same window, so refreshing one without the other would let the station
        // view fall behind the bill view after a purchase is recorded.
        const [list, lineList, sum] = await Promise.all([
          getPurchases({ search: s, filter: f, period: p, date: d || null }),
          getPurchaseLines({ search: s, filter: f, period: p, date: d || null }),
          getPurchaseSummary(),
        ]);
        setRows(list);
        setLines(lineList);
        setSummary(sum);
      } catch {
        // keep the last known list on a transient failure
      }
    });
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => reload(search, filter, period, date), 250);
    return () => clearTimeout(t);
  }, [search, filter, period, date, reload]);

  useEffect(() => { setPage(1); }, [search, filter, period, date, station]);

  const refresh = useCallback(() => reload(search, filter, period, date), [reload, search, filter, period, date]);

  useRealtime(["purchases", "vendors"], refresh);

  // Stations worth offering: active ones, plus any inactive station still on a
  // line in view.
  const chipStations = useMemo(
    () => filterableStations(workstations, lines.flatMap((l) => l.workstation_ids)),
    [workstations, lines]
  );

  const byStation = station !== ALL_STATIONS;

  // Client-side, over lines already in memory — switching station costs no round
  // trip, exactly as on the Stock page.
  const stationLines = useMemo(
    () => (byStation ? lines.filter((l) => matchesStation(l.workstation_ids, station)) : []),
    [lines, station, byStation]
  );

  /** What the listed lines add up to. Stated as the total of what's on screen —
   *  NOT apportioned across cash/online/credit, which are facts about a whole
   *  bill and cannot be honestly split across its lines. */
  const stationTotal = useMemo(
    () => stationLines.reduce((sum, l) => sum + l.line_total, 0),
    [stationLines]
  );
  const stationBills = useMemo(
    () => new Set(stationLines.map((l) => l.purchase_id)).size,
    [stationLines]
  );

  const listLength = byStation ? stationLines.length : rows.length;
  const pageCount = Math.max(1, Math.ceil(listLength / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage]
  );
  const pageLines = useMemo(
    () => stationLines.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [stationLines, safePage]
  );

  const activeStation = chipStations.find((w) => w.id === station) ?? null;
  const stationLabel = activeStation?.name ?? "Unassigned";

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="text-2xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
            Purchases
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Buying stock adds it to inventory and, on credit, to the vendor&apos;s account.
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="shrink-0">
            <Plus size={14} /> New purchase
          </Button>
        )}
      </div>

      {/* Today */}
      <div className="grid gap-3 my-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard label="Purchases today" value={money(summary.totalPurchases)} />
        <StatCard label="Cash spent today" value={money(summary.cashSpend)} />
        <StatCard label="Online spent today" value={money(summary.onlineSpend)} />
        <StatCard
          label="On credit today"
          value={money(summary.creditPurchases)}
          tone={summary.creditPurchases > 0 ? "#f97316" : undefined}
        />
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-ink-mute)" }} />
          <Input
            type="search"
            placeholder="Search by purchase ID or vendor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                  background: active ? "var(--color-primary)" : "var(--color-canvas)",
                  color: active ? "#fff" : "var(--color-ink)",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4">
        <PeriodFilter value={period} onChange={setPeriod} date={date} onDateChange={setDate} />
      </div>

      <StationChips
        stations={chipStations}
        value={station}
        onChange={setStation}
        className="mb-4"
      />

      {/* What the station view is, said once, where the numbers change meaning.
          The stat cards above stay whole-restaurant and say "today"; this total
          is of the lines listed below, over the same window as the bill list. */}
      {byStation && (
        <div
          className="rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap"
          style={{
            background: "var(--color-canvas-soft)",
            borderColor: activeStation
              ? `color-mix(in srgb, ${stationColor(activeStation)} 30%, transparent)`
              : "var(--color-hairline)",
          }}
        >
          <div>
            <p
              className="text-xs uppercase tracking-wide font-medium"
              style={{
                color: activeStation ? stationColor(activeStation) : "var(--color-ink-mute)",
                letterSpacing: "0.06em",
              }}
            >
              {stationLabel}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              {stationLines.length} line{stationLines.length !== 1 ? "s" : ""} across{" "}
              {stationBills} purchase{stationBills !== 1 ? "s" : ""}
              {" — other stations’ lines on the same bills are not counted."}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
              {money2(stationTotal)}
            </p>
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              spent on {stationLabel.toLowerCase()} stock
            </p>
          </div>
        </div>
      )}

      {listLength === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {byStation
              ? `Nothing bought for ${stationLabel} in these purchases. Assign products to a workstation on the Stock page, and their purchases appear here.`
              : search || filter !== "all" || period !== "today" || date
              ? "No purchases match that search."
              : "No purchases yet. Record one to add stock and track what you spent."}
          </p>
        </div>
      ) : byStation ? (
        <>
          {/* Station view: LINES, not bills. Tapping one still opens its bill —
              the line is the unit of reporting, the bill is the unit of record. */}
          <div
            className="hidden md:block rounded-xl border overflow-x-auto"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-canvas-soft)" }}>
                  {[
                    { h: "Product", right: false },
                    { h: "Purchase", right: false },
                    { h: "Vendor", right: false },
                    { h: "Qty", right: true },
                    { h: "Unit cost", right: true },
                    { h: "Line total", right: true },
                  ].map(({ h, right }) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide whitespace-nowrap ${right ? "text-right" : "text-left"}`}
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageLines.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t cursor-pointer"
                    style={{ borderColor: "var(--color-hairline)" }}
                    onClick={() => {
                      const bill = rows.find((r) => r.id === l.purchase_id);
                      if (bill) setDetailOf(bill);
                    }}
                  >
                    <td className="px-4 py-3" style={{ color: "var(--color-ink)" }}>{l.product_name}</td>
                    <td className="px-4 py-3">
                      <span style={{ color: "var(--color-ink)" }}>{l.purchase_code}</span>
                      <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                        {new Date(l.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--color-ink-mute)" }}>{l.vendor_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                      {qty(l.quantity)} {l.unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                      {money2(l.unit_cost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: "var(--color-ink)" }}>
                      {money2(l.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-2">
            {pageLines.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  const bill = rows.find((r) => r.id === l.purchase_id);
                  if (bill) setDetailOf(bill);
                }}
                className="w-full rounded-xl border px-4 py-3 text-left"
                style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {l.product_name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                      {qty(l.quantity)} {l.unit} × {money2(l.unit_cost)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {l.purchase_code} · {l.vendor_name} ·{" "}
                      {new Date(l.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <p className="text-sm font-medium tabular-nums shrink-0" style={{ color: "var(--color-ink)" }}>
                    {money(l.line_total)}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, listLength)} of {listLength} lines
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border disabled:opacity-40"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs px-2 tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage === pageCount}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border disabled:opacity-40"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Desktop table */}
          <div
            // overflow-x-auto, not -hidden: on a tablet this table is wider than
            // the column it sits in, and -hidden silently CLIPS the right-hand
            // columns instead of letting them scroll into view.
            className="hidden md:block rounded-xl border overflow-x-auto"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-canvas-soft)" }}>
                  {[
                    { h: "Purchase", right: false },
                    { h: "Vendor", right: false },
                    { h: "Payment", right: false },
                    { h: "On credit", right: true },
                    { h: "Total", right: true },
                  ].map(({ h, right }) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide ${right ? "text-right" : "text-left"}`}
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t cursor-pointer"
                    style={{ borderColor: "var(--color-hairline)" }}
                    onClick={() => setDetailOf(p)}
                  >
                    <td className="px-4 py-3">
                      <span style={{ color: "var(--color-ink)" }}>{p.purchase_code}</span>
                      <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                        {p.item_count} item{p.item_count !== 1 ? "s" : ""} ·{" "}
                        {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--color-ink)" }}>{p.vendor_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full border"
                        style={{
                          color: METHOD_COLOR[p.method],
                          borderColor: `${METHOD_COLOR[p.method]}44`,
                          background: `${METHOD_COLOR[p.method]}11`,
                          letterSpacing: "0.06em",
                        }}
                      >
                        {METHOD_LABEL[p.method]}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: p.credit_amount > 0 ? "var(--color-danger)" : "var(--color-ink-mute)" }}
                    >
                      {p.credit_amount > 0 ? money2(p.credit_amount) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: "var(--color-ink)" }}>
                      {money2(p.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-2">
            {pageRows.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetailOf(p)}
                className="w-full rounded-xl border px-4 py-3 text-left"
                style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{p.vendor_name}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                      {p.purchase_code} · {p.item_count} item{p.item_count !== 1 ? "s" : ""} ·{" "}
                      {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
                      {money(p.total_amount)}
                    </p>
                    <p className="text-xs uppercase tracking-wide" style={{ color: METHOD_COLOR[p.method], letterSpacing: "0.06em" }}>
                      {METHOD_LABEL[p.method]}
                    </p>
                  </div>
                </div>
                {p.credit_amount > 0 && (
                  <p className="text-xs mt-1.5" style={{ color: "var(--color-danger)" }}>
                    {money2(p.credit_amount)} added to vendor credit
                  </p>
                )}
              </button>
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} of {rows.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border disabled:opacity-40"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs px-2 tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage === pageCount}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border disabled:opacity-40"
                  style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New purchase"
        subtitle="Adds to stock; on credit, adds to the vendor's account"
        wide
      >
        <PurchaseForm
          vendors={vendors}
          products={products}
          onDone={() => { setCreating(false); refresh(); }}
        />
      </Modal>

      <Modal
        open={!!detailOf}
        onClose={() => setDetailOf(null)}
        title={detailOf?.purchase_code ?? "Purchase"}
        subtitle={detailOf?.vendor_name}
        wide
      >
        {detailOf && (
          <PurchaseDetailView
            purchaseId={detailOf.id}
            vendors={vendors}
            products={products}
            canEdit={canEdit}
            securityEnabled={securityEnabled}
            onEdited={() => { setDetailOf(null); refresh(); }}
          />
        )}
      </Modal>
    </div>
  );
}

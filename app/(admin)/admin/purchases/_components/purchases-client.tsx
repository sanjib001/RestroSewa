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
  getPurchases,
  getPurchaseSummary,
  recordPurchase,
} from "@/app/actions/purchases";
import type {
  ActionResult,
  PurchaseDetail,
  PurchaseFilter,
  PurchaseRow,
  PurchaseSummary,
  VendorOption,
} from "@/app/actions/purchases";
import { qty } from "@/lib/stock";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "../../_components/modal";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Trash2 } from "lucide-react";

const PAGE_SIZE = 10;

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) => `₹${n.toFixed(2)}`;

type ProductOption = { id: string; name: string; unit: string };

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
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

function PurchaseForm({
  vendors,
  products,
  onDone,
}: {
  vendors: VendorOption[];
  products: ProductOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(recordPurchase, null);
  const [vendorId, setVendorId] = useState("");
  const [method, setMethod] = useState<"cash" | "online" | "credit">("cash");
  const [paidNow, setPaidNow] = useState("");
  const [paidTender, setPaidTender] = useState<"cash" | "online">("cash");
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[]>([
    { key: 0, product_id: "", quantity: "", unit_cost: "" },
  ]);

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
  const creditValid = method !== "credit" || (paidNowNum >= 0 && paidNowNum < total);

  const canSubmit =
    !pending && !!vendorId && validLines.length > 0 && total > 0 && creditValid;

  const vendor = vendors.find((s) => s.id === vendorId);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="paid_now" value={method === "credit" ? paidNow : ""} />
      <input type="hidden" name="paid_tender" value={paidTender} />
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
          <p className="text-xs" style={{ color: "#9a3412" }}>
            You already owe {vendor.name} {money2(vendor.credit_balance)}.
          </p>
        )}
        {vendors.length === 0 && (
          <p className="text-xs" style={{ color: "#9a3412" }}>No active vendors — add one first.</p>
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
        <div className="grid grid-cols-3 gap-1">
          {(["cash", "online", "credit"] as const).map((m) => {
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
            <div className="grid grid-cols-2 gap-1">
              {(["cash", "online"] as const).map((t) => {
                const active = paidTender === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPaidTender(t)}
                    className="py-1.5 rounded-lg border text-sm transition-colors"
                    style={{
                      borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                      background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                      color: "var(--color-ink)",
                    }}
                  >
                    Paid by {METHOD_LABEL[t]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Totals — the maths, spelled out before committing */}
      <div
        className="rounded-lg border px-4 py-3 flex flex-col gap-1.5"
        style={{
          background: method === "credit" ? "#fff7ed" : "var(--color-canvas-soft)",
          borderColor: method === "credit" ? "#f9731644" : "var(--color-hairline)",
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
            <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: "#f9731633" }}>
              <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Goes on vendor credit</span>
              <span className="text-lg font-medium tabular-nums" style={{ color: "#9a3412" }}>{money2(onCredit)}</span>
            </div>
          </>
        )}
      </div>

      {method === "credit" && paidNow !== "" && !creditValid && total > 0 && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          That settles the whole bill — use Cash or Online instead.
        </p>
      )}

      <Input name="notes" placeholder="Note (optional) — e.g. invoice #1234" autoComplete="off" />

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={!canSubmit}>
        {pending
          ? "Recording…"
          : method === "credit" && onCredit > 0
          ? `Record & add ${money(onCredit)} to vendor credit`
          : `Record purchase ${total > 0 ? money(total) : ""}`}
      </Button>
    </form>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

function PurchaseDetailView({ purchaseId }: { purchaseId: string }) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await getPurchaseDetail(purchaseId);
      if ("error" in res) setError(res.error);
      else setDetail(res);
    })();
  }, [purchaseId]);

  if (error) {
    return <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>{error}</p>;
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-8" style={{ color: "var(--color-ink-mute)" }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
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
            <span style={{ color: "#9a3412" }}>{money2(detail.credit_amount)}</span>
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

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        This purchase already added its items to stock
        {detail.credit_amount > 0 ? " and raised the vendor's balance" : ""}. Purchases are never
        edited or deleted — record a stock adjustment or a vendor payment instead, so the trail stays intact.
      </p>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function PurchasesClient({
  initialPurchases,
  initialSummary,
  vendors,
  products,
  canManage,
}: {
  initialPurchases: PurchaseRow[];
  initialSummary: PurchaseSummary;
  vendors: VendorOption[];
  products: ProductOption[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState(initialPurchases);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PurchaseFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [detailOf, setDetailOf] = useState<PurchaseRow | null>(null);

  const reload = useCallback((s: string, f: PurchaseFilter) => {
    startTransition(async () => {
      try {
        const [list, sum] = await Promise.all([
          getPurchases({ search: s, filter: f }),
          getPurchaseSummary(),
        ]);
        setRows(list);
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
    const t = setTimeout(() => reload(search, filter), 250);
    return () => clearTimeout(t);
  }, [search, filter, reload]);

  useEffect(() => { setPage(1); }, [search, filter]);

  const refresh = useCallback(() => reload(search, filter), [reload, search, filter]);

  useRealtime(["purchases", "vendors"], refresh);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage]
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="text-xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
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

      {rows.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {search || filter !== "all"
              ? "No purchases match that search."
              : "No purchases yet. Record one to add stock and track what you spent."}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div
            className="hidden md:block rounded-xl border overflow-hidden"
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
                        className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border"
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
                      style={{ color: p.credit_amount > 0 ? "#dc2626" : "var(--color-ink-mute)" }}
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
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: METHOD_COLOR[p.method], letterSpacing: "0.06em" }}>
                      {METHOD_LABEL[p.method]}
                    </p>
                  </div>
                </div>
                {p.credit_amount > 0 && (
                  <p className="text-xs mt-1.5" style={{ color: "#dc2626" }}>
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
      >
        {detailOf && <PurchaseDetailView purchaseId={detailOf.id} />}
      </Modal>
    </div>
  );
}

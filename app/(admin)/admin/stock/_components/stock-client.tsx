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
  adjustStock,
  createProduct,
  getMenuItemLinks,
  getProductDetail,
  getProductHistory,
  getStock,
  getStockSummary,
  linkMenuItem,
  setProductActive,
  unlinkMenuItem,
  updateProduct,
} from "@/app/actions/stock";
import type {
  ActionResult,
  LinkTarget,
  MenuItemLink,
  ProductDetail,
  RecipeLine,
  StockFilter,
  StockRow,
  StockSummary,
} from "@/app/actions/stock";
import {
  CAN_ADD_STOCK,
  MOVEMENT_COLOR,
  movementLabel,
  qty,
  STOCK_REASON_LABEL,
  STOCK_REASONS,
  STOCK_STATUS_COLOR,
  STOCK_STATUS_LABEL,
  todayISO,
} from "@/lib/stock";
import type { StockMovement } from "@/lib/stock";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ConfirmDialog } from "../../_components/modal";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";

const PAGE_SIZE = 10;
const HISTORY_PAGE = 12;

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) => `₹${n.toFixed(2)}`;

// How the purchase behind a stock movement was settled.
const PURCHASE_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  credit: "Credit",
};

const UNIT_SUGGESTIONS = ["bottle", "can", "packet", "piece", "kg", "g", "litre", "ml", "crate", "box"];

const FILTERS: { key: StockFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
  { key: "inactive", label: "Inactive" },
];

type ProductOption = { id: string; name: string; unit: string };

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

function StatusPill({ status }: { status: StockRow["status"] }) {
  const color = STOCK_STATUS_COLOR[status];
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap"
      style={{ color, borderColor: `${color}44`, background: `${color}11`, letterSpacing: "0.06em" }}
    >
      {STOCK_STATUS_LABEL[status]}
    </span>
  );
}

// ── Create / edit product ─────────────────────────────────────────────────────

function ProductForm({ product, onDone }: { product?: StockRow; onDone: () => void }) {
  const editing = !!product;
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    editing ? updateProduct : createProduct,
    null
  );

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-3">
      {editing && <input type="hidden" name="id" value={product.id} />}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="p_name" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Product name <span style={{ color: "var(--color-ruby)" }}>*</span>
        </label>
        <Input id="p_name" name="name" required autoComplete="off" placeholder="e.g. Chicken" defaultValue={product?.name ?? ""} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p_unit" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Unit <span style={{ color: "var(--color-ruby)" }}>*</span>
          </label>
          <Input id="p_unit" name="unit" required autoComplete="off" list="unit-suggestions" placeholder="g" defaultValue={product?.unit ?? ""} />
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="p_low" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Warn me below
          </label>
          <Input id="p_low" name="low_stock_threshold" type="number" min="0" step="0.001" placeholder="0" defaultValue={product?.low_stock_threshold ?? ""} />
        </div>
      </div>

      {!editing && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p_opening" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Stock on hand right now
          </label>
          <Input id="p_opening" name="opening_stock" type="number" min="0" step="0.001" placeholder="0" />
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Counted once, when the product is created. Afterwards stock only moves through
            purchases, sales and deductions — so the history always adds up.
          </p>
        </div>
      )}

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add product"}
      </Button>
    </form>
  );
}

// ── Manual deduction ──────────────────────────────────────────────────────────
// For stock consumed outside a sale: kitchen usage, waste, damage, staff meals.
// Every reason removes stock; only a correction may put it back.

function DeductForm({
  products,
  preselected,
  onDone,
}: {
  products: ProductOption[];
  preselected?: StockRow;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(adjustStock, null);
  const [productId, setProductId] = useState(preselected?.id ?? "");
  const [reason, setReason] = useState("kitchen_usage");
  const [direction, setDirection] = useState<"remove" | "add">("remove");
  const [amount, setAmount] = useState("");

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const product = products.find((p) => p.id === productId);
  const unit = preselected?.unit ?? product?.unit ?? "";
  const canAdd = CAN_ADD_STOCK(reason);
  const removing = !canAdd || direction === "remove";
  const amountNum = parseFloat(amount) || 0;

  const current = preselected?.closing;
  const after = current !== undefined ? current + (removing ? -amountNum : amountNum) : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="kind" value={reason} />
      <input type="hidden" name="direction" value={canAdd ? direction : "remove"} />

      {/* Opened from the header, the admin picks the product; opened from a row,
          it's already chosen. */}
      {preselected ? (
        <div
          className="rounded-lg border px-4 py-2.5 flex items-center justify-between text-sm"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <span style={{ color: "var(--color-ink)" }}>{preselected.name}</span>
          <span className="tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
            {qty(preselected.closing)} {preselected.unit} in stock
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="d_product" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Product <span style={{ color: "var(--color-ruby)" }}>*</span>
          </label>
          <select
            id="d_product"
            required
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full text-sm rounded-lg border px-3 py-2"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
          >
            <option value="">Choose a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="d_reason" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Reason <span style={{ color: "var(--color-ruby)" }}>*</span>
        </label>
        <select
          id="d_reason"
          value={reason}
          onChange={(e) => { setReason(e.target.value); setDirection("remove"); }}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
        >
          {STOCK_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Only a correction can go either way. Everything else consumes stock. */}
      {canAdd && (
        <div className="grid grid-cols-2 gap-1">
          {([
            { d: "remove", label: "Remove stock" },
            { d: "add", label: "Add stock" },
          ] as const).map((o) => {
            const active = direction === o.d;
            return (
              <button
                key={o.d}
                type="button"
                onClick={() => setDirection(o.d)}
                className="py-1.5 rounded-lg border text-sm transition-colors"
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                  background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                  color: "var(--color-ink)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="d_qty" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Quantity{unit ? ` (${unit})` : ""} <span style={{ color: "var(--color-ruby)" }}>*</span>
        </label>
        <Input
          id="d_qty"
          name="qty"
          type="number"
          min="0.001"
          step="0.001"
          required
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <Input name="notes" placeholder="Note (optional) — e.g. used for staff lunch" autoComplete="off" />

      {after !== undefined && amountNum > 0 && (
        <div
          className="rounded-lg border px-4 py-2.5 flex items-center justify-between text-sm"
          style={{
            background: after < 0 ? "var(--color-warning-bg)" : "var(--color-canvas-soft)",
            borderColor: after < 0 ? "color-mix(in srgb, var(--color-warning) 27%, transparent)" : "var(--color-hairline)",
          }}
        >
          <span style={{ color: "var(--color-ink-mute)" }}>Stock after this</span>
          <span
            className="tabular-nums font-medium"
            style={{ color: after <= 0 ? "var(--color-danger)" : "var(--color-ink)" }}
          >
            {qty(after)} {unit}
          </span>
        </div>
      )}

      {after !== undefined && after < 0 && (
        <p className="text-xs" style={{ color: "var(--color-warning)" }}>
          This deducts more than you have on hand. It will be recorded anyway — the negative
          balance tells you the count is off somewhere.
        </p>
      )}

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending || !productId || amountNum <= 0}>
        {pending
          ? "Recording…"
          : removing
          ? `Deduct ${amountNum > 0 ? `${qty(amountNum)} ${unit}` : "stock"}`
          : `Add ${qty(amountNum)} ${unit}`}
      </Button>
    </form>
  );
}

// ── Menu items that use a product (product-centric linking) ───────────────────

// The value of one <option> in the target picker: an item, or one variant of it.
const targetValue = (t: LinkTarget) =>
  t.variant_id ? `${t.menu_item_id}::${t.variant_id}` : t.menu_item_id;

function ProductLinks({
  product,
  links,
  targets,
  canManage,
  onChanged,
}: {
  product: StockRow;
  links: ProductDetail["links"];
  targets: LinkTarget[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(linkMenuItem, null);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [perUnit, setPerUnit] = useState("");
  const [, startUnlink] = useTransition();

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setAdding(false);
      setTarget("");
      setPerUnit("");
      onChanged();
    }
    wasPending.current = pending;
  }, [pending, state, onChanged]);

  // Don't offer a target that already consumes this product. Keyed by item AND
  // variant, so "Momo" and "Momo · Chicken" are offered independently — the whole
  // point is that they can consume different things.
  const linked = new Set(
    links.map((l) => (l.variant_id ? `${l.menu_item_id}::${l.variant_id}` : l.menu_item_id))
  );
  const available = targets.filter((t) => !linked.has(targetValue(t)));

  const chosen = targets.find((t) => targetValue(t) === target);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p
          className="text-xs uppercase tracking-wide font-medium"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Menu items using this
        </p>
        {canManage && !adding && available.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs flex items-center gap-1"
            style={{ color: "var(--color-primary)" }}
          >
            <Plus size={12} /> Add menu item
          </button>
        )}
      </div>

      {links.length === 0 && !adding ? (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            No menu item uses this product, so selling never deducts it. Add one — the same
            product can feed as many menu items as you like.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
          {links.map((l, i) => (
            <div
              key={l.link_id}
              className="flex items-center gap-3 px-4 py-2"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
            >
              <span className="flex-1 min-w-0 text-sm truncate" style={{ color: "var(--color-ink)" }}>
                {l.menu_item_name}
                {/* The variant is the whole point of the row — a Chicken Momo can
                    consume chicken while the Veg Momo next to it consumes paneer. */}
                {l.variant_name && (
                  <span
                    className="ml-1.5 text-xs px-1.5 py-0.5 rounded-md"
                    style={{ background: "rgba(99,102,241,0.08)", color: "var(--color-primary)" }}
                  >
                    {l.variant_name}
                  </span>
                )}
              </span>
              <span className="text-sm tabular-nums shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                {qty(l.qty_per_unit)} {product.unit}
              </span>
              {canManage && (
                <button
                  type="button"
                  aria-label={`Unlink ${l.menu_item_name}${l.variant_name ? ` (${l.variant_name})` : ""}`}
                  onClick={() =>
                    startUnlink(async () => {
                      await unlinkMenuItem(l.link_id);
                      onChanged();
                    })
                  }
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form
          action={action}
          className="rounded-xl border px-3 py-3 mt-2 flex flex-col gap-2"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <input type="hidden" name="product_id" value={product.id} />
          {/* The picker offers one value; the action wants the item and the
              variant separately, so it's split back out here. */}
          <input type="hidden" name="menu_item_id" value={chosen?.menu_item_id ?? ""} />
          <input type="hidden" name="variant_id" value={chosen?.variant_id ?? ""} />

          <select
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full text-sm rounded-lg border px-2.5 py-1.5"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
          >
            <option value="">Choose a menu item or variant…</option>
            {available.map((t) => (
              <option key={targetValue(t)} value={targetValue(t)}>
                {t.label}
              </option>
            ))}
          </select>

          {/* Say out loud what attaching to a VARIANT means, because it changes
              what the item's own recipe does. */}
          {chosen?.variant_id && (
            <p className="text-xs rounded-md px-2 py-1.5" style={{ background: "var(--color-canvas)", color: "var(--color-ink-mute)" }}>
              This is the recipe for <strong>{chosen.label.split(" · ").pop()}</strong> only. Once a
              variant has its own recipe, it stops using the item&apos;s.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Input
              name="qty_per_unit"
              type="number"
              min="0.001"
              step="0.001"
              required
              placeholder={`${product.unit} used per sale`}
              value={perUnit}
              onChange={(e) => setPerUnit(e.target.value)}
              className="flex-1"
            />
            <span className="text-xs shrink-0" style={{ color: "var(--color-ink-mute)" }}>
              {product.unit} / sale
            </span>
          </div>

          {state?.error && (
            <p className="text-xs rounded-md px-2 py-1.5" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
              {state.error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="flex-1 text-sm py-1.5 rounded-lg border"
              style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !target}
              className="flex-1 text-sm py-1.5 rounded-lg font-medium disabled:opacity-50"
              style={{ background: "var(--color-primary)", color: "#fff" }}
            >
              {pending ? "Linking…" : "Link"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Stock history ─────────────────────────────────────────────────────────────

function HistoryList({ productId, unit }: { productId: string; unit: string }) {
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await getProductHistory(productId);
      if (alive) setRows(h);
    })();
    return () => { alive = false; };
  }, [productId]);

  if (!rows) {
    return (
      <div className="flex items-center justify-center py-6" style={{ color: "var(--color-ink-mute)" }}>
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border px-4 py-6 text-center" style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)" }}>
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>No movements yet.</p>
      </div>
    );
  }

  const shown = showAll ? rows : rows.slice(0, HISTORY_PAGE);

  return (
    <>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
        {shown.map((m, i) => {
          const tone = MOVEMENT_COLOR[m.kind];
          const label = movementLabel(m);
          return (
            <div
              key={`${m.at}-${i}`}
              className="flex items-start gap-3 px-4 py-2.5"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
            >
              <div className="flex-1 min-w-0">
                {/* `label` already IS the reason for a manual movement
                    ("Kitchen Usage", "Waste") — never a generic placeholder. */}
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                  {label}
                  {/* A sale names the menu item that consumed the stock — and so
                      does the restore that later put it back, so the two lines
                      read as a matched pair. */}
                  {(m.kind === "sale" || m.kind === "restore") && m.ref && (
                    <span style={{ color: "var(--color-ink-mute)" }}> · {m.ref}</span>
                  )}
                </p>

                {/* Purchases explain themselves: who from, what it cost, how it
                    was paid. The vendor's NAME identifies them — the code doesn't. */}
                {m.kind === "purchase" && (
                  <>
                    {m.vendor_name && (
                      <p className="text-xs" style={{ color: "var(--color-ink)" }}>
                        Vendor: {m.vendor_name}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {m.amount != null && <>{money2(m.amount)} · </>}
                      {m.method && <>Paid via {PURCHASE_METHOD_LABEL[m.method] ?? m.method} · </>}
                      {m.ref}
                    </p>
                  </>
                )}

                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  {new Date(m.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  {m.staff_name ? ` · ${m.staff_name}` : ""}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-medium tabular-nums" style={{ color: tone }}>
                  {m.qty > 0 ? "+" : "−"}{qty(Math.abs(m.qty))} {unit}
                </p>
                {/* Running balance — what was on hand after this movement. */}
                <p className="text-[11px] tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                  {qty(m.balance)} {unit}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {rows.length > HISTORY_PAGE && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mt-2 text-xs w-full py-1.5 rounded-lg border"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-primary)" }}
        >
          {showAll
            ? "Show less"
            : `Show all ${rows.length} movements`}
        </button>
      )}
    </>
  );
}

// ── Product detail: formula + links + history ─────────────────────────────────

function ProductDetailView({
  product,
  day,
  targets,
  canManage,
  onChanged,
}: {
  product: StockRow;
  day: string;
  targets: LinkTarget[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  // Bumping this refetches the detail after a link changes.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await getProductDetail(product.id, day);
      if (!alive) return;
      if ("error" in res) setError(res.error);
      else setDetail(res);
    })();
    return () => { alive = false; };
  }, [product.id, day, rev]);

  const reloadDetail = useCallback(() => {
    setRev((r) => r + 1);
    onChanged();
  }, [onChanged]);

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

  const rows: { label: string; value: number; sign?: boolean }[] = [
    { label: "Yesterday's stock", value: detail.opening },
    { label: "Purchased", value: detail.purchased, sign: true },
  ];
  // "Used" is POS + manual, so both halves are shown — otherwise the total looks
  // wrong to anyone who only remembers the sales.
  //
  // `used_pos` arrives NET of anything ordered and then rejected/cancelled today,
  // so the gross sale and its reversal are shown as two lines that cancel out.
  // Collapsing them into the net figure alone would leave an admin staring at
  // "Sold via POS −0" on a day an order visibly came through the kitchen.
  rows.push({
    label: "Sold via POS",
    value: -(detail.used_pos + detail.reversed),
    sign: true,
  });
  if (detail.reversed > 0) {
    rows.push({ label: "Rejected / cancelled", value: detail.reversed, sign: true });
  }
  if (detail.used_manual > 0) {
    rows.push({ label: "Deducted manually", value: -detail.used_manual, sign: true });
  }
  if (detail.added > 0) {
    rows.push({ label: "Added back", value: detail.added, sign: true });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The formula for the selected day */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            className="flex items-center justify-between px-4 py-2.5 text-sm"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
          >
            <span style={{ color: "var(--color-ink-mute)" }}>{r.label}</span>
            <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
              {r.sign && r.value > 0 ? "+" : ""}
              {qty(r.value)} {detail.unit}
            </span>
          </div>
        ))}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ background: "var(--color-canvas-soft)", borderTop: "1px solid var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Final stock</span>
          <span className="text-lg font-medium tabular-nums" style={{ color: STOCK_STATUS_COLOR[detail.status] }}>
            {qty(detail.closing)} {detail.unit}
          </span>
        </div>
      </div>

      <ProductLinks
        product={product}
        links={detail.links}
        targets={targets}
        canManage={canManage}
        onChanged={reloadDetail}
      />

      {/* History — open by default, collapsible without leaving the page. */}
      <div>
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          className="w-full flex items-center justify-between mb-2"
        >
          <span
            className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
          >
            Stock history
          </span>
          <ChevronDown
            size={15}
            className="transition-transform duration-200"
            style={{ color: "var(--color-ink-mute)", transform: historyOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
        </button>

        {historyOpen && <HistoryList productId={product.id} unit={detail.unit} />}
      </div>
    </div>
  );
}

// ── Menu links overview (menu-item-centric) ───────────────────────────────────

function MenuLinks({ canManage, onOpenProduct }: { canManage: boolean; onOpenProduct: () => void }) {
  const [links, setLinks] = useState<MenuItemLink[] | null>(null);
  const [, startUnlink] = useTransition();

  const load = useCallback(async () => setLinks(await getMenuItemLinks()), []);
  useEffect(() => { load(); }, [load]);

  if (!links) {
    return (
      <div className="flex items-center justify-center py-8" style={{ color: "var(--color-ink-mute)" }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  // A dish deducts nothing only if it has no recipe of its own AND no variant of
  // it has one — a dish whose recipes all live on its variants is fully tracked.
  const unlinked = links.filter(
    (l) => l.base.length === 0 && !l.variants.some((v) => v.overrides)
  ).length;

  const line = (p: RecipeLine, onGone: () => void) => (
    <div key={p.link_id} className="flex items-center gap-2 mt-1">
      <span className="text-xs flex-1 min-w-0 truncate" style={{ color: "var(--color-ink-mute)" }}>
        → {qty(p.qty_per_unit)} {p.unit} of {p.product_name}
      </span>
      {canManage && (
        <button
          type="button"
          aria-label={`Unlink ${p.product_name}`}
          onClick={() => startUnlink(async () => { await unlinkMenuItem(p.link_id); onGone(); })}
          className="w-5 h-5 rounded flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        What each menu item consumes when it sells. A variant can have its own recipe — a Large
        drawing down more than a Small, or a Chicken Momo drawing down something a Veg Momo never
        touches. A variant with its own recipe stops using the item&apos;s.
      </p>

      {unlinked > 0 && (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            {unlinked} menu item{unlinked !== 1 ? "s" : ""} deduct{unlinked === 1 ? "s" : ""} nothing
            when sold. Open a product to link {unlinked !== 1 ? "them" : "it"}.
          </p>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
        {links.map((l, i) => {
          const tracked = l.base.length > 0 || l.variants.some((v) => v.overrides);
          return (
            <div
              key={l.menu_item_id}
              className="px-4 py-2.5"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
            >
              <div className="flex items-center gap-3">
                <p className="flex-1 min-w-0 text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {l.menu_item_name}
                </p>
                {!tracked && (
                  <span className="text-xs shrink-0" style={{ color: "var(--color-warning)" }}>Deducts nothing</span>
                )}
              </div>

              {/* The item's own recipe. */}
              <div className="pl-3">
                {l.base.map((p) => line(p, load))}
              </div>

              {/* Then each variant. A variant with its own recipe shows it; one
                  without says so out loud, because "inherits the item's recipe" is
                  a decision, and a silent blank would look like a missing link. */}
              {l.variants.map((v) => (
                <div key={v.variant_id} className="mt-1.5 pl-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-md shrink-0"
                      style={{
                        background: v.overrides ? "rgba(99,102,241,0.08)" : "var(--color-canvas-soft)",
                        color: v.overrides ? "var(--color-primary)" : "var(--color-ink-mute)",
                      }}
                    >
                      {v.variant_name}
                    </span>
                    {!v.overrides && (
                      <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                        {l.base.length > 0
                          ? "uses the item’s recipe"
                          : "deducts nothing"}
                      </span>
                    )}
                  </div>
                  <div className="pl-3">
                    {v.products.map((p) => line(p, load))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenProduct}
        className="text-xs py-2 rounded-lg border"
        style={{ borderColor: "var(--color-hairline)", color: "var(--color-primary)" }}
      >
        To link menu items, open a product and use “Add menu item”
      </button>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function StockClient({
  initialStock,
  initialSummary,
  products,
  targets,
  canManage,
}: {
  initialStock: StockRow[];
  initialSummary: StockSummary;
  products: ProductOption[];
  targets: LinkTarget[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState(initialStock);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [day, setDay] = useState(todayISO());
  const [page, setPage] = useState(1);
  const [loading, startTransition] = useTransition();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StockRow | null>(null);
  const [detailOf, setDetailOf] = useState<StockRow | null>(null);
  // `deducting` holds the product; `deductAny` opens the picker version.
  const [deducting, setDeducting] = useState<StockRow | null>(null);
  const [deductAny, setDeductAny] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [toggling, setToggling] = useState<StockRow | null>(null);
  const [togglePending, startToggle] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);

  const reload = useCallback((s: string, f: StockFilter, d: string) => {
    startTransition(async () => {
      try {
        const [list, sum] = await Promise.all([
          getStock({ search: s, filter: f, day: d }),
          getStockSummary(d),
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
    const t = setTimeout(() => reload(search, filter, day), 250);
    return () => clearTimeout(t);
  }, [search, filter, day, reload]);

  useEffect(() => { setPage(1); }, [search, filter, day]);

  const refresh = useCallback(() => reload(search, filter, day), [reload, search, filter, day]);

  // Stock moves from three places: a POS sale, a purchase, and a manual
  // deduction. All three push here.
  useRealtime(["stock", "purchases", "orders"], refresh);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage]
  );

  const isToday = day === todayISO();

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1 className="text-xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
            Stock
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Sales deduct stock automatically. Tap a product for its full history.
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => setLinksOpen(true)}>
            <Link2 size={14} /> Menu links
          </Button>
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setDeductAny(true)}>
              <Minus size={14} /> Manual deduction
            </Button>
          )}
          {canManage && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add product
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 my-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard label="Inventory value" value={money(summary.inventoryValue)} />
        <StatCard label="Products" value={String(summary.productCount)} />
        <StatCard label="Low stock" value={String(summary.lowCount)} tone={summary.lowCount > 0 ? "#f97316" : undefined} />
        <StatCard label="Out of stock" value={String(summary.outCount)} tone={summary.outCount > 0 ? "#dc2626" : undefined} />
      </div>

      {summary.unlinkedMenuItems > 0 && (
        <button
          type="button"
          onClick={() => setLinksOpen(true)}
          className="w-full rounded-lg border px-3 py-2.5 flex items-start gap-2 mb-4 text-left"
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            <span className="font-medium">{summary.unlinkedMenuItems} menu item
            {summary.unlinkedMenuItems !== 1 ? "s aren't" : " isn't"} linked to a product.</span>{" "}
            Selling {summary.unlinkedMenuItems !== 1 ? "them" : "it"} won&apos;t change stock. Tap to review.
          </p>
        </button>
      )}

      {/* Day picker + search */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-ink-mute)" }} />
          <Input
            type="search"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <input
          type="date"
          value={day}
          max={todayISO()}
          onChange={(e) => setDay(e.target.value || todayISO())}
          className="text-sm rounded-lg border px-3 py-2"
          style={{
            background: isToday ? "var(--color-canvas)" : "var(--color-canvas-soft)",
            borderColor: isToday ? "var(--color-hairline)" : "var(--color-primary)",
            color: "var(--color-ink)",
          }}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto mb-4" style={{ scrollbarWidth: "none" }}>
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

      {rows.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {search || filter !== "all"
              ? "No products match that search."
              : "No products yet. Add the ingredients and goods you want to track."}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table — the whole row opens the product. */}
          <div
            className="hidden lg:block rounded-xl border overflow-x-auto"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-canvas-soft)" }}>
                  {[
                    { h: "Product", right: false },
                    { h: "Yesterday", right: true },
                    { h: "Purchased", right: true },
                    { h: "Used", right: true },
                    { h: "Final stock", right: true },
                    { h: "", right: true },
                  ].map(({ h, right }, i) => (
                    <th
                      key={h || i}
                      className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide whitespace-nowrap ${right ? "text-right" : "text-left"}`}
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
                    style={{ borderColor: "var(--color-hairline)", opacity: p.is_active ? 1 : 0.5 }}
                    onClick={() => setDetailOf(p)}
                  >
                    <td className="px-4 py-3">
                      <span style={{ color: "var(--color-ink)" }}>{p.name}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                          {p.product_code} · {p.unit}
                        </span>
                        <StatusPill status={p.status} />
                        {p.link_count === 0 ? (
                          <span className="text-[10px]" style={{ color: "var(--color-warning)" }}>unlinked</span>
                        ) : (
                          <span className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                            {p.link_count} menu item{p.link_count !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--color-ink-mute)" }}>{qty(p.opening)}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: p.purchased > 0 ? "var(--color-success)" : "var(--color-ink-mute)" }}>
                      {p.purchased > 0 ? `+${qty(p.purchased)}` : "—"}
                    </td>
                    {/* Used = what was ACTUALLY consumed: POS sales (net of anything
                        rejected or cancelled today) + manual deductions, as ONE
                        total. The split lives in the product history, not here —
                        this column is a summary. */}
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: p.used > 0 ? "var(--color-danger)" : "var(--color-ink-mute)" }}>
                      {p.used > 0 ? `−${qty(p.used)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: STOCK_STATUS_COLOR[p.status] }}>
                      {qty(p.closing)}
                      {p.added > 0 && (
                        <span className="block text-[10px] font-normal" style={{ color: "var(--color-ink-mute)" }}>
                          incl. +{qty(p.added)} added
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <>
                            <button
                              type="button"
                              title="Manual deduction"
                              onClick={() => setDeducting(p)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                            >
                              <Minus size={14} />
                            </button>
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => setEditing(p)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setToggleError(null); setToggling(p); }}
                              className="text-xs px-2 py-1 rounded-md border"
                              style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
                            >
                              {p.is_active ? "Deactivate" : "Reactivate"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <div className="lg:hidden flex flex-col gap-2">
            {pageRows.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border px-4 py-3"
                style={{
                  background: "var(--color-canvas)",
                  borderColor: "var(--color-hairline)",
                  opacity: p.is_active ? 1 : 0.6,
                }}
              >
                <button type="button" onClick={() => setDetailOf(p)} className="w-full text-left">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{p.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                        {p.product_code} · {p.unit}
                        {p.link_count > 0 && ` · ${p.link_count} menu item${p.link_count !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium tabular-nums" style={{ color: STOCK_STATUS_COLOR[p.status] }}>
                        {qty(p.closing)}
                      </p>
                      <StatusPill status={p.status} />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                    <span>Yest {qty(p.opening)}</span>
                    <span style={{ color: p.purchased > 0 ? "var(--color-success)" : undefined }}>
                      Purch {p.purchased > 0 ? `+${qty(p.purchased)}` : "—"}
                    </span>
                    <span style={{ color: p.used > 0 ? "var(--color-danger)" : undefined }}>
                      Used {p.used > 0 ? `−${qty(p.used)}` : "—"}
                    </span>
                  </div>
                </button>

                {canManage && (
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setDeducting(p)}
                      className="flex-1 text-xs py-1.5 rounded-lg border"
                      style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                    >
                      Deduct
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="flex-1 text-xs py-1.5 rounded-lg border"
                      style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => { setToggleError(null); setToggling(p); }}
                      className="flex-1 text-xs py-1.5 rounded-lg border"
                      style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
                    >
                      {p.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                )}
              </div>
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

      {/* Modals */}
      <Modal open={creating} onClose={() => setCreating(false)} title="Add product" subtitle="An ingredient or good you want to track">
        <ProductForm onDone={() => { setCreating(false); refresh(); }} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit product" subtitle={editing?.product_code}>
        {editing && <ProductForm product={editing} onDone={() => { setEditing(null); refresh(); }} />}
      </Modal>

      <Modal
        open={!!detailOf}
        onClose={() => setDetailOf(null)}
        title={detailOf?.name ?? "Product"}
        subtitle={detailOf ? `${detailOf.product_code} · ${new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : undefined}
        wide
      >
        {detailOf && (
          <ProductDetailView
            product={detailOf}
            day={day}
            targets={targets}
            canManage={canManage}
            onChanged={refresh}
          />
        )}
      </Modal>

      {/* Manual deduction — from a row (product fixed) or the header (pick one). */}
      <Modal
        open={!!deducting || deductAny}
        onClose={() => { setDeducting(null); setDeductAny(false); }}
        title="Manual deduction"
        subtitle="Stock used or lost outside a sale"
      >
        <DeductForm
          products={products}
          preselected={deducting ?? undefined}
          onDone={() => { setDeducting(null); setDeductAny(false); refresh(); }}
        />
      </Modal>

      <Modal open={linksOpen} onClose={() => setLinksOpen(false)} title="Menu links" subtitle="What each menu item deducts when it sells" wide>
        <MenuLinks canManage={canManage} onOpenProduct={() => setLinksOpen(false)} />
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.is_active ? "Deactivate product?" : "Reactivate product?"}
        message={
          toggling?.is_active
            ? `${toggling?.name} will be hidden from stock and purchase pickers. Its history is kept and you can reactivate it any time.`
            : `${toggling?.name} will appear in stock again.`
        }
        confirmLabel={toggling?.is_active ? "Deactivate" : "Reactivate"}
        destructive={toggling?.is_active}
        pending={togglePending}
        error={toggleError}
        onCancel={() => setToggling(null)}
        onConfirm={() => {
          if (!toggling) return;
          const target = toggling;
          setToggleError(null);
          startToggle(async () => {
            const res = await setProductActive(target.id, !target.is_active);
            if (res?.error) setToggleError(res.error);
            else { setToggling(null); refresh(); }
          });
        }}
      />
    </div>
  );
}

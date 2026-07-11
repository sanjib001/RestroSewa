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
  createVendor,
  getVendorDetail,
  getVendors,
  getVendorSummary,
  payVendor,
  setVendorActive,
  updateVendor,
} from "@/app/actions/vendors";
import type {
  ActionResult,
  VendorDetail,
  VendorFilter,
  VendorRow,
  VendorSummary,
} from "@/app/actions/vendors";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ConfirmDialog } from "../../_components/modal";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Search,
  Wallet,
} from "lucide-react";

const PAGE_SIZE = 10;

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function money2(n: number) {
  return `₹${n.toFixed(2)}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  credit: "Credit",
};

const FILTERS: { key: VendorFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "owing", label: "Owed money" },
  { key: "settled", label: "Settled" },
  { key: "inactive", label: "Inactive" },
];

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: tone ?? "var(--color-ink)" }}>
        {value}
      </p>
    </div>
  );
}

// ── Create / edit form (shared shape, different action) ───────────────────────

function VendorForm({
  vendor,
  onDone,
}: {
  vendor?: VendorRow;
  onDone: () => void;
}) {
  const editing = !!vendor;
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    editing ? updateVendor : createVendor,
    null
  );

  // Both actions return null on success; watch the falling edge of `pending`.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-3">
      {editing && <input type="hidden" name="id" value={vendor.id} />}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="s_name" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Vendor name <span style={{ color: "var(--color-ruby)" }}>*</span>
        </label>
        <Input id="s_name" name="name" required autoComplete="off" placeholder="e.g. ABC Traders" defaultValue={vendor?.name ?? ""} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="s_phone" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Phone number
          </label>
          <Input id="s_phone" name="phone" type="tel" autoComplete="off" placeholder="Optional" defaultValue={vendor?.phone ?? ""} />
        </div>

        {/* Opening credit is a one-time seed and can never be edited afterwards —
            once the account is live, only purchases and payments may move it. */}
        {!editing && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="s_opening" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Already owed (₹)
            </label>
            <Input id="s_opening" name="opening_credit" type="number" min="0" step="0.01" placeholder="0.00" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="s_address" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Address
        </label>
        <Input id="s_address" name="address" autoComplete="off" placeholder="Optional" defaultValue={vendor?.address ?? ""} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="s_notes" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Notes
        </label>
        <Input id="s_notes" name="notes" autoComplete="off" placeholder="Optional" defaultValue={vendor?.notes ?? ""} />
      </div>

      {!editing && (
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Create each vendor once — the same account is reused for every future purchase.
          Use <span style={{ color: "var(--color-ink)" }}>Already owed</span> only to carry
          over dues from your existing books.
        </p>
      )}

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Create vendor"}
      </Button>
    </form>
  );
}

// ── Vendor account: history + pay ─────────────────────────────────────────────

function VendorAccount({
  vendorId,
  canManage,
  onChanged,
}: {
  vendorId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [state, action, pending] = useActionState<ActionResult, FormData>(payVendor, null);

  const load = useCallback(async () => {
    const res = await getVendorDetail(vendorId);
    if ("error" in res) setLoadError(res.error);
    else setDetail(res);
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setAmount("");
      load();
      onChanged();
    }
    wasPending.current = pending;
  }, [pending, state, load, onChanged]);

  if (loadError) {
    return (
      <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
        {loadError}
      </p>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-8" style={{ color: "var(--color-ink-mute)" }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const owed = detail.credit_balance;
  const settled = owed <= 0;
  const amountNum = parseFloat(amount) || 0;
  const amountValid = amountNum > 0 && amountNum <= owed + 0.005;

  return (
    <div className="flex flex-col gap-4">
      {/* Balance */}
      <div
        className="rounded-xl border px-4 py-3 flex flex-col gap-1.5"
        style={{
          background: settled ? "#f0fdf4" : "#fff7ed",
          borderColor: settled ? "#1a7a4a44" : "#f9731644",
        }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--color-ink-mute)" }}>Total bought from them</span>
          <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>{money2(detail.total_purchased)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--color-ink-mute)" }}>Total paid to date</span>
          <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>{money2(detail.total_paid)}</span>
        </div>
        <div
          className="flex items-center justify-between pt-1.5 border-t"
          style={{ borderColor: settled ? "#1a7a4a22" : "#f9731633" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {settled ? "Settled" : "We still owe"}
          </span>
          <span className="text-lg font-medium tabular-nums" style={{ color: settled ? "#1a7a4a" : "#9a3412" }}>
            {money2(owed)}
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
        <div className="flex justify-between gap-3">
          <span>Vendor ID</span>
          <span style={{ color: "var(--color-ink)" }}>{detail.vendor_code}</span>
        </div>
        {detail.phone && (
          <div className="flex justify-between gap-3">
            <span>Phone</span>
            <a href={`tel:${detail.phone}`} style={{ color: "var(--color-primary)" }}>{detail.phone}</a>
          </div>
        )}
        {detail.address && (
          <div className="flex justify-between gap-3">
            <span>Address</span>
            <span className="text-right" style={{ color: "var(--color-ink)" }}>{detail.address}</span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span>Added</span>
          <span style={{ color: "var(--color-ink)" }}>
            {new Date(detail.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}
            {detail.created_by_name ? ` · ${detail.created_by_name}` : ""}
          </span>
        </div>
        {detail.notes && (
          <div className="flex justify-between gap-3">
            <span>Notes</span>
            <span className="text-right" style={{ color: "var(--color-ink)" }}>{detail.notes}</span>
          </div>
        )}
      </div>

      {/* Pay the vendor */}
      {canManage && !settled && (
        <form
          action={action}
          className="rounded-xl border px-4 py-4 flex flex-col gap-3"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <input type="hidden" name="vendor_id" value={detail.id} />
          <input type="hidden" name="method" value={method} />

          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Pay this vendor</p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay_amount" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>₹</span>
              <Input
                id="pay_amount"
                name="amount"
                type="number"
                min="0.01"
                max={owed}
                step="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7"
              />
            </div>
            <button
              type="button"
              onClick={() => setAmount(owed.toFixed(2))}
              className="self-start text-xs underline"
              style={{ color: "var(--color-primary)" }}
            >
              Settle in full ({money2(owed)})
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>Paid by</p>
            <div className="grid grid-cols-2 gap-1">
              {["cash", "online"].map((m) => {
                const active = method === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className="py-1.5 rounded-lg border text-sm transition-colors"
                    style={{
                      borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                      background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                      color: "var(--color-ink)",
                    }}
                  >
                    {METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </div>

          <Input name="notes" placeholder="Note (optional)" autoComplete="off" />

          {amount !== "" && !amountValid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              {amountNum > owed
                ? `That's more than the ${money2(owed)} outstanding.`
                : "Enter an amount greater than zero."}
            </p>
          )}

          {state?.error && (
            <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
              {state.error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={pending || !amountValid}>
            {pending ? "Recording…" : `Pay ${amountNum > 0 ? money2(amountNum) : ""}`}
          </Button>
        </form>
      )}

      {/* History */}
      <div>
        <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Account history
        </p>
        {detail.history.length === 0 ? (
          <div className="rounded-xl border px-4 py-6 text-center" style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)" }}>
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
              No activity yet. Purchases from this vendor will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
            {detail.history.map((h, i) => {
              // Opening dues and credit purchases RAISE what we owe; a payment
              // lowers it. The sign makes the running balance readable.
              const raises = h.kind === "opening" || h.kind === "purchase";
              const label =
                h.kind === "opening"
                  ? "Opening balance"
                  : h.kind === "purchase"
                  ? `Bought on credit · ${h.purchase_code}`
                  : `Paid · ${METHOD_LABEL[h.method ?? ""] ?? h.method}`;
              return (
                <div
                  key={h.id}
                  className="flex items-start gap-3 px-4 py-2.5"
                  style={{
                    borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)",
                    background: "var(--color-canvas)",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: "var(--color-ink)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {new Date(h.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      {h.staff_name ? ` · ${h.staff_name}` : ""}
                    </p>
                    {h.notes && (
                      <p className="text-xs italic mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{h.notes}</p>
                    )}
                  </div>
                  <p
                    className="text-sm font-medium tabular-nums shrink-0"
                    style={{ color: raises ? "#9a3412" : "#1a7a4a" }}
                  >
                    {raises ? "+" : "−"}{money2(h.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function VendorsClient({
  initialVendors,
  initialSummary,
  canManage,
}: {
  initialVendors: VendorRow[];
  initialSummary: VendorSummary;
  canManage: boolean;
}) {
  const [vendors, setVendors] = useState(initialVendors);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VendorFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, startTransition] = useTransition();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VendorRow | null>(null);
  const [accountOf, setAccountOf] = useState<VendorRow | null>(null);
  const [deactivating, setDeactivating] = useState<VendorRow | null>(null);
  const [deactivatePending, startDeactivate] = useTransition();
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const reload = useCallback((s: string, f: VendorFilter) => {
    startTransition(async () => {
      try {
        const [rows, sum] = await Promise.all([
          getVendors({ search: s, filter: f }),
          getVendorSummary(),
        ]);
        setVendors(rows);
        setSummary(sum);
      } catch {
        // keep the last known list on a transient failure
      }
    });
  }, []);

  // Debounced search / filter; skips the first run (the server already rendered).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => reload(search, filter), 250);
    return () => clearTimeout(t);
  }, [search, filter, reload]);

  // A shorter list can leave the current page out of range.
  useEffect(() => { setPage(1); }, [search, filter]);

  const refresh = useCallback(() => reload(search, filter), [reload, search, filter]);

  // A purchase on credit raises a vendor balance — that must show up here live.
  useRealtime(["vendors", "purchases"], refresh);

  const pageCount = Math.max(1, Math.ceil(vendors.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => vendors.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [vendors, safePage]
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="text-xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
            Vendors
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Vendors you buy stock from, and what you still owe them.
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="shrink-0">
            <Plus size={14} /> New vendor
          </Button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 my-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard label="Active vendors" value={String(summary.activeCount)} />
        <StatCard
          label="Total outstanding"
          value={money(summary.outstanding)}
          tone={summary.outstanding > 0 ? "#dc2626" : undefined}
        />
        <StatCard label="Vendors owed money" value={String(summary.owingCount)} />
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-ink-mute)" }} />
          <Input
            type="search"
            placeholder="Search by vendor ID, name or phone…"
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

      {/* List */}
      {vendors.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {search || filter !== "all"
              ? "No vendors match that search."
              : "No vendors yet. Add each vendor once, then reuse them for every purchase."}
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
                  {["Vendor ID", "Name", "Phone", "Outstanding", ""].map((h, i) => (
                    <th
                      key={h || i}
                      className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide ${i === 3 ? "text-right" : "text-left"}`}
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => (
                  <tr key={s.id} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                    <td className="px-4 py-3 tabular-nums" style={{ color: "var(--color-ink-mute)" }}>{s.vendor_code}</td>
                    <td className="px-4 py-3" style={{ color: "var(--color-ink)", opacity: s.is_active ? 1 : 0.5 }}>
                      <button type="button" onClick={() => setAccountOf(s)} className="hover:underline text-left">
                        {s.name}
                      </button>
                      {!s.is_active && <span className="ml-2 text-xs" style={{ color: "var(--color-ink-mute)" }}>inactive</span>}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--color-ink-mute)" }}>{s.phone ?? "—"}</td>
                    <td
                      className="px-4 py-3 text-right tabular-nums font-medium"
                      style={{ color: s.credit_balance > 0 ? "#dc2626" : "var(--color-ink-mute)" }}
                    >
                      {s.credit_balance > 0 ? money2(s.credit_balance) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Account & payments"
                          onClick={() => setAccountOf(s)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                        >
                          <Wallet size={14} />
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => setEditing(s)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => { setDeactivateError(null); setDeactivating(s); }}
                            className="text-xs px-2 py-1 rounded-md border"
                            style={{
                              color: s.is_active ? "var(--color-ink-mute)" : "#1a7a4a",
                              borderColor: "var(--color-hairline)",
                            }}
                          >
                            {s.is_active ? "Deactivate" : "Reactivate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-2">
            {pageRows.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border px-4 py-3"
                style={{
                  background: "var(--color-canvas)",
                  borderColor: "var(--color-hairline)",
                  opacity: s.is_active ? 1 : 0.6,
                }}
              >
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => setAccountOf(s)} className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{s.name}</p>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-mute)" }}>
                      {s.vendor_code}{s.phone ? ` · ${s.phone}` : ""}
                    </p>
                  </button>
                  <div className="text-right shrink-0">
                    <p
                      className="text-sm font-medium tabular-nums"
                      style={{ color: s.credit_balance > 0 ? "#dc2626" : "var(--color-ink-mute)" }}
                    >
                      {s.credit_balance > 0 ? money(s.credit_balance) : "Settled"}
                    </p>
                    {s.credit_balance > 0 && (
                      <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>outstanding</p>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setAccountOf(s)}
                      className="flex-1 text-xs py-1.5 rounded-lg border"
                      style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                    >
                      Account
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="flex-1 text-xs py-1.5 rounded-lg border"
                      style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeactivateError(null); setDeactivating(s); }}
                      className="flex-1 text-xs py-1.5 rounded-lg border"
                      style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
                    >
                      {s.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, vendors.length)} of {vendors.length}
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

      {/* Create */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New vendor"
        subtitle="Create this vendor once — reuse them for every purchase"
      >
        <VendorForm onDone={() => { setCreating(false); refresh(); }} />
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit vendor"
        subtitle={editing?.vendor_code}
      >
        {editing && (
          <VendorForm
            vendor={editing}
            onDone={() => { setEditing(null); refresh(); }}
          />
        )}
      </Modal>

      {/* Account */}
      <Modal
        open={!!accountOf}
        onClose={() => setAccountOf(null)}
        title={accountOf?.name ?? "Vendor"}
        subtitle={accountOf ? `${accountOf.vendor_code} · credit account` : undefined}
      >
        {accountOf && (
          <VendorAccount vendorId={accountOf.id} canManage={canManage} onChanged={refresh} />
        )}
      </Modal>

      {/* Deactivate / reactivate */}
      <ConfirmDialog
        open={!!deactivating}
        title={deactivating?.is_active ? "Deactivate vendor?" : "Reactivate vendor?"}
        message={
          deactivating?.is_active
            ? `${deactivating?.name} will be hidden from purchase pickers. Their history is kept, and you can reactivate them at any time.`
            : `${deactivating?.name} will be selectable for purchases again.`
        }
        confirmLabel={deactivating?.is_active ? "Deactivate" : "Reactivate"}
        destructive={deactivating?.is_active}
        pending={deactivatePending}
        error={deactivateError}
        onCancel={() => setDeactivating(null)}
        onConfirm={() => {
          if (!deactivating) return;
          const target = deactivating;
          setDeactivateError(null);
          startDeactivate(async () => {
            const res = await setVendorActive(target.id, !target.is_active);
            if (res?.error) setDeactivateError(res.error);
            else {
              setDeactivating(null);
              refresh();
            }
          });
        }}
      />
    </div>
  );
}

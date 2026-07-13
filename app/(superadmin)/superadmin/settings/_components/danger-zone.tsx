"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteRestaurantSetup,
  getRestaurantSummary,
  resetRestaurantFinance,
  setOpeningBalanceFor,
} from "@/app/actions/danger-zone";
import type { RestaurantSummary } from "@/app/actions/danger-zone";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, RotateCcw, Trash2, X } from "lucide-react";

const RUBY = "#b42318";
const AMBER = "#b45309";
const GREEN = "#1a7a4a";

const money = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const count = (n: number) => Number(n ?? 0).toLocaleString("en-IN");

// ─── Shell ───────────────────────────────────────────────────────────────────

function Modal({
  title,
  tone,
  onClose,
  children,
}: {
  title: string;
  tone: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Escape closes. On a dialog this destructive, the cheapest possible exit
  // matters more than it does anywhere else in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[86vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border shadow-xl"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <div
          className="sticky top-0 flex items-center gap-2.5 px-5 py-4 border-b"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <AlertTriangle size={17} style={{ color: tone }} className="shrink-0" />
          <p className="text-sm font-medium flex-1" style={{ color: "var(--color-ink)" }}>
            {title}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// A list of what is about to happen, with real numbers against it.
function Ledger({
  heading,
  tone,
  rows,
}: {
  heading: string;
  tone: string;
  rows: [string, string][];
}) {
  if (!rows.length) return null;
  return (
    <div className="mb-4">
      <p
        className="text-xs uppercase tracking-wide mb-1.5 font-medium"
        style={{ color: tone, letterSpacing: "0.06em" }}
      >
        {heading}
      </p>
      <div
        className="rounded-lg border divide-y"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
      >
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 px-3 py-1.5"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {label}
            </span>
            <span
              className="text-xs font-medium tabular-nums text-right"
              style={{ color: "var(--color-ink)" }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmInput({
  phrase,
  hint,
  value,
  onChange,
  tone,
}: {
  phrase: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  tone: string;
}) {
  const ok = value.trim().toLowerCase() === phrase.trim().toLowerCase();
  return (
    <div className="mb-4">
      <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
        {hint}
      </label>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={phrase}
        spellCheck={false}
        autoComplete="off"
        className="w-full h-10 rounded-sm border px-3 text-sm"
        style={{
          borderColor: ok ? tone : "var(--color-hairline-input)",
          color: "var(--color-ink)",
          background: "var(--color-canvas)",
        }}
      />
    </div>
  );
}

// ─── Reset finance & sales ───────────────────────────────────────────────────

function ResetDialog({
  s,
  onClose,
  onDone,
}: {
  s: RestaurantSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  // Opening-balance prompt, shown once the books are actually cleared.
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  const f = s.financial;
  const c = s.carried;

  const armed = typed.trim().toUpperCase() === "RESET";

  function run() {
    setError(null);
    start(async () => {
      const r = await resetRestaurantFinance(s.restaurant.id, typed);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setDone(true);
    });
  }

  function saveOpening() {
    setError(null);
    startSave(async () => {
      const r = await setOpeningBalanceFor(
        s.restaurant.id,
        Number(cash || 0),
        Number(online || 0)
      );
      if (r && "error" in r) {
        setError(r.error);
        return;
      }
      setSaved(true);
      setTimeout(onDone, 700);
    });
  }

  // ── Step 2: cleared, now seed the new opening balance ──
  if (done) {
    return (
      <Modal title="Books cleared" tone={GREEN} onClose={onDone}>
        <div className="flex items-start gap-2 mb-4">
          <Check size={16} style={{ color: GREEN }} className="mt-0.5 shrink-0" />
          <p className="text-sm" style={{ color: "var(--color-ink)" }}>
            {s.restaurant.name} is starting from a clean set of books. The menu, staff, tables,
            products, vendors and credit accounts are all untouched.
          </p>
        </div>

        <Ledger
          heading="Carried forward"
          tone={GREEN}
          rows={[
            ["Stock on hand", "Closing stock is now each product's opening stock"],
            ...(c.customer_debt > 0
              ? ([[`Owed by ${c.debtors} customer${c.debtors === 1 ? "" : "s"}`, money(c.customer_debt)]] as [string, string][])
              : []),
            ...(c.vendor_payable > 0
              ? ([[`Owed to ${c.creditors} vendor${c.creditors === 1 ? "" : "s"}`, money(c.vendor_payable)]] as [string, string][])
              : []),
          ]}
        />

        <p className="text-sm mb-3" style={{ color: "var(--color-ink)" }}>
          Set the opening balance — the cash and online money on hand as of now. This is the one
          figure the system cannot work out for itself.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {([
            ["Cash", cash, setCash],
            ["Online", online, setOnline],
          ] as const).map(([label, val, set]) => (
            <div key={label}>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                {label}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder="0"
                className="w-full h-10 rounded-sm border px-3 text-sm tabular-nums"
                style={{
                  borderColor: "var(--color-hairline-input)",
                  color: "var(--color-ink)",
                  background: "var(--color-canvas)",
                }}
              />
            </div>
          ))}
        </div>

        {error && (
          <p className="text-xs mb-3" style={{ color: RUBY }}>
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onDone}
            className="text-xs px-3 py-2 rounded-lg"
            style={{ color: "var(--color-ink-mute)" }}
          >
            I&rsquo;ll set it later in Finance
          </button>
          <Button type="button" variant="primary" disabled={saving || saved} onClick={saveOpening}>
            {saved ? "Saved" : saving ? "Saving…" : "Set opening balance"}
          </Button>
        </div>
      </Modal>
    );
  }

  // ── Step 1: confirm ──
  return (
    <Modal title={`Reset finance & sales — ${s.restaurant.name}`} tone={AMBER} onClose={onClose}>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink)" }}>
        This clears every transaction on the books. The restaurant itself, and everything you set
        up in it, stays exactly as it is.
      </p>

      <Ledger
        heading="Permanently deleted"
        tone={AMBER}
        rows={[
          ["Sessions", count(f.sessions)],
          ["Orders", `${count(f.orders)} · ${count(f.order_items)} items`],
          ["Payments", `${count(f.payments)} · ${money(f.revenue)}`],
          ["Credit bills & repayments", `${count(f.credits)} · ${count(f.credit_payments)}`],
          ["Purchases", count(f.purchases)],
          ["Vendor payments", count(f.vendor_payments)],
          ["Salary payments", count(f.salary_payments)],
          ["Stock movements", count(f.stock_moves)],
          ["Room stays", count(f.room_stays)],
          ["Alerts", count(f.notifications)],
          ["Opening balance", f.has_opening ? "Cleared — you'll set a new one" : "Not set"],
        ]}
      />

      <Ledger
        heading="Carried forward, not forgiven"
        tone={GREEN}
        rows={[
          ["Stock on hand", "Closing stock becomes opening stock"],
          [
            "Owed by customers",
            c.customer_debt > 0
              ? `${money(c.customer_debt)} across ${c.debtors}`
              : "Nothing outstanding",
          ],
          [
            "Owed to vendors",
            c.vendor_payable > 0
              ? `${money(c.vendor_payable)} across ${c.creditors}`
              : "Nothing outstanding",
          ],
        ]}
      />

      <Ledger
        heading="Kept"
        tone="var(--color-ink-mute)"
        rows={[
          ["Staff & admin accounts", count(s.setup.staff)],
          ["Menu", `${count(s.setup.menu_items)} items · ${count(s.setup.variants)} variations`],
          ["Tables & rooms", `${count(s.setup.tables)} · ${count(s.setup.rooms)}`],
          ["Products & vendors", `${count(s.setup.products)} · ${count(s.setup.vendors)}`],
          ["Credit accounts", count(s.setup.credit_customers)],
        ]}
      />

      <ConfirmInput
        phrase="RESET"
        hint="Type RESET to confirm"
        value={typed}
        onChange={setTyped}
        tone={AMBER}
      />

      {error && (
        <p className="text-xs mb-3" style={{ color: RUBY }}>
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-2 rounded-lg"
          style={{ color: "var(--color-ink-mute)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!armed || pending}
          onClick={run}
          className="inline-flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-pill disabled:opacity-40 disabled:pointer-events-none"
          style={{ background: AMBER, color: "#fff" }}
        >
          <RotateCcw size={14} />
          {pending ? "Resetting…" : "Reset finance & sales"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Delete restaurant ───────────────────────────────────────────────────────

function DeleteDialog({
  s,
  onClose,
  onDeleted,
}: {
  s: RestaurantSummary;
  onClose: () => void;
  onDeleted: (name: string, warning?: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const name = s.restaurant.name;
  const armed =
    typed.trim().toLowerCase() === name.trim().toLowerCase() ||
    typed.trim().toUpperCase() === "DELETE";

  const f = s.financial;
  const c = s.carried;
  const u = s.setup;

  function run() {
    setError(null);
    start(async () => {
      const r = await deleteRestaurantSetup(s.restaurant.id, typed);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      onDeleted(r.deleted, r.warning);
    });
  }

  return (
    <Modal title={`Delete ${name} permanently`} tone={RUBY} onClose={onClose}>
      <div
        className="rounded-lg border px-3 py-2.5 mb-4"
        style={{ borderColor: RUBY + "55", background: RUBY + "0d" }}
      >
        <p className="text-sm font-medium" style={{ color: RUBY }}>
          This is permanent and cannot be undone.
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink)" }}>
          {name} is erased from the system entirely. There is no backup, no archive and no way to
          bring it back. Every login stops working immediately.
        </p>
      </div>

      <Ledger
        heading="Erased"
        tone={RUBY}
        rows={[
          ["Restaurant profile & settings", name],
          ["Staff & admin logins", count(u.staff)],
          [
            "Menu",
            `${count(u.menu_categories)} categories · ${count(u.menu_items)} items · ${count(u.variants)} variations`,
          ],
          ["Tables & groups", `${count(u.tables)} · ${count(u.table_groups)}`],
          ["Rooms", count(u.rooms)],
          ["Workstations", count(u.workstations)],
          ["Stock products", count(u.products)],
          ["Vendors", count(u.vendors)],
          ["Credit accounts", count(u.credit_customers)],
          ["Sales & orders", `${count(f.sessions)} sessions · ${count(f.orders)} orders`],
          ["Payments taken", `${count(f.payments)} · ${money(f.revenue)}`],
          ["Purchases & vendor payments", `${count(f.purchases)} · ${count(f.vendor_payments)}`],
          ["Salary payments", count(f.salary_payments)],
          ["QR codes & logo", "Deleted"],
        ]}
      />

      {(c.customer_debt > 0 || c.vendor_payable > 0) && (
        <Ledger
          heading="Money that will never be recorded again"
          tone={RUBY}
          rows={[
            ...(c.customer_debt > 0
              ? ([[`Owed by ${c.debtors} customer${c.debtors === 1 ? "" : "s"}`, money(c.customer_debt)]] as [string, string][])
              : []),
            ...(c.vendor_payable > 0
              ? ([[`Owed to ${c.creditors} vendor${c.creditors === 1 ? "" : "s"}`, money(c.vendor_payable)]] as [string, string][])
              : []),
          ]}
        />
      )}

      <ConfirmInput
        phrase={name}
        hint={`Type the restaurant's name — ${name} — to confirm`}
        value={typed}
        onChange={setTyped}
        tone={RUBY}
      />

      {error && (
        <p className="text-xs mb-3" style={{ color: RUBY }}>
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-2 rounded-lg"
          style={{ color: "var(--color-ink-mute)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!armed || pending}
          onClick={run}
          className="inline-flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-pill disabled:opacity-40 disabled:pointer-events-none"
          style={{ background: RUBY, color: "#fff" }}
        >
          <Trash2 size={14} />
          {pending ? "Deleting…" : `Delete ${name}`}
        </button>
      </div>
    </Modal>
  );
}

// ─── The zone ────────────────────────────────────────────────────────────────

export function DangerZone({
  restaurantId,
  restaurantName,
  onDeleted,
}: {
  restaurantId: string;
  restaurantName: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState<"reset" | "delete" | null>(null);
  const [summary, setSummary] = useState<RestaurantSummary | null>(null);
  const [loading, startLoad] = useTransition();
  const [flash, setFlash] = useState<{ text: string; warning?: string } | null>(null);

  // The counts are fetched when the dialog opens, not held from page load — the
  // warning has to describe the restaurant as it is NOW, not as it was when the
  // super admin wandered onto this page twenty minutes ago.
  function openDialog(which: "reset" | "delete") {
    setSummary(null);
    setFlash(null);
    startLoad(async () => {
      const s = await getRestaurantSummary(restaurantId);
      if (!s) return;
      setSummary(s);
      setOpen(which);
    });
  }

  function close() {
    setOpen(null);
    setSummary(null);
  }

  return (
    <div
      className="rounded-xl border px-5 py-4"
      style={{ background: "var(--color-canvas)", borderColor: RUBY + "44" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={15} style={{ color: RUBY }} />
        <p className="text-sm font-medium" style={{ color: RUBY }}>
          Danger zone
        </p>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Destructive actions on {restaurantName}. Both ask you to type a confirmation, and both show
        exactly what they will destroy before you do.
      </p>

      {flash && (
        <div
          className="rounded-lg border px-3 py-2.5 mb-4"
          style={{ borderColor: GREEN + "55", background: GREEN + "0d" }}
        >
          <p className="text-sm" style={{ color: GREEN }}>
            {flash.text}
          </p>
          {flash.warning && (
            <p className="text-xs mt-1" style={{ color: AMBER }}>
              {flash.warning}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {(
          [
            {
              key: "reset" as const,
              tone: AMBER,
              icon: <RotateCcw size={13} />,
              title: "Reset Finance & Sales Data",
              body: "Clears sales, billing, payments, credits, purchases, salary payments and the finance reports. Keeps the menu, staff, tables, products, vendors and credit accounts. Stock on hand and outstanding balances carry forward.",
              cta: "Reset",
            },
            {
              key: "delete" as const,
              tone: RUBY,
              icon: <Trash2 size={13} />,
              title: "Delete Restaurant Setup",
              body: "Removes the restaurant and everything in it — accounts, menu, tables, stock, vendors, orders, sales, QR codes and logo. Permanent, with no way back.",
              cta: "Delete",
            },
          ]
        ).map((a) => (
          <div
            key={a.key}
            className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border px-4 py-3"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {a.title}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                {a.body}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openDialog(a.key)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border shrink-0 disabled:opacity-50"
              style={{ color: a.tone, borderColor: a.tone + "55", background: a.tone + "0f" }}
            >
              {a.icon}
              {loading ? "…" : a.cta}
            </button>
          </div>
        ))}
      </div>

      {open === "reset" && summary && (
        <ResetDialog
          s={summary}
          onClose={close}
          onDone={() => {
            close();
            setFlash({ text: "Finance and sales data was reset." });
          }}
        />
      )}

      {open === "delete" && summary && (
        <DeleteDialog
          s={summary}
          onClose={close}
          onDeleted={(name, warning) => {
            close();
            setFlash({ text: `${name} was permanently deleted.`, warning });
            onDeleted();
          }}
        />
      )}
    </div>
  );
}

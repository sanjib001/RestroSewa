"use client";

// Stock & Finance → Extra Expenses.
//
// The overheads a restaurant pays that are neither stock nor wages: rent, the
// power bill, the water tanker. Every row here is money that has ALREADY left —
// there is no "unpaid" state to chase, which is why this screen is a log with an
// add form and nothing else.
//
// Periods resolve server-side through the same `periodBounds` the Finance report
// uses, so "This Month" here and "This Month" there always cover the same hours.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  addExtraExpense,
  addSaving,
  closeSavingTitle,
  createSavingTitle,
  deleteSavingTitle,
  reopenSavingTitle,
  listExtraExpenses,
  listSavings,
  listSavingTitles,
  renameSavingTitle,
  withdrawSaving,
} from "@/app/actions/expenses";
import { removeExtraExpense, updateExtraExpense } from "@/app/actions/security";
import { SPENDING_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/lib/expenses";
import type { ExpenseCategory, ExtraExpense, SavingTitle } from "@/lib/expenses";
import { PERIOD_LABEL } from "@/lib/finance";
import type { FinancePeriod } from "@/lib/finance";
import type { HistoryPeriod } from "@/lib/history-period";
import { PeriodFilter } from "@/components/ui/period-filter";
import { Button } from "@/components/ui/button";
import { Modal } from "../../_components/modal";
import {
  Plus,
  Receipt,
  Pencil,
  Trash2,
  PiggyBank,
  ChevronDown,
  ChevronRight,
  ArrowUpFromLine,
} from "lucide-react";

const PERIODS: FinancePeriod[] = ["today", "yesterday", "week", "month", "year"];

const money2 = (n: number) =>
  `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + online",
};

const inputClass = "w-full h-10 rounded-sm border px-3 text-sm";
const inputStyle = {
  borderColor: "var(--color-hairline-input)",
  background: "var(--color-canvas)",
  color: "var(--color-ink)",
};

// ── The amount + tender fields, shared by the add form and the edit modal ─────
// One component so the two cannot disagree about what a valid split is — the
// same reason `AdvanceFields` exists on the room side. The server re-derives the
// split from these inputs regardless (`resolveExpenseSplit`), so nothing here is
// a security boundary.

function AmountAndTender({
  initialAmount = "",
  initialMethod = "cash",
  initialCash = "",
  initialOnline = "",
  onValidChange,
}: {
  initialAmount?: string;
  initialMethod?: string;
  initialCash?: string;
  initialOnline?: string;
  onValidChange?: (valid: boolean) => void;
}) {
  const [amount, setAmount] = useState(initialAmount);
  const [method, setMethod] = useState(initialMethod);
  const [cash, setCash] = useState(initialCash);
  const [online, setOnline] = useState(initialOnline);

  const amountNum = parseFloat(amount) || 0;
  const cashNum = parseFloat(cash) || 0;
  const onlineNum = parseFloat(online) || 0;

  // Typing one half fills the other, so the pair always totals the amount.
  function handleCash(v: string) {
    setCash(v);
    const n = parseFloat(v);
    setOnline(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((amountNum - n) * 100) / 100).toFixed(2) : ""
    );
  }
  function handleOnline(v: string) {
    setOnline(v);
    const n = parseFloat(v);
    setCash(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((amountNum - n) * 100) / 100).toFixed(2) : ""
    );
  }
  // A new amount strands any split typed against the old one.
  function handleAmount(v: string) {
    setAmount(v);
    setCash("");
    setOnline("");
  }

  const mixedOk =
    method !== "mixed" ||
    amountNum === 0 ||
    (cash !== "" && online !== "" && Math.abs(cashNum + onlineNum - amountNum) < 0.01);
  const valid = amountNum > 0 && mixedOk;

  const [lastReported, setLastReported] = useState<boolean | null>(null);
  if (onValidChange && lastReported !== valid) {
    setLastReported(valid);
    onValidChange(valid);
  }

  return (
    <>
      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Amount
        </label>
        <input
          name="amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => handleAmount(e.target.value)}
          placeholder="0.00"
          className={inputClass + " tabular-nums"}
          style={inputStyle}
        />
      </div>

      <input type="hidden" name="method" value={method} />
      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Paid by
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(["cash", "online", "mixed"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                setCash("");
                setOnline("");
              }}
              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: method === m ? "var(--color-primary)" : "var(--color-hairline)",
                background: method === m ? "var(--color-primary)" : "var(--color-canvas)",
                color: method === m ? "#fff" : "var(--color-ink)",
              }}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {method === "mixed" && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["Cash", "cash_amount", cash, handleCash],
              ["Online", "online_amount", online, handleOnline],
            ] as const
          ).map(([label, name, val, set]) => (
            <div key={name}>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                {label}
              </label>
              <input
                name={name}
                type="number"
                min="0"
                max={amountNum}
                step="0.01"
                inputMode="decimal"
                value={val}
                onChange={(e) => set(e.target.value)}
                className={inputClass + " tabular-nums"}
                style={inputStyle}
              />
            </div>
          ))}
          {!mixedOk && (
            <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
              Cash and Online must add up to {money2(amountNum)}.
            </p>
          )}
        </div>
      )}
    </>
  );
}

// `saving` is absent from SPENDING_CATEGORIES on purpose — a saving needs a pot,
// which this control cannot offer. Savings are recorded from the Saving tab.
function CategorySelect({ value }: { value?: ExpenseCategory }) {
  return (
    <div>
      <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
        What for
      </label>
      <select
        name="category"
        defaultValue={value ?? "rent"}
        className={inputClass}
        style={inputStyle}
      >
        {SPENDING_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {EXPENSE_CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>
    </div>
  );
}

function SavingTitleSelect({
  titles,
  value,
}: {
  titles: SavingTitle[];
  value?: string | null;
}) {
  // A closed pot is retired: nothing new may be filed into it. The one it is already
  // set to stays selectable, so EDITING an old entry that belongs to a closed pot does
  // not silently re-file it somewhere else.
  const open = titles.filter((t) => !t.closedAt || t.id === value);
  return (
    <div>
      <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
        Saving
      </label>
      <select
        name="saving_title_id"
        defaultValue={value ?? open[0]?.id ?? ""}
        className={inputClass}
        style={inputStyle}
      >
        {open.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.closedAt ? " (closed)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Add ───────────────────────────────────────────────────────────────────────

function AddExpenseForm({ onDone }: { onDone: () => void }) {
  const [valid, setValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Called directly rather than through `useActionState` because the modal has to
  // close on success and stay open on failure — which means the caller needs the
  // result, not just the latest state.
  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await addExtraExpense(null, formData);
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <CategorySelect />

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Note <span style={{ opacity: 0.6 }}>(optional)</span>
        </label>
        <input
          name="note"
          placeholder="July bill, NEA"
          autoComplete="off"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <AmountAndTender onValidChange={setValid} />

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending ? "Saving…" : "Record expense"}
        </Button>
      </div>
    </form>
  );
}

// ── Savings ───────────────────────────────────────────────────────────────────
// A saving is an extra expense with a pot. It moves cash and bank exactly like
// rent does and reaches Finance as one "Saving" line — the pots themselves live
// only here, which is the point: Finance stays a summary, this page holds detail.

function AddSavingForm({ titles, onDone }: { titles: SavingTitle[]; onDone: () => void }) {
  const [valid, setValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await addSaving(null, formData);
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <SavingTitleSelect titles={titles} />

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Note <span style={{ opacity: 0.6 }}>(optional)</span>
        </label>
        <input
          name="note"
          placeholder="From August takings"
          autoComplete="off"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <AmountAndTender onValidChange={setValid} />

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending ? "Saving…" : "Add to saving"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Take money back out of a pot.
 *
 * The form is entirely in POSITIVE numbers — "withdraw 3,000" is what a person
 * means. The server negates it once, at the boundary, and stores a negative
 * saving row. Nothing in this component knows about signs.
 */
function WithdrawSavingForm({
  titles,
  onDone,
}: {
  titles: SavingTitle[];
  onDone: () => void;
}) {
  const [valid, setValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Only pots with something in them can be drawn from.
  const funded = titles.filter((t) => t.total > 0.005);
  const [titleId, setTitleId] = useState(funded[0]?.id ?? "");
  const pot = funded.find((t) => t.id === titleId) ?? funded[0];

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await withdrawSaving(null, formData);
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  if (funded.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
        None of your savings have money in them yet.
      </p>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Take from
        </label>
        <select
          name="saving_title_id"
          value={titleId}
          onChange={(e) => setTitleId(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {funded.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {money2(t.total)}
            </option>
          ))}
        </select>
        {pot && (
          <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
            Holds {money2(pot.total)} — {money2(pot.cash)} cash + {money2(pot.online)} online.
          </p>
        )}
      </div>

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Note <span style={{ opacity: 0.6 }}>(optional)</span>
        </label>
        <input
          name="note"
          placeholder="Towards the new oven"
          autoComplete="off"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <AmountAndTender onValidChange={setValid} />

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        This money comes back into your cash or bank. It is not a sale — it is your own money
        returning, so it lowers the period&apos;s Saving figure rather than adding to income.
      </p>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending ? "Working…" : "Withdraw"}
        </Button>
      </div>
    </form>
  );
}

function NewTitleForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createSavingTitle(null, formData);
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Name
        </label>
        <input
          name="name"
          placeholder="Emergency Fund"
          maxLength={60}
          autoComplete="off"
          autoFocus
          className={inputClass}
          style={inputStyle}
        />
        <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
          A pot you file money into. You can rename it later without changing anything already
          saved under it.
        </p>
      </div>

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Already collected <span style={{ opacity: 0.7 }}>(optional)</span>
        </label>
        <input
          name="opening_amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          autoComplete="off"
          className={inputClass}
          style={inputStyle}
        />
        {/* Stated plainly because the opposite is the natural assumption, and
            getting it wrong would have someone hunting a phantom ₹50,000 hole
            in today's cash. */}
        <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
          What this pot already held before you started tracking it here. It counts towards the
          pot&apos;s balance but is <strong>not</strong> treated as money spent today — your cash,
          bank and profit figures are untouched.
        </p>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create saving"}
        </Button>
      </div>
    </form>
  );
}

function SavingPot({
  title,
  refreshVersion,
  canManage,
  canEdit,
  securityEnabled,
  onEditEntry,
  onChanged,
}: {
  title: SavingTitle;
  /** Bumped by the parent after any add/withdraw/edit — refetches this pot's
   *  history if it's open. Not the pot's own doing (it has no visibility into
   *  another pot's edits), which is why it's a prop rather than local state. */
  refreshVersion: number;
  canManage: boolean;
  canEdit: boolean;
  securityEnabled: boolean;
  onEditEntry: (e: ExtraExpense) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // This pot's OWN history filter — separate from every other pot's, and from
  // the pot's all-time BALANCE above (`title.total`), which never moves with it.
  const [period, setPeriod] = useState<HistoryPeriod>("month");
  const [date, setDate] = useState("");
  const [entries, setEntries] = useState<ExtraExpense[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Fetched lazily, on first expand — a restaurant can have several pots, and
  // fetching every one's history up front only to show a handful expanded is
  // wasted work the collapsed ones will never use.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntriesLoading(true);
    listSavings(title.id, title.todayOnly ? "today" : period, title.todayOnly ? null : date || null)
      .then((rows) => { if (!cancelled) setEntries(rows); })
      .finally(() => { if (!cancelled) setEntriesLoading(false); });
    return () => { cancelled = true; };
  }, [open, period, date, title.id, title.todayOnly, refreshVersion]);

  function rename() {
    setError(null);
    startTransition(async () => {
      const res = await renameSavingTitle(title.id, name);
      if (res && "error" in res) setError(res.error);
      else {
        setRenaming(false);
        onChanged();
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteSavingTitle(title.id);
      if (res && "error" in res) setError(res.error);
      else onChanged();
    });
  }

  function close() {
    setError(null);
    startTransition(async () => {
      const res = await closeSavingTitle(title.id);
      if (res && "error" in res) setError(res.error);
      else onChanged();
    });
  }

  function reopen() {
    setError(null);
    startTransition(async () => {
      const res = await reopenSavingTitle(title.id);
      if (res && "error" in res) setError(res.error);
      else onChanged();
    });
  }

  // What may be done with this pot.
  //
  // ⚠️ Keyed on the BALANCE, not on the entry count — that confusion is the bug this
  // replaced. A pot deposited into and fully withdrawn holds nothing, and used to be
  // stuck on the screen forever with "This saving has money in it".
  //
  // Hidden entirely for the add-only holder (`todayOnly`), whose `total` is today's
  // net contribution rather than the pot's balance — retiring a pot on the strength of
  // a number that does not mean what it looks like is exactly the wrong outcome.
  const isEmpty = !title.todayOnly && Math.abs(title.total) < 0.005;
  const canDelete = !title.todayOnly && title.entryCount === 0 && isEmpty;
  const canClose = !title.todayOnly && !title.closedAt && title.entryCount > 0 && isEmpty;

  return (
    <div style={{ borderTop: "1px solid var(--color-hairline)" }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          {open ? (
            <ChevronDown size={15} style={{ color: "var(--color-ink-mute)" }} />
          ) : (
            <ChevronRight size={15} style={{ color: "var(--color-ink-mute)" }} />
          )}
          <span className="min-w-0">
            <span
              className="text-sm block truncate"
              style={{ color: title.closedAt ? "var(--color-ink-mute)" : "var(--color-ink)" }}
            >
              {title.name}
              {/* A retired pot stays visible so its history is reachable, but it must
                  not look like somewhere money can still go. */}
              {title.closedAt && (
                <span
                  className="ml-1.5 px-1 rounded align-middle"
                  style={{
                    fontSize: "9px",
                    lineHeight: "14px",
                    background: "var(--color-canvas-soft)",
                    color: "var(--color-ink-mute)",
                    letterSpacing: "0.04em",
                  }}
                >
                  CLOSED
                </span>
              )}
            </span>
            <span className="text-xs" style={{ color: "var(--color-ink-mute)", opacity: 0.8 }}>
              {title.todayOnly
                ? // The add-only holder never sees a running balance. The figure
                  // beside this line is TODAY's net, and it says so — an
                  // unlabelled number here would read as the pot's size.
                  title.entryCount === 0
                  ? "Nothing added today"
                  : `${title.entryCount} today · ${money2(title.cash)} cash + ${money2(
                      title.online
                    )} online`
                : title.entryCount === 0 && title.openingAmount === 0
                  ? "Nothing saved yet"
                  : [
                      title.entryCount > 0 &&
                        `${title.entryCount} ${title.entryCount === 1 ? "entry" : "entries"}`,
                      // Named explicitly, because the balance otherwise refuses
                      // to equal cash + online and looks like an arithmetic bug.
                      title.openingAmount > 0 &&
                        `${money2(title.openingAmount)} already collected`,
                      title.entryCount > 0 &&
                        `${money2(title.cash)} cash + ${money2(title.online)} online since`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
            </span>
          </span>
        </button>
        <span className="shrink-0 text-right">
          <span className="text-base tabular-nums block" style={{ color: "var(--color-ink)" }}>
            {money2(title.total)}
          </span>
          {title.todayOnly && (
            <span className="text-xs block" style={{ color: "var(--color-ink-mute)" }}>
              today
            </span>
          )}
        </span>
      </div>

      {open && (
        <div className="pb-2">
          {/* This pot's OWN filter — not the add-only view, which has no period
              concept at all (see `title.todayOnly` above). */}
          {!title.todayOnly && (
            <div className="px-4 pb-2 pl-11">
              <PeriodFilter value={period} onChange={setPeriod} date={date} onDateChange={setDate} />
            </div>
          )}

          {entriesLoading ? (
            <p className="text-xs px-4 pb-2 pl-11" style={{ color: "var(--color-ink-mute)" }}>
              Loading…
            </p>
          ) : entries.length === 0 ? (
            <p className="text-xs px-4 pb-2 pl-11" style={{ color: "var(--color-ink-mute)" }}>
              {period === "all" && !date
                ? "No money has been filed into this saving yet."
                : "Nothing in this period."}
            </p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-1.5 pl-11">
                <span className="text-xs min-w-0" style={{ color: "var(--color-ink-mute)" }}>
                  {new Date(e.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                  {" · "}
                  {e.amount < 0 ? "Withdrawn" : "Added"}
                  {" · "}
                  {METHOD_LABEL[e.method] ?? e.method}
                  {e.note && <span className="block truncate">{e.note}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {/* Money OUT of the business is red; a withdrawal is money
                      coming back, so it reads green like any other inflow. */}
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: e.amount < 0 ? "#1a7a4a" : "#dc2626" }}
                  >
                    {e.amount < 0 ? `+${money2(Math.abs(e.amount))}` : money2(e.amount)}
                  </span>
                  {canEdit && securityEnabled && (
                    <button
                      type="button"
                      onClick={() => onEditEntry(e)}
                      aria-label="Edit saving entry"
                      className="p-1 rounded-md"
                      style={{ color: "var(--color-ink-mute)" }}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </span>
              </div>
            ))
          )}

          {canManage && (
            <div className="px-4 pl-11 pt-1 flex flex-wrap items-center gap-2">
              {renaming ? (
                <>
                  <input
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                    maxLength={60}
                    className="h-8 rounded-sm border px-2 text-xs"
                    style={inputStyle}
                  />
                  <Button type="button" size="sm" onClick={rename} disabled={pending}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRenaming(false);
                      setName(title.name);
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    className="text-xs underline"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    Rename
                  </button>
                  {/* A pot that never held anything has no history to protect, so it
                      is genuinely deleted. The FK is `on delete restrict`, so this
                      cannot strand entries even if the gate were bypassed. */}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={remove}
                      disabled={pending}
                      className="text-xs underline"
                      style={{ color: "var(--color-ruby)" }}
                    >
                      Delete
                    </button>
                  )}
                  {/* Emptied, but it has history. Its saving rows are dated cash
                      movements Finance has already counted, so they stay — only the
                      pot is retired. */}
                  {canClose && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !confirm(
                            `Close "${title.name}"?\n\nIt is empty, so it comes off the list ` +
                              `and can't be filed into any more. Its ${title.entryCount} past ` +
                              `entr${title.entryCount === 1 ? "y stays" : "ies stay"} in Finance, ` +
                              `unchanged. You can reopen it later.`
                          )
                        )
                          return;
                        close();
                      }}
                      disabled={pending}
                      className="text-xs underline"
                      style={{ color: "var(--color-ruby)" }}
                    >
                      Close
                    </button>
                  )}
                  {title.closedAt && (
                    <button
                      type="button"
                      onClick={reopen}
                      disabled={pending}
                      className="text-xs underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      Reopen
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs px-4 pl-11 pt-1" style={{ color: "var(--color-ruby)" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Edit / delete (Security PIN) ──────────────────────────────────────────────

function EditExpenseForm({
  expense,
  titles,
  onDone,
}: {
  expense: ExtraExpense;
  titles: SavingTitle[];
  onDone: () => void;
}) {
  // A saving stays a saving: it swaps the category picker for a pot picker. The
  // server refuses to convert between the two, and a DB constraint makes the
  // mismatched state unrepresentable anyway.
  const isSaving = expense.category === "saving";
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
    const method = String(formData.get("method") ?? "cash");
    const cash =
      method === "cash" ? amount
      : method === "online" ? 0
      : parseFloat(String(formData.get("cash_amount") ?? "0")) || 0;
    const online =
      method === "online" ? amount
      : method === "cash" ? 0
      : parseFloat(String(formData.get("online_amount") ?? "0")) || 0;

    startTransition(async () => {
      const res = await updateExtraExpense(pin, expense.id, {
        category: isSaving ? "saving" : String(formData.get("category") ?? expense.category),
        note: String(formData.get("note") ?? "").trim() || null,
        amount,
        method,
        cash,
        online,
        savingTitleId: isSaving
          ? String(formData.get("saving_title_id") ?? expense.savingTitleId ?? "")
          : null,
      });
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeExtraExpense(pin, expense.id);
      if (res && "error" in res) setError(res.error);
      else onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      {isSaving ? (
        <SavingTitleSelect titles={titles} value={expense.savingTitleId} />
      ) : (
        <CategorySelect value={expense.category} />
      )}

      <div>
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Note <span style={{ opacity: 0.6 }}>(optional)</span>
        </label>
        <input
          name="note"
          defaultValue={expense.note ?? ""}
          autoComplete="off"
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {/* Absolute values throughout: a withdrawal is stored negative, but nobody
          edits "minus three thousand". The server re-applies the sign from the
          row being edited, so it cannot be flipped from here. */}
      <AmountAndTender
        initialAmount={String(Math.abs(expense.amount))}
        initialMethod={expense.method}
        initialCash={expense.method === "mixed" ? String(Math.abs(expense.cash)) : ""}
        initialOnline={expense.method === "mixed" ? String(Math.abs(expense.online)) : ""}
        onValidChange={setValid}
      />

      <div className="pt-1">
        <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
          Security PIN
        </label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••"
          className={inputClass + " tracking-[0.3em]"}
          style={inputStyle}
        />
        <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
          This expense has already been counted into a day&apos;s cash balance. Every change is logged.
        </p>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}

      {confirmingDelete ? (
        <div
          className="rounded-lg border px-3 py-2.5 flex flex-col gap-2"
          style={{
            background: "var(--color-warning-bg)",
            borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)",
          }}
        >
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            Delete this {money2(Math.abs(expense.amount))}{" "}
            {expense.amount < 0 ? "withdrawal" : "expense"}? Cash for that day goes back{" "}
            {expense.amount < 0 ? "down" : "up"} by the same amount
            {expense.amount < 0 ? ", and the saving regains it" : ""}. Only the audit log will
            remember it.
          </p>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
            <Button type="button" size="sm" onClick={remove} disabled={!pin || pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 justify-between pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 size={14} /> Delete
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!valid || !pin || pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function ExpensesClient({
  initialExpenses,
  initialTitles,
  canManage,
  canEdit,
  securityEnabled,
  canAdd,
  todayOnly = false,
}: {
  initialExpenses: ExtraExpense[];
  initialTitles: SavingTitle[];
  canManage: boolean;
  canEdit: boolean;
  securityEnabled: boolean;
  /**
   * May file an expense or a saving. Wider than `canManage`: the add-only
   * permission passes here and nowhere else. Defaults to `canManage` so every
   * existing caller behaves exactly as before.
   */
  canAdd?: boolean;
  /**
   * The add-only view: today's entries, no period picker, no pot balances, no
   * withdrawals. The SERVER already enforces all of this — it forces the period
   * and never computes a running total. This flag only stops the UI offering
   * controls that would be refused anyway.
   */
  todayOnly?: boolean;
}) {
  const mayAdd = canAdd ?? canManage;
  const [tab, setTab] = useState<"expenses" | "saving">("expenses");
  const [expenses, setExpenses] = useState(initialExpenses);
  const [titles, setTitles] = useState(initialTitles);
  const [period, setPeriod] = useState<FinancePeriod>(todayOnly ? "today" : "month");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);
  const [addingTitle, setAddingTitle] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [editing, setEditing] = useState<ExtraExpense | null>(null);
  // Bumped after any add/withdraw/edit so every OPEN pot refetches its own
  // history — each pot owns its own filter now, so there is no single "the
  // savings list" to refresh from here.
  const [savingsVersion, setSavingsVersion] = useState(0);

  // A picked calendar day rides on the EXISTING "custom" period — `periodBounds`
  // already resolves `custom` with `from === to` to exactly one business day, so
  // this needed no new plumbing, just `from`/`to` both set to the same date.
  const load = useCallback(async (p: FinancePeriod, d: string) => {
    setLoading(true);
    try {
      setExpenses(
        d ? await listExtraExpenses({ period: "custom", from: d, to: d }) : await listExtraExpenses({ period: p })
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTitles = useCallback(async () => {
    setTitles(await listSavingTitles());
  }, []);

  const firstRender = useRef(true);
  useEffect(() => {
    if (todayOnly) return; // the period is fixed; the server sent today already
    if (firstRender.current) { firstRender.current = false; return; } // the server already sent this one
    load(period, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, date, todayOnly]);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const cash = expenses.reduce((s, e) => s + e.cash, 0);
  const online = expenses.reduce((s, e) => s + e.online, 0);

  // Signed rows mean these are already NET of withdrawals — nothing to subtract.
  const savedTotal = titles.reduce((s, t) => s + t.total, 0);
  const savedCash = titles.reduce((s, t) => s + t.cash, 0);
  const savedOnline = titles.reduce((s, t) => s + t.online, 0);
  const hasFundedPot = titles.some((t) => t.total > 0.005);

  const showSaving = tab === "saving";

  async function afterChange() {
    setAdding(false);
    setAddingSaving(false);
    setAddingTitle(false);
    setWithdrawing(false);
    setEditing(null);
    // Both lists move together: a saving is an expense row, so an edit can change
    // either view's totals. Pot histories aren't fetched here (each pot owns its
    // own) — bumping the version tells every open one to refetch itself.
    await Promise.all([load(period, date), loadTitles()]);
    setSavingsVersion((v) => v + 1);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1
            className="text-2xl"
            style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
          >
            Extra Expenses
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {showSaving
              ? "Money set aside, by pot — all time"
              : "Rent, electricity and other overheads"}
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        {mayAdd && !showSaving && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add expense
          </Button>
        )}
        {mayAdd && showSaving && (
          <div className="flex flex-wrap gap-2">
            {/* Creating a pot, and taking money OUT of one, stay on the manage
                right. "Add Expenses & Saving" adds — it does not withdraw, and
                it does not decide what the pots are. */}
            {canManage && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setAddingTitle(true)}>
                  <Plus size={14} /> New saving
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setWithdrawing(true)}
                  disabled={!hasFundedPot}
                >
                  <ArrowUpFromLine size={14} /> Withdraw
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setAddingSaving(true)} disabled={titles.length === 0}>
              <PiggyBank size={14} /> Add money
            </Button>
          </div>
        )}
      </div>

      {/* Two views of the same table. Savings are excluded from the Expenses list
          because they appear here, grouped by pot — showing them in both would be
          the same money listed twice. */}
      <div className="flex gap-2 mt-4">
        {(
          [
            ["expenses", "Expenses"],
            ["saving", "Saving"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="text-sm px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors"
            style={{
              borderColor: tab === key ? "var(--color-primary)" : "var(--color-hairline)",
              background: tab === key ? "var(--color-primary)" : "var(--color-canvas)",
              color: tab === key ? "#fff" : "var(--color-ink)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The period picker belongs to spending only. A pot's balance is not a
          period figure — "how much is in the emergency fund" has one answer — so
          offering a period on the Saving tab would invite a misreading. */}
      {!showSaving && todayOnly && (
        // No picker: this viewer only ever sees today. Saying so beats an empty
        // gap where the periods used to be.
        <p className="text-xs my-4" style={{ color: "var(--color-ink-mute)" }}>
          Showing <strong style={{ color: "var(--color-ink)" }}>today&apos;s</strong> entries.
        </p>
      )}
      {!showSaving && !todayOnly && (
        <div className="flex flex-wrap items-center gap-2 my-4">
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => { setDate(""); setPeriod(p); }}
                className="text-sm px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors"
                style={{
                  borderColor: !date && period === p ? "var(--color-primary)" : "var(--color-hairline)",
                  background: !date && period === p ? "var(--color-primary)" : "var(--color-canvas)",
                  color: !date && period === p ? "#fff" : "var(--color-ink)",
                }}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          {/* A specific calendar day — not a sixth period, a separate choice
              that overrides whichever pill is picked (see `load` above). */}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Choose a specific day"
            className="shrink-0 text-sm rounded-full border px-3 py-1.5"
            style={{
              borderColor: date ? "var(--color-primary)" : "var(--color-hairline)",
              background: "var(--color-canvas)",
              color: "var(--color-ink)",
            }}
          />
        </div>
      )}
      {showSaving && <div className="h-4" />}

      {/* Totals. Split by tender because that is how it lands on the four
          balances — cash out of the till, online out of the bank. */}
      <section
        className="rounded-xl border overflow-hidden mb-4"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <div className="grid grid-cols-3 divide-x" style={{ borderColor: "var(--color-hairline)" }}>
          {(
            showSaving
              ? ([
                  ["Cash", savedCash],
                  ["Online", savedOnline],
                  // For the add-only viewer this is what THEY put in today, not
                  // what the pots hold — the label has to say which.
                  [todayOnly ? "Added today" : "Saved", savedTotal],
                ] as const)
              : ([
                  ["Cash", cash],
                  ["Online", online],
                  [todayOnly ? "Today" : "Total", total],
                ] as const)
          ).map(([label, value], i) => (
            <div key={label} className="px-4 py-3">
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                {label}
              </p>
              <p
                className="text-lg tabular-nums mt-0.5"
                style={{
                  color: i === 2 && value > 0 ? "#dc2626" : "var(--color-ink)",
                  fontWeight: i === 2 ? 500 : 400,
                }}
              >
                {money2(value)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {showSaving ? (
        titles.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-10 text-center"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            <PiggyBank
              size={22}
              className="mx-auto mb-2"
              style={{ color: "var(--color-ink-mute)", opacity: 0.5 }}
            />
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
              {canManage
                ? "No savings yet. Create one — an emergency fund, a new oven — then file money into it."
                : "No savings have been set up yet. Ask an owner to create one."}
            </p>
          </div>
        ) : (
          <section
            className="rounded-xl border overflow-hidden"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            {titles.map((t) => (
              <SavingPot
                key={t.id}
                title={t}
                refreshVersion={savingsVersion}
                canManage={canManage}
                canEdit={canEdit}
                securityEnabled={securityEnabled}
                onEditEntry={setEditing}
                onChanged={afterChange}
              />
            ))}
          </section>
        )
      ) : expenses.length === 0 ? (
        <div
          className="rounded-xl border px-4 py-10 text-center"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <Receipt size={22} className="mx-auto mb-2" style={{ color: "var(--color-ink-mute)", opacity: 0.5 }} />
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No expenses recorded for {date ? "that day" : PERIOD_LABEL[period].toLowerCase()}.
          </p>
        </div>
      ) : (
        <section
          className="rounded-xl border overflow-hidden"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          {expenses.map((e, i) => (
            <div
              key={e.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
            >
              <div className="min-w-0">
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                  {e.categoryLabel}
                  {e.updatedAt && (
                    <span className="text-xs ml-2" style={{ color: "var(--color-warning)" }}>
                      edited
                    </span>
                  )}
                </p>
                {e.note && (
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-mute)" }}>
                    {e.note}
                  </p>
                )}
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)", opacity: 0.8 }}>
                  {new Date(e.createdAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {" · "}
                  {METHOD_LABEL[e.method] ?? e.method}
                  {e.method === "mixed" && ` (${money2(e.cash)} + ${money2(e.online)})`}
                  {e.createdByName ? ` · ${e.createdByName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm tabular-nums" style={{ color: "#dc2626" }}>
                  {money2(e.amount)}
                </span>
                {canEdit && securityEnabled && (
                  <button
                    type="button"
                    onClick={() => setEditing(e)}
                    aria-label="Edit expense"
                    className="p-1.5 rounded-md transition-colors"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {canEdit && !securityEnabled && expenses.length > 0 && (
        <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
          Set a Security PIN in Settings to correct or remove an expense.
        </p>
      )}

      <Modal open={adding} title="Record an expense" onClose={() => setAdding(false)}>
        <AddExpenseForm onDone={afterChange} />
      </Modal>

      <Modal open={addingTitle} title="New saving" onClose={() => setAddingTitle(false)}>
        <NewTitleForm onDone={afterChange} />
      </Modal>

      <Modal
        open={addingSaving}
        title="Add to a saving"
        subtitle="Money set aside — it leaves your cash or bank like any expense"
        onClose={() => setAddingSaving(false)}
      >
        <AddSavingForm titles={titles} onDone={afterChange} />
      </Modal>

      <Modal
        open={withdrawing}
        title="Withdraw from a saving"
        subtitle="Money coming back into your cash or bank"
        onClose={() => setWithdrawing(false)}
      >
        <WithdrawSavingForm titles={titles} onDone={afterChange} />
      </Modal>

      {/* Keyed on the row so switching rows remounts the form — otherwise the
          amount/tender fields keep the previous expense's state. */}
      <Modal
        open={!!editing}
        title={editing && editing.amount < 0 ? "Correct this withdrawal" : "Correct this expense"}
        subtitle={
          editing
            ? `${editing.savingTitleName ?? editing.categoryLabel}${
                editing.amount < 0 ? " · withdrawal" : ""
              } · ${money2(Math.abs(editing.amount))}`
            : undefined
        }
        onClose={() => setEditing(null)}
      >
        {editing && (
          <EditExpenseForm
            key={editing.id}
            expense={editing}
            titles={titles}
            onDone={afterChange}
          />
        )}
      </Modal>
    </div>
  );
}

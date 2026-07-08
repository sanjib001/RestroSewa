import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { NAV_ACCESS } from "@/lib/permissions";
import { getSalesSummary } from "@/app/actions/pos";
import type { SalesTxn } from "@/app/actions/pos";

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{sub}</p>}
    </div>
  );
}

function TxnCard({ txn }: { txn: SalesTxn }) {
  const location = txn.table_number
    ? `Table ${txn.table_number}`
    : txn.room_number
    ? `Room ${txn.room_number}`
    : txn.session_type === "walk_in"
    ? "Walk-in"
    : "—";

  const time = new Date(txn.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const date = new Date(txn.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const method = METHOD_LABEL[txn.method] ?? txn.method;
  const symbol = txn.method === "cash" ? "₹" : txn.method === "mixed" ? "⬡₹" : "⬡";

  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-medium shrink-0"
        style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
      >
        {symbol}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {location}
          {txn.customer_name && (
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>{txn.customer_name}</span>
          )}
        </p>
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          #{txn.id.slice(0, 8)} · {method} · {time}, {date}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(txn.amount)}</p>
        <p className="text-[10px] uppercase tracking-wide" style={{ color: "#1a7a4a", letterSpacing: "0.06em" }}>Paid</p>
      </div>
    </div>
  );
}

export default async function SalesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  // Only staff with billing / sales permission (e.g. cashier) may view sales.
  if (!NAV_ACCESS.canSeeSales(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const s = await getSalesSummary(restaurantUser.restaurant_id);

  const breakdownItems = [
    { label: "Cash", value: s.breakdown.cash },
    { label: "Online", value: s.breakdown.online },
    { label: "Card", value: s.breakdown.card },
    { label: "Other", value: s.breakdown.other },
  ].filter((b) => b.value > 0);

  return (
    <div className="p-5 max-w-2xl">
      <h1 className="text-xl mb-1" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
        Sales
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-mute)" }}>
        {s.orderCount === 0 ? "No sales recorded yet." : `${s.orderCount} bill${s.orderCount !== 1 ? "s" : ""} all-time`}
      </p>

      {/* Headline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile label="Today" value={money(s.today)} />
        <StatTile label="This Week" value={money(s.week)} />
        <StatTile label="This Month" value={money(s.month)} />
        <StatTile label="Total Sales" value={money(s.total)} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatTile label="Number of Orders" value={String(s.orderCount)} />
        <StatTile label="Avg. Order Value" value={money(s.avgOrderValue)} />
      </div>

      {/* Payment method breakdown */}
      {breakdownItems.length > 0 && (
        <section className="mb-6">
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Payment methods
          </p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
            {breakdownItems.map((b, i) => {
              const pct = s.total > 0 ? (b.value / s.total) * 100 : 0;
              return (
                <div
                  key={b.label}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ background: "var(--color-canvas)", borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
                >
                  <span className="text-sm w-16 shrink-0" style={{ color: "var(--color-ink)" }}>{b.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-canvas-soft)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-primary)" }} />
                  </div>
                  <span className="text-sm tabular-nums w-20 text-right" style={{ color: "var(--color-ink)" }}>{money(b.value)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent transactions */}
      <section>
        <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Recent transactions
        </p>
        {s.transactions.length === 0 ? (
          <div
            className="rounded-xl border px-6 py-12 text-center"
            style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>No payments recorded yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {s.transactions.map((t) => <TxnCard key={t.id} txn={t} />)}
          </div>
        )}
      </section>
    </div>
  );
}

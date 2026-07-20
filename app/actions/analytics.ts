"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { periodBounds } from "@/lib/finance";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashboardStats = {
  /** Stock on hand, valued at each product's last purchase price. */
  inventoryValue: number;
  productCount: number;
  lowCount: number;
  outCount: number;

  /** Accrual — the full value billed today, credit included. */
  salesToday: number;
  purchasesToday: number;

  /** Sales − cost of the stock they consumed. See `costCoverage`. */
  estimatedProfit: number;
  /** Cost of the stocked goods sold today. */
  cogs: number;
  /**
   * Revenue from menu items that HAVE a stock link. Anything above this earned
   * revenue with no known cost, so the profit figure is optimistic by that much.
   */
  trackedRevenue: number;

  customerCreditOutstanding: number;
  vendorCreditOutstanding: number;
};

export type RecentPurchase = {
  id: string;
  purchase_code: string;
  vendor_name: string;
  method: string;
  total_amount: number;
  credit_amount: number;
  created_at: string;
};

export type RecentSale = {
  id: string;
  amount: number;
  method: string;
  /** True when the bill was closed with money still owed. */
  onCredit: boolean;
  location: string;
  created_at: string;
};

export type DashboardAnalytics = {
  /** Null when the viewer may not see stock. */
  stats: DashboardStats | null;
  /** Money figures are hidden without `view_finance`. */
  canSeeMoney: boolean;
  recentPurchases: RecentPurchase[];
  recentSales: RecentSale[];
};

const EMPTY_STATS: DashboardStats = {
  inventoryValue: 0,
  productCount: 0,
  lowCount: 0,
  outCount: 0,
  salesToday: 0,
  purchasesToday: 0,
  estimatedProfit: 0,
  cogs: 0,
  trackedRevenue: 0,
  customerCreditOutstanding: 0,
  vendorCreditOutstanding: 0,
};

// ─── Dashboard analytics ──────────────────────────────────────────────────────
// One RPC for every card, plus the two recent-activity lists. Derived from the
// existing bills, purchases and stock — nothing is stored or duplicated.

export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  const ru = await getRestaurantUser();

  const canSeeStock = STOCK_ACCESS.canViewStock(ru);
  const canSeeMoney = STOCK_ACCESS.canViewFinance(ru);

  if (!canSeeStock && !canSeeMoney) {
    return { stats: null, canSeeMoney: false, recentPurchases: [], recentSales: [] };
  }

  const service = createServiceClient();
  const { from, to } = periodBounds("today", ru.closingHour);

  const [statsRes, purchasesRes, salesRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("dashboard_stats", {
      p_restaurant_id: ru.restaurant_id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    canSeeStock
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)
          .from("purchases")
          .select("id, purchase_code, payment_method, total_amount, credit_amount, created_at, vendors ( name )")
          .eq("restaurant_id", ru.restaurant_id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    canSeeMoney
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)
          .from("payments")
          .select(
            "id, amount, total_amount, cash_amount, online_amount, card_amount, payment_method, created_at, sessions ( type, restaurant_tables ( number ), rooms ( number ) )"
          )
          .eq("restaurant_id", ru.restaurant_id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data) as any;
  const num = (v: unknown) => Number(v ?? 0);

  let stats: DashboardStats | null = null;
  if (row) {
    const salesToday = num(row.sales_total);
    const cogs = num(row.cogs);
    stats = {
      inventoryValue: num(row.inventory_value),
      productCount: Number(row.product_count ?? 0),
      lowCount: Number(row.low_count ?? 0),
      outCount: Number(row.out_count ?? 0),
      salesToday,
      purchasesToday: num(row.purchases_total),
      cogs,
      trackedRevenue: num(row.tracked_revenue),
      estimatedProfit: salesToday - cogs,
      customerCreditOutstanding: num(row.customer_credit_outstanding),
      vendorCreditOutstanding: num(row.vendor_credit_outstanding),
    };

    // Blank the money figures for a stock-only viewer (a storekeeper must not see
    // takings, margins or debt) while leaving the stock cards intact.
    if (!canSeeMoney) {
      stats = {
        ...stats,
        salesToday: 0,
        purchasesToday: 0,
        cogs: 0,
        trackedRevenue: 0,
        estimatedProfit: 0,
        customerCreditOutstanding: 0,
        vendorCreditOutstanding: 0,
      };
    }
  } else if (canSeeStock) {
    stats = EMPTY_STATS;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentPurchases: RecentPurchase[] = ((purchasesRes.data ?? []) as any[]).map((p) => ({
    id: p.id,
    purchase_code: p.purchase_code,
    vendor_name: p.vendors?.name ?? "—",
    method: p.payment_method,
    total_amount: Number(p.total_amount),
    credit_amount: Number(p.credit_amount),
    created_at: p.created_at,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentSales: RecentSale[] = ((salesRes.data ?? []) as any[]).map((p) => {
    const total = Number(p.total_amount ?? p.amount ?? 0);
    const tendered =
      Number(p.cash_amount ?? 0) + Number(p.online_amount ?? 0) + Number(p.card_amount ?? 0);
    return {
      id: p.id,
      amount: total,
      method: p.payment_method,
      // A credit bill records its full value but only part of it as tendered.
      onCredit: p.payment_method === "credit" && total - tendered > 0.005,
      location: p.sessions?.restaurant_tables?.number
        ? `Table ${p.sessions.restaurant_tables.number}`
        : p.sessions?.rooms?.number
        ? `Room ${p.sessions.rooms.number}`
        : p.sessions?.type === "walk_in"
        ? "Walk-in"
        : "—",
      created_at: p.created_at,
    };
  });

  return { stats, canSeeMoney, recentPurchases, recentSales };
}

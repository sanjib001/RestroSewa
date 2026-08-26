import { businessPeriodBounds, businessPeriodDateBounds, businessDayBounds, addBusinessDays } from "@/lib/business-day";

// A lighter period set for simple chronological lists (Security activity, Report
// delivery history, Purchases, Savings, …) that just need "narrow the window",
// not the full custom-range picker Sales/Finance have. One shared type + bounds
// resolver so every list agrees on what "This Month" means — the same business
// day math (`businessPeriodBounds`) the Sales and Finance reports already use.
export type HistoryPeriod = "today" | "week" | "month" | "year" | "all";

export const HISTORY_PERIODS: HistoryPeriod[] = ["today", "week", "month", "year", "all"];

export const HISTORY_PERIOD_LABEL: Record<HistoryPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  all: "All Time",
};

/**
 * Bounds for the filter — a picked calendar DAY wins over the period pill when
 * both are present, which is how `PeriodFilter` behaves: picking a day is its
 * own choice, not a sixth period, so nothing has to keep the two in sync.
 */
export function historyPeriodBounds(
  period: HistoryPeriod,
  hour: number,
  date?: string | null
): { from: Date; to: Date } {
  if (date) return businessDayBounds(date, hour);
  return businessPeriodBounds(period, hour);
}

/** String bounds, for filtering a plain YYYY-MM-DD business-date column. */
export function historyPeriodDateBounds(
  period: HistoryPeriod,
  hour: number,
  date?: string | null
): { from: string | null; to: string | null } {
  if (date) return { from: date, to: addBusinessDays(date, 1) };
  return businessPeriodDateBounds(period, hour);
}

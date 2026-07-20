// THE definition of a business day. Every report, filter and day picker in the
// app resolves its dates through this file and nowhere else.
//
// WHY IT EXISTS: a restaurant that serves until 2am treats those sales as part
// of the previous night's trading. The books said otherwise — a 00:45 bill
// landed on the next calendar day, splitting one evening's takings across two
// reports. So the boundary is configurable per restaurant
// (`restaurants.settings.business_closing_hour`, whole hours, default 0 =
// midnight = the old behaviour).
//
//   business day D  =  [ D h:00 Nepal , D+1 h:00 Nepal )
//
// ── TIMEZONE: PINNED TO NEPAL, NOT THE SERVER ────────────────────────────────
// This used to compute in the SERVER's local timezone, which was fine on a
// Nepal-based dev machine but WRONG in production: hosted on a UTC (or US) server,
// "today" was the server's calendar day, so at 2am Nepal the server still thought
// it was yesterday and dumped the previous evening's sales into today's total —
// the "yesterday shows in my today's sales" bug.
//
// Every restaurant is in Nepal, and Nepal Standard Time is a FIXED UTC+05:45 with
// NO daylight saving (year-round, since 1986). So a constant offset is exactly
// correct and, crucially, independent of where the server runs. All arithmetic
// below is done on Nepal wall-clock date STRINGS (calendar maths, tz-free) and
// only converted to an absolute instant at the very end, through the offset.
//
// THE RULE THAT IS EASY TO GET WRONG: every period is derived from
// `businessDate(now, h)` — the business day we are *currently inside* — never
// from `now`'s calendar date. At 01:00 on 1 August with h=3 we are still inside
// business day 31 July, so "This Month" must mean JULY.
//
// The upper bound is always EXCLUSIVE, which is what makes the carry-forward
// exact: one period's closing and the next period's opening are the same instant.
//
// Client components must not compute business days themselves — the browser's
// clock is yet another clock. Format timestamps there; bucket them here.

export const DEFAULT_CLOSING_HOUR = 0;

// Nepal Standard Time = UTC+05:45, no DST. A single constant is fully correct.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/**
 * Coerce whatever is sitting in the settings jsonb into a usable hour.
 *
 * Settings are free-form JSON, so this may be a number, a string, absent, or
 * nonsense. Anything that isn't a whole hour in 0–23 collapses to the default,
 * which is midnight — i.e. a bad value degrades to the behaviour the app had
 * before this feature, never to a random boundary.
 */
export function normalizeClosingHour(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_CLOSING_HOUR;
  return n;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Nepal wall-clock date (YYYY-MM-DD) of an absolute instant. */
function nepalDateStr(at: Date): string {
  // Shift into Nepal time, then read the UTC parts — those ARE the Nepal parts.
  const d = new Date(at.getTime() + NEPAL_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The absolute instant of Nepal-local `day hour:00:00`. */
function nepalInstant(day: string, hour: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  // Build the Nepal wall-clock time as if UTC, then subtract the offset to get
  // the true absolute instant.
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, hour, 0, 0, 0) - NEPAL_OFFSET_MS);
}

/** Calendar add on a date STRING — pure UTC maths, so it is timezone-free. */
function addDaysStr(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const firstOfMonthStr = (day: string) => `${day.slice(0, 7)}-01`;
const firstOfYearStr = (day: string) => `${day.slice(0, 4)}-01-01`;

/**
 * The instant business day `day` begins: Nepal midnight of that date plus the
 * closing hour. Accepts a YYYY-MM-DD string, or a Date (read as its Nepal day).
 */
export function businessDayStart(day: string | Date, hour: number): Date {
  const s = typeof day === "string" ? day : nepalDateStr(day);
  return nepalInstant(s, hour);
}

/**
 * Which business day does this instant belong to?
 *
 * Shifting back by the closing hour is the whole trick: with h=3, a 02:50 stamp
 * moves to 23:50 the previous day and reads off that Nepal date.
 */
export function businessDate(at: Date, hour: number): string {
  return nepalDateStr(new Date(at.getTime() - hour * 60 * 60 * 1000));
}

/**
 * The business day we are currently inside, as YYYY-MM-DD.
 *
 * `now` is injectable ONLY so the boundary rules can be tested at instants a
 * test can't otherwise reach — 01:00 on the 1st of a month, or exactly h:00:00.
 * Production callers never pass it.
 */
export function businessToday(hour: number, now: Date = new Date()): string {
  return businessDate(now, hour);
}

/** Bounds for ONE business day (the Nepal date, or today's). */
export function businessDayBounds(
  day: string | null | undefined,
  hour: number
): { from: Date; to: Date } {
  const d = day ?? businessToday(hour);
  return { from: nepalInstant(d, hour), to: nepalInstant(addDaysStr(d, 1), hour) };
}

export type BusinessPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "all"
  | "custom";

/**
 * Resolve a named period to [from, to) business-day bounds.
 *
 * This is the single resolver — Finance, Sales, Stock, Purchases, Credits,
 * Payroll and the dashboard all come through here, so "This Week" cannot mean
 * two different things on two different screens.
 */
export function businessPeriodBounds(
  period: BusinessPeriod,
  hour: number,
  from?: string | null,
  to?: string | null,
  now: Date = new Date()
): { from: Date; to: Date } {
  // Anchor on the Nepal business day we're inside — see the header note.
  const today = businessToday(hour, now);
  const S = (dayStr: string) => nepalInstant(dayStr, hour);
  const tomorrow = S(addDaysStr(today, 1));

  switch (period) {
    case "today":
      return { from: S(today), to: tomorrow };
    case "yesterday":
      return { from: S(addDaysStr(today, -1)), to: S(today) };
    // Week/month/year run up to the end of the current business day, so today's
    // trading is included.
    case "week":
      return { from: S(addDaysStr(today, -6)), to: tomorrow };
    case "month":
      return { from: S(firstOfMonthStr(today)), to: tomorrow };
    case "year":
      return { from: S(firstOfYearStr(today)), to: tomorrow };
    case "all":
      return { from: new Date(0), to: tomorrow };
    case "custom": {
      const f = from ? S(from) : S(today);
      // `to` is a business day the user means to INCLUDE, so push to its end.
      const t = to ? S(addDaysStr(to, 1)) : tomorrow;
      // A `to` before `from` would give an empty or negative window; fall back to
      // the single day `from` names rather than reporting nothing.
      return { from: f, to: t > f ? t : new Date(f.getTime() + 24 * 60 * 60 * 1000) };
    }
  }
}

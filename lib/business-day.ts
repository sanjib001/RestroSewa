// THE definition of a business day. Every report, filter and day picker in the
// app resolves its dates through this file and nowhere else.
//
// WHY IT EXISTS: a restaurant that serves until 2am treats those sales as part
// of the previous night's trading. The books said otherwise — a 00:45 bill
// landed on the next calendar day, splitting one evening's takings across two
// reports. So the boundary is now configurable per restaurant
// (`restaurants.settings.business_closing_hour`, whole hours, default 0 =
// midnight = the old behaviour).
//
//   business day D  =  [ D h:00 local , D+1 h:00 local )
//
// THE RULE THAT IS EASY TO GET WRONG: every period must be derived from
// `businessDate(now, h)` — the business day we are *currently inside* — never
// from `now`'s calendar date. At 01:00 on 1 August with h=3 we are still inside
// business day 31 July, so "This Month" must mean JULY. Anchoring the month and
// year arithmetic on the business date gets that right for free; anchoring it on
// `now` is wrong for h hours every single night, and most visibly at exactly the
// month and year rollovers where anyone would notice.
//
// The upper bound is always EXCLUSIVE. That is what makes the carry-forward
// exact: one period's closing and the next period's opening are evaluated at the
// very same instant, so they cannot disagree.
//
// All arithmetic is in the SERVER's local timezone (there is no per-restaurant
// timezone column). Client components must not compute business days themselves
// — the browser's clock is a different clock. Format timestamps there; bucket
// them here.

export const DEFAULT_CLOSING_HOUR = 0;

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

/** Local YYYY-MM-DD. Deliberately not `toISOString`, which would shift the day. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a YYYY-MM-DD as a LOCAL calendar date (`new Date("...")` would be UTC). */
function parseISODate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Calendar-day arithmetic, not +24h — so it stays correct across a DST shift. */
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours());
}

/**
 * The instant business day `day` begins: local midnight of that date, plus the
 * closing hour.
 */
export function businessDayStart(day: string | Date, hour: number): Date {
  const d = typeof day === "string" ? parseISODate(day) : d0(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0);
}

const d0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Which business day does this instant belong to?
 *
 * Shifting back by the closing hour is the whole trick: with h=3, a 02:50 stamp
 * moves to 23:50 the previous day and reads off that calendar date.
 */
export function businessDate(at: Date, hour: number): string {
  const shifted = new Date(at.getTime() - hour * 60 * 60 * 1000);
  return isoDate(shifted);
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

/**
 * Bounds for ONE business day. Replaces the midnight-to-midnight `dayBounds`
 * the stock module used.
 */
export function businessDayBounds(
  day: string | null | undefined,
  hour: number
): { from: Date; to: Date } {
  const d = day ?? businessToday(hour);
  const from = businessDayStart(d, hour);
  return { from, to: businessDayStart(addDays(parseISODate(d), 1), hour) };
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
 * two different things on two different screens (it used to: Sales measured a
 * rolling 168 hours while Finance measured the last 7 days).
 */
export function businessPeriodBounds(
  period: BusinessPeriod,
  hour: number,
  from?: string | null,
  to?: string | null,
  now: Date = new Date()
): { from: Date; to: Date } {
  // Anchor on the business day we're inside — see the header note.
  const today = parseISODate(businessToday(hour, now));
  const S = (d: Date | string) => businessDayStart(d, hour);
  const tomorrow = S(addDays(today, 1));

  switch (period) {
    case "today":
      return { from: S(today), to: tomorrow };
    case "yesterday":
      return { from: S(addDays(today, -1)), to: S(today) };
    // Week/month/year run up to the end of the current business day, so today's
    // trading is included.
    case "week":
      return { from: S(addDays(today, -6)), to: tomorrow };
    case "month":
      return { from: S(new Date(today.getFullYear(), today.getMonth(), 1)), to: tomorrow };
    case "year":
      return { from: S(new Date(today.getFullYear(), 0, 1)), to: tomorrow };
    case "all":
      return { from: new Date(0), to: tomorrow };
    case "custom": {
      const f = from ? S(from) : S(today);
      // `to` is a business day the user means to INCLUDE, so push to its end.
      const t = to ? S(addDays(parseISODate(to), 1)) : tomorrow;
      // A `to` before `from` would give an empty or negative window; fall back to
      // the single day `from` names rather than reporting nothing.
      return { from: f, to: t > f ? t : new Date(f.getTime() + 24 * 60 * 60 * 1000) };
    }
  }
}

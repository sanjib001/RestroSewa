// Subscription expiry — computed everywhere, stored nowhere. Only `install_date`
// and `subscription_extra_days` live in the database (see the migration); every
// reader (superadmin UI, the dashboard watermark, the expiry cron) derives the
// same two numbers from those two inputs through this one file, so "how many
// days are left" can never disagree between screens.

/** The standard cycle length. Per-restaurant variation is `subscription_extra_days`, not this. */
export const SUBSCRIPTION_CYCLE_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD string as a LOCAL calendar date, not UTC — `new Date(str)`
 *  on a bare date string is read as UTC midnight, which shifts a day west of
 *  UTC (this app's whole userbase). Mirrors the same fix already applied to
 *  Sales' date-bucketing this session. */
function parseDateOnly(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** The last day covered by the subscription, or null if it was never started. */
export function subscriptionExpiryDate(
  installDate: string | null,
  extraDays: number
): Date | null {
  if (!installDate) return null;
  const start = parseDateOnly(installDate);
  const totalDays = SUBSCRIPTION_CYCLE_DAYS + (Number.isFinite(extraDays) ? extraDays : 0);
  return new Date(start.getTime() + totalDays * MS_PER_DAY);
}

/**
 * Whole days left until expiry, or null if no install date is set.
 * 0 or negative means expired — callers decide how to present that (this file
 * only does the arithmetic, never the wording or color).
 */
export function subscriptionDaysRemaining(
  installDate: string | null,
  extraDays: number,
  now: Date = new Date()
): number | null {
  const expiry = subscriptionExpiryDate(installDate, extraDays);
  if (!expiry) return null;
  // Calendar-day diff, not a raw ms division: comparing local midnights (via
  // parseDateOnly-shaped instants) means "expires today" reads as 0, not -0.4.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expiry.getTime() - today.getTime()) / MS_PER_DAY);
}

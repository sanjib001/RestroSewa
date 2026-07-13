// Dates that read the same on the server and in the browser.
//
// `new Date(iso).toLocaleString("en-IN", …)` formats in whatever timezone the
// RUNTIME happens to be in. On a laptop that is the same process family for both
// render passes, so it agrees and nothing looks wrong. In production it does not:
// the server runs UTC and the browser runs the guest's zone, so the same instant
// renders as two different strings —
//
//     SERVER  (UTC)             13 Jul, 06:30 pm
//     BROWSER (Asia/Kathmandu)  14 Jul, 12:15 am     ← a different DAY
//
// which is a hydration mismatch, and worse, prints the wrong date on a bill.
//
// Pinning the zone makes both passes agree and makes them agree on the RIGHT
// answer — the wall-clock time at the restaurant, which is the only time a
// receipt or a check-in stamp ever means.
//
// One constant, so a restaurant in another zone is a one-line change (or a column
// on `restaurants`, when that day comes) rather than a hunt through every file.
export const APP_TIME_ZONE = "Asia/Kathmandu";
export const APP_LOCALE = "en-IN";

const opts = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  ...o,
  timeZone: APP_TIME_ZONE,
});

/** "14 Jul 2026, 12:15 am" */
export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(APP_LOCALE, opts({ dateStyle: "medium", timeStyle: "short" }));
}

/** "14 Jul, 12:15 am" — compact, for cards and lists. */
export function formatShort(iso: string | Date): string {
  return new Date(iso).toLocaleString(
    APP_LOCALE,
    opts({ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  );
}

/** "14 Jul 2026" */
export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(APP_LOCALE, opts({ dateStyle: "medium" }));
}

/** "12:15 am" */
export function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, opts({ hour: "2-digit", minute: "2-digit" }));
}

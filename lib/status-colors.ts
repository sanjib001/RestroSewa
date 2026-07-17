/**
 * The ONE palette for table, walk-in and room status, so a colour means the same thing
 * everywhere.
 *
 * It exists because the same statuses had drifted into two different palettes — the staff
 * rooms grid painted Maintenance grey while the admin rooms page painted it red, and each
 * kept its own copy of the labels.
 *
 * Tables, walk-ins and rooms share it deliberately, and status is NOT re-tinted per section:
 * "blue = in use" has to hold while a cashier scans 55 cards, so an occupied room is the same
 * blue as an occupied table. Sections are told apart by their own chrome and icon instead —
 * see lib/section-colors.ts.
 *
 *   Available   green    — free to use
 *   Active      blue     — a table/walk-in with an open session
 *   Occupied    blue     — a room with a guest in it (same colour: both mean "in use")
 *   Cleaning    orange   — just vacated, not yet wiped/made up
 *   Maintenance red      — deliberately out of service
 *
 * Values are `var()` references so the palette flips in dark mode; the tokens live in
 * `app/globals.css` (`--st-*`), outside `@theme` because status arrives as data and Tailwind
 * can't generate a class for it. They were light-only hex until 2026-07-17.
 *
 * NOTE: there is still no "Reserved" state. Neither `room_status` nor the derived table state
 * has one, so it isn't listed here rather than being invented as a colour nothing can produce.
 */
export type StatusKey = "available" | "active" | "occupied" | "cleaning" | "maintenance";

export type StatusStyle = {
  label: string;
  /** Text / border / dot. */
  color: string;
  /** Tint behind it. */
  soft: string;
};

export const STATUS_STYLE: Record<StatusKey, StatusStyle> = {
  available:   { label: "Available",   color: "var(--st-available)",   soft: "var(--st-available-soft)" },
  active:      { label: "Active",      color: "var(--st-occupied)",    soft: "var(--st-occupied-soft)" },
  occupied:    { label: "Occupied",    color: "var(--st-occupied)",    soft: "var(--st-occupied-soft)" },
  cleaning:    { label: "Cleaning",    color: "var(--st-cleaning)",    soft: "var(--st-cleaning-soft)" },
  maintenance: { label: "Maintenance", color: "var(--st-maintenance)", soft: "var(--st-maintenance-soft)" },
};

/** How long a table/room has been waiting to be cleaned, as a short human string. */
export function cleaningFor(since: string | null | undefined, now: number = Date.now()): string {
  if (!since) return "";
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

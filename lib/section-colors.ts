/**
 * Each dashboard section's accent, so staff recognise a section by colour before they read
 * its title. One accent per section, used for its icon, title, header rule and count badge.
 *
 * The values are `var()` references, not hex, so a section keeps its identity in dark mode
 * without every call site knowing the theme. The tokens live in `app/globals.css` under
 * `:root` / `.dark` — deliberately outside `@theme`, because a section's colour is *data*
 * (it arrives as a key at render time) and Tailwind v4 can neither generate `bg-${key}` nor
 * see a var() inside a style object, so a theme token would be pruned.
 *
 * Status colour is a separate axis and deliberately NOT re-themed per section — see
 * lib/status-colors.ts. A section says *where you are*; a status says *what's happening*.
 */
export type SectionAccentKey =
  | "orders"
  | "tables"
  | "walkins"
  | "rooms"
  | "sales"
  | "credits"
  | "menu"
  | "notifications";

export type SectionAccent = {
  /** Title, icon, badge text, header rule. Clears 4.5:1 on the page canvas in both themes. */
  color: string;
  /** The tint behind an icon tile or badge. */
  soft: string;
};

export const SECTION_ACCENT: Record<SectionAccentKey, SectionAccent> = {
  orders:        { color: "var(--sec-orders)",        soft: "var(--sec-orders-soft)" },
  tables:        { color: "var(--sec-tables)",        soft: "var(--sec-tables-soft)" },
  walkins:       { color: "var(--sec-walkins)",       soft: "var(--sec-walkins-soft)" },
  rooms:         { color: "var(--sec-rooms)",         soft: "var(--sec-rooms-soft)" },
  sales:         { color: "var(--sec-sales)",         soft: "var(--sec-sales-soft)" },
  credits:       { color: "var(--sec-credits)",       soft: "var(--sec-credits-soft)" },
  menu:          { color: "var(--sec-menu)",          soft: "var(--sec-menu-soft)" },
  notifications: { color: "var(--sec-notifications)", soft: "var(--sec-notifications-soft)" },
};

/** Falls back to the neutral ink colour for any key without an accent. */
export function accentOf(key: string): SectionAccent {
  return (
    SECTION_ACCENT[key as SectionAccentKey] ?? {
      color: "var(--color-ink)",
      soft: "var(--color-canvas-soft)",
    }
  );
}

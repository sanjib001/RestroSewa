"use client";

import { useEffect, useState } from "react";
import { ListOrdered, Banknote, LayoutGrid, BedDouble, BookOpen, ChevronDown, HandCoins, ShoppingBag } from "lucide-react";
import { accentOf } from "@/lib/section-colors";

export type SectionKey = "orders" | "tables" | "walkins" | "rooms" | "sales" | "credits" | "menu";

export type DashboardSection = {
  key: SectionKey;
  title: string;
  subtitle?: string;
  body: React.ReactNode;
  // A `bare` section renders its own card chrome (e.g. the self-managing Orders
  // section) — the dashboard only supplies the grid cell + scroll anchor.
  bare?: boolean;
};

// `style` is part of the contract now: the quick-nav tints each icon with its section accent.
const SECTION_ICON: Record<
  SectionKey,
  React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>
> = {
  orders: ListOrdered,
  tables: LayoutGrid,
  walkins: ShoppingBag,
  rooms: BedDouble,
  sales: Banknote,
  credits: HandCoins,
  menu: BookOpen,
};

/**
 * What a section shows while its data is still in flight.
 *
 * Each section streams in on its own now, so the page has to look deliberate
 * while they land rather than jumping as each one arrives. Fixed heights, so the
 * layout doesn't reflow underneath a cashier who has already started reading.
 */
export function SectionSkeleton({ bare }: { bare?: boolean }) {
  const bars = (
    <div className="flex flex-col gap-2.5" aria-hidden>
      {[100, 72, 88].map((w, i) => (
        <div
          key={i}
          className="rounded-lg animate-pulse"
          style={{ height: 14, width: `${w}%`, background: "var(--color-canvas-soft)" }}
        />
      ))}
    </div>
  );

  if (bare) {
    return (
      <div
        className="rounded-2xl border px-4 sm:px-5 py-4"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        {bars}
      </div>
    );
  }
  return <div className="py-2">{bars}</div>;
}

function SectionCard({ section, className }: { section: DashboardSection; className?: string }) {
  // Collapsible so a tall section (Menu, Sales) doesn't bury the ones below it.
  // Everything stays mounted (just height-collapsed) so embedded pollers keep
  // running. Uses the grid-rows 0fr→1fr trick for a smooth animation.
  const [open, setOpen] = useState(true);
  const Icon = SECTION_ICON[section.key];
  const accent = accentOf(section.key);

  return (
    <section
      id={`sec-${section.key}`}
      className={`rounded-2xl border overflow-hidden ${className ?? ""}`}
      // The accent runs along the TOP and LEFT edges. Both live on the section's own border
      // rather than an inner element, so the colour follows the rounded corner cleanly instead
      // of butting against it. The other two edges stay hairline — a full coloured outline
      // would box the card in and fight the content.
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        borderTopColor: accent.color,
        borderTopWidth: 2,
        borderLeftColor: accent.color,
        borderLeftWidth: 3,
        scrollMarginTop: 112,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left transition-colors hover:bg-canvas-soft"
      >
        <span
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200"
          style={{ background: accent.soft, color: accent.color }}
        >
          <Icon size={20} strokeWidth={1.9} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-lg font-medium" style={{ color: accent.color }}>{section.title}</span>
          {section.subtitle && (
            <span className="block text-sm truncate" style={{ color: "var(--color-ink-mute)" }}>{section.subtitle}</span>
          )}
        </span>
        <ChevronDown
          size={20}
          strokeWidth={2}
          className="shrink-0 transition-transform duration-300"
          style={{ color: "var(--color-ink-mute)", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
      </button>

      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.3s ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div className="border-t px-3 sm:px-4 py-4" style={{ borderColor: "var(--color-hairline)" }}>
            {section.body}
          </div>
        </div>
      </div>
    </section>
  );
}

// The single-page staff dashboard: every section the staff member is permitted to
// see, stacked full-width in a single wide column. Each section fills the width
// and reflows its OWN content with responsive grids (Tables auto-fill cards,
// Sales auto-fit stat tiles) — so sections use the space without being squeezed
// into narrow half-columns. Orders stays first (most-used).
export function StaffDashboard({
  sections,
  focus,
}: {
  sections: DashboardSection[];
  /** Section to scroll to on arrival — set when a bill was just put on credit. */
  focus?: SectionKey | null;
}) {
  const jump = (key: SectionKey) => {
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Arriving pointed at a section — a credit bill just closed, or a tapped push —
  // scroll there rather than leaving the staff member at the top hunting for it.
  //
  // The target may not exist yet: every section streams in under its own <Suspense>,
  // so #sec-orders can be a skeleton (or nothing) for a beat after mount. So retry
  // until it lands rather than firing once at 50ms and missing. Once it's scrolled,
  // strip ?focus from the URL so a pull-to-refresh doesn't yank the page back down.
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(`sec-${focus}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        clearInterval(timer);
        const url = new URL(window.location.href);
        if (url.searchParams.has("focus")) {
          url.searchParams.delete("focus");
          window.history.replaceState(null, "", url.pathname + url.search);
        }
      } else if (++tries > 30) {
        // ~3s and it never appeared (the staff member lacks that section): give up
        // quietly rather than spin forever.
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [focus]);

  return (
    <div className="pb-10">
      {/* Quick-nav — sticky under the top bar; only shows when >1 section. */}
      {sections.length > 1 && (
        <div
          // Parks directly under the sticky top bar (56px) rather than sliding
          // beneath it. z-30 keeps it below the bar and its notification panel.
          className="sticky z-30 px-4 sm:px-5 py-2.5 border-b bg-canvas/90 backdrop-blur-md border-hairline"
          style={{
            top: 56,
          }}
        >
          <div className="max-w-6xl mx-auto flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {sections.map((s) => {
              const Icon = SECTION_ICON[s.key];
              const accent = accentOf(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => jump(s.key)}
                  // Tinted rather than filled: eight saturated pills in a row would fight each
                  // other and the content below. The icon carries the hue, the label stays ink.
                  className="inline-flex items-center gap-1.5 shrink-0 text-sm px-3 py-2 rounded-full border bg-canvas text-ink transition-all duration-200 active:scale-95 shadow-xs"
                  // Borders were accent.soft — a 50-tier tint that all but vanished against the
                  // white canvas. The accent at full strength gives the chip a real edge.
                  style={{ borderColor: accent.color }}
                >
                  <Icon size={16} strokeWidth={1.9} style={{ color: accent.color }} />
                  {s.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sections.length === 0 ? (
        <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-4">
          <div
            className="rounded-2xl border px-6 py-12 text-center"
            style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
              You don&apos;t have access to any dashboard sections yet. Ask your admin to update your permissions.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-3 sm:px-5 pt-4 flex flex-col gap-4">
          {sections.map((s) =>
            s.bare ? (
              <div key={s.key} id={`sec-${s.key}`} style={{ scrollMarginTop: 112 }}>
                {s.body}
              </div>
            ) : (
              <SectionCard key={s.key} section={s} />
            )
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ListOrdered, Banknote, LayoutGrid, BedDouble, BookOpen, ChevronDown, HandCoins } from "lucide-react";

export type SectionKey = "orders" | "tables" | "rooms" | "sales" | "credits" | "menu";

export type DashboardSection = {
  key: SectionKey;
  title: string;
  subtitle?: string;
  body: React.ReactNode;
  // A `bare` section renders its own card chrome (e.g. the self-managing Orders
  // section) — the dashboard only supplies the grid cell + scroll anchor.
  bare?: boolean;
};

const SECTION_ICON: Record<SectionKey, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  orders: ListOrdered,
  tables: LayoutGrid,
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

  return (
    <section
      id={`sec-${section.key}`}
      className={`rounded-2xl border overflow-hidden ${className ?? ""}`}
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", scrollMarginTop: 112 }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left"
      >
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)", color: "var(--color-primary)" }}
        >
          <Icon size={18} strokeWidth={1.6} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-medium" style={{ color: "var(--color-ink)" }}>{section.title}</span>
          {section.subtitle && (
            <span className="block text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>{section.subtitle}</span>
          )}
        </span>
        <ChevronDown
          size={18}
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

  // Arriving from a credit bill: switch to the Credits section rather than
  // leaving the cashier at the top of the dashboard hunting for it.
  useEffect(() => {
    if (!focus) return;
    // Next paint, so the section is mounted before we scroll to it.
    const t = setTimeout(() => jump(focus), 50);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div className="pb-10">
      {/* Quick-nav — sticky under the top bar; only shows when >1 section. */}
      {sections.length > 1 && (
        <div
          // Parks directly under the sticky top bar (56px) rather than sliding
          // beneath it. z-30 keeps it below the bar and its notification panel.
          className="sticky z-30 px-4 sm:px-5 py-2.5 border-b"
          style={{
            top: 56,
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(12px)",
            borderColor: "var(--color-hairline)",
          }}
        >
          <div className="max-w-6xl mx-auto flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {sections.map((s) => {
              const Icon = SECTION_ICON[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => jump(s.key)}
                  className="inline-flex items-center gap-1.5 shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
                  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                >
                  <Icon size={14} strokeWidth={1.6} />
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

import { NAV_HEIGHT, RAIL_BOX_WIDTH } from "../_components/layout-metrics";

/**
 * The session screen's shell, painted the instant the navigation starts.
 *
 * Opening a table used to show the dashboard, frozen, for as long as the whole request
 * took — a tap with no acknowledgement, which on a busy floor gets tapped again. This
 * costs one file and turns that dead time into an obviously-loading screen, so the
 * remaining latency reads as "working" rather than "broken".
 *
 * Two shapes, like the real page (`session-split-view.tsx`): a single centered
 * column below `lg`, two bordered columns (order · menu) at `lg` and up, sitting
 * beside the tables rail — which does NOT get a skeleton here, because it lives in
 * `session/layout.tsx` now and stays mounted (showing real data throughout) across
 * this exact navigation. Same widths, same card rhythm as the real columns, so the
 * paint doesn't jump when the real layout replaces this one.
 */
export default function SessionLoading() {
  const bar = (w: string, h = 14) => (
    <div
      className="rounded-lg animate-pulse"
      style={{ height: h, width: w, background: "var(--color-canvas-soft)" }}
    />
  );

  const orderSkeleton = (
    <>
      {/* back link */}
      <div className="mb-4">{bar("64px", 12)}</div>

      {/* title + status pill */}
      <div className="flex items-center justify-between mb-5">
        {bar("40%", 22)}
        {bar("56px", 18)}
      </div>

      {/* the items card */}
      <div
        className="rounded-2xl border px-4 py-4 mb-4 flex flex-col gap-3"
        style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        aria-hidden
      >
        {bar("70%")}
        {bar("55%")}
        {bar("62%")}
      </div>

      {/* action buttons */}
      <div className="flex flex-col gap-2.5" aria-hidden>
        {bar("100%", 40)}
        {bar("100%", 40)}
      </div>
    </>
  );

  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading table…</span>

      {/* ── Mobile (below lg) ── */}
      <div className="lg:hidden p-4 sm:p-5 max-w-lg mx-auto">{orderSkeleton}</div>

      {/* ── Desktop/tablet: order · menu, offset past the (already-real, not
          skeletoned) tables rail — matching `session-split-view.tsx` exactly. */}
      <div
        className="hidden lg:flex gap-3 lg:fixed lg:bottom-0 z-10"
        style={{ top: NAV_HEIGHT, left: RAIL_BOX_WIDTH, right: 0, paddingTop: 12, paddingBottom: 12, paddingRight: 12 }}
      >
        <div
          className="w-[460px] shrink-0 rounded-xl border p-4 sm:p-5"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)" }}
        >
          {orderSkeleton}
        </div>

        <div
          className="flex-1 min-w-0 rounded-xl border p-4 flex flex-col gap-3"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)" }}
          aria-hidden
        >
          {bar("30%", 16)}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl animate-pulse" style={{ height: 100, background: "var(--color-canvas-soft)" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

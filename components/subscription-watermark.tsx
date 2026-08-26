import { PlatformLogo, PlatformWordmark } from "@/components/branding/platform-logo";

/**
 * Permanent stamp on every admin/staff dashboard page, showing the
 * subscription countdown — bottom-right on desktop, bottom-CENTER on mobile
 * (below `md`, matching the sidebar's own mobile/desktop split). Off to the
 * side is fine once there's room either side of it; on a narrow phone that
 * corner is exactly where a fixed primary action (e.g. "Place order") tends
 * to live, and centering keeps the watermark from sitting on top of one edge
 * of it. `position: fixed` (not `absolute`) is what makes it
 * survive page scroll — same technique as `OfflineGate`
 * (`components/pwa/offline-gate.tsx`), whose z-[60]/pointer-events-none pattern
 * this copies: `pointer-events-none` so the watermark can never intercept a
 * click meant for the real UI beneath it, and z-40 sits below OfflineGate (60)
 * and the mobile drawer (50) but above the mobile top bar (30), so it's never
 * covered by page content and never competes with either of those.
 *
 * A real watermark, not a UI chip: no backdrop at all. It used to have a
 * solid/blurred pill behind it — that visually covered whatever real UI
 * happened to sit in that corner (a fixed "Place order" button on the
 * ordering screen, in practice), even though `pointer-events-none` already
 * let clicks pass through. Looking blocked is still a problem even when it
 * isn't one; a watermark you can see through fixes both.
 *
 * The "HRestroSewa" name keeps its normal brand wordmark styling
 * (`PlatformWordmark`, white + green accent) — it doesn't switch to the
 * ink/ruby tokens the way the days-remaining text does, so on the light theme
 * it needs its own fix. A hard black outline (text-stroke + a 4-direction
 * shadow) was tried here and read as too heavy/cartoonish, so this is a soft
 * blur-only glow instead — no stroke, no offset, just a dark halo behind the
 * white glyphs, closer to how white text sits over a busy photo than to a
 * printed outline.
 */
export function SubscriptionWatermark({ daysRemaining }: { daysRemaining: number | null }) {
  if (daysRemaining === null) return null;

  const low = daysRemaining < 30;
  const label = daysRemaining <= 0 ? "Subscription Expired" : `Subscription Expires In: ${daysRemaining} Days`;
  const color = low ? "var(--color-ruby)" : "var(--color-ink)";

  return (
    <div
      className="fixed bottom-2 left-1/2 -translate-x-1/2 md:left-auto md:right-2 md:translate-x-0 z-40 pointer-events-none select-none flex items-center gap-2 opacity-70 whitespace-nowrap"
      style={{
        // A soft ambient shadow, not a legibility crutch (the ink/ruby colors
        // already contrast the page on their own) — just enough lift to read
        // as a mark sitting slightly above the surface rather than printed
        // flat onto it, on either theme.
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
      }}
    >
      <PlatformLogo size={18} className="shrink-0" />
      <span className="shrink-0" style={{ textShadow: "0 0 3px rgba(0,0,0,0.85), 0 0 6px rgba(0,0,0,0.55)" }}>
        <PlatformWordmark size={13} tone="light" />
      </span>
      <span className="text-xs font-medium shrink-0" style={{ color }}>
        · {label}
      </span>
    </div>
  );
}

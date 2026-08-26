// Shared between `session/layout.tsx` (the persistent tables rail) and
// `session/[id]/_components/session-split-view.tsx` (the order + menu
// columns) — the two pieces now live in DIFFERENT route segments (see
// `session/layout.tsx`'s doc comment for why) but still have to line up into
// what reads as one continuous three-column strip, with the same gaps and
// edge padding the original single-container layout had.

// StaffNav's own height — every fixed column starts exactly where the nav ends.
export const NAV_HEIGHT = "calc(56px + env(safe-area-inset-top, 0px))";

// Matches Tailwind's `p-3` / `gap-3` (12px) — the spacing the original
// single-flex-row layout got for free from one container's padding and gap,
// now split across two independently-fixed boxes that have to reproduce it
// by hand.
const OUTER_PAD = 12;
const GAP = 12;
const RAIL_WIDTH = 132;

// The rail's box reserves its own trailing 12px as the gap to the next column
// (no padding-right on the rail itself) — so the split-view's box starts
// exactly here and needs no left padding of its own, or the gap would double.
export const RAIL_BOX_WIDTH = OUTER_PAD + RAIL_WIDTH + GAP;

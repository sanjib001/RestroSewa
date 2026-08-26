"use client";

import { useEffect } from "react";

// Shared, reference-counted body-scroll lock.
//
// WHY NOT "capture the previous value, restore it on close" (what every caller used
// to do independently): dialogs nest — a Security PIN confirmation opens on top of a
// Modal, both close together (one success handler triggers both onSuccess and onDone
// in the same commit) — and when two components independently snapshot/restore
// `document.body.style.overflow`, whichever one's cleanup runs last wins, with no
// guarantee that's the outer one. Losing that race leaves the page permanently stuck
// non-scrollable, because the inner dialog's cleanup restores "hidden" (what it was
// when the OUTER modal was already open) over the outer modal's own correct restore.
//
// A module-level counter has no such race: every lock increments it, every unlock
// decrements it, and the body only becomes scrollable again once the count returns to
// zero — regardless of which one closes first or last.
let lockCount = 0;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockCount++;
    document.body.style.overflow = "hidden";
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.body.style.overflow = "";
    };
  }, [active]);
}

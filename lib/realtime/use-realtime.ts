"use client";

import { useEffect, useRef } from "react";

export type Topic =
  | "tables"
  | "orders"
  | "notifications"
  | "billing"
  | "credits"
  | "stock"
  | "purchases"
  | "vendors"
  | "finance"
  | "menu";

/**
 * Subscribe to the server's change stream.
 *
 * The stream carries only topic names — the component reacts by REFETCHING
 * through the normal permission-checked server actions (or `router.refresh()`
 * for server-rendered sections). No row data is pushed, so a client can never
 * receive something it isn't allowed to read.
 *
 * One EventSource is shared per page by the browser's connection reuse; each
 * hook filters for the topics it cares about, so a stock change never re-renders
 * the orders queue.
 *
 * @param topics   the topics this component cares about
 * @param onChange called when one of them fires (coalesced — see below)
 * @param sessionId customer pages pass their session so the server can scope
 *                  them without a login
 */
export function useRealtime(
  topics: Topic[],
  onChange: (topic: Topic) => void,
  sessionId?: string | null
) {
  // Keep the latest callback without re-opening the stream on every render.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const topicsKey = topics.slice().sort().join(",");

  useEffect(() => {
    const wanted = new Set(topicsKey.split(",").filter(Boolean));
    if (wanted.size === 0) return;

    const url = sessionId
      ? `/api/realtime?session=${encodeURIComponent(sessionId)}`
      : "/api/realtime";

    let es: EventSource | null = null;
    let closed = false;
    let retry = 0;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;

    // A burst of writes (closing a bill touches payments, sessions, credits…)
    // would otherwise fire several refetches in a row. Coalesce them.
    let pending: Set<string> = new Set();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const batch = pending;
      pending = new Set();
      for (const t of batch) cbRef.current(t as Topic);
    };

    const open = () => {
      if (closed) return;
      es = new EventSource(url);

      es.addEventListener("ready", () => {
        retry = 0;
      });

      es.addEventListener("change", (e) => {
        try {
          const { topic } = JSON.parse((e as MessageEvent).data) as { topic: string };
          if (!wanted.has(topic)) return;
          pending.add(topic);
          if (!flushTimer) flushTimer = setTimeout(flush, 120);
        } catch {
          // ignore malformed frames
        }
      });

      es.onerror = () => {
        // EventSource auto-reconnects, but a 401 (session expired) would spin.
        // Close and back off ourselves so a dead tab can't hammer the server.
        es?.close();
        es = null;
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry++);
        reopenTimer = setTimeout(open, delay);
      };
    };

    open();

    // Coming back to a backgrounded tab: the stream may have been cut. Reconnect
    // and resync at once rather than showing stale tables.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!es) {
        if (reopenTimer) clearTimeout(reopenTimer);
        retry = 0;
        open();
      }
      for (const t of wanted) cbRef.current(t as Topic);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (reopenTimer) clearTimeout(reopenTimer);
      if (flushTimer) clearTimeout(flushTimer);
      es?.close();
    };
  }, [topicsKey, sessionId]);
}

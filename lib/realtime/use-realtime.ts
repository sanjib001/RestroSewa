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
  | "payroll"
  | "menu";

/**
 * ─── ONE stream per page, shared by every subscriber ─────────────────────────
 *
 * This used to call `new EventSource(url)` inside each hook, with a comment
 * claiming the browser would share the connection. It does not: every hook
 * opened its own, and an SSE connection is held open forever.
 *
 * A Cashier's dashboard mounts five of them (notification bell, Tables, Rooms,
 * Sales, Credits). HTTP/1.1 allows SIX concurrent connections per origin, so five
 * permanent streams left ONE for everything else — navigation, RSC payloads,
 * server actions, images. That is what made the dashboard feel like it hung, why
 * it got worse the more permissions a user had (more sections ⇒ more streams),
 * and why the logs filled with "Failed to fetch RSC payload" and "aborted": those
 * requests were queued behind the stream sockets, not failing on their own.
 *
 * So the stream is now a module-level singleton, reference-counted across hooks.
 * The page opens exactly one connection no matter how many sections listen, and
 * closes it when the last one unmounts. Each subscriber still receives only the
 * topics it asked for, so nothing about behaviour changes — a stock event still
 * doesn't wake the orders queue.
 */

type Subscriber = { topics: Set<string>; cb: (t: Topic) => void };

type Conn = {
  es: EventSource | null;
  subs: Set<Subscriber>;
  retry: number;
  closed: boolean;
  reopenTimer: ReturnType<typeof setTimeout> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  pending: Set<string>;
  onVisible: () => void;
};

// Keyed by URL: staff share "/api/realtime", a customer page has its own session
// URL. In practice a page only ever uses one.
const conns = new Map<string, Conn>();

function dispatch(conn: Conn) {
  conn.flushTimer = null;
  const batch = conn.pending;
  conn.pending = new Set();
  for (const topic of batch) {
    // Snapshot: a callback may unsubscribe (unmount) while we're iterating.
    for (const sub of [...conn.subs]) {
      if (sub.topics.has(topic)) sub.cb(topic as Topic);
    }
  }
}

function open(url: string, conn: Conn) {
  if (conn.closed) return;

  const es = new EventSource(url);
  conn.es = es;

  es.addEventListener("ready", () => {
    conn.retry = 0;
  });

  es.addEventListener("change", (e) => {
    try {
      const { topic } = JSON.parse((e as MessageEvent).data) as { topic: string };
      // Only queue a topic somebody is actually listening for.
      let wanted = false;
      for (const sub of conn.subs) {
        if (sub.topics.has(topic)) { wanted = true; break; }
      }
      if (!wanted) return;

      // A burst of writes (closing a bill touches payments, sessions, credits…)
      // would otherwise fire several refetches in a row. Coalesce them.
      conn.pending.add(topic);
      if (!conn.flushTimer) conn.flushTimer = setTimeout(() => dispatch(conn), 120);
    } catch {
      // ignore malformed frames
    }
  });

  es.onerror = () => {
    // EventSource auto-reconnects, but a 401 (session expired) would spin. Close
    // and back off ourselves so a dead tab can't hammer the server.
    conn.es?.close();
    conn.es = null;
    if (conn.closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** conn.retry++);
    conn.reopenTimer = setTimeout(() => open(url, conn), delay);
  };
}

function acquire(url: string, sub: Subscriber): () => void {
  let conn = conns.get(url);

  if (!conn) {
    const fresh: Conn = {
      es: null,
      subs: new Set(),
      retry: 0,
      closed: false,
      reopenTimer: null,
      flushTimer: null,
      pending: new Set(),
      onVisible: () => {},
    };

    // Coming back to a backgrounded tab: the stream may have been cut. Reconnect
    // and resync at once rather than showing stale tables.
    fresh.onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!fresh.es) {
        if (fresh.reopenTimer) clearTimeout(fresh.reopenTimer);
        fresh.retry = 0;
        open(url, fresh);
      }
      // Wake every subscriber, each for its own topics.
      for (const s of [...fresh.subs]) {
        for (const t of s.topics) s.cb(t as Topic);
      }
    };
    document.addEventListener("visibilitychange", fresh.onVisible);

    conns.set(url, fresh);
    conn = fresh;
    open(url, fresh);
  }

  conn.subs.add(sub);
  const c = conn;

  return () => {
    c.subs.delete(sub);
    if (c.subs.size > 0) return;

    // Last listener gone — tear the whole thing down.
    c.closed = true;
    document.removeEventListener("visibilitychange", c.onVisible);
    if (c.reopenTimer) clearTimeout(c.reopenTimer);
    if (c.flushTimer) clearTimeout(c.flushTimer);
    c.es?.close();
    conns.delete(url);
  };
}

/**
 * Subscribe to the server's change stream.
 *
 * The stream carries only topic names — the component reacts by REFETCHING
 * through the normal permission-checked server actions (or `router.refresh()` for
 * server-rendered sections). No row data is pushed, so a client can never receive
 * something it isn't allowed to read.
 *
 * @param topics    the topics this component cares about
 * @param onChange  called when one of them fires (coalesced)
 * @param sessionId customer pages pass their session so the server can scope them
 *                  without a login
 */
export function useRealtime(
  topics: Topic[],
  onChange: (topic: Topic) => void,
  sessionId?: string | null
) {
  // Keep the latest callback without re-subscribing on every render.
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const topicsKey = topics.slice().sort().join(",");

  useEffect(() => {
    const wanted = new Set(topicsKey.split(",").filter(Boolean));
    if (wanted.size === 0) return;

    const url = sessionId
      ? `/api/realtime?session=${encodeURIComponent(sessionId)}`
      : "/api/realtime";

    // Reads cbRef, so the subscription survives re-renders of the parent.
    const sub: Subscriber = { topics: wanted, cb: (t) => cbRef.current(t) };
    return acquire(url, sub);
  }, [topicsKey, sessionId]);
}

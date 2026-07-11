import "server-only";
import { Client } from "pg";

/**
 * The server side of the real-time bus.
 *
 * ONE Postgres connection for the whole process LISTENs on `rs_events`. Database
 * triggers announce that something changed — never what — and this fans the event
 * out to every connected client of that restaurant over SSE. Clients then refetch
 * through the existing permission-checked server actions.
 *
 * Why not Supabase Realtime in the browser: postgres_changes is gated by RLS, and
 * every table here is RLS-on with no policies precisely because the browser must
 * never read data directly. Opening it up would leak finance data to any staff
 * member holding the anon key. This design keeps the permission model intact.
 */

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

type Listener = (topic: Topic) => void;

type Bus = {
  client: Client | null;
  connecting: Promise<void> | null;
  /** restaurant_id → the callbacks of every client currently connected for it. */
  subscribers: Map<string, Set<Listener>>;
  retry: number;
};

// Survive Next's dev hot-reloads — otherwise every edit would leak a DB
// connection and duplicate the fan-out.
const g = globalThis as unknown as { __rsBus?: Bus };
const bus: Bus =
  g.__rsBus ??
  (g.__rsBus = { client: null, connecting: null, subscribers: new Map(), retry: 0 });

/**
 * LISTEN needs a SESSION connection. Supabase's transaction pooler (:6543)
 * silently drops cross-connection NOTIFY — verified — so the port is rewritten
 * to the session pooler unless an explicit URL is provided.
 */
function listenerConfig() {
  const raw = process.env.REALTIME_DB_URL ?? process.env.SUPABASE_DB_URL;
  if (!raw) return null;

  // Defensive: strip surrounding quotes. The connection string MUST be quoted in
  // .env — an unquoted value containing `#` gets silently TRUNCATED at the `#`
  // by dotenv, which treats it as an inline comment. That produced a listener
  // that never connected while everything else kept working (the rest of the app
  // talks to Supabase over HTTP, not this URL).
  const url = raw.trim().replace(/^["']|["']$/g, "");

  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) {
    console.error(
      "[realtime] SUPABASE_DB_URL is not a parseable connection string " +
        "(is it quoted? an unquoted value containing '#' is truncated by dotenv)"
    );
    return null;
  }
  const [, user, password, host, port, database] = m;

  return {
    user,
    password,
    host,
    // 6543 (transaction pooler) cannot deliver NOTIFY across connections.
    port: process.env.REALTIME_DB_URL ? Number(port) : 5432,
    database,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
  };
}

function dispatch(payload: string) {
  try {
    const { r, t } = JSON.parse(payload) as { r: string; t: Topic };
    const subs = bus.subscribers.get(r);
    if (!subs) return;
    for (const fn of subs) {
      try {
        fn(t);
      } catch {
        // one bad subscriber must not stop the rest
      }
    }
  } catch {
    // malformed payload — ignore rather than kill the listener
  }
}

async function connect(): Promise<void> {
  if (bus.client) return;
  if (bus.connecting) return bus.connecting;

  bus.connecting = (async () => {
    const cfg = listenerConfig();
    if (!cfg) {
      bus.connecting = null;
      return;
    }

    const client = new Client(cfg);

    // A dropped connection must not silently stop every dashboard updating.
    // Clear it and reconnect with backoff; subscribers stay registered.
    const onDead = () => {
      if (bus.client === client) bus.client = null;
      const delay = Math.min(30_000, 1000 * 2 ** bus.retry++);
      setTimeout(() => {
        if (bus.subscribers.size > 0) void connect();
      }, delay);
    };

    client.on("error", onDead);
    client.on("end", onDead);
    client.on("notification", (n) => {
      if (n.payload) dispatch(n.payload);
    });

    await client.connect();
    await client.query("listen rs_events");

    bus.client = client;
    bus.retry = 0;
    bus.connecting = null;
  })();

  try {
    await bus.connecting;
  } catch (err) {
    // Never swallow this: if the listener can't connect, every dashboard silently
    // falls back to the slow poll and nobody knows why.
    console.error("[realtime] listener failed to connect:", err);
    bus.connecting = null;
    bus.client = null;
    const delay = Math.min(30_000, 1000 * 2 ** bus.retry++);
    setTimeout(() => {
      if (bus.subscribers.size > 0) void connect();
    }, delay);
  }
}

/** True once the shared LISTEN connection is live. Surfaced to clients so a
 *  degraded stream is visible rather than silently falling back to slow polls. */
export function isListening(): boolean {
  return bus.client !== null;
}

/**
 * Subscribe one connected client. Returns an unsubscribe function; the shared DB
 * connection is closed once the last subscriber of the whole process is gone.
 */
export async function subscribe(
  restaurantId: string,
  listener: Listener
): Promise<() => void> {
  let set = bus.subscribers.get(restaurantId);
  if (!set) {
    set = new Set();
    bus.subscribers.set(restaurantId, set);
  }
  set.add(listener);

  await connect();

  return () => {
    const s = bus.subscribers.get(restaurantId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) bus.subscribers.delete(restaurantId);

    if (bus.subscribers.size === 0 && bus.client) {
      const c = bus.client;
      bus.client = null;
      c.removeAllListeners();
      void c.end().catch(() => {});
    }
  };
}

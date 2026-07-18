// What a pushed alert SAYS. Shared by the sender and (in shape only) the service
// worker that renders it.
//
// Kept apart from the sending machinery because this is the part a human reads on a
// lock screen, in a noisy dining room, with one hand full of plates. It has about
// three seconds and forty characters to be useful.

// Every staff alert now lands on the one workspace — the dashboard — with a hint
// of what to surface, rather than throwing the user out to a standalone page they
// then have to navigate back from. `notifications` opens the bell dropdown (the
// actions live there); a section key scrolls the dashboard to it. The old targets
// (/employee/notifications, /queue, /sales) still resolve — they redirect here — so
// an alert already sitting in someone's tray keeps working after this ships.
const FOCUS = {
  notifications: "/employee/dashboard?focus=notifications",
  orders: "/employee/dashboard?focus=orders",
  sales: "/employee/dashboard?focus=sales",
} as const;

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping it goes. Always an in-app path. */
  url: string;
  /**
   * Collapse key. Two pushes with the same tag REPLACE one another in the tray
   * rather than stacking — so a table whose request is re-sent doesn't leave a
   * queue of identical alerts to swipe away one at a time.
   */
  tag: string;
  /** The notification row this came from, so an action can resolve back to it. */
  notificationId?: string;
  /**
   * Buttons rendered on the notification itself.
   *
   * Two, at most — Android shows two and silently drops the rest, and a lock screen
   * is not a place to offer a menu. The `action` string is what comes back to the
   * service worker, and it must be one the /api/push/action route recognises.
   */
  actions?: { action: string; title: string }[];
  /** Vibrate + keep the alert on screen until it's dealt with. */
  requireInteraction?: boolean;
};

export type NotifiableRow = {
  id: string;
  type: string;
  table_number?: string | null;
  room_number?: string | null;
  order_summary?: { name: string; quantity: number; price: number }[];
  order_total?: number;
  /** Which station this is for — "Kitchen", "Bar". Workstation events only. */
  workstation_name?: string | null;
  /** Money settled. `payment_received` only. */
  amount?: number | null;
};

function where(n: NotifiableRow): string {
  if (n.table_number) return `Table ${n.table_number}`;
  if (n.room_number) return `Room ${n.room_number}`;
  return "Walk-in";
}

const rupee = (v: number) => `₹${Math.round(v)}`;

/**
 * What the station is actually being asked to make — in about forty characters.
 *
 * "3 items" tells a chef nothing they can act on. The DISH does: it tells them
 * whether to start the fryer. So name the first one and count the rest.
 *
 * The quantity is on the front, not folded into the count, because two mojitos and
 * one mojito are different jobs and an earlier version of this genuinely rendered
 * "2× Mojito" as "Mojito" — it was counting units rather than line items, so a
 * quantity of two vanished entirely. A bartender reading that pours one drink.
 */
function describeItems(items: { name: string; quantity: number }[]): string {
  if (items.length === 0) return "no items";

  const first = items[0];
  const lead = first.quantity > 1 ? `${first.quantity}× ${first.name}` : first.name;
  const rest = items.length - 1;

  return rest > 0 ? `${lead} +${rest} more` : lead;
}

/**
 * Turn a notification row into the thing that appears on a lock screen.
 *
 * Returns null for a type that has no business waking a phone — which is the
 * default, not the exception. Every alert that isn't worth interrupting someone for
 * teaches them to ignore the ones that are.
 */
export function buildPushPayload(n: NotifiableRow): PushPayload | null {
  const place = where(n);

  switch (n.type) {
    case "table_activation_request": {
      const items = n.order_summary ?? [];
      const count = items.reduce((s, i) => s + i.quantity, 0);
      // The whole point of this alert is that someone must decide. Put the stakes in
      // the body — how many items, how much money — so the decision can be made from
      // the lock screen instead of requiring a trip into the app to find out.
      const detail =
        count > 0
          ? `${count} item${count > 1 ? "s" : ""} · ${rupee(n.order_total ?? 0)}`
          : "awaiting approval";
      return {
        title: "Table activation request",
        body: `${place} — ${detail}`,
        url: FOCUS.notifications,
        tag: `activation-${n.id}`,
        notificationId: n.id,
        requireInteraction: true,
        // The only alert whose decision is genuinely binary, and the only one worth
        // deciding without opening the app: approve opens the table and sends the
        // order to the kitchen, reject leaves the table free.
        actions: [
          { action: "approve", title: "Approve" },
          { action: "reject", title: "Reject" },
        ],
      };
    }

    case "call_waiter":
      return {
        title: "Waiter call",
        body: `${place} needs a waiter`,
        url: FOCUS.notifications,
        tag: `waiter-${n.id}`,
        notificationId: n.id,
        requireInteraction: true,
        // "On my way" — moves it to acknowledged so the rest of the floor can see
        // somebody has picked it up, without anyone having to open the app.
        actions: [{ action: "acknowledge", title: "On my way" }],
      };

    case "request_bill":
      return {
        title: "Bill request",
        body: `${place} is asking for the bill`,
        url: FOCUS.notifications,
        tag: `bill-${n.id}`,
        notificationId: n.id,
        requireInteraction: true,
        actions: [{ action: "acknowledge", title: "On my way" }],
      };

    // ── Workstation events: the chef's and the bartender's alerts ─────────────
    // `new_order` is deliberately EXCLUDED from the notifications panel — an order
    // belongs in the Orders queue, not in a list of things to acknowledge. That is
    // still right for the panel. It is not right for push: a chef whose phone is in
    // their apron cannot see a queue on a screen they are not looking at.
    case "new_order": {
      // `new_order` comes in TWO flavours, told apart by whether a station is named:
      //
      //   • STATION alert (workstation_name present) — goes to the chef / bartender and names
      //     THEIR items ("New order · Kitchen — 3× Chicken Momo"), so they know what to make.
      //   • GENERAL alert (no station) — goes to everyone who covers the table (waiter, cashier,
      //     manager) and names the WHOLE order as a count ("New order — Table A3 · 3 items"),
      //     because front-of-house cares that an order landed, not the station breakdown.
      //
      // The two audiences are disjoint (see lib/assignments canSeeNotification vs
      // canSeeWorkstationEvent), so nobody receives both.
      const items = n.order_summary ?? [];
      if (n.workstation_name) {
        return {
          title: `New order · ${n.workstation_name}`,
          body: `${place} — ${describeItems(items)}`,
          url: FOCUS.orders,
          // Tagged by ORDER, so a kitchen that gets three orders in a minute sees
          // three alerts — unlike a service call, each one is a separate job.
          tag: `order-${n.id}`,
          notificationId: n.id,
          // Deliberately NOT requireInteraction: an order is a job to work through the
          // queue, not a decision to make from the lock screen. Making a chef dismiss
          // every ticket by hand would be a tax, not a feature.
          requireInteraction: false,
        };
      }
      const count = items.reduce((s, i) => s + i.quantity, 0);
      return {
        title: "New order",
        body: `${place} · ${count} item${count === 1 ? "" : "s"}`,
        url: FOCUS.orders,
        tag: `order-${n.id}`,
        notificationId: n.id,
        requireInteraction: false,
      };
    }

    case "order_cancelled": {
      const items = n.order_summary ?? [];
      const station = n.workstation_name ?? "your station";
      const lead = items[0]?.name ?? "an order";
      return {
        title: `Order cancelled · ${station}`,
        // This one IS urgent in the other direction — something may already be on the
        // heat, and every second it stays there is food and money in the bin.
        body: `${place} — stop ${lead}`,
        url: FOCUS.orders,
        tag: `cancel-${n.id}`,
        notificationId: n.id,
        requireInteraction: true,
      };
    }

    case "payment_received":
      // Deliberately NO push (2026-07-18). This fired on bill close — "Table A1 — ₹500
      // settled" — but the cashier who just closed the bill already knows, so it was pure
      // close-time noise. Removed per the notifications spec: wake staff only for actionable
      // events (table activation, bill request, waiter call, new order). The notification row is
      // still written (it's excluded from the panel anyway) and every in-app sales/billing update
      // keeps working — ONLY the phone/PWA push is suppressed, which is what returning null here
      // does: this is the single gate that decides whether a type earns an interruption.
      return null;

    default:
      // `order_ready` reaches here, and the room-service request types that nothing
      // currently emits. Silent by default: an event with no considered payload is an
      // event that has not earned the right to wake anybody.
      return null;
  }
}

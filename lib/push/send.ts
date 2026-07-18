import "server-only";
import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildVisibilityFilter,
  getAssignedWorkstationIds,
  canSeeNotification,
  canSeeWorkstationEvent,
} from "@/lib/assignments";
import type { StaffViewer } from "@/lib/assignments";
import { hasAnyPermission, PERMISSIONS } from "@/lib/permissions";
import type { Permission } from "@/lib/permissions";
import { buildPushPayload } from "./payload";
import type { PushPayload, NotifiableRow } from "./payload";
import { categoryOf } from "./categories";
import type { NotificationCategory } from "./categories";

/**
 * The sending half of web push.
 *
 * A push is an interruption. It reaches a locked phone in someone's apron pocket, so
 * the bar for sending one is higher than the bar for putting a row on a screen, and
 * TWO things have to hold that don't matter for the notification panel:
 *
 *   1. It must reach only staff who could already SEE the event. Push travels
 *      through Google's/Apple's servers to a device that may be nowhere near the
 *      restaurant — so it is the one place where getting the permission model wrong
 *      leaks off-premises. Recipients are therefore resolved through exactly the
 *      predicate the panel uses (canSeeNotification), never a copy of it.
 *
 *   2. It must never make the customer wait. The push goes out AFTER the response —
 *      see `notifyStaff` — because a guest tapping "call waiter" should not sit
 *      watching a spinner while we negotiate TLS with a push service in Frankfurt.
 */

let configured = false;

/** Lazily hand web-push our VAPID identity. Returns false when push isn't set up. */
function ensureConfigured(): boolean {
  if (configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    // Deliberately loud: a silent no-op here looks exactly like "nobody has
    // subscribed yet", and you would not find out that push was never configured
    // until a waiter says nobody's phone ever rings.
    console.error(
      "[push] VAPID keys missing — no push will be sent. " +
        "Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT."
    );
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Who should be woken for this notification?
 *
 * Runs the panel's own visibility rule over every active staff member of the
 * restaurant. Costs a handful of queries per staff member, which is fine: this
 * happens once per waiter call, not once per render.
 */
async function recipientsFor(
  restaurantId: string,
  notif: { table_id: string | null; room_id: string | null }
): Promise<string[]> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff } = await (service as any)
    .from("restaurant_users")
    .select("id, role, permissions")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (!staff?.length) return [];

  const decided = await Promise.all(
    (staff as StaffViewer[]).map(async (viewer) => {
      const visibility = await buildVisibilityFilter(restaurantId, viewer);
      const workstations = await getAssignedWorkstationIds(viewer.id);
      return canSeeNotification(visibility, workstations.size, notif) ? viewer.id : null;
    })
  );

  return decided.filter((id): id is string => id !== null);
}

/**
 * Who works the stations this event is for?
 *
 * Nobody else. Not the waiters, not the owner — see canSeeWorkstationEvent. An order
 * with items for the Bar and items for the Kitchen reaches both stations and only
 * those.
 */
async function workstationRecipients(
  restaurantId: string,
  workstationIds: string[]
): Promise<string[]> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff } = await (service as any)
    .from("restaurant_users")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (!staff?.length) return [];

  const decided = await Promise.all(
    (staff as { id: string }[]).map(async (s) => {
      const mine = await getAssignedWorkstationIds(s.id);
      return canSeeWorkstationEvent(mine, workstationIds) ? s.id : null;
    })
  );

  return decided.filter((id): id is string => id !== null);
}

/**
 * Staff who hold any of the given permissions (admins always qualify).
 *
 * Used for events that follow a JOB rather than a place — a payment is the cashier's
 * business no matter which table it came from, so table groups don't enter into it.
 */
async function permissionRecipients(
  restaurantId: string,
  permissions: Permission[]
): Promise<string[]> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff } = await (service as any)
    .from("restaurant_users")
    .select("id, role, permissions")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (!staff?.length) return [];

  return (staff as StaffViewer[])
    .filter((v) => hasAnyPermission(v, permissions))
    .map((v) => v.id);
}

/**
 * Drop the staff who have muted this category.
 *
 * Enforced HERE, at the send, and not in the browser — a preference honoured only by
 * the client is not a preference, it is a suggestion. The push would still be
 * generated, still be encrypted to their device, still be delivered by the OS, and
 * still light up their lock screen; hiding it after the fact is not possible, because
 * by then it has already interrupted them.
 *
 * Absence of a row means ON — see the migration. So this filters against the mutes,
 * not against a list of opt-ins, which is why a brand-new category reaches everyone
 * on the day it ships instead of nobody.
 */
async function dropMuted(
  userIds: string[],
  category: NotificationCategory | null
): Promise<string[]> {
  if (!category || userIds.length === 0) return userIds;

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: muted } = await (service as any)
    .from("notification_preferences")
    .select("restaurant_user_id")
    .in("restaurant_user_id", userIds)
    .eq("category", category)
    .eq("enabled", false);

  if (!muted?.length) return userIds;

  const off = new Set((muted as { restaurant_user_id: string }[]).map((m) => m.restaurant_user_id));
  return userIds.filter((id) => !off.has(id));
}

/**
 * Push a payload to every device belonging to the given staff.
 *
 * Returns how many devices actually accepted it — the honest number, not the number
 * we tried.
 */
export async function sendToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number; pruned: number }> {
  if (userIds.length === 0 || !ensureConfigured()) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await (service as any)
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("restaurant_user_id", userIds);

  const rows = (subs ?? []) as SubscriptionRow[];
  if (rows.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  const delivered: string[] = [];
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
          {
            // The push service holds an undelivered message this long for a phone
            // that is off or out of signal. Four hours is deliberate: a waiter call
            // from before the current shift is not worth delivering, and a stale
            // alert is worse than none — it sends someone to a table that was cleared
            // two shifts ago.
            TTL: 4 * 60 * 60,
            urgency: "high",
          }
        );
        delivered.push(row.id);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;

        // 404/410 mean the subscription is GONE — app uninstalled, browser data
        // cleared, permission revoked. That is permanent, and the row is now a
        // guaranteed failure on every future send, so reap it.
        //
        // Anything else (a 500 from the push service, a network blip) is transient
        // and must NOT delete the row, or one bad afternoon at Google would silently
        // unsubscribe an entire restaurant.
        if (status === 404 || status === 410) {
          dead.push(row.id);
        } else {
          failed++;
          // Carry the message, not just the code. A bare "network" tells you nothing
          // at 9pm on a Friday when the alerts have stopped and you need to know
          // whether it's DNS, TLS, a bad VAPID key, or the push service being down.
          const detail = (err as Error)?.message ?? String(err);
          console.error(`[push] send failed (${status ?? "network"}) for ${row.id}: ${detail}`);
        }
      }
    })
  );

  if (dead.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).from("push_subscriptions").delete().in("id", dead);
  }

  if (delivered.length > 0) {
    // Scoped to the subscriptions that ACTUALLY accepted the push — by row id, not by
    // recipient. Marking every recipient's device healthy because one of them
    // succeeded would make `last_success_at` a record of "somebody, somewhere, got
    // this", which is precisely the column you'd reach for to find the phone that has
    // silently stopped receiving alerts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from("push_subscriptions")
      .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
      .in("id", delivered);
  }

  return { sent: delivered.length, failed, pruned: dead.length };
}

/**
 * Raise a push for a notification row that has just been written.
 *
 * Never throws. A failure to push must not roll back the notification itself — the
 * row is the source of truth and the panel will still show it; push is a courtesy
 * layer on top, and it is not allowed to take the actual feature down with it.
 */
export async function notifyStaff(
  restaurantId: string,
  notif: NotifiableRow & {
    table_id: string | null;
    room_id: string | null;
    /** Workstation events (new_order, order_cancelled) route by station, not table. */
    workstation_ids?: string[];
    /**
     * Override the mute category. `categoryOf(type)` keys off the type alone, but a `new_order`
     * comes in two flavours: the per-station one (category "station") and the general
     * front-of-house one routed by place (category "orders"). This lets the caller say which.
     */
    category?: NotificationCategory;
  }
): Promise<void> {
  try {
    const payload = buildPushPayload(notif);
    if (!payload) return; // this type doesn't earn an interruption

    // Three ways to be a recipient, and an event uses exactly one of them:
    //
    //   by STATION  — a kitchen cooks for every table, so table groups are meaningless
    //   by JOB      — a payment is the cashier's business wherever it came from
    //   by PLACE    — a waiter call belongs to whoever covers that table
    //
    // Whichever applies, this is the SECURITY gate: it decides who is allowed to know.
    let permitted: string[];
    if (notif.workstation_ids?.length) {
      permitted = await workstationRecipients(restaurantId, notif.workstation_ids);
    } else if (notif.type === "payment_received") {
      permitted = await permissionRecipients(restaurantId, [PERMISSIONS.PROCESS_PAYMENTS]);
    } else {
      permitted = await recipientsFor(restaurantId, notif);
    }

    // And this is the COURTESY gate: it decides who wants to know. It runs second and
    // can only ever remove people — un-muting a category must never buy someone an
    // alert the gate above refused them.
    const userIds = await dropMuted(permitted, notif.category ?? categoryOf(notif.type));
    if (userIds.length === 0) return;

    const { sent, pruned } = await sendToUsers(userIds, payload);
    if (pruned > 0) console.log(`[push] pruned ${pruned} dead subscription(s)`);
    if (sent === 0) {
      // Not an error — it just means nobody who can see this table has enabled
      // notifications on any device yet.
      console.log(`[push] ${notif.type}: no subscribed device among ${userIds.length} recipient(s)`);
    }
  } catch (err) {
    console.error("[push] notifyStaff failed:", err);
  }
}

import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "node:crypto";
import { subscriptionDaysRemaining } from "@/lib/subscription";

// Real network calls (Supabase); never prerender/cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deactivates any restaurant whose subscription has hit 0 remaining days.
 *
 * Called once a day by Supabase pg_cron (see
 * supabase/cron/subscription-expiry-cron.sql). Nothing else in the app reacts
 * to elapsed time on its own — a restaurant nobody logs into just sits there —
 * so this is the only thing that actually flips `is_active` off when a
 * subscription lapses. It only ever turns restaurants OFF: it never touches one
 * that already has time left, and it never turns one back ON (that's
 * `updateSubscriptionDates`, run from the superadmin Settings page, the moment
 * a renewed date puts it back in credit).
 *
 * Secret-gated by `x-cron-secret` == CRON_SECRET (constant-time), same posture
 * as app/api/cron/daily-summary/route.ts and app/api/_perf/route.ts.
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const given = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req: Request) {
  if (!authorised(req)) return notFound();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurants } = await (service as any)
    .from("restaurants")
    .select("id, install_date, subscription_extra_days")
    .eq("is_active", true)
    .not("install_date", "is", null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (restaurants ?? []) as any[];

  const expiredIds = rows
    .filter((r) => {
      const remaining = subscriptionDaysRemaining(r.install_date, r.subscription_extra_days ?? 0);
      return remaining !== null && remaining <= 0;
    })
    .map((r) => r.id as string);

  if (expiredIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from("restaurants")
      .update({ is_active: false })
      .in("id", expiredIds);
    console.log(`subscription-expiry: deactivated ${expiredIds.length} restaurant(s): ${expiredIds.join(", ")}`);
  }

  return Response.json(
    { ok: true, checked: rows.length, deactivated: expiredIds.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}

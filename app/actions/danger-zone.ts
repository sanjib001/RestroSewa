"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string } | null;

const LOGO_BUCKET = "restaurant-logos";

// What the confirmation dialogs are built from. Every number here is counted
// live from the database at the moment the dialog opens — a warning that names
// the actual damage ("1,204 orders, ₹8,300 owed by 3 customers") is one a person
// reads. A generic "this cannot be undone" is one they click through.
export type RestaurantSummary = {
  restaurant: { id: string; name: string; slug: string; logo_url: string | null };
  financial: {
    sessions: number;
    orders: number;
    order_items: number;
    payments: number;
    revenue: number;
    credits: number;
    credit_payments: number;
    purchases: number;
    vendor_payments: number;
    salary_payments: number;
    stock_moves: number;
    room_stays: number;
    notifications: number;
    has_opening: boolean;
  };
  carried: {
    customer_debt: number;
    debtors: number;
    vendor_payable: number;
    creditors: number;
  };
  setup: {
    staff: number;
    menu_items: number;
    menu_categories: number;
    variants: number;
    tables: number;
    table_groups: number;
    rooms: number;
    workstations: number;
    products: number;
    vendors: number;
    credit_customers: number;
  };
};

export async function getRestaurantSummary(
  restaurantId: string
): Promise<RestaurantSummary | null> {
  await requireSuperAdmin();
  if (!restaurantId) return null;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("restaurant_data_summary", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data?.restaurant) return null;
  return data as RestaurantSummary;
}

// ─── 1. Reset finance & sales ────────────────────────────────────────────────
//
// Clears the books, keeps the restaurant. All the hard parts (what to delete, in
// what order, and carrying stock / payables / debts forward before their
// evidence disappears) live in `reset_restaurant_finance`, which is one
// transaction — it either all lands or none of it does. PostgREST cannot give us
// a transaction across sixteen separate DELETE calls, and a reset that fails
// halfway is worse than one that fails outright.

export async function resetRestaurantFinance(
  restaurantId: string,
  confirmation: string
): Promise<{ error: string } | { summary: RestaurantSummary }> {
  // The (superadmin) layout guards page RENDERING. A server action is its own
  // entry point, reachable by anyone who can POST — so it guards itself.
  await requireSuperAdmin();

  if (!restaurantId) return { error: "No restaurant selected." };

  // Re-checked here and not only in the dialog. A confirmation that exists only
  // in the browser is a suggestion, not a safeguard.
  if (confirmation.trim().toUpperCase() !== "RESET") {
    return { error: "Type RESET to confirm." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("reset_restaurant_finance", {
    p_restaurant_id: restaurantId,
  });

  if (error) {
    if (error.message?.includes("RESTAURANT_NOT_FOUND"))
      return { error: "That restaurant no longer exists." };
    return { error: error.message ?? "The reset failed. Nothing was changed." };
  }

  revalidateEverything(restaurantId);
  return { summary: data as RestaurantSummary };
}

// The new opening balance, set by the super admin on behalf of a restaurant they
// don't belong to. `setOpeningBalance` in finance.ts is the restaurant's own
// version and is scoped to the caller's restaurant_id, so it cannot serve here.
export async function setOpeningBalanceFor(
  restaurantId: string,
  cash: number,
  online: number
): Promise<ActionResult> {
  await requireSuperAdmin();

  if (!restaurantId) return { error: "No restaurant selected." };
  if (!Number.isFinite(cash) || !Number.isFinite(online) || cash < 0 || online < 0) {
    return { error: "Enter an amount of zero or more." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_finance_opening", {
    p_restaurant_id: restaurantId,
    p_cash: cash,
    p_online: online,
    p_effective_from: new Date().toISOString(),
    p_created_by: null, // a super admin is not a restaurant_user
  });

  if (error) return { error: "Could not save the opening balance." };

  revalidateEverything(restaurantId);
  return null;
}

// ─── 2. Delete restaurant setup ──────────────────────────────────────────────
//
// Three separate systems hold this restaurant's data, and only one of them is
// transactional. So: database first (all-or-nothing), and only once that has
// committed do we touch the two that cannot be rolled back.
//
// If the Auth or Storage cleanup fails afterwards, what is left is a leak — a
// login that authenticates into nothing, an unreferenced image — not a corrupt
// half-deleted restaurant. That asymmetry is the reason for the order.

export async function deleteRestaurantSetup(
  restaurantId: string,
  confirmation: string
): Promise<{ error: string } | { deleted: string; logins: number; warning?: string }> {
  await requireSuperAdmin();

  if (!restaurantId) return { error: "No restaurant selected." };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("id, name")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant) return { error: "That restaurant no longer exists." };

  // Typing the restaurant's own name is the real gate — it is the one phrase a
  // person cannot produce by muscle memory, and it proves they know WHICH
  // restaurant is selected. DELETE is accepted too, per the brief.
  const typed = confirmation.trim();
  const matchesName = typed.toLowerCase() === String(restaurant.name).trim().toLowerCase();
  const matchesWord = typed.toUpperCase() === "DELETE";
  if (!matchesName && !matchesWord) {
    return { error: `Type the restaurant's name (${restaurant.name}) or DELETE to confirm.` };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("delete_restaurant_cascade", {
    p_restaurant_id: restaurantId,
  });

  if (error) {
    if (error.message?.includes("RESTAURANT_NOT_FOUND"))
      return { error: "That restaurant no longer exists." };
    return { error: error.message ?? "The delete failed. Nothing was removed." };
  }

  const result = data as { name: string; logo_url: string | null; auth_user_ids: string[] };
  const authIds = result.auth_user_ids ?? [];
  const stranded: string[] = [];

  // The logins. restaurant_users.auth_user_id is ON DELETE SET NULL, so deleting
  // the restaurant does NOT remove these — every admin and staff account would
  // still authenticate, just into nothing. They have to be revoked explicitly,
  // and they live in auth.users, which is outside our schema.
  for (const id of authIds) {
    const { error: authErr } = await service.auth.admin.deleteUser(id);
    if (authErr) stranded.push(id);
  }

  // The logo. Uploaded to `${restaurantId}/${uuid}.ext`, so the restaurant's id
  // is its folder — list it rather than parsing logo_url, which would miss any
  // file left behind by a failed replace.
  const { data: files } = await service.storage.from(LOGO_BUCKET).list(restaurantId);
  if (files?.length) {
    await service.storage
      .from(LOGO_BUCKET)
      .remove(files.map((f) => `${restaurantId}/${f.name}`));
  }

  revalidateEverything(restaurantId);
  revalidatePath("/superadmin/settings");

  return {
    deleted: result.name,
    logins: authIds.length - stranded.length,
    // Told, not swallowed. These accounts can no longer reach anything, but they
    // still exist, and the super admin is the only one who can finish the job.
    warning: stranded.length
      ? `${stranded.length} login${stranded.length === 1 ? "" : "s"} could not be revoked and must be removed from Supabase Auth by hand.`
      : undefined,
  };
}

// Both operations change what every surface of the app would render, so both
// invalidate all of them — not just the page the super admin was standing on.
function revalidateEverything(restaurantId: string) {
  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  revalidatePath("/superadmin/dashboard");
  revalidatePath("/superadmin/settings");
  revalidatePath("/admin", "layout");
  revalidatePath("/employee", "layout");
  revalidatePath("/c", "layout");
}

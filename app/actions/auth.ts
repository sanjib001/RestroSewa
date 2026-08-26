"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

/**
 * The restaurant this DEVICE last signed into.
 *
 * `/login` only shows the staff name-picker and PIN pad when it is given `?slug=`, so a
 * staff member whose session ends has no way back to their own till screen — which is the
 * "open the manager's link again and rejoin the restaurant" step people were complaining
 * about. Remembering it here turns that into one tap.
 *
 * Set SERVER-side deliberately. A value written from JavaScript is capped at 7 days by
 * Safari's tracking prevention, which is the class of bug this whole change is unpicking.
 * It is not a credential and grants nothing on its own — a PIN is still required.
 */
const LAST_SLUG_COOKIE = "rs_last_slug";
const LAST_SLUG_MAX_AGE = 400 * 24 * 60 * 60; // the browser cap; effectively "remember it"

async function rememberRestaurant(slug: string) {
  const store = await cookies();
  store.set(LAST_SLUG_COOKIE, slug, {
    path: "/",
    maxAge: LAST_SLUG_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

/** The remembered restaurant, for `/login` to fall back to. */
export async function lastRestaurantSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(LAST_SLUG_COOKIE)?.value ?? null;
}

export type AuthResult = { error: string } | { redirectTo: string } | null;

/**
 * Sign out THIS device only.
 *
 * `supabase.auth.signOut()` defaults to `{ scope: "global" }`, which revokes every refresh
 * token the user holds — on every device — server-side. That default is what made the iOS
 * PWA unusable: an iPhone Home Screen web app has its OWN storage container, seeded from
 * Safari at install and never resynchronised, so logging out in Safari killed the PWA's
 * token remotely while a later Safari login landed only in Safari's container. The PWA was
 * then permanently signed out with no way back except deleting and reinstalling it.
 *
 * It also meant that logging out at the till signed the same staff member out on their
 * phone, and that merely using the wrong login form revoked every session they had.
 *
 * Local scope is what "log out" means to the person pressing it: this browser, this device.
 * Revoking a lost device is a deliberate admin action, not a side effect of a library
 * default.
 */
async function signOutThisDevice(supabase: {
  auth: { signOut: (options?: { scope?: "global" | "local" | "others" }) => Promise<unknown> };
}) {
  await supabase.auth.signOut({ scope: "local" });
}

export async function loginWithEmail(
  _prevState: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication failed." };

  const service = createServiceClient();

  // Reject super admins — they must use /superadmin/login
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sa } = await (service as any)
    .from("super_admins")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (sa) {
    await signOutThisDevice(supabase);
    return { error: "Super Admin accounts must use the Super Admin login page." };
  }

  // Check restaurant user role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ru } = await (service as any)
    .from("restaurant_users")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!ru) {
    await signOutThisDevice(supabase);
    return { error: "No account found. Please contact your administrator." };
  }

  revalidatePath("/", "layout");
  if (ru.role === "restaurant_admin") {
    return { redirectTo: "/admin/dashboard" };
  }
  return { redirectTo: "/employee/dashboard" };
}

export async function loginWithEmailSuperAdmin(
  _prevState: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication failed." };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sa } = await (service as any)
    .from("super_admins")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!sa) {
    await signOutThisDevice(supabase);
    return { error: "This login is for Super Admins only." };
  }

  revalidatePath("/", "layout");
  return { redirectTo: "/superadmin/dashboard" };
}

// A locked-out person is told how long is left, in the coarsest unit that
// still reads as true — "1 minute" for anything under two, so a 90-second wait
// doesn't claim to be "0 minutes".
function minutesLeft(retryAfter: string): number {
  const ms = new Date(retryAfter).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 60000));
}

export async function loginWithPin(
  _prevState: AuthResult,
  formData: FormData
): Promise<AuthResult> {
  const restaurantUserId = formData.get("restaurant_user_id") as string;
  const pin = formData.get("pin") as string;

  if (!restaurantUserId || !/^[0-9]{4}$/.test(pin)) {
    return { error: "PIN must be exactly 4 digits." };
  }

  const service = createServiceClient();

  // Checked BEFORE ever calling Supabase Auth — a lockout must refuse even the
  // right PIN, not just a wrong one, or it isn't really a lockout.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lockRows } = await (service as any).rpc("pin_lockout_status", {
    p_restaurant_user_id: restaurantUserId,
  });
  const lock = lockRows?.[0];
  if (lock?.locked) {
    const mins = minutesLeft(lock.retry_after);
    return { error: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }

  const syntheticEmail = `emp-${restaurantUserId}@restrosewa.internal`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: pin,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).rpc("record_pin_attempt", {
    p_restaurant_user_id: restaurantUserId,
    p_success: !error,
  });

  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: afterRows } = await (service as any).rpc("pin_lockout_status", {
      p_restaurant_user_id: restaurantUserId,
    });
    const justLocked = afterRows?.[0]?.locked;
    return {
      error: justLocked
        ? `Incorrect PIN. Too many wrong attempts — try again in 30 minutes.`
        : "Incorrect PIN. Please try again.",
    };
  }

  // Route by role so restaurant admins land on their management dashboard, not the
  // employee POS. Both admins and staff authenticate with the same synthetic-email + PIN.
  // The restaurant's slug comes back on the same query as the role — it costs nothing here
  // and is what lets this device find its way back to the right till screen next time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ru, error: ruError } = await (service as any)
    .from("restaurant_users")
    .select("role, restaurants ( slug )")
    .eq("id", restaurantUserId)
    .eq("is_active", true)
    .maybeSingle();

  // Don't route on a query that FAILED. This lookup uses the same `restaurants` embed the
  // page guards depend on, so when the embed breaks (a stale PostgREST schema cache is the
  // usual cause self-hosted) `ru` is null and the branch below cheerfully sends the person
  // to /employee/dashboard — which then cannot find them either and bounces them back here.
  // Saying so is the difference between a diagnosable error and an infinite redirect.
  if (ruError) {
    return { error: "Signed in, but your account could not be loaded. Please try again." };
  }

  // PostgREST returns a to-one embed as an object, but tolerate an array so a
  // relationship-shape change cannot break signing in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rest = Array.isArray((ru as any)?.restaurants)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ru as any).restaurants[0]
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ru as any)?.restaurants;
  if (rest?.slug) await rememberRestaurant(rest.slug);

  revalidatePath("/", "layout");
  if (ru?.role === "restaurant_admin") {
    return { redirectTo: "/admin/dashboard" };
  }
  return { redirectTo: "/employee/dashboard" };
}

export async function logout() {
  const supabase = await createClient();

  // Work out WHICH restaurant this person belongs to *before* signing out (afterwards there's no
  // session to read), so we can drop them back on that restaurant's own staff sign-in — the name
  // picker + PIN pad — rather than the generic admin login. That keeps the flow unbroken: they can
  // sign straight back in, or pick a different name to switch accounts, without hunting for the
  // manager's link again. Falls back to /login if the slug can't be resolved.
  let slug: string | null = null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ru } = await (service as any)
      .from("restaurant_users")
      .select("restaurant_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (ru?.restaurant_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: r } = await (service as any)
        .from("restaurants")
        .select("slug")
        .eq("id", ru.restaurant_id)
        .maybeSingle();
      slug = r?.slug ?? null;
    }
  }

  // Remember it across the sign-out, so the next person at this till gets the name picker
  // straight away rather than a generic login form.
  if (slug) await rememberRestaurant(slug);

  await signOutThisDevice(supabase);
  redirect(slug ? `/login?mode=staff&slug=${encodeURIComponent(slug)}` : "/login");
}

/**
 * Clear a session that resolves to nobody.
 *
 * `/login` reaches this state when there is a valid token but no super-admin row and no
 * staff row. Before, that combination silently fell through to the admin email form while
 * the guards kept redirecting back here — an unbreakable loop with no message, and inside
 * an installed PWA there is no URL bar to escape it with. Local scope only, for the reason
 * documented on `signOutThisDevice`. Lands back on /login, where `rs_last_slug` still puts
 * the right restaurant's PIN pad on screen.
 */
export async function signOutStrandedSession() {
  const supabase = await createClient();
  await signOutThisDevice(supabase);
  redirect("/login");
}

export async function logoutSuperAdmin() {
  const supabase = await createClient();
  await signOutThisDevice(supabase);
  redirect("/superadmin/login");
}

/**
 * Find a restaurant by name, so staff can reach their own sign-in without a manager.
 *
 * The slug is the only route to the staff name-picker + PIN pad, and slugs are up to 34
 * characters ("shining-crown-hotel-and-restaurant") — nobody is typing that on a phone
 * mid-shift. Searching by the name on the sign board is the one thing a staff member
 * always knows, and it is what removes the dependency on the manager's link for good.
 *
 * Deliberately narrow: active restaurants only, a minimum query length so it cannot be
 * used to list every tenant on the platform, a small result cap, and nothing returned but
 * the name and the slug. Knowing a slug grants nothing on its own — a PIN is still needed.
 */
export async function searchRestaurants(
  query: string
): Promise<Array<{ slug: string; name: string }>> {
  // `%` and `_` are ILIKE wildcards; stripping them keeps a typo from matching everything.
  const q = query.trim().replace(/[%_]/g, "");
  if (q.length < 2) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("name, slug")
    .eq("is_active", true)
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(8);

  return ((data ?? []) as Array<{ name: string; slug: string }>).map((r) => ({
    name: r.name,
    slug: r.slug,
  }));
}

export type StaffMember = {
  id: string;
  display_name: string;
  title: string;
  role: "restaurant_admin" | "restaurant_employee";
};

export async function getRestaurantStaff(
  slug: string
): Promise<StaffMember[] | null> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("id")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!restaurant) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff } = await (service as any)
    .from("restaurant_users")
    .select("id, display_name, title, role")
    .eq("restaurant_id", restaurant.id)
    .eq("is_active", true)
    .order("display_name");

  return (staff as StaffMember[]) ?? null;
}

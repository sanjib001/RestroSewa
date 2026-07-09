"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type AuthResult = { error: string } | { redirectTo: string } | null;

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
    await supabase.auth.signOut();
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
    await supabase.auth.signOut();
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
    await supabase.auth.signOut();
    return { error: "This login is for Super Admins only." };
  }

  revalidatePath("/", "layout");
  return { redirectTo: "/superadmin/dashboard" };
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

  const syntheticEmail = `emp-${restaurantUserId}@restrosewa.internal`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: pin,
  });

  if (error) {
    return { error: "Incorrect PIN. Please try again." };
  }

  // Route by role so restaurant admins land on their management dashboard, not the
  // employee POS. Both admins and staff authenticate with the same synthetic-email + PIN.
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ru } = await (service as any)
    .from("restaurant_users")
    .select("role")
    .eq("id", restaurantUserId)
    .eq("is_active", true)
    .maybeSingle();

  revalidatePath("/", "layout");
  if (ru?.role === "restaurant_admin") {
    return { redirectTo: "/admin/dashboard" };
  }
  return { redirectTo: "/employee/dashboard" };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function logoutSuperAdmin() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/superadmin/login");
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

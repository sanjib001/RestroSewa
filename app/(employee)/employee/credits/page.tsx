import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { NAV_ACCESS } from "@/lib/permissions";
import { getCredits, getCreditSummary } from "@/app/actions/credits";
import { CreditsView } from "./_components/credits-view";

// Customer credits — Cashier / Receptionist only (Billing + Close Bills). The
// same check gates the nav item, every credit server action and the RPCs, so a
// staff member without it can't reach customer debt by typing the URL either.
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!NAV_ACCESS.canManageCredits(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const { open } = await searchParams;

  const [credits, summary] = await Promise.all([
    getCredits({ status: "all" }),
    getCreditSummary(),
  ]);

  return (
    <CreditsView
      initialCredits={credits}
      initialSummary={summary}
      // Deep link to one customer's account (?open=<customerId>). Closing a bill
      // on credit now lands on the DASHBOARD's Credits section instead, so the
      // cashier never leaves the staff dashboard.
      initialOpenId={open ?? null}
    />
  );
}

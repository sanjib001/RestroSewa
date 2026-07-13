import { getAllRestaurants } from "@/app/actions/restaurants";
import { SettingsClient } from "./_components/settings-client";

export default async function SuperAdminSettingsPage() {
  const restaurants = await getAllRestaurants();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <h1
          className="text-xl"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          Settings
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          Reset login PINs, manage restaurant accounts, and reset or delete restaurant data
        </p>
      </div>

      <SettingsClient restaurants={restaurants} />
    </div>
  );
}

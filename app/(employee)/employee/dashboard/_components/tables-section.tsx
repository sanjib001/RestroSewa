import { getTableStatusOverview } from "@/app/actions/pos";
import { buildVisibilityFilter } from "@/lib/assignments";
import type { RestaurantUserContext } from "@/lib/auth/guards";
import { TablesGrid } from "./tables-grid";

// Tables only. Rooms used to be tacked onto the bottom of this section as an
// identical row of squares — a table is a seat, a room is a stay, and they need
// different information on the card. Rooms now live in RoomsSection.
//
// This server component does the FIRST fetch (so the list is in the HTML, with no
// loading flash); TablesGrid keeps it live from there. Both reads are memoised
// per request, so rendering this next to the Rooms section costs nothing extra.
export async function TablesSection({ restaurantUser }: { restaurantUser: RestaurantUserContext }) {
  const [tables, visibility] = await Promise.all([
    getTableStatusOverview(restaurantUser.restaurant_id),
    buildVisibilityFilter(restaurantUser.restaurant_id, restaurantUser),
  ]);

  const visible = tables.filter((t) => visibility.canSeeTable(t.id));

  // "None assigned to you" and "none exist at all" are different problems with
  // different fixes, so the empty state has to tell them apart.
  return <TablesGrid initial={visible} hasAnyTables={tables.length > 0} />;
}

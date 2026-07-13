import { getRoomsOverview } from "@/app/actions/rooms";
import { RoomsGrid } from "./rooms-grid";

// Rooms, on their own. Previously a row of identical squares bolted onto the end
// of the Tables section — which said nothing a receptionist needs: not who is in
// the room, not since when, not what they owe.
//
// The first fetch happens here so the cards are in the server HTML; RoomsGrid
// keeps them live by refetching itself, rather than calling router.refresh() and
// dragging the whole dashboard along with it.
export async function RoomsSection({ canCheckIn }: { canCheckIn: boolean }) {
  const rooms = await getRoomsOverview();

  return <RoomsGrid initial={rooms} canCheckIn={canCheckIn} />;
}

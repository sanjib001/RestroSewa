import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { subscribe, isListening } from "@/lib/realtime/bus";
import type { Topic } from "@/lib/realtime/bus";

// Long-lived SSE stream + a persistent DB listener: this must run on the Node
// runtime, not Edge, and must never be statically evaluated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A heartbeat keeps proxies from closing an idle stream and lets the client tell
// "connected but quiet" from "connection died".
const HEARTBEAT_MS = 25_000;

/**
 * Resolve who is listening, and to which restaurant.
 *
 * Staff  → signed in; scoped to their own restaurant.
 * Customer → not signed in, but holds a session id from their QR table; scoped
 *            to that session's restaurant. Since the stream carries only TOPIC
 *            NAMES and no row data, this exposes nothing — the customer still
 *            fetches everything through the same session-scoped actions.
 */
async function resolveRestaurant(sessionId: string | null): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const service = createServiceClient();

  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ru } = await (service as any)
      .from("restaurant_users")
      .select("restaurant_id")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (ru) return ru.restaurant_id as string;
  }

  if (sessionId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (service as any)
      .from("sessions")
      .select("restaurant_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (s) return s.restaurant_id as string;
  }

  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");

  const restaurantId = await resolveRestaurant(sessionId);
  if (!restaurantId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          closed = true;
        }
      };

      unsubscribe = await subscribe(restaurantId, (topic: Topic) => {
        // Only the topic name travels — never row data.
        send(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`);
      });

      // Report whether the DB listener actually came up. If it didn't, the client
      // keeps its fallback poll — a degraded stream must never be silent.
      send(
        `event: ready\ndata: ${JSON.stringify({ listening: isListening() })}\n\n`
      );

      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      // The browser navigating away / closing the tab aborts the request.
      request.signal.addEventListener("abort", () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer streamed responses by default, which would make
      // every event arrive late (or in a clump).
      "X-Accel-Buffering": "no",
    },
  });
}

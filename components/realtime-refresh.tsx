"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/lib/realtime/use-realtime";
import type { Topic } from "@/lib/realtime/use-realtime";

/**
 * Drop this into any SERVER-rendered section to make it live.
 *
 * On a matching change it calls `router.refresh()`, which re-runs the server
 * component and patches the DOM in place — no full page reload, no lost scroll
 * position, and the data still comes back through the same permission-checked
 * server code. Client components that hold their own state should call
 * `useRealtime` directly and refetch instead (router.refresh won't re-seed
 * `useState` initial props).
 */
export function RealtimeRefresh({
  topics,
  sessionId,
}: {
  topics: Topic[];
  sessionId?: string | null;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  useRealtime(topics, refresh, sessionId);

  return null;
}

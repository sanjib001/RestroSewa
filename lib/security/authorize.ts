import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { RestaurantUserContext } from "@/lib/auth/guards";

// The reusable Security-PIN authorization service. Any sensitive operation (editing a
// payment/purchase today; refunds, stock reset, finance reset tomorrow) authorizes the
// same way: call `verifySecurityPin` with a unique `operation` string, and on success run
// the op's own RPC (which logs its success atomically). Failures and blocks are logged
// here so they persist even when the operation itself is rejected/rolled back.
//
// This is server-only and deliberately NOT a "use server" action: it must be reachable
// only from other server actions that have already established an admin session, never
// invoked directly from a client.

/** Every operation the Security PIN gates. Add a member when a new sensitive op reuses it. */
export type SecurityOperation =
  | "edit_payment_tender"
  | "edit_purchase"
  // Opening the Mock Billing screen. Unlike the two above it changes NOTHING — it is
  // gated because a mock bill prints indistinguishably from a real one, so who opened
  // the tool (and who tried and failed) is the thing worth recording.
  | "open_mock_bill"
  // Correcting or removing a room advance. Unlike a tender edit, which only moves money
  // between columns, this rewrites a figure that has ALREADY been counted into a day's
  // cash balance — so a wrong advance left standing corrupts a till reconciliation that
  // nobody can later explain.
  | "edit_room_advance"
  // Correcting or removing an overhead (rent, electricity). Same reasoning as a
  // room advance: the row has ALREADY been subtracted from a day's cash balance,
  // so a wrong figure left standing — or a right one quietly deleted — breaks a
  // till reconciliation with nothing left to explain it.
  | "edit_extra_expense"
  | "delete_extra_expense"
  // Correcting or removing an extra-income entry. The mirror of the extra-expense
  // pair above, on the money-IN side — same reasoning, same admin-only gate.
  | "edit_extra_income"
  | "delete_extra_income"
  // Ending a stay without billing it, and keeping part (or none) of the deposit.
  // The only PIN operation that is NOT admin-only — a permitted staff member may
  // do it too — which is precisely why the PIN matters here: the permission says
  // who may try, the PIN says it is really them, and the log says what they kept.
  | "cancel_room_stay";

export type SecurityAuditRow = {
  id: string;
  createdAt: string;
  actorName: string | null;
  operation: string;
  targetType: string | null;
  outcome: "success" | "failure" | "blocked";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
};

type LogInput = {
  restaurantId: string;
  actor: Pick<RestaurantUserContext, "id" | "display_name">;
  operation: SecurityOperation;
  targetType: string | null;
  targetId: string | null;
  outcome: "success" | "failure" | "blocked";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail?: Record<string, any> | null;
};

// Writes one audit row. Successful EDITS are logged inside their RPC (atomic with the
// change); this path is for failures, blocks, and any op without its own success-logging RPC.
export async function logSecurityEvent(input: LogInput): Promise<void> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).rpc("log_security_event", {
    p_restaurant_id: input.restaurantId,
    p_actor_id: input.actor.id,
    p_actor_name: input.actor.display_name ?? null,
    p_operation: input.operation,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_outcome: input.outcome,
    p_detail: input.detail ?? null,
  });
}

// True only when a PIN is set AND matches. A wrong or absent PIN returns false and is
// recorded as a `failure` against the operation the caller was attempting.
export async function verifySecurityPin(
  restaurantUser: Pick<RestaurantUserContext, "id" | "restaurant_id" | "display_name">,
  operation: SecurityOperation,
  pin: string,
  target?: { type: string; id: string | null }
): Promise<boolean> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("verify_security_pin", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_pin: (pin ?? "").trim(),
  });

  const ok = !error && data === true;
  if (!ok) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      outcome: "failure",
    });
  }
  return ok;
}

// The recent security activity for the owner's Settings surface, newest first.
export async function getSecurityAuditRows(
  restaurantId: string,
  limit = 50
): Promise<SecurityAuditRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("security_audit_log")
    .select("id, created_at, actor_name, operation, target_type, outcome, detail")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 200));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    actorName: r.actor_name ?? null,
    operation: r.operation,
    targetType: r.target_type ?? null,
    outcome: r.outcome,
    detail: r.detail ?? null,
  }));
}

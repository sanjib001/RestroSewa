"use client";

import { useState, useTransition } from "react";
import { cancelOrderItem, updateOrderItemStatus } from "@/app/actions/pos";
import type { OrderItemRow } from "@/app/actions/pos";
import { Check, X } from "lucide-react";

// One order line, on a table's bill or a room's folio.
//
// Lifted out of the table's session screen so the ROOM screen renders the SAME
// control rather than a lookalike. That is the difference between "the two
// sections look consistent" and "the two sections ARE the same thing" — a change
// to how an item is served or cancelled now lands in both places at once, and
// they cannot drift apart later.

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  served: "Served",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#f97316",
  served: "var(--color-ink-mute)",
};

export function OrderItem({
  item,
  canCancel = false,
}: {
  item: OrderItemRow;
  canCancel?: boolean;
}) {
  const [, start] = useTransition();
  const [cancelError, setCancelError] = useState<string | null>(null);

  // One step: pending → served. There is no middle state any more.
  const nextStatus = item.item_status === "pending" ? "served" : null;

  // A served item was genuinely consumed — its stock stays deducted, so it can
  // never be cancelled. Only what is still pending can go back.
  const cancellable = canCancel && item.item_status !== "served";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b last:border-0"
      style={{
        borderColor: "var(--color-hairline)",
        opacity: item.item_status === "served" ? 0.45 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: "var(--color-ink)" }}>
          {item.quantity > 1 && (
            <span className="font-medium mr-1" style={{ color: "var(--color-ink-mute)" }}>
              ×{item.quantity}
            </span>
          )}
          {item.item_name}
        </p>
        {item.workstation_name && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {item.workstation_name}
          </p>
        )}
        {item.notes && (
          <p className="text-xs italic mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {item.notes}
          </p>
        )}
      </div>

      <p className="text-sm tabular shrink-0" style={{ color: "var(--color-ink-mute)" }}>
        ₹{(Number(item.item_price) * item.quantity).toFixed(0)}
      </p>

      <span
        className="text-xs shrink-0 min-w-[52px] text-center"
        style={{ color: STATUS_COLOR[item.item_status] }}
      >
        {STATUS_LABEL[item.item_status]}
      </span>

      {nextStatus && (
        <button
          type="button"
          title="Mark as served"
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)" }}
          onClick={() =>
            start(async () => {
              await updateOrderItemStatus(item.id, "served");
            })
          }
        >
          <Check size={13} style={{ color: "var(--color-ink-mute)" }} />
        </button>
      )}

      {/* Cancelling takes the item off the bill AND puts its stock back on the
          shelf, so it is confirmed rather than one-tap. */}
      {cancellable && (
        <button
          type="button"
          title="Cancel this item"
          aria-label={`Cancel ${item.item_name}`}
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)" }}
          onClick={() => {
            if (
              !confirm(
                `Cancel ${item.quantity > 1 ? `${item.quantity} × ` : ""}${item.item_name}?\n\nIt comes off the bill and its stock goes back.`
              )
            )
              return;
            setCancelError(null);
            start(async () => {
              const res = await cancelOrderItem(item.id);
              if (res?.error) setCancelError(res.error);
            });
          }}
        >
          <X size={13} style={{ color: "#dc2626" }} />
        </button>
      )}

      {cancelError && (
        <span className="text-xs shrink-0" style={{ color: "#dc2626" }}>
          {cancelError}
        </span>
      )}
    </div>
  );
}
